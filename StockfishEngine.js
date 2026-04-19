(() => {
  const DEFAULT_WORKER_URL = 'vendor/stockfish/stockfish-17.1-lite-single-03e3232.js';

  function scoreText(type, value) {
    if (type === 'mate') return `Мат в ${value}`;
    if (type === 'cp') return `${(value / 100).toFixed(2)}`;
    return '—';
  }

  function createStockfishController(options = {}) {
    const workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};

    const state = {
      worker: null,
      ready: false,
      fen: null,
      timer: null,
      currentEval: '',
      bestMove: '',
      pv: ''
    };

    function emit(payload) {
      onStateChange(payload);
    }

    function showUnavailable() {
      emit({
        engineState: 'Stockfish: не удалось запустить локально',
        evalText: 'Оценка: открой позицию в Lichess',
        bestMoveText: 'Лучший ход: —',
        pvText: 'Встроенный движок не стартовал.'
      });
    }

    function handleMessage(event) {
      const line = String(event.data || '').trim();
      if (!line) return;

      if (line === 'readyok') {
        state.ready = true;
        emit({ engineState: 'Stockfish: готов' });
        if (state.fen) {
          const fen = state.fen;
          state.fen = null;
          requestAnalysis(fen);
        }
        return;
      }

      if (line.startsWith('info ')) {
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+)$/);
        const depth = depthMatch ? depthMatch[1] : null;

        if (mateMatch) state.currentEval = scoreText('mate', Number(mateMatch[1]));
        else if (cpMatch) state.currentEval = scoreText('cp', Number(cpMatch[1]));
        if (pvMatch) state.pv = pvMatch[1];

        emit({
          evalText: `Оценка${depth ? ` (глубина ${depth})` : ''}: ${state.currentEval || '—'}`,
          pvText: state.pv || '—'
        });
        return;
      }

      if (line.startsWith('bestmove')) {
        state.bestMove = line.split(/\s+/)[1] || '(нет)';
        emit({ bestMoveText: `Лучший ход: ${state.bestMove}` });
      }
    }

    function init() {
      try {
        const worker = new Worker(workerUrl);
        state.worker = worker;
        worker.onmessage = handleMessage;
        worker.onerror = (error) => {
          console.error('Stockfish worker error', error);
          state.worker = null;
          state.ready = false;
          showUnavailable();
        };
        worker.postMessage('uci');
        worker.postMessage('isready');
        worker.postMessage('ucinewgame');
      } catch (error) {
        console.error(error);
        showUnavailable();
      }
    }

    function requestAnalysis(fen) {
      if (!state.worker || !fen) return;
      if (!state.ready) {
        state.fen = fen;
        return;
      }
      if (state.fen === fen) return;

      state.fen = fen;
      state.currentEval = '';
      state.bestMove = '';
      state.pv = '';

      emit({
        engineState: 'Stockfish: анализирует',
        evalText: 'Оценка: считаю…',
        bestMoveText: 'Лучший ход: считаю…',
        pvText: '—'
      });

      try {
        state.worker.postMessage('stop');
        state.worker.postMessage('position fen ' + fen);
        state.worker.postMessage('go depth 14');
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          if (!state.worker) return;
          state.worker.postMessage('stop');
          emit({ engineState: 'Stockfish: готов' });
        }, 1800);
      } catch (error) {
        console.error(error);
      }
    }

    return {
      init,
      requestAnalysis
    };
  }

  window.createStockfishController = createStockfishController;
})();
