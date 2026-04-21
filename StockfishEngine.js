(() => {
  const DEFAULT_WORKER_URL = 'vendor/stockfish/stockfish-17.1-lite-single-03e3232.js';
  const MODEL_LABEL = 'Stockfish 17.1 Lite';
  const ANALYSIS_DEBOUNCE_MS = 120;
  const ANALYSIS_STOP_MS = 1800;
  const STOP_TIMEOUT_MS = 1200;
  const READY_TIMEOUT_MS = 10000;
  const DISPLAY_PV_PLY_LIMIT = 10;
  const ANALYSIS_MODES = {
    depth20: { command: 'go depth 20' },
    infinite: { command: 'go infinite' }
  };

  function scoreText(type, value) {
    if (type === 'mate') return `Мат в ${value}`;
    if (type === 'cp') return `${(value / 100).toFixed(2)}`;
    return '-';
  }

  function whitePerspectiveFactor(fen) {
    const turn = String(fen || '').split(' ')[1];
    return turn === 'b' ? -1 : 1;
  }

  function formatPvMoves(fen, pvLine) {
    if (typeof window.Chess !== 'function' || !fen || !pvLine) return pvLine || '-';

    try {
      const chess = new window.Chess(fen);
      const parts = [];
      const moves = String(pvLine).trim().split(/\s+/).filter(Boolean).slice(0, DISPLAY_PV_PLY_LIMIT);

      moves.forEach((uciMove) => {
        const from = uciMove.slice(0, 2);
        const to = uciMove.slice(2, 4);
        const promotion = uciMove.slice(4, 5) || undefined;
        const moveNumber = Number(chess.fen().split(' ')[5]);
        const isWhiteTurn = chess.turn() === 'w';

        if (isWhiteTurn) {
          parts.push(`${moveNumber}.`);
        } else if (!parts.length) {
          parts.push(`${moveNumber}...`);
        }

        const move = chess.move({ from, to, promotion });
        if (!move) throw new Error(`Invalid PV move: ${uciMove}`);
        parts.push(move.san);
      });

      return parts.join(' ');
    } catch (_) {
      return pvLine || '-';
    }
  }

  function createStockfishController(options = {}) {
    const workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};

    const state = {
      worker: null,
      ready: false,
      failed: false,
      initialized: false,
      fen: null,
      pendingFen: null,
      perspective: 1,
      mode: 'depth20',
      multiPv: 1,
      readyTimer: null,
      timer: null,
      stopTimer: null,
      debounceTimer: null,
      activeAnalysisId: 0,
      currentDepth: null,
      pvLines: {},
      searching: false,
      stopping: false,
      optionsDirty: false
    };

    function emit(payload) {
      onStateChange(payload);
    }

    function currentPvText() {
      const lines = [];
      for (let i = 1; i <= state.multiPv; i += 1) {
        if (!state.pvLines[i]) continue;
        const entry = state.pvLines[i];
        const prefix = state.multiPv > 1 ? `${i}. ` : '';
        const suffix = entry.score ? ` (${entry.score})` : '';
        lines.push(`${prefix}${entry.text}${suffix}`);
      }
      return lines.join('\n') || '-';
    }

    function showUnavailable(reason = 'Встроенный движок не стартовал.') {
      emit({
        engineState: `${MODEL_LABEL}: ошибка`,
        evalText: 'Глубина: -',
        pvText: reason
      });
    }

    function resetSearchState() {
      clearTimeout(state.timer);
      clearTimeout(state.stopTimer);
      clearTimeout(state.debounceTimer);
      state.pendingFen = null;
      state.fen = null;
      state.currentDepth = null;
      state.pvLines = {};
      state.searching = false;
      state.stopping = false;
    }

    function handleFailure(error) {
      console.error('Stockfish error', error);
      if (state.worker) {
        try {
          state.worker.terminate();
        } catch (_) {}
      }
      state.worker = null;
      state.ready = false;
      state.failed = true;
      clearTimeout(state.readyTimer);
      clearTimeout(state.stopTimer);
      resetSearchState();
      showUnavailable('Движок остановлен после ошибки. Нажмите Play, чтобы запустить его заново.');
    }

    function post(command) {
      if (!state.worker || state.failed) return false;
      try {
        state.worker.postMessage(command);
        return true;
      } catch (error) {
        handleFailure(error);
        return false;
      }
    }

    function requestStop() {
      if (!state.worker || !state.searching || state.stopping) return;
      state.stopping = post('stop');
      if (state.stopping) {
        emit({ engineState: `${MODEL_LABEL}: останавливается` });
        clearTimeout(state.stopTimer);
        state.stopTimer = setTimeout(() => {
          if (!state.stopping) return;
          restartAfterStuckStop();
        }, STOP_TIMEOUT_MS);
      }
    }

    function finishSearch() {
      clearTimeout(state.timer);
      clearTimeout(state.stopTimer);
      const nextFen = state.pendingFen;
      state.searching = false;
      state.stopping = false;
      state.fen = null;
      if (nextFen) scheduleAnalysis(nextFen);
      else emit({ engineState: `${MODEL_LABEL}: готов` });
    }

    function restartAfterStuckStop() {
      const nextFen = state.pendingFen;
      if (state.worker) {
        try {
          state.worker.terminate();
        } catch (_) {}
      }
      state.worker = null;
      state.ready = false;
      state.failed = false;
      state.initialized = false;
      resetSearchState();
      if (!nextFen) {
        emit({ engineState: `${MODEL_LABEL}: готов` });
        return;
      }
      state.pendingFen = nextFen;
      emit({ engineState: `${MODEL_LABEL}: перезапуск` });
      init();
    }

    function handleMessage(event) {
      const line = String(event.data || '').trim();
      if (!line) return;

      if (line === 'readyok') {
        state.ready = true;
        clearTimeout(state.readyTimer);
        if (state.pendingFen) scheduleAnalysis(state.pendingFen);
        return;
      }

      if (line.startsWith('info ')) {
        if (!state.fen) return;
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+)$/);
        const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
        const depth = depthMatch ? depthMatch[1] : null;
        const pvIndex = multiPvMatch ? Number(multiPvMatch[1]) : 1;
        const perspectiveValue = state.perspective;
        let score = '';

        if (mateMatch) score = scoreText('mate', Number(mateMatch[1]) * perspectiveValue);
        else if (cpMatch) score = scoreText('cp', Number(cpMatch[1]) * perspectiveValue);
        if (depth) state.currentDepth = depth;
        if (pvMatch) {
          state.pvLines[pvIndex] = {
            text: formatPvMoves(state.fen, pvMatch[1]),
            score
          };
        }

        emit({
          engineState: `${MODEL_LABEL}: анализирует`,
          evalText: `Глубина: ${state.currentDepth || '-'}`,
          pvText: currentPvText()
        });
        return;
      }

      if (line.startsWith('bestmove')) {
        finishSearch();
      }
    }

    function init() {
      if (state.worker || (state.initialized && !state.failed)) return;
      state.initialized = true;
      state.failed = false;
      emit({ engineState: `${MODEL_LABEL}: запускается` });

      try {
        const absoluteWorkerUrl = new URL(workerUrl, window.location.href).href;
        const worker = new Worker(absoluteWorkerUrl);
        state.worker = worker;
        worker.onmessage = handleMessage;
        worker.onerror = (error) => {
          const details = [
            error && error.message ? error.message : null,
            error && error.filename ? error.filename : null,
            Number.isFinite(error && error.lineno) ? `строка ${error.lineno}` : null
          ].filter(Boolean).join(' - ');
          handleFailure(error);
          if (details) showUnavailable(details);
        };
        state.readyTimer = setTimeout(() => {
          if (state.ready) return;
          handleFailure(new Error('Stockfish ready timeout'));
          showUnavailable('Движок не ответил readyok вовремя. Откройте проект через server.js.');
        }, READY_TIMEOUT_MS);
        post('uci');
        post(`setoption name MultiPV value ${state.multiPv}`);
        post('isready');
        post('ucinewgame');
      } catch (error) {
        handleFailure(error);
        showUnavailable();
      }
    }

    function runAnalysis(fen) {
      if (!state.worker || !fen || !state.ready) return;

      if (state.searching) {
        state.pendingFen = fen;
        requestStop();
        return;
      }

      state.activeAnalysisId += 1;
      const analysisId = state.activeAnalysisId;
      state.fen = fen;
      state.pendingFen = null;
      state.perspective = whitePerspectiveFactor(fen);
      state.currentDepth = null;
      state.pvLines = {};
      state.searching = true;
      state.stopping = false;

      emit({
        engineState: `${MODEL_LABEL}: анализирует`,
        evalText: 'Глубина: -',
        pvText: '-'
      });

      clearTimeout(state.timer);
      if (state.optionsDirty) {
        post(`setoption name MultiPV value ${state.multiPv}`);
        state.optionsDirty = false;
      }
      if (!post('position fen ' + fen) || !post(ANALYSIS_MODES[state.mode].command)) return;
      if (state.mode !== 'infinite') {
        state.timer = setTimeout(() => {
          if (!state.worker || analysisId !== state.activeAnalysisId || !state.searching) return;
          requestStop();
        }, ANALYSIS_STOP_MS);
      }
    }

    function scheduleAnalysis(fen) {
      if (!state.worker || !fen) return;
      state.pendingFen = fen;
      if (state.searching) {
        requestStop();
        return;
      }
      clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        runAnalysis(state.pendingFen);
      }, ANALYSIS_DEBOUNCE_MS);
    }

    function requestAnalysis(fen) {
      if (!fen) return;
      if (!state.worker || state.failed) init();
      if (!state.worker) return;
      if (!state.ready) {
        state.pendingFen = fen;
        return;
      }
      if (state.fen === fen && !state.pendingFen && state.searching) return;
      scheduleAnalysis(fen);
    }

    function setMode(mode) {
      if (!Object.prototype.hasOwnProperty.call(ANALYSIS_MODES, mode)) return;
      if (state.mode === mode) return;
      state.mode = mode;
      clearTimeout(state.timer);
      clearTimeout(state.debounceTimer);
      if (state.searching) requestStop();
      if (state.fen) {
        const fen = state.fen;
        state.fen = null;
        scheduleAnalysis(fen);
      }
    }

    function setMultiPv(value) {
      const nextValue = Math.max(1, Math.min(5, Number(value) || 1));
      if (state.multiPv === nextValue) return;
      state.multiPv = nextValue;
      state.pvLines = {};
      state.optionsDirty = true;
      if (state.searching) {
        requestStop();
      } else if (state.worker) {
        post(`setoption name MultiPV value ${state.multiPv}`);
        state.optionsDirty = false;
      }
      clearTimeout(state.timer);
      clearTimeout(state.debounceTimer);
      if (state.fen) {
        const fen = state.fen;
        state.fen = null;
        scheduleAnalysis(fen);
      } else {
        emit({ pvText: '-' });
      }
    }

    function stopAnalysis() {
      clearTimeout(state.debounceTimer);
      state.pendingFen = null;
      if (state.searching) requestStop();
      else resetSearchState();
    }

    return {
      init,
      requestAnalysis,
      setMode,
      setMultiPv,
      stopAnalysis,
      getModelLabel: () => MODEL_LABEL
    };
  }

  window.createStockfishController = createStockfishController;
})();
