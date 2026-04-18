    const PGN_SOURCE = 'best games.pgn';

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

    const FILES = ['a','b','c','d','e','f','g','h'];
    const RANKS = ['8','7','6','5','4','3','2','1'];

    const boardEl = document.getElementById('board');
    const gamesListEl = document.getElementById('gamesList');
    const movesWrapEl = document.getElementById('movesWrap');
    const boardTitleEl = document.getElementById('boardTitle');
    const boardSubtitleEl = document.getElementById('boardSubtitle');
    const whiteTurnDotEl = document.getElementById('whiteTurnDot');
    const blackTurnDotEl = document.getElementById('blackTurnDot');
    const resetAnalysisBtnEl = document.getElementById('resetAnalysisBtn');
    const engineStateEl = document.getElementById('engineState');
    const evalLineEl = document.getElementById('evalLine');
    const bestMoveLineEl = document.getElementById('bestMoveLine');
    const pvLineEl = document.getElementById('pvLine');
    movesWrapEl.addEventListener('click', (event) => {
      const variationBtn = event.target.closest('.variation-btn[data-node-id]');
      if (!variationBtn) return;
      const node = findAnalysisNodeById(variationBtn.dataset.nodeId);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      goToAnalysisNode(node);
    });


    const state = {
      games: [],
      gameIndex: 0,
      replayIndex: 0,
      orientation: localStorage.getItem('cm_orientation') || 'white',
      selectedSquare: null,
      legalTargets: [],
      analysisMode: false,
      analysisBaseIndex: null,
      analysisRoot: null,
      analysisCurrentNode: null,
      analysisNodeSeq: 1,
      lastMove: null,
      engine: null,
      engineReady: false,
      engineFen: null,
      engineBestMove: '',
      enginePv: '',
      currentEval: ''
    };

    async function loadPgnText() {
      const response = await fetch(PGN_SOURCE, { cache: 'no-store' });
      if (!response.ok) throw new Error(`PGN request failed: ${response.status}`);
      return response.text();
    }

    function normalizePgnText(text) {
      return (text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    }
    function splitMultiPgn(text) {
      const cleaned = normalizePgnText(text);
      if (!cleaned) return [];
      return cleaned.split(/\n(?=\[Event\s)/g).map(s => s.trim()).filter(Boolean);
    }
    function parseHeaders(pgn) {
      const headers = {};
      const matches = pgn.matchAll(/^\[(\w+)\s+"(.*)"\]$/gm);
      for (const m of matches) headers[m[1]] = m[2];
      return headers;
    }
    function shortEventLabel(eventName = '') {
      const event = String(eventName || '').trim();
      if (!event) return 'Без турнира';
      const sixDaysMatch = event.match(/^SixDays(?:\s+\w+)?\s+(\d{4})\s+GM\s*([A-Z])/i);
      if (sixDaysMatch) return `SixDays, GM-${sixDaysMatch[2].toUpperCase()}`;
      return event.replace(/\s+/g, ' ').replace(/\s*GM\s*([A-Z])\b/i, ', GM-$1');
    }
    function yearFromDate(dateStr = '') {
      const m = String(dateStr || '').match(/(\d{4})/);
      return m ? m[1] : '—';
    }
    function compactGameLabel(headers) {
      const white = headers.White || 'White';
      const black = headers.Black || 'Black';
      const whiteElo = headers.WhiteElo ? ` (${headers.WhiteElo})` : '';
      const blackElo = headers.BlackElo ? ` (${headers.BlackElo})` : '';
      const event = shortEventLabel(headers.Event || '');
      const year = yearFromDate(headers.Date || '');
      const result = headers.Result || '*';
      return `${white}${whiteElo}-${black}${blackElo}, ${event}, ${year}, ${result}`;
    }
    function buildGames(text) {
      const chunks = splitMultiPgn(text);
      const games = [];
      chunks.forEach((chunk, index) => {
        try {
          const chess = new Chess();
          const ok = chess.load_pgn(chunk, { sloppy: true, newline_char: '\n' });
          if (!ok) return;
          const headers = parseHeaders(chunk);
          const verboseMoves = chess.history({ verbose: true }) || [];
          const replay = new Chess();
          const states = [{ fen: replay.fen(), san: null, move: null, moveNumber: 0, from: null, to: null }];
          verboseMoves.forEach((mv, i) => {
            replay.move(mv);
            states.push({ fen: replay.fen(), san: mv.san, move: mv, moveNumber: i + 1, from: mv.from, to: mv.to });
          });
          games.push({ id: index, pgn: chunk, headers, moves: verboseMoves, states, title: `${headers.White || 'White'} — ${headers.Black || 'Black'}`, subtitle: `${headers.Event || 'Без турнира'} • ${headers.Site || 'Без места'} • ${headers.Date || 'Без даты'}`, compactLabel: compactGameLabel(headers), result: headers.Result || '*' });
        } catch (e) { console.error('PGN parse error', e); }
      });
      return games;
    }
    function currentGame() { return state.games[state.gameIndex]; }
    function currentChess() {
      if (state.analysisMode && state.analysisCurrentNode) return new Chess(state.analysisCurrentNode.fen);
      return new Chess(currentGame().states[state.replayIndex].fen);
    }
    function boardSquares() {
      const files = state.orientation === 'white' ? FILES : [...FILES].reverse();
      const ranks = state.orientation === 'white' ? RANKS : [...RANKS].reverse();
      const arr = [];
      for (const rank of ranks) for (const file of files) arr.push(file + rank);
      return arr;
    }
    function pieceCode(piece) { return !piece ? null : piece.color === 'w' ? piece.type.toUpperCase() : piece.type; }
    function updateStatus(chess) {
      const statusParts = [];
      if (chess.in_checkmate()) statusParts.push('Мат');
      else if (chess.in_draw()) statusParts.push('Ничья');
      else if (chess.in_stalemate()) statusParts.push('Пат');
      else if (chess.in_check()) statusParts.push('Шах');
      statusParts.push(chess.turn() === 'w' ? 'Ход белых' : 'Ход чёрных');
      const isWhiteTurn = chess.turn() === 'w';
      whiteTurnDotEl.classList.toggle('active', isWhiteTurn);
      blackTurnDotEl.classList.toggle('active', !isWhiteTurn);
    }
    function renderBoard() {
      const chess = currentChess();
      const squares = boardSquares();
      const last = state.lastMove;
      boardEl.innerHTML = '';
      squares.forEach((sq, idx) => {
        const square = document.createElement('div');
        const fileIndex = FILES.indexOf(sq[0]);
        const rankIndex = Number(sq[1]) - 1;
        const isLight = (fileIndex + rankIndex) % 2 === 1;
        square.className = `square ${isLight ? 'light' : 'dark'}`;
        square.dataset.square = sq;
        if (state.selectedSquare === sq) square.classList.add('selected');
        if (state.legalTargets.includes(sq)) square.classList.add('legal');
        if (last && (last.from === sq || last.to === sq)) square.classList.add('last');
        const piece = chess.get(sq);
        const code = pieceCode(piece);
        if (code) {
          const img = document.createElement('img'); img.className = 'piece'; img.src = PIECES[code]; img.alt = code; square.appendChild(img);
        }
        const row = Math.floor(idx / 8), col = idx % 8;
        if (col === 0) { const rank = document.createElement('span'); rank.className = 'coord rank'; rank.textContent = sq[1]; square.appendChild(rank); }
        if (row === 7) { const file = document.createElement('span'); file.className = 'coord file'; file.textContent = sq[0]; square.appendChild(file); }
        square.addEventListener('click', onSquareClick);
        boardEl.appendChild(square);
      });
      updateStatus(chess);
    }
    function renderGamesList() {
      gamesListEl.innerHTML = '';
      state.games.forEach((game, index) => {
        const card = document.createElement('div');
        card.className = 'game-card' + (index === state.gameIndex ? ' active' : '');
        card.innerHTML = `<div class="pairing">${escapeHtml(game.compactLabel || game.title)}</div>`;
        card.addEventListener('click', () => selectGame(index));
        gamesListEl.appendChild(card);
      });
    }
    function createAnalysisNode(parent, move, fen) { return { id: state.analysisNodeSeq++, parent, move, fen, children: [] }; }
    function clearAnalysis() { state.analysisMode = false; state.analysisBaseIndex = null; state.analysisRoot = null; state.analysisCurrentNode = null; }
    function leaveAnalysisView() { state.analysisMode = false; }
    function beginAnalysisFromReplay() {
      const fen = currentGame().states[state.replayIndex].fen;
      state.analysisMode = true; state.analysisBaseIndex = state.replayIndex; state.analysisRoot = createAnalysisNode(null, null, fen); state.analysisCurrentNode = state.analysisRoot; state.lastMove = currentGame().states[state.replayIndex].move || null;
    }
    function getNodePly(node) { let ply = state.analysisBaseIndex || 0; while (node && node.parent) { ply += 1; node = node.parent; } return ply; }
    function goToAnalysisNode(node) {
      if (!node) return; state.analysisMode = true; state.analysisCurrentNode = node; state.selectedSquare = null; state.legalTargets = []; state.lastMove = node.move || currentGame().states[state.replayIndex].move || null; refresh();
    }
    function findMatchingChild(parent, move) { return parent.children.find(c => c.move && c.move.from === move.from && c.move.to === move.to && String(c.move.promotion || '') === String(move.promotion || '')); }
    function flattenAnalysisNodes(node, acc = []) {
      if (!node) return acc;
      acc.push(node);
      node.children.forEach(child => flattenAnalysisNodes(child, acc));
      return acc;
    }
    function findAnalysisNodeById(id) {
      if (!state.analysisRoot) return null;
      return flattenAnalysisNodes(state.analysisRoot).find(node => String(node.id) === String(id)) || null;
    }
    function appendVariationSequence(container, startNode, startPly) {
      let node = startNode;
      let ply = startPly;
      let first = true;
      while (node) {
        if (ply % 2 === 1) {
          const p = document.createElement('span');
          p.className = 'variation-prefix';
          p.textContent = `${Math.floor((ply + 1) / 2)}.`;
          container.appendChild(p);
        } else if (first) {
          const p = document.createElement('span');
          p.className = 'variation-prefix';
          p.textContent = `${Math.floor(ply / 2)}...`;
          container.appendChild(p);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'variation-btn' + (state.analysisCurrentNode === node ? ' current' : '');
        btn.textContent = node.move.san;
        btn.dataset.nodeId = String(node.id);
        container.appendChild(btn);

        node.children.slice(1).forEach(child => container.appendChild(renderVariationGroup(child, ply + 1)));

        node = node.children[0] || null;
        ply += 1;
        first = false;
      }
    }
    function renderVariationGroup(startNode, startPly) {
      const group = document.createElement('span');
      group.className = 'variation-group';
      const open = document.createElement('span');
      open.className = 'variation-paren';
      open.textContent = '(';
      group.appendChild(open);
      appendVariationSequence(group, startNode, startPly);
      const close = document.createElement('span');
      close.className = 'variation-paren';
      close.textContent = ')';
      group.appendChild(close);
      return group;
    }
    function makeVariationBlock(rootChildren, startPly) {
      if (!rootChildren || !rootChildren.length) return null;
      const block = document.createElement('div');
      block.className = 'variation-block';
      rootChildren.forEach(child => block.appendChild(renderVariationGroup(child, startPly)));
      return block;
    }
    function renderMoves() {
      const game = currentGame();
      movesWrapEl.innerHTML = '';
      const anchorRowIndex = state.analysisRoot ? (state.analysisBaseIndex === 0 ? -1 : Math.ceil(state.analysisBaseIndex / 2) - 1) : null;
      const rootVariationBlock = state.analysisRoot && state.analysisRoot.children.length
        ? makeVariationBlock(state.analysisRoot.children, (state.analysisBaseIndex || 0) + 1)
        : null;

      if (anchorRowIndex === -1 && rootVariationBlock) movesWrapEl.appendChild(rootVariationBlock);

      for (let i = 0; i < game.moves.length; i += 2) {
        const rowIndex = Math.floor(i / 2);
        const row = document.createElement('div');
        row.className = 'move-row';
        const no = document.createElement('div');
        no.className = 'move-no';
        no.textContent = `${rowIndex + 1}.`;
        row.appendChild(no);
        const whiteBtn = document.createElement('button');
        whiteBtn.type = 'button';
        whiteBtn.className = 'move-btn' + (state.replayIndex === i + 1 && !state.analysisMode ? ' current' : '');
        whiteBtn.textContent = game.moves[i].san;
        whiteBtn.addEventListener('click', () => goToReplay(i + 1));
        row.appendChild(whiteBtn);
        const blackCell = document.createElement('div');
        if (game.moves[i + 1]) {
          const blackBtn = document.createElement('button');
          blackBtn.type = 'button';
          blackBtn.className = 'move-btn' + (state.replayIndex === i + 2 && !state.analysisMode ? ' current' : '');
          blackBtn.textContent = game.moves[i + 1].san;
          blackBtn.addEventListener('click', () => goToReplay(i + 2));
          blackCell.appendChild(blackBtn);
        }
        row.appendChild(blackCell);
        movesWrapEl.appendChild(row);
        if (anchorRowIndex === rowIndex && rootVariationBlock) movesWrapEl.appendChild(makeVariationBlock(state.analysisRoot.children, (state.analysisBaseIndex || 0) + 1));
      }
      if (rootVariationBlock && !movesWrapEl.querySelector('.variation-block')) movesWrapEl.appendChild(rootVariationBlock);
    }
    function updateHeader() {
      const game = currentGame();
      boardTitleEl.textContent = game.title;
      boardSubtitleEl.textContent = `${game.headers.Event || 'Без турнира'} • ${game.headers.Site || 'Без места'} • ${game.headers.Date || 'Без даты'} • ${game.headers.Result || '*'}`;
      resetAnalysisBtnEl.classList.toggle('visible', Boolean(state.analysisMode && state.analysisRoot));
    }
    function goToReplay(index) { const game = currentGame(); state.replayIndex = Math.max(0, Math.min(index, game.moves.length)); leaveAnalysisView(); state.selectedSquare = null; state.legalTargets = []; state.lastMove = game.states[state.replayIndex].move || null; persistState(); refresh(); }
    function selectGame(index) { state.gameIndex = index; state.replayIndex = 0; clearAnalysis(); state.selectedSquare = null; state.legalTargets = []; state.lastMove = null; persistState(); refresh(); renderGamesList(); }
    function legalMovesFrom(square) { return currentChess().moves({ square, verbose: true }) || []; }
    function onSquareClick(event) {
      const sq = event.currentTarget.dataset.square; const chess = currentChess(); const piece = chess.get(sq);
      if (state.selectedSquare) {
        const from = state.selectedSquare; const legal = legalMovesFrom(from); const candidate = legal.find(m => m.to === sq);
        if (candidate) {
          if (!state.analysisMode) beginAnalysisFromReplay();
          const parentNode = state.analysisCurrentNode; const analysisChess = new Chess(parentNode.fen); const playedMove = analysisChess.move({ from, to: sq, promotion: candidate.promotion || 'q' });
          let nextNode = findMatchingChild(parentNode, playedMove);
          if (!nextNode) { nextNode = createAnalysisNode(parentNode, playedMove, analysisChess.fen()); parentNode.children.push(nextNode); }
          state.analysisCurrentNode = nextNode; state.lastMove = nextNode.move || null; state.selectedSquare = null; state.legalTargets = []; refresh(); return;
        }
      }
      if (piece && piece.color === chess.turn()) { state.selectedSquare = sq; state.legalTargets = legalMovesFrom(sq).map(m => m.to); }
      else { state.selectedSquare = null; state.legalTargets = []; }
      renderBoard();
    }
    function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function persistState() { localStorage.setItem('cm_game_index', String(state.gameIndex)); localStorage.setItem('cm_replay_index', String(state.replayIndex)); localStorage.setItem('cm_orientation', state.orientation); }
    function restoreState() {
      const gi = Number(localStorage.getItem('cm_game_index'));
      if (Number.isInteger(gi) && gi >= 0 && gi < state.games.length) state.gameIndex = gi;
      state.replayIndex = 0;
      state.lastMove = null;
    }

    function scrollCurrentMoveIntoView() {
      const currentEl = movesWrapEl.querySelector('.move-btn.current, .variation-btn.current');
      if (!currentEl) return;
      requestAnimationFrame(() => {
        currentEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      });
    }
    function refresh() { updateHeader(); renderBoard(); renderMoves(); scrollCurrentMoveIntoView(); requestEngineAnalysis(); }
    function scoreText(type, value) { if (type === 'mate') return `Мат в ${value}`; if (type === 'cp') return `${(value / 100).toFixed(2)}`; return '—'; }
    function initEngine() {
      try {
        const blobCode = `importScripts("https://cdn.jsdelivr.net/npm/stockfish@18.0.7/src/stockfish-18-asm.js");`; const blob = new Blob([blobCode], { type: 'application/javascript' }); const url = URL.createObjectURL(blob); const worker = new Worker(url); URL.revokeObjectURL(url); state.engine = worker; worker.onmessage = onEngineMessage; worker.postMessage('uci'); worker.postMessage('isready'); worker.postMessage('ucinewgame');
      } catch (e) { console.error(e); engineStateEl.textContent = 'Stockfish: не удалось запустить локально'; evalLineEl.textContent = 'Оценка: открой позицию в Lichess'; bestMoveLineEl.textContent = 'Лучший ход: —'; pvLineEl.textContent = 'Встроенный движок не стартовал.'; }
    }
    function onEngineMessage(event) {
      const line = String(event.data || '').trim(); if (!line) return;
      if (line === 'readyok') { state.engineReady = true; engineStateEl.textContent = 'Stockfish: готов'; requestEngineAnalysis(); return; }
      if (line.startsWith('info ')) {
        const depthMatch = line.match(/\bdepth\s+(\d+)/), cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/), mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/), pvMatch = line.match(/\bpv\s+(.+)$/); const depth = depthMatch ? depthMatch[1] : null;
        if (mateMatch) state.currentEval = scoreText('mate', mateMatch[1]); else if (cpMatch) state.currentEval = scoreText('cp', Number(cpMatch[1])); if (pvMatch) state.enginePv = pvMatch[1]; evalLineEl.textContent = `Оценка${depth ? ` (глубина ${depth})` : ''}: ${state.currentEval || '—'}`; pvLineEl.textContent = state.enginePv || '—'; return;
      }
      if (line.startsWith('bestmove')) { const bm = line.split(/\s+/)[1] || '(нет)'; state.engineBestMove = bm; bestMoveLineEl.textContent = `Лучший ход: ${bm}`; }
    }
    let engineTimer = null;
    function requestEngineAnalysis() {
      if (!state.engine || !state.engineReady) return; const fen = currentChess().fen(); if (state.engineFen === fen) return; state.engineFen = fen; state.currentEval = ''; state.enginePv = ''; state.engineBestMove = ''; evalLineEl.textContent = 'Оценка: считаю…'; bestMoveLineEl.textContent = 'Лучший ход: считаю…'; pvLineEl.textContent = '—'; engineStateEl.textContent = 'Stockfish: анализирует';
      try { state.engine.postMessage('stop'); state.engine.postMessage('position fen ' + fen); state.engine.postMessage('go depth 14'); clearTimeout(engineTimer); engineTimer = setTimeout(() => { if (state.engine) { state.engine.postMessage('stop'); engineStateEl.textContent = 'Stockfish: готов'; } }, 1800); } catch (e) { console.error(e); }
    }
    document.getElementById('flipBtn').addEventListener('click', () => { state.orientation = state.orientation === 'white' ? 'black' : 'white'; persistState(); renderBoard(); });
    document.getElementById('startBtn').addEventListener('click', () => goToReplay(0));
    document.getElementById('prevBtn').addEventListener('click', () => { if (state.analysisMode && state.analysisCurrentNode && state.analysisCurrentNode.parent) return goToAnalysisNode(state.analysisCurrentNode.parent); goToReplay(state.replayIndex - 1); });
    document.getElementById('nextBtn').addEventListener('click', () => { if (state.analysisMode && state.analysisCurrentNode && state.analysisCurrentNode.children[0]) return goToAnalysisNode(state.analysisCurrentNode.children[0]); goToReplay(state.replayIndex + 1); });
    document.getElementById('endBtn').addEventListener('click', () => { if (state.analysisMode && state.analysisCurrentNode) { let node = state.analysisCurrentNode; while (node.children[0]) node = node.children[0]; return goToAnalysisNode(node); } goToReplay(currentGame().moves.length); });
    document.getElementById('resetAnalysisBtn').addEventListener('click', () => { const target = state.analysisBaseIndex !== null ? state.analysisBaseIndex : state.replayIndex; goToReplay(target); });
    document.getElementById('copyFenBtn').addEventListener('click', async () => { const fen = currentChess().fen(); try { await navigator.clipboard.writeText(fen); } catch (_) {} });
    window.addEventListener('keydown', (e) => {
      if (state.analysisMode && state.analysisCurrentNode) {
        if (e.key === 'ArrowLeft' && state.analysisCurrentNode.parent) return goToAnalysisNode(state.analysisCurrentNode.parent);
        if (e.key === 'ArrowRight' && state.analysisCurrentNode.children[0]) return goToAnalysisNode(state.analysisCurrentNode.children[0]);
        if (e.key === 'Home') return goToAnalysisNode(state.analysisRoot);
        if (e.key === 'End') { let node = state.analysisCurrentNode; while (node.children[0]) node = node.children[0]; return goToAnalysisNode(node); }
      }
      if (e.key === 'ArrowLeft') goToReplay(state.replayIndex - 1); if (e.key === 'ArrowRight') goToReplay(state.replayIndex + 1); if (e.key === 'Home') goToReplay(0); if (e.key === 'End') goToReplay(currentGame().moves.length);
    });
    async function boot() {
      if (typeof Chess !== 'function') { boardTitleEl.textContent = 'Ошибка загрузки chess.js'; boardSubtitleEl.textContent = 'Проверь подключение к интернету: без библиотеки браузер не сможет разобрать PGN.'; return; }
      let rawPgn = '';
      try {
        rawPgn = await loadPgnText();
      } catch (e) {
        console.error('PGN load error', e);
        boardTitleEl.textContent = 'Партии не загружены';
        boardSubtitleEl.textContent = 'Не удалось загрузить PGN-файл. Проверь путь и запуск через локальный сервер.';
        return;
      }
      state.games = buildGames(rawPgn); if (!state.games.length) { boardTitleEl.textContent = 'Партии не найдены'; boardSubtitleEl.textContent = 'PGN-файл загрузился, но не удалось его прочитать.'; return; }
      restoreState(); renderGamesList(); refresh(); initEngine();
    }
    boot();
