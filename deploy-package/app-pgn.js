(() => {
  function normalizePgnText(text) {
    return (text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  }

  function splitMultiPgn(text) {
    const cleaned = normalizePgnText(text);
    if (!cleaned) return [];
    return cleaned.split(/\n(?=\[Event\s)/g).map((item) => item.trim()).filter(Boolean);
  }

  function parseHeaders(pgn) {
    const headers = {};
    const matches = pgn.matchAll(/^\[(\w+)\s+"(.*)"\]$/gm);
    for (const match of matches) headers[match[1]] = match[2];
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
    const match = String(dateStr || '').match(/(\d{4})/);
    return match ? match[1] : '—';
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
    const white = headers.White || 'Белые';
    const black = headers.Black || 'Черные';
    const whiteElo = headers.WhiteElo ? ` (${headers.WhiteElo})` : '';
    const blackElo = headers.BlackElo ? ` (${headers.BlackElo})` : '';
    const event = shortEventLabel(headers.Event || '');
    const year = yearFromDate(headers.Date || '');
    const result = headers.Result || '*';
    return `${white}${whiteElo}-${black}${blackElo}, ${event}, ${year}, ${result}`;
  }

  async function loadPgnText(source) {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) throw new Error(`PGN request failed: ${response.status}`);
    return response.text();
  }

  function buildGames(text) {
    const chunks = splitMultiPgn(text);
    const games = [];

    chunks.forEach((chunk, index) => {
      try {
        const chess = new window.Chess();
        const ok = chess.load_pgn(chunk, { sloppy: true, newline_char: '\n' });
        if (!ok) return;

        const headers = parseHeaders(chunk);
        const verboseMoves = chess.history({ verbose: true }) || [];
        chess.reset();
        const replay = chess;
        const states = [{ fen: replay.fen(), san: null, move: null, moveNumber: 0, from: null, to: null }];

        verboseMoves.forEach((move, moveIndex) => {
          replay.move(move);
          states.push({
            fen: replay.fen(),
            san: move.san,
            move,
            moveNumber: moveIndex + 1,
            from: move.from,
            to: move.to
          });
        });

        games.push({
          id: index,
          pgn: chunk,
          headers,
          moves: verboseMoves,
          states,
          title: `${headers.White || 'Белые'}${headers.WhiteElo ? ` (${headers.WhiteElo})` : ''} — ${headers.Black || 'Черные'}${headers.BlackElo ? ` (${headers.BlackElo})` : ''}`,
          subtitle: `${headers.Event || 'Без турнира'} • ${headers.Site || 'Без места'} • ${headers.Date || 'Без даты'}`,
          compactLabel: compactGameLabel(headers),
          result: headers.Result || '*',
          white: headers.White || 'Белые',
          black: headers.Black || 'Черные',
          whiteElo: headers.WhiteElo || '—',
          blackElo: headers.BlackElo || '—',
          event: headers.Event || '—',
          date: headers.Date || '—',
          year: yearFromDate(headers.Date || ''),
          sortDate: parseSortableDate(headers.Date || ''),
          sortWhiteElo: parseSortableElo(headers.WhiteElo || ''),
          sortBlackElo: parseSortableElo(headers.BlackElo || '')
        });
      } catch (error) {
        console.error('PGN parse error', error);
      }
    });

    return games;
  }

  window.appPgn = {
    buildGames,
    loadPgnText
  };
})();
