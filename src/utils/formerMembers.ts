// src/utils/formerMembers.ts
//
// What a deleted account wrote still shows under its name (Andrei, 04.10.2026: „Rămân, și cu nume,
// dar apare ca șters”).
//
// The chat reads every name from `profiles/{uid}`, and that document goes with the account. So the
// deletion (functions/src/accountDeletion.ts) leaves the name on each conversation the person was
// in, as `formerMembers.{uid} = { name, deletedAt }` on the group or the direct chat, and the screens
// add those names to the map the chat reads, marked as deleted.
//
// Only to the CHAT's map. CalendarHome's member map is also the list of people an event can be
// assigned to, and somebody who no longer exists must not be offered there.
//
// The note wins over a profile the screen still holds: a uid in `formerMembers` IS a deleted account
// (uids are never reused), and Chat keeps the profiles it read before the deletion, which showed the
// plain name and a photo that is gone. Nobody can fake the note: only the deletion writes it
// (firestore.rules pins it on groups; direct chats are server-only).
//
// Pure: no React, no Firestore.

/** A deleted member as a screen shows it: `name` already says the account was deleted. */
export interface FormerPerson { name: string; deleted: true }

/** The deleted members a conversation document names, uid → the name they had (or null). */
export function formerMembersOf(doc: unknown): Record<string, string | null> {
  const raw = (doc as { formerMembers?: unknown } | null | undefined)?.formerMembers;
  const out: Record<string, string | null> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [uid, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!uid || !entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    out[uid] = typeof name === 'string' && name.trim() ? name.trim() : null;
  }
  return out;
}

/**
 * `people` with the deleted members of `docs` set, as `{ name: label(name), deleted: true }`, over any
 * entry `people` still had for them. The first conversation to name somebody gives the name. The SAME
 * object comes back when there is nothing to set, so a memoised map does not change identity on every
 * render (AddEventModal resets its form on a new one).
 */
export function withFormerMembers<T>(
  people: Record<string, T>,
  docs: unknown[],
  label: (name: string | null) => string,
): Record<string, T | FormerPerson> {
  let out: Record<string, T | FormerPerson> | null = null;
  const done = new Set<string>();
  for (const d of docs) {
    for (const [uid, name] of Object.entries(formerMembersOf(d))) {
      if (done.has(uid)) continue;
      done.add(uid);
      out ??= { ...people };
      out[uid] = { name: label(name), deleted: true };
    }
  }
  return out ?? people;
}

/** "Ana (deleted account)", or "Deleted account" when no name was left. */
export function deletedName(name: string | null, named: string, unnamed: string): string {
  return name ? named.replace('{name}', name) : unnamed;
}
