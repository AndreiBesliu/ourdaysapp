import { serverTimestamp } from 'firebase/firestore';

// Determine the WINNER OF THE SESSION (not just the last round). Round-loop
// games (Tic-Tac-Toe, Connect 4, Memory Match) accumulate per-round wins in
// `state.scores`, so the session leader is whoever has the higher score — the
// `winner` field on the doc only reflects the most recent round. Rummy is a
// single hand, so its `winner` is already the session result.
export function getSessionWinner(game: any): string | null {
  const s = game?.state || {};
  const players = s.players || {};
  const scores = s.scores || {};

  switch (game?.gameType) {
    case 'tic-tac-toe': {
      const x = scores.X || 0, o = scores.O || 0;
      if (x === o) return null; // tie or no rounds won
      return (x > o ? players.X : players.O) || null;
    }
    case 'connect-4':
    case 'memory-match': {
      const p1 = scores.P1 || 0, p2 = scores.P2 || 0;
      if (p1 === p2) return null;
      return (p1 > p2 ? players.P1 : players.P2) || null;
    }
    case 'rummy-45':
    default:
      return game?.winner || null;
  }
}

// Firestore update payload that formally ENDS and LOCKS a game session: marks it
// finished, banks the session winner, and flags `finalized` so the round-loop
// games hide "Next Round" and the leaderboard treats it as a completed session.
export function finalizeGameUpdate(game: any) {
  return {
    status: 'finished',
    winner: getSessionWinner(game),
    finalized: true,
    endedAt: serverTimestamp(),
  };
}
