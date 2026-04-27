const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const ROOT_DIR = __dirname;
const DEFAULT_PAGE = 'index.html';
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const STORAGE_FOLDERS = {
  games: path.join(STORAGE_DIR, 'games'),
  engine: path.join(STORAGE_DIR, 'engine')
};
const UPLOAD_RULES = {
  games: {
    extensions: new Set(['.pgn']),
    contentTypes: new Set([
      'application/x-chess-pgn',
      'application/octet-stream',
      'text/plain'
    ]),
    maxBytes: 10 * 1024 * 1024
  },
  engine: {
    extensions: new Set(['.js', '.wasm']),
    contentTypes: new Set([
      'application/javascript',
      'text/javascript',
      'application/wasm',
      'application/octet-stream'
    ]),
    maxBytes: 32 * 1024 * 1024
  }
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pgn': 'application/x-chess-pgn; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8'
};

function ensureStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  Object.values(STORAGE_FOLDERS).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return cleaned || null;
}

function stripContentTypeParameters(contentType) {
  return String(contentType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function validateUploadRequest(type, fileName, contentType) {
  const rules = UPLOAD_RULES[type];
  if (!rules) {
    return { ok: false, statusCode: 400, error: 'Unknown upload type. Use games or engine.' };
  }

  if (!fileName || fileName === '.' || fileName === '..') {
    return { ok: false, statusCode: 400, error: 'filename query parameter is required.' };
  }

  if (fileName.includes('..')) {
    return { ok: false, statusCode: 400, error: 'filename must not contain path traversal segments.' };
  }

  if (fileName.length > 120) {
    return { ok: false, statusCode: 400, error: 'filename is too long.' };
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!rules.extensions.has(extension)) {
    return {
      ok: false,
      statusCode: 415,
      error: `Unsupported file extension for ${type}. Allowed: ${Array.from(rules.extensions).join(', ')}`
    };
  }

  const normalizedContentType = stripContentTypeParameters(contentType);
  if (normalizedContentType && !rules.contentTypes.has(normalizedContentType)) {
    return {
      ok: false,
      statusCode: 415,
      error: `Unsupported Content-Type for ${type}: ${normalizedContentType}`
    };
  }

  return { ok: true, rules };
}

function resolveUploadPath(type, fileName) {
  const targetDir = STORAGE_FOLDERS[type];
  const targetPath = path.resolve(targetDir, fileName);

  if (path.dirname(targetPath) !== targetDir) {
    return null;
  }

  if (!targetPath.startsWith(`${targetDir}${path.sep}`) && targetPath !== targetDir) {
    return null;
  }

  return targetPath;
}

function isValidWasmBinary(body) {
  return body.length >= 4
    && body[0] === 0x00
    && body[1] === 0x61
    && body[2] === 0x73
    && body[3] === 0x6d;
}

function resolveStaticPath(requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const safePath = decodedPath === '/' ? `/${DEFAULT_PAGE}` : decodedPath;
  const targetPath = path.resolve(ROOT_DIR, `.${safePath}`);
  if (!targetPath.startsWith(ROOT_DIR)) return null;
  return targetPath;
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(res, 404, 'File not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = ['.html', '.js', '.css'].includes(ext)
      ? 'no-store, no-cache, must-revalidate'
      : 'public, max-age=3600';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl,
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => sendText(res, 500, 'Failed to read file'));
    stream.pipe(res);
  });
}

function readRequestBody(req, limitBytes = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        const error = new Error('Request body is too large');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function listStorageFiles() {
  return Object.fromEntries(
    Object.entries(STORAGE_FOLDERS).map(([key, dir]) => {
      const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, 'ru'));
      return [key, files];
    })
  );
}

async function handleUpload(req, res, url) {
  const type = url.searchParams.get('type');
  const rawFileName = url.searchParams.get('filename');
  const fileName = sanitizeFileName(rawFileName);
  const validation = validateUploadRequest(type, fileName, req.headers['content-type']);
  if (!validation.ok) {
    sendJson(res, validation.statusCode, { error: validation.error });
    return;
  }

  const targetPath = resolveUploadPath(type, fileName);
  if (!targetPath) {
    sendJson(res, 400, { error: 'Invalid upload target path.' });
    return;
  }

  try {
    const body = await readRequestBody(req, validation.rules.maxBytes);
    if (!body.length) {
      sendJson(res, 400, { error: 'Empty request body.' });
      return;
    }

    if (path.extname(fileName).toLowerCase() === '.wasm' && !isValidWasmBinary(body)) {
      sendJson(res, 400, { error: 'WASM upload must start with a valid wasm header.' });
      return;
    }

    if (fs.existsSync(targetPath)) {
      sendJson(res, 409, { error: 'A file with this name already exists.' });
      return;
    }

    fs.writeFileSync(targetPath, body);

    sendJson(res, 201, {
      ok: true,
      type,
      fileName,
      bytes: body.length,
      savedTo: path.relative(ROOT_DIR, targetPath)
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || 'Upload failed.' });
  }
}

ensureStorage();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      host: HOST,
      port: PORT,
      files: listStorageFiles()
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    await handleUpload(req, res, url);
    return;
  }

  if (req.method === 'GET') {
    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      sendText(res, 403, 'Forbidden');
      return;
    }
    serveFile(req, res, filePath);
    return;
  }

  sendText(res, 405, 'Method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`Server is running at http://${HOST}:${PORT}`);
});
