const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const PORT = 8123;
const BASE_URL = `http://${HOST}:${PORT}`;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function requireFile(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  assert.ok(fs.existsSync(fullPath), `${relativePath} must exist`);
  return fullPath;
}

async function waitForServer(serverProcess) {
  const deadline = Date.now() + 5000;
  let lastError = null;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`server.js exited early with code ${serverProcess.exitCode}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/index.html`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw lastError || new Error('server.js did not start');
}

async function assertHttpOk(relativeUrl) {
  const response = await fetch(`${BASE_URL}${relativeUrl}`);
  assert.strictEqual(response.status, 200, `${relativeUrl} should return 200`);
}

async function main() {
  requireFile('index.html');
  requireFile('App.js');
  requireFile('Styles.css');
  requireFile('vendor/chess/chess-0.10.3.min.js');
  requireFile('vendor/stockfish/stockfish-17.1-lite-single-03e3232.js');
  requireFile('vendor/stockfish/stockfish-17.1-lite-single-03e3232.wasm');
  requireFile('storage/games/best games.pgn');

  const { Chess } = require('./vendor/chess/chess-0.10.3.min.js');
  assert.strictEqual(typeof Chess, 'function', 'local chess.js should export Chess');

  global.window = { Chess };
  require('./app-pgn.js');
  require('./app-render.js');

  const rawPgn = fs.readFileSync(path.join(ROOT, 'storage/games/best games.pgn'), 'utf8');
  const games = window.appPgn.buildGames(rawPgn);
  assert.ok(games.length > 0, 'PGN should produce at least one game');
  assert.ok(games[0].moves.length > 0, 'first PGN game should contain moves');
  assert.strictEqual(games[0].states[0].fen, START_FEN, 'first game state should start from the initial position');

  const state = {
    games,
    sortKey: 'date',
    sortDir: 'desc',
    orientation: 'white',
    selectedSquare: null,
    legalTargets: [],
    lastMove: null
  };
  const renderer = window.appRender.createRenderer({
    state,
    elements: {},
    constants: {
      PIECES: {},
      FILES: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      RANKS: ['8', '7', '6', '5', '4', '3', '2', '1']
    },
    getCurrentGame: () => games[state.gameIndex || 0],
    getCurrentChess: () => new Chess(START_FEN)
  });

  const sortedGames = renderer.getSortedGames();
  assert.ok(sortedGames[0], 'sorted games should contain the first visible game');
  assert.strictEqual(renderer.getSortedGames(), sortedGames, 'sorted games should be cached between calls');
  state.gameIndex = sortedGames[0].id;
  state.replayIndex = 0;
  state.orientation = 'white';
  assert.strictEqual(games[state.gameIndex].states[state.replayIndex].fen, START_FEN, 'opening view should use move 0');
  assert.strictEqual(state.orientation, 'white', 'opening view should face white');

  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: 'ignore',
    windowsHide: true
  });

  try {
    await waitForServer(serverProcess);
    await assertHttpOk('/index.html');
    await assertHttpOk('/App.js');
    await assertHttpOk('/Styles.css');
    await assertHttpOk('/vendor/chess/chess-0.10.3.min.js');
    await assertHttpOk('/vendor/stockfish/stockfish-17.1-lite-single-03e3232.js');
    await assertHttpOk('/vendor/stockfish/stockfish-17.1-lite-single-03e3232.wasm');
    await assertHttpOk('/storage/games/best%20games.pgn');
  } finally {
    serverProcess.kill();
  }

  console.log('Smoke-check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
