# Smoke-check

1. Open the app through the local server, not as a `file://` page.
   Recommended URL: `http://127.0.0.1:8000/Best%20Games.html`.
2. Confirm that the games table loads and selecting another game updates the board and move list.
3. Press Stockfish Play and wait until the depth line starts changing.
4. While Stockfish is running, click several moves forward and backward quickly.
   Expected: the engine keeps running, the status does not switch to error, and PV/eval update for the current board.
5. Switch between depth 20 and infinite analysis while the engine is running.
   Expected: the current analysis stops cleanly and restarts on the same position.
6. Change the number of variations from 1 to 3 and then back to 1 while the engine is running.
   Expected: the engine keeps responding and the PV area follows the selected count.
7. Press Pause, move to another position, then press Play again.
   Expected: analysis starts for the new current position.
8. Flip the board and switch themes.
   Expected: orientation/theme change does not affect the current engine session.
