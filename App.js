    const PGN_SOURCE = 'storage/games/best games.pgn';

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
    function parseSortableDate(dateStr = '') {
      const match = String(dateStr || '').match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
      if (!match) return 0;
      return Number(`${match[1]}${match[2]}${match[3]}`);
    }
    function parseSortableElo(value = '') {
      const num = Number(value);
      return Number.isFinite(num) ? num : -1;
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
          games.push({
            id: index,
            pgn: chunk,
            headers,
            moves: verboseMoves,
            states,
            title: `${headers.White || 'White'}${headers.WhiteElo ? ` (${headers.WhiteElo})` : ''} — ${headers.Black || 'Black'}${headers.BlackElo ? ` (${headers.BlackElo})` : ''}`,
            subtitle: `${headers.Event || 'Без турнира'} • ${headers.Site || 'Без места'} • ${headers.Date || 'Без даты'}`,
            compactLabel: compactGameLabel(headers),
            result: headers.Result || '*',
            white: headers.White || 'White',
            black: headers.Black || 'Black',
            whiteElo: headers.WhiteElo || '—',
            blackElo: headers.BlackElo || '—',
            event: headers.Event || '—',
            date: headers.Date || '—',
            year: yearFromDate(headers.Date || ''),
            sortDate: parseSortableDate(headers.Date || ''),
            sortWhiteElo: parseSortableElo(headers.WhiteElo || ''),
            sortBlackElo: parseSortableElo(headers.BlackElo || '')
          });
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
    function compareGames(a, b) {
      const direction = state.sortDir === 'asc' ? 1 : -1;
      let left = '';
      let right = '';
      switch (state.sortKey) {
        case 'white':
          left = a.white.toLocaleLowerCase('en');
          right = b.white.toLocaleLowerCase('en');
          break;
        case 'black':
          left = a.black.toLocaleLowerCase('en');
          right = b.black.toLocaleLowerCase('en');
          break;
        case 'whiteElo':
          left = a.sortWhiteElo;
          right = b.sortWhiteElo;
          break;
        case 'blackElo':
          left = a.sortBlackElo;
          right = b.sortBlackElo;
          break;
        case 'date':
        default:
          left = a.sortDate;
          right = b.sortDate;
          break;
      }
      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
      return a.id - b.id;
    }
    function sortedGames() {
      return [...state.games].sort(compareGames);
    }
    function sortIndicator(key) {
      if (state.sortKey !== key) return '';
      return state.sortDir === 'asc' ? ' ▲' : ' ▼';
    }
    function setGamesSort(key) {
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = key === 'date' ? 'desc' : 'asc'; }
      renderGamesList();
    }
    function selectRelativeGame(delta) {
      const orderedGames = sortedGames();
      const currentIndex = orderedGames.findIndex(game => game.id === state.gameIndex);
      if (currentIndex === -1) return;
      const nextIndex = Math.max(0, Math.min(currentIndex + delta, orderedGames.length - 1));
      if (nextIndex === currentIndex) return;
      selectGame(orderedGames[nextIndex].id);
    }
    function renderGamesList() {
      gamesListEl.innerHTML = '';

      const table = document.createElement('table');
      table.className = 'games-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const columns = [
        { label: '№' },
        { label: 'Белые', key: 'white' },
        { label: 'Чёрные', key: 'black' },
        { label: 'Дата', key: 'date' },
        { label: 'Турнир' },
        { label: 'Рез.' }
      ];

      columns.forEach((column) => {
        const th = document.createElement('th');
        if (column.key) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'table-sort-btn' + (state.sortKey === column.key ? ' active' : '');
          btn.textContent = column.label + sortIndicator(column.key);
          btn.addEventListener('click', () => setGamesSort(column.key));
          th.appendChild(btn);
        } else {
          th.textContent = column.label;
        }
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      sortedGames().forEach((game, orderIndex) => {
        const row = document.createElement('tr');
        row.className = game.id === state.gameIndex ? 'active' : '';
        row.addEventListener('click', () => selectGame(game.id));

        const cells = [
          String(orderIndex + 1),
          game.white,
          game.black,
          game.year,
          game.event,
          game.result
        ];

        cells.forEach((value, cellIndex) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          if (cellIndex === 0 || cellIndex === 5) cell.classList.add('numeric');
          if (cellIndex === 4) cell.classList.add('event-cell');
          if (cellIndex === 0) cell.classList.add('index-cell');
          row.appendChild(cell);
        });

        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      gamesListEl.appendChild(table);
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
        const containerRect = movesWrapEl.getBoundingClientRect();
        const currentRect = currentEl.getBoundingClientRect();
        const offsetTop = currentEl.offsetTop;
        const offsetBottom = offsetTop + currentEl.offsetHeight;
        const visibleTop = movesWrapEl.scrollTop;
        const visibleBottom = visibleTop + movesWrapEl.clientHeight;
        const padding = Math.max(24, Math.floor(movesWrapEl.clientHeight * 0.18));

        if (offsetTop - padding < visibleTop) {
          movesWrapEl.scrollTo({ top: Math.max(0, offsetTop - padding), behavior: 'smooth' });
          return;
        }

        if (offsetBottom + padding > visibleBottom) {
          const targetTop = offsetBottom - movesWrapEl.clientHeight + padding;
          movesWrapEl.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          return;
        }

        if (currentRect.top < containerRect.top || currentRect.bottom > containerRect.bottom) {
          currentEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
      });
    }
    function refresh() {
      updateHeader();
      renderBoard();
      renderMoves();
      scrollCurrentMoveIntoView();
      if (stockfish) stockfish.requestAnalysis(currentChess().fen());
    }
    document.getElementById('flipBtn').addEventListener('click', () => { state.orientation = state.orientation === 'white' ? 'black' : 'white'; persistState(); renderBoard(); });
    boardResizeHandleEl.addEventListener('pointerdown', beginBoardResize);
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
    document.getElementById('startBtn').addEventListener('click', () => goToReplay(0));
    document.getElementById('prevBtn').addEventListener('click', () => { if (state.analysisMode && state.analysisCurrentNode && state.analysisCurrentNode.parent) return goToAnalysisNode(state.analysisCurrentNode.parent); goToReplay(state.replayIndex - 1); });
    document.getElementById('nextBtn').addEventListener('click', () => { if (state.analysisMode && state.analysisCurrentNode && state.analysisCurrentNode.children[0]) return goToAnalysisNode(state.analysisCurrentNode.children[0]); goToReplay(state.replayIndex + 1); });
    document.getElementById('endBtn').addEventListener('click', () => { if (state.analysisMode && state.analysisCurrentNode) { let node = state.analysisCurrentNode; while (node.children[0]) node = node.children[0]; return goToAnalysisNode(node); } goToReplay(currentGame().moves.length); });
    document.getElementById('resetAnalysisBtn').addEventListener('click', () => { const target = state.analysisBaseIndex !== null ? state.analysisBaseIndex : state.replayIndex; goToReplay(target); });
    document.getElementById('copyFenBtn').addEventListener('click', async () => { const fen = currentChess().fen(); try { await navigator.clipboard.writeText(fen); } catch (_) {} });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && themeMenuEl && !themeMenuEl.hidden) {
        closeThemeMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectRelativeGame(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectRelativeGame(1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
      }
      if (state.analysisMode && state.analysisCurrentNode) {
        if (e.key === 'ArrowLeft' && state.analysisCurrentNode.parent) return goToAnalysisNode(state.analysisCurrentNode.parent);
        if (e.key === 'ArrowRight' && state.analysisCurrentNode.children[0]) return goToAnalysisNode(state.analysisCurrentNode.children[0]);
        if (e.key === 'Home') return goToAnalysisNode(state.analysisRoot);
        if (e.key === 'End') { let node = state.analysisCurrentNode; while (node.children[0]) node = node.children[0]; return goToAnalysisNode(node); }
      }
      if (e.key === 'ArrowLeft') goToReplay(state.replayIndex - 1); if (e.key === 'ArrowRight') goToReplay(state.replayIndex + 1); if (e.key === 'Home') goToReplay(0); if (e.key === 'End') goToReplay(currentGame().moves.length);
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
      applyBoardSize();
      restoreState();
      renderGamesList();
      refresh();
      if (stockfish) stockfish.init();
    }
    boot();
