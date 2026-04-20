const PGN_SOURCE = 'storage/games/best games.pgn';

const { loadPgnText, buildGames } = window.appPgn;
const { createPositionCache } = window.appPosition;
const { createRenderer } = window.appRender;

const PIECES = {
  p: 'https://lichess1.org/assets/piece/cburnett/bP.svg',
  r: 'https://lichess1.org/assets/piece/cburnett/bR.svg',
  n: 'https://lichess1.org/assets/piece/cburnett/bN.svg',
  b: 'https://lichess1.org/assets/piece/cburnett/bB.svg',
  q: 'https://lichess1.org/assets/piece/cburnett/bQ.svg',
  k: 'https://lichess1.org/assets/piece/cburnett/bK.svg',
  P: 'https://lichess1.org/assets/piece/cburnett/wP.svg',
  R: 'https://lichess1.org/assets/piece/cburnett/wR.svg',
  N: 'https://lichess1.org/assets/piece/cburnett/wN.svg',
  B: 'https://lichess1.org/assets/piece/cburnett/wB.svg',
  Q: 'https://lichess1.org/assets/piece/cburnett/wQ.svg',
  K: 'https://lichess1.org/assets/piece/cburnett/wK.svg'
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const boardEl = document.getElementById('board');
const boardShellEl = document.querySelector('.board-shell');
const boardResizeHandleEl = document.getElementById('boardResizeHandle');
const gamesListEl = document.getElementById('gamesList');
const movesWrapEl = document.getElementById('movesWrap');
const boardTitleEl = document.getElementById('boardTitle');
const boardSubtitleEl = document.getElementById('boardSubtitle');
const whiteTurnDotEl = document.getElementById('whiteTurnDot');
const blackTurnDotEl = document.getElementById('blackTurnDot');
const themeToggleBtnEl = document.getElementById('themeToggleBtn');
const themeMenuEl = document.getElementById('themeMenu');
const themeOptionEls = Array.from(document.querySelectorAll('.theme-option'));
const resetAnalysisBtnEl = document.getElementById('resetAnalysisBtn');
const prevGameBtnEl = document.getElementById('prevGameBtn');
const nextGameBtnEl = document.getElementById('nextGameBtn');
const engineStateEl = document.getElementById('engineState');
const evalLineEl = document.getElementById('evalLine');
const bestMoveLineEl = document.getElementById('bestMoveLine');
const pvLineEl = document.getElementById('pvLine');
const THEMES = ['classic', 'light', 'blue'];

const stockfish = typeof window.createStockfishController === 'function'
  ? window.createStockfishController({
      onStateChange: ({ engineState, evalText, bestMoveText, pvText }) => {
        if (engineState !== undefined) engineStateEl.textContent = engineState;
        if (evalText !== undefined) evalLineEl.textContent = evalText;
        if (bestMoveText !== undefined) bestMoveLineEl.textContent = bestMoveText;
        if (pvText !== undefined) pvLineEl.textContent = pvText;
      }
    })
  : null;

const state = {
  games: [],
  gameIndex: 0,
  replayIndex: 0,
  boardSize: Number(localStorage.getItem('cm_board_size')) || null,
  theme: THEMES.includes(localStorage.getItem('cm_theme')) ? localStorage.getItem('cm_theme') : 'classic',
  sortKey: 'date',
  sortDir: 'desc',
  orientation: localStorage.getItem('cm_orientation') || 'white',
  selectedSquare: null,
  legalTargets: [],
  analysisMode: false,
  analysisBaseIndex: null,
  analysisRoot: null,
  analysisCurrentNode: null,
  analysisNodeSeq: 1,
  lastMove: null
};

const BOARD_MIN_SIZE = 320;
let keyboardScope = 'viewer';

function currentGame() {
  return state.games[state.gameIndex];
}

function setKeyboardScope(scope) {
  keyboardScope = scope;
}

const positionCache = createPositionCache({
  getCurrentFen: () => {
    if (state.analysisMode && state.analysisCurrentNode) return state.analysisCurrentNode.fen;
    return currentGame().states[state.replayIndex].fen;
  }
});

const renderer = createRenderer({
  state,
  elements: {
    boardEl,
    gamesListEl,
    movesWrapEl,
    boardTitleEl,
    boardSubtitleEl,
    whiteTurnDotEl,
    blackTurnDotEl,
    resetAnalysisBtnEl
  },
  constants: {
    PIECES,
    FILES,
    RANKS
  },
  getCurrentGame: currentGame,
  getCurrentChess: positionCache.currentChess
});

movesWrapEl.addEventListener('click', (event) => {
  const variationBtn = event.target.closest('.variation-btn[data-node-id]');
  if (!variationBtn) return;
  const node = findAnalysisNodeById(variationBtn.dataset.nodeId);
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  goToAnalysisNode(node);
});

function boardMaxSize() {
  const panelWidth = boardShellEl.parentElement ? boardShellEl.parentElement.clientWidth - 28 : 700;
  return Math.max(BOARD_MIN_SIZE, panelWidth);
}

function clampBoardSize(size) {
  return Math.max(BOARD_MIN_SIZE, Math.min(boardMaxSize(), Math.round(size)));
}

function persistBoardSize() {
  if (state.boardSize) localStorage.setItem('cm_board_size', String(state.boardSize));
  else localStorage.removeItem('cm_board_size');
}

function persistTheme() {
  localStorage.setItem('cm_theme', state.theme);
}

function updateThemeMenu() {
  if (!themeToggleBtnEl || !themeMenuEl) return;
  themeToggleBtnEl.textContent = 'Тема';
  themeOptionEls.forEach((optionEl) => {
    const isActive = optionEl.dataset.theme === state.theme;
    optionEl.classList.toggle('active', isActive);
    optionEl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function applyTheme() {
  document.body.dataset.theme = state.theme;
  updateThemeMenu();
}

function setTheme(theme) {
  if (!THEMES.includes(theme) || theme === state.theme) return;
  state.theme = theme;
  persistTheme();
  applyTheme();
}

function closeThemeMenu() {
  if (!themeMenuEl || !themeToggleBtnEl) return;
  themeMenuEl.hidden = true;
  themeToggleBtnEl.setAttribute('aria-expanded', 'false');
}

function toggleThemeMenu() {
  if (!themeMenuEl || !themeToggleBtnEl) return;
  const shouldOpen = themeMenuEl.hidden;
  themeMenuEl.hidden = !shouldOpen;
  themeToggleBtnEl.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function applyBoardSize() {
  if (!state.boardSize) {
    boardShellEl.style.width = '';
    return;
  }
  const nextSize = clampBoardSize(state.boardSize);
  state.boardSize = nextSize;
  boardShellEl.style.width = `${nextSize}px`;
}

function beginBoardResize(event) {
  event.preventDefault();

  const pointerMove = (moveEvent) => {
    const nextSize = clampBoardSize(moveEvent.clientX - boardShellEl.getBoundingClientRect().left);
    state.boardSize = nextSize;
    applyBoardSize();
  };

  const pointerUp = () => {
    boardShellEl.classList.remove('resizing');
    persistBoardSize();
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
  };

  boardShellEl.classList.add('resizing');
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
}

function createAnalysisNode(parent, move, fen) {
  return { id: state.analysisNodeSeq++, parent, move, fen, children: [] };
}

function clearAnalysis() {
  state.analysisMode = false;
  state.analysisBaseIndex = null;
  state.analysisRoot = null;
  state.analysisCurrentNode = null;
}

function leaveAnalysisView() {
  state.analysisMode = false;
}

function beginAnalysisFromReplay() {
  const fen = currentGame().states[state.replayIndex].fen;
  state.analysisMode = true;
  state.analysisBaseIndex = state.replayIndex;
  state.analysisRoot = createAnalysisNode(null, null, fen);
  state.analysisCurrentNode = state.analysisRoot;
  state.lastMove = currentGame().states[state.replayIndex].move || null;
}

function goToAnalysisNode(node) {
  if (!node) return;
  state.analysisMode = true;
  state.analysisCurrentNode = node;
  state.selectedSquare = null;
  state.legalTargets = [];
  state.lastMove = node.move || currentGame().states[state.replayIndex].move || null;
  refresh();
}

function findMatchingChild(parent, move) {
  return parent.children.find((child) =>
    child.move
    && child.move.from === move.from
    && child.move.to === move.to
    && String(child.move.promotion || '') === String(move.promotion || '')
  );
}

function flattenAnalysisNodes(node, acc = []) {
  if (!node) return acc;
  acc.push(node);
  node.children.forEach((child) => flattenAnalysisNodes(child, acc));
  return acc;
}

function findAnalysisNodeById(id) {
  if (!state.analysisRoot) return null;
  return flattenAnalysisNodes(state.analysisRoot).find((node) => String(node.id) === String(id)) || null;
}

function setGamesSort(key) {
  if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else {
    state.sortKey = key;
    state.sortDir = key === 'date' ? 'desc' : 'asc';
  }
  renderer.renderGamesList();
  updateGameNavButtons();
}

function selectRelativeGame(delta) {
  const orderedGames = renderer.getSortedGames();
  const currentIndex = orderedGames.findIndex((game) => game.id === state.gameIndex);
  if (currentIndex === -1) return;
  const nextIndex = Math.max(0, Math.min(currentIndex + delta, orderedGames.length - 1));
  if (nextIndex === currentIndex) return;
  selectGame(orderedGames[nextIndex].id);
}

function updateGameNavButtons() {
  const orderedGames = renderer.getSortedGames();
  const currentIndex = orderedGames.findIndex((game) => game.id === state.gameIndex);
  const isAtStart = currentIndex <= 0;
  const isAtEnd = currentIndex === -1 || currentIndex >= orderedGames.length - 1;
  prevGameBtnEl.disabled = isAtStart;
  nextGameBtnEl.disabled = isAtEnd;
}

function goToReplay(index) {
  const game = currentGame();
  const hadAnalysisView = state.analysisMode;
  setKeyboardScope('viewer');
  state.replayIndex = Math.max(0, Math.min(index, game.moves.length));
  leaveAnalysisView();
  state.selectedSquare = null;
  state.legalTargets = [];
  state.lastMove = game.states[state.replayIndex].move || null;
  persistState();
  refresh({ renderMoves: hadAnalysisView });
}

function selectGame(index) {
  setKeyboardScope('games');
  state.gameIndex = index;
  state.replayIndex = 0;
  clearAnalysis();
  state.selectedSquare = null;
  state.legalTargets = [];
  state.lastMove = null;
  persistState();
  refresh({ renderMoves: true });
  renderer.updateGamesSelectionState();
  updateGameNavButtons();
}

function legalMovesFrom(square, chess = positionCache.currentChess()) {
  return chess.moves({ square, verbose: true }) || [];
}

function onSquareClick(event) {
  const squareEl = event.target.closest('.square[data-square]');
  if (!squareEl) return;

  const sq = squareEl.dataset.square;
  const chess = positionCache.currentChess();
  const piece = chess.get(sq);

  if (state.selectedSquare) {
    const from = state.selectedSquare;
    const legal = legalMovesFrom(from, chess);
    const candidate = legal.find((move) => move.to === sq);

    if (candidate) {
      if (!state.analysisMode) beginAnalysisFromReplay();
      const parentNode = state.analysisCurrentNode;
      const analysisChess = new window.Chess(parentNode.fen);
      const playedMove = analysisChess.move({ from, to: sq, promotion: candidate.promotion || 'q' });
      let nextNode = findMatchingChild(parentNode, playedMove);

      if (!nextNode) {
        nextNode = createAnalysisNode(parentNode, playedMove, analysisChess.fen());
        parentNode.children.push(nextNode);
      }

      state.analysisCurrentNode = nextNode;
      state.lastMove = nextNode.move || null;
      state.selectedSquare = null;
      state.legalTargets = [];
      refresh();
      return;
    }
  }

  if (piece && piece.color === chess.turn()) {
    state.selectedSquare = sq;
    state.legalTargets = legalMovesFrom(sq, chess).map((move) => move.to);
  } else {
    state.selectedSquare = null;
    state.legalTargets = [];
  }

  renderer.renderBoard();
}

function persistState() {
  localStorage.setItem('cm_game_index', String(state.gameIndex));
  localStorage.setItem('cm_replay_index', String(state.replayIndex));
  localStorage.setItem('cm_orientation', state.orientation);
}

function restoreState() {
  const savedGameIndex = Number(localStorage.getItem('cm_game_index'));
  if (Number.isInteger(savedGameIndex) && savedGameIndex >= 0 && savedGameIndex < state.games.length) {
    state.gameIndex = savedGameIndex;
  }

  const game = currentGame();
  const savedReplayIndex = Number(localStorage.getItem('cm_replay_index'));
  if (Number.isInteger(savedReplayIndex)) {
    state.replayIndex = Math.max(0, Math.min(savedReplayIndex, game.moves.length));
  } else {
    state.replayIndex = 0;
  }

  state.lastMove = game.states[state.replayIndex].move || null;
}

function refresh({ renderMoves: shouldRenderMoves = true } = {}) {
  const chess = positionCache.currentChess();
  renderer.updateHeader();
  renderer.renderBoard();
  if (shouldRenderMoves) renderer.renderMoves();
  else renderer.updateCurrentMoveState();
  renderer.scrollCurrentMoveIntoView();
  updateGameNavButtons();
  if (stockfish) stockfish.requestAnalysis(chess.fen());
}

document.getElementById('flipBtn').addEventListener('click', () => {
  state.orientation = state.orientation === 'white' ? 'black' : 'white';
  persistState();
  renderer.renderBoard();
});
prevGameBtnEl.addEventListener('click', () => {
  setKeyboardScope('games');
  selectRelativeGame(-1);
});
nextGameBtnEl.addEventListener('click', () => {
  setKeyboardScope('games');
  selectRelativeGame(1);
});
boardResizeHandleEl.addEventListener('pointerdown', beginBoardResize);
boardEl.addEventListener('click', (event) => {
  setKeyboardScope('viewer');
  onSquareClick(event);
});

themeToggleBtnEl.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleThemeMenu();
});

themeOptionEls.forEach((optionEl) => {
  optionEl.addEventListener('click', () => {
    setTheme(optionEl.dataset.theme);
    closeThemeMenu();
  });
});

movesWrapEl.addEventListener('click', (event) => {
  setKeyboardScope('viewer');
  const replayBtn = event.target.closest('.move-btn[data-replay-index]');
  if (replayBtn) {
    goToReplay(Number(replayBtn.dataset.replayIndex));
  }
});

gamesListEl.addEventListener('click', (event) => {
  setKeyboardScope('games');
  const sortBtn = event.target.closest('.table-sort-btn[data-sort-key]');
  if (sortBtn) {
    setGamesSort(sortBtn.dataset.sortKey);
    return;
  }

  const gameRow = event.target.closest('tr[data-game-id]');
  if (gameRow) {
    selectGame(Number(gameRow.dataset.gameId));
  }
});

document.getElementById('startBtn').addEventListener('click', () => {
  setKeyboardScope('viewer');
  goToReplay(0);
});
document.getElementById('prevBtn').addEventListener('click', () => {
  setKeyboardScope('viewer');
  if (state.analysisMode && state.analysisCurrentNode && state.analysisCurrentNode.parent) {
    return goToAnalysisNode(state.analysisCurrentNode.parent);
  }
  goToReplay(state.replayIndex - 1);
});
document.getElementById('nextBtn').addEventListener('click', () => {
  setKeyboardScope('viewer');
  if (state.analysisMode && state.analysisCurrentNode && state.analysisCurrentNode.children[0]) {
    return goToAnalysisNode(state.analysisCurrentNode.children[0]);
  }
  goToReplay(state.replayIndex + 1);
});
document.getElementById('endBtn').addEventListener('click', () => {
  setKeyboardScope('viewer');
  if (state.analysisMode && state.analysisCurrentNode) {
    let node = state.analysisCurrentNode;
    while (node.children[0]) node = node.children[0];
    return goToAnalysisNode(node);
  }
  goToReplay(currentGame().moves.length);
});
document.getElementById('resetAnalysisBtn').addEventListener('click', () => {
  setKeyboardScope('viewer');
  const target = state.analysisBaseIndex !== null ? state.analysisBaseIndex : state.replayIndex;
  goToReplay(target);
});
document.getElementById('copyFenBtn').addEventListener('click', async () => {
  const fen = positionCache.currentFen();
  try {
    await navigator.clipboard.writeText(fen);
  } catch (_) {}
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && themeMenuEl && !themeMenuEl.hidden) {
    closeThemeMenu();
    return;
  }

  if (keyboardScope === 'games') {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectRelativeGame(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectRelativeGame(1);
      return;
    }
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
  }

  if (state.analysisMode && state.analysisCurrentNode) {
    if (event.key === 'ArrowLeft' && state.analysisCurrentNode.parent) return goToAnalysisNode(state.analysisCurrentNode.parent);
    if (event.key === 'ArrowRight' && state.analysisCurrentNode.children[0]) return goToAnalysisNode(state.analysisCurrentNode.children[0]);
    if (event.key === 'Home') return goToAnalysisNode(state.analysisRoot);
    if (event.key === 'End') {
      let node = state.analysisCurrentNode;
      while (node.children[0]) node = node.children[0];
      return goToAnalysisNode(node);
    }
  }

  if (event.key === 'ArrowLeft') goToReplay(state.replayIndex - 1);
  if (event.key === 'ArrowRight') goToReplay(state.replayIndex + 1);
  if (event.key === 'Home') goToReplay(0);
  if (event.key === 'End') goToReplay(currentGame().moves.length);
});

window.addEventListener('resize', () => {
  if (!state.boardSize) return;
  applyBoardSize();
});

document.addEventListener('click', (event) => {
  if (!themeMenuEl || themeMenuEl.hidden) return;
  if (event.target.closest('.theme-switcher')) return;
  closeThemeMenu();
});

async function boot() {
  applyTheme();

  if (typeof window.Chess !== 'function') {
    boardTitleEl.textContent = 'Ошибка загрузки chess.js';
    boardSubtitleEl.textContent = 'Проверь подключение к интернету: без библиотеки браузер не сможет разобрать PGN.';
    return;
  }

  let rawPgn = '';
  try {
    rawPgn = await loadPgnText(PGN_SOURCE);
  } catch (error) {
    console.error('PGN load error', error);
    boardTitleEl.textContent = 'Партии не загружены';
    boardSubtitleEl.textContent = 'Не удалось загрузить PGN-файл. Проверь путь и запуск через локальный сервер.';
    return;
  }

  state.games = buildGames(rawPgn);
  if (!state.games.length) {
    boardTitleEl.textContent = 'Партии не найдены';
    boardSubtitleEl.textContent = 'PGN-файл загрузился, но не удалось его прочитать.';
    return;
  }

  applyBoardSize();
  restoreState();
  renderer.renderGamesList();
  refresh();
  if (stockfish) stockfish.init();
}

boot();
