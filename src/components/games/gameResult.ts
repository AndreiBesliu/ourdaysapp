// src/components/games/gameResult.ts
//
// The client half of closing a game session.
//
// The DECISION — who won, and whether a session counts as abandoned — moved to
// `src/utils/gameSession.ts`, which is copied byte-for-byte into the functions build so the
// scheduled sweep that closes forgotten games answers exactly as the End button does. What is
// left here is the one thing that cannot be shared: `serverTimestamp()` is a different function
// in the web SDK and in the Admin SDK.

import { serverTimestamp } from 'firebase/firestore';
import { closedSessionFields } from '../../utils/gameSession';

export { getSessionWinner } from '../../utils/gameSession';

/**
 * Firestore update payload that formally ENDS and LOCKS a game session: marks it finished, banks
 * the session winner, and flags `finalized` so the round-loop games hide "Next Round" and the
 * leaderboard treats it as a completed session.
 *
 * No `abandoned` flag: a person pressed the button. The sweep passes true for that.
 */
export function finalizeGameUpdate(game: any) {
  return {
    ...closedSessionFields(game, false),
    endedAt: serverTimestamp(),
  };
}
