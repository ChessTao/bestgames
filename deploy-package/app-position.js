(() => {
  function createPositionCache({ getCurrentFen }) {
    let cachedFen = null;
    let cachedChess = null;

    function currentFen() {
      return getCurrentFen();
    }

    function currentChess() {
      const fen = currentFen();
      if (cachedFen === fen && cachedChess) return cachedChess;
      cachedFen = fen;
      cachedChess = new window.Chess(fen);
      return cachedChess;
    }

    return {
      currentFen,
      currentChess
    };
  }

  window.appPosition = {
    createPositionCache
  };
})();
