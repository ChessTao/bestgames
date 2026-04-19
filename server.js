const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const ROOT_DIR = __dirname;
const DEFAULT_PAGE = 'Best Games.html';
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const STORAGE_FOLDERS = {
  games: path.join(STORAGE_DIR, 'games'),
  engine: path.join(STORAGE_DIR, 'engine')
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

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size
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
        reject(new Error('Request body is too large'));
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

  if (!Object.prototype.hasOwnProperty.call(STORAGE_FOLDERS, type)) {
    sendJson(res, 400, { error: 'Unknown upload type. Use games or engine.' });
    return;
  }

  const fileName = sanitizeFileName(rawFileName);
  if (!fileName) {
    sendJson(res, 400, { error: 'filename query parameter is required.' });
    return;
  }

  try {
    const body = await readRequestBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: 'Empty request body.' });
      return;
    }

    const targetPath = path.join(STORAGE_FOLDERS[type], fileName);
    fs.writeFileSync(targetPath, body);

    sendJson(res, 201, {
      ok: true,
      type,
      fileName,
      bytes: body.length,
      savedTo: path.relative(ROOT_DIR, targetPath)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Upload failed.' });
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
