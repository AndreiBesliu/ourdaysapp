// src/components/games/gameWrite.ts
//
// Every write to a game document goes through here, so every one of them records WHEN.
//
// Before 16.09.2026 not one of the fifteen `updateDoc` calls in the arcade wrote a timestamp. The
// only time on a game was `createdAt`, which meant "abandoned after 24 hours of inactivity" was
// not a rule anyone could implement: there was no way to tell a game abandoned last month from
// one whose players are mid-move.
//
// A helper rather than twenty-six copies of `lastMoveAt: serverTimestamp()`, because the failure
// mode of the copies is the one that hurts: miss a single call site and a game people are actively
// playing looks idle to the sweep and gets closed under them. `src/utils/arcadeWrites.test.ts`
// keeps the bypass from coming back — nothing under `components/games` may call `updateDoc` or
// `setDoc` itself.

import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';

/**
 * Apply `fields` to a game and stamp the moment.
 *
 * Dotted paths work as they do in `updateDoc` — `{ 'state.flippedIndices': [] }` updates that leaf
 * alone — because this only spreads one more key alongside them.
 */
export async function writeGame(gameId: string, fields: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'games', gameId), {
    ...fields,
    // Last, deliberately: a caller that passed its own `lastMoveAt` would be saying the game was
    // touched at some other moment, and no caller has any business saying that.
    lastMoveAt: serverTimestamp(),
  });
}
