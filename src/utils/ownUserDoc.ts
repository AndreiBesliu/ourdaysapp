// src/utils/ownUserDoc.ts
//
// The signed-in person's OWN document on the calendar and Settings screens, and what may be claimed
// from it. Pure.
//
// ── What this replaces (27.09.2026) ──────────────────────────────────────────────────────────
//
// The birthday banner and the person's own entry in `userMap` came from ONE `getDoc` inside the
// groups listener, and nothing ever refreshed it:
//   * pressing the banner's X wrote `hideBirthdayPrompt: true` to the server — and the banner stayed,
//     because the map on screen was the one read before;
//   * a read that failed, or was answered from a stale cache, left the entry as the bare auth seed
//     (id, email, name), which the banner read as "no birthday". Andrei, 27.09: "tot imi apare
//     chestia cu birthday, dar eu o am setata" — on the server his document had the birthday AND
//     the flag, so either one alone should have hidden it.
// Now the screen keeps a live listener on that document, and a claim about somebody's account is
// made only on the SERVER's word, never from a cache.
//
// ── Where the birthday is asked for (28.09.2026) ─────────────────────────────────────────────
//
// Not on the calendar any more. Andrei, 28.09, after the fix above went live: "banner-ul a aparut
// pentru o secunda dar dupa a disparut, si parca l-as muta in tabul de settings". So the question is
// asked beside the field it is about, in Settings, and nowhere else. No X there: it is the field
// itself, and the old `hideBirthdayPrompt` flag had one job, closing a banner that no longer exists.

/**
 * Whether Settings points this person at their empty birthday field. `birthday` is the field's own
 * value, so what the person just typed counts at once; `fromServer` says the server has answered for
 * the document. Until it has, the field is empty because the form is still loading, and an empty
 * field is not yet a missing birthday.
 */
export function asksForBirthday(birthday: unknown, fromServer: boolean): boolean {
  // Truthiness, as the banner always used: any stored birthday counts, and an empty one does not.
  return fromServer && !birthday;
}

/**
 * `map` with the person's own entry taken from their live document, when there is one. The fields
 * the map already held (the auth seed: email, name) stay underneath; the document wins where both
 * have a value. Returns `map` itself when there is nothing to add, so no new object is handed down.
 */
export function withOwnEntry<T extends Record<string, unknown>>(
  map: Record<string, T>,
  uid: string | null | undefined,
  own: Record<string, unknown> | null | undefined,
): Record<string, T> {
  if (!uid || !own) return map;
  return { ...map, [uid]: { ...(map[uid] || {}), ...own, id: uid } as unknown as T };
}

/**
 * The same document content? A listener with metadata changes fires again when only the source
 * changes (cache → server, a write acknowledged) with an identical `data()` in a NEW object. That
 * object must not replace the old one: `userMap` is a dependency of AddEventModal's form reset, and
 * a new map while somebody types would clear their event.
 */
export function sameDoc(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
