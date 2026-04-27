(() => {
  function createRenderer(options) {
    const {
      state,
      elements,
      constants,
      getCurrentGame,
      getCurrentChess
    } = options;
    const {
      boardEl,
      gamesListEl,
      movesWrapEl,
      boardTitleEl,
      boardSubtitleEl,
      whiteTurnDotEl,
      blackTurnDotEl,
      resetAnalysisBtnEl
    } = elements;
    const {
      PIECES,
      FILES,
      RANKS
    } = constants;

    let renderedBoardOrientation = null;
    let sortedGamesCache = null;
    let sortedGamesSource = null;
    let sortedGamesSortKey = null;
    let sortedGamesSortDir = null;
    const boardSquareEls = new Map();

    function boardSquares() {
      const files = state.orientation === 'white' ? FILES : [...FILES].reverse();
      const ranks = state.orientation === 'white' ? RANKS : [...RANKS].reverse();
      const squares = [];
      for (const rank of ranks) {
        for (const file of files) squares.push(file + rank);
      }
      return squares;
    }

    function pieceCode(piece) {
      return !piece ? null : piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
    }

    function updateStatus(chess) {
      const isWhiteTurn = chess.turn() === 'w';
      whiteTurnDotEl.classList.toggle('active', isWhiteTurn);
      blackTurnDotEl.classList.toggle('active', !isWhiteTurn);
    }

    function ensureBoardLayout() {
      if (renderedBoardOrientation === state.orientation && boardSquareEls.size === 64) return;

      const squares = boardSquares();
      const fragment = document.createDocumentFragment();
      boardSquareEls.clear();

      squares.forEach((sq, index) => {
        const square = document.createElement('div');
        const fileIndex = FILES.indexOf(sq[0]);
        const rankIndex = Number(sq[1]) - 1;
        const isLight = (fileIndex + rankIndex) % 2 === 1;
        square.className = `square ${isLight ? 'light' : 'dark'}`;
        square.dataset.square = sq;

        const row = Math.floor(index / 8);
        const col = index % 8;
        if (col === 0) {
          const rank = document.createElement('span');
          rank.className = 'coord rank';
          rank.textContent = sq[1];
          square.appendChild(rank);
        }
        if (row === 7) {
          const file = document.createElement('span');
          file.className = 'coord file';
          file.textContent = sq[0];
          square.appendChild(file);
        }

        boardSquareEls.set(sq, square);
        fragment.appendChild(square);
      });

      boardEl.replaceChildren(fragment);
      renderedBoardOrientation = state.orientation;
    }

    function syncSquarePiece(squareEl, code) {
      const currentCode = squareEl.dataset.piece || '';
      if (currentCode === (code || '')) return;

      squareEl.dataset.piece = code || '';
      const existingPiece = squareEl.querySelector('img.piece');
      if (!code) {
        if (existingPiece) existingPiece.remove();
        return;
      }

      const pieceEl = existingPiece || document.createElement('img');
      pieceEl.className = 'piece';
      pieceEl.src = PIECES[code];
      pieceEl.alt = code;
      if (!existingPiece) squareEl.insertBefore(pieceEl, squareEl.firstChild);
    }

    function renderBoard() {
      const chess = getCurrentChess();
      const lastMove = state.lastMove;
      const legalTargets = new Set(state.legalTargets);

      ensureBoardLayout();
      boardSquareEls.forEach((squareEl, sq) => {
        squareEl.classList.toggle('selected', state.selectedSquare === sq);
        squareEl.classList.toggle('legal', legalTargets.has(sq));
        squareEl.classList.toggle('last', Boolean(lastMove && (lastMove.from === sq || lastMove.to === sq)));
        syncSquarePiece(squareEl, pieceCode(chess.get(sq)));
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

    function getSortedGames() {
      if (
        sortedGamesCache
        && sortedGamesSource === state.games
        && sortedGamesSortKey === state.sortKey
        && sortedGamesSortDir === state.sortDir
      ) {
        return sortedGamesCache;
      }

      sortedGamesCache = [...state.games].sort(compareGames);
      sortedGamesSource = state.games;
      sortedGamesSortKey = state.sortKey;
      sortedGamesSortDir = state.sortDir;
      return sortedGamesCache;
    }

    function invalidateSortedGames() {
      sortedGamesCache = null;
      sortedGamesSource = null;
      sortedGamesSortKey = null;
      sortedGamesSortDir = null;
    }

    function sortIndicator(key) {
      if (state.sortKey !== key) return '';
      return state.sortDir === 'asc' ? ' ▲' : ' ▼';
    }

    function renderGamesList() {
      const fragment = document.createDocumentFragment();
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
          btn.dataset.sortKey = column.key;
          btn.textContent = column.label + sortIndicator(column.key);
          th.appendChild(btn);
        } else {
          th.textContent = column.label;
        }
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      getSortedGames().forEach((game, orderIndex) => {
        const row = document.createElement('tr');
        row.className = game.id === state.gameIndex ? 'active' : '';
        row.dataset.gameId = String(game.id);

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
      fragment.appendChild(table);
      gamesListEl.replaceChildren(fragment);
    }

    function updateGamesSelectionState() {
      gamesListEl.querySelectorAll('tbody tr[data-game-id]').forEach((rowEl) => {
        rowEl.classList.toggle('active', rowEl.dataset.gameId === String(state.gameIndex));
      });
    }

    function appendVariationSequence(container, startNode, startPly) {
      let node = startNode;
      let ply = startPly;
      let first = true;

      while (node) {
        if (ply % 2 === 1) {
          const prefix = document.createElement('span');
          prefix.className = 'variation-prefix';
          prefix.textContent = `${Math.floor((ply + 1) / 2)}.`;
          container.appendChild(prefix);
        } else if (first) {
          const prefix = document.createElement('span');
          prefix.className = 'variation-prefix';
          prefix.textContent = `${Math.floor(ply / 2)}...`;
          container.appendChild(prefix);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'variation-btn' + (state.analysisCurrentNode === node ? ' current' : '');
        btn.textContent = node.move.san;
        btn.dataset.nodeId = String(node.id);
        container.appendChild(btn);

        node.children.slice(1).forEach((child) => container.appendChild(renderVariationGroup(child, ply + 1)));

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
      rootChildren.forEach((child) => block.appendChild(renderVariationGroup(child, startPly)));
      return block;
    }

    function renderMoves() {
      const game = getCurrentGame();
      const fragment = document.createDocumentFragment();

      const anchorRowIndex = state.analysisRoot
        ? (state.analysisBaseIndex === 0 ? -1 : Math.ceil(state.analysisBaseIndex / 2) - 1)
        : null;
      const rootVariationBlock = state.analysisRoot && state.analysisRoot.children.length
        ? makeVariationBlock(state.analysisRoot.children, (state.analysisBaseIndex || 0) + 1)
        : null;

      if (anchorRowIndex === -1 && rootVariationBlock) fragment.appendChild(rootVariationBlock);

      for (let i = 0; i < game.moves.length; i += 2) {
        const rowIndex = Math.floor(i / 2);
        const row = document.createElement('div');
        row.className = 'move-row';

        const moveNumber = document.createElement('div');
        moveNumber.className = 'move-no';
        moveNumber.textContent = `${rowIndex + 1}.`;
        row.appendChild(moveNumber);

        const whiteBtn = document.createElement('button');
        whiteBtn.type = 'button';
        whiteBtn.className = 'move-btn' + (state.replayIndex === i + 1 && !state.analysisMode ? ' current' : '');
        whiteBtn.textContent = game.moves[i].san;
        whiteBtn.dataset.replayIndex = String(i + 1);
        row.appendChild(whiteBtn);

        const blackCell = document.createElement('div');
        if (game.moves[i + 1]) {
          const blackBtn = document.createElement('button');
          blackBtn.type = 'button';
          blackBtn.className = 'move-btn' + (state.replayIndex === i + 2 && !state.analysisMode ? ' current' : '');
          blackBtn.textContent = game.moves[i + 1].san;
          blackBtn.dataset.replayIndex = String(i + 2);
          blackCell.appendChild(blackBtn);
        }
        row.appendChild(blackCell);

        fragment.appendChild(row);
        if (anchorRowIndex === rowIndex && rootVariationBlock) {
          fragment.appendChild(makeVariationBlock(state.analysisRoot.children, (state.analysisBaseIndex || 0) + 1));
        }
      }

      if (rootVariationBlock && !fragment.querySelector('.variation-block')) {
        fragment.appendChild(rootVariationBlock);
      }

      movesWrapEl.replaceChildren(fragment);
    }

    function updateCurrentMoveState() {
      const currentReplayIndex = String(state.replayIndex);

      movesWrapEl.querySelectorAll('.move-btn[data-replay-index]').forEach((btnEl) => {
        btnEl.classList.toggle('current', !state.analysisMode && btnEl.dataset.replayIndex === currentReplayIndex);
      });

      movesWrapEl.querySelectorAll('.variation-btn[data-node-id]').forEach((btnEl) => {
        const isCurrent = state.analysisMode
          && state.analysisCurrentNode
          && btnEl.dataset.nodeId === String(state.analysisCurrentNode.id);
        btnEl.classList.toggle('current', Boolean(isCurrent));
      });
    }

    function updateHeader() {
      const game = getCurrentGame();
      boardTitleEl.textContent = game.title;
      boardSubtitleEl.textContent = `${game.headers.Event || 'Без турнира'} • ${game.headers.Site || 'Без места'} • ${game.headers.Date || 'Без даты'} • ${game.headers.Result || '*'}`;
      resetAnalysisBtnEl.classList.toggle('visible', Boolean(state.analysisMode && state.analysisRoot));
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

    return {
      getSortedGames,
      invalidateSortedGames,
      renderBoard,
      renderGamesList,
      renderMoves,
      scrollCurrentMoveIntoView,
      updateCurrentMoveState,
      updateGamesSelectionState,
      updateHeader
    };
  }

  window.appRender = {
    createRenderer
  };
})();
