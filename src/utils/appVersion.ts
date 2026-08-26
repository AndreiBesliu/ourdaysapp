// src/utils/appVersion.ts
// Noticing that the tab you are looking at is running yesterday's code.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// Two separate things make a browser show stale code, and only one of them was fixed today.
//
//   1. The entry document was served with `max-age=3600`, so even a deliberate reload returned the
//      old `index.html`, the old bundle hash, and the old code for an hour. That was a glob bug in
//      `firebase.json` and it is fixed: every navigable route now says `no-cache`.
//
//   2. A tab that is simply LEFT OPEN keeps running the JavaScript it loaded when it opened.
//      No header can fix that — nothing re-fetches anything. This app is a chat and a calendar,
//      exactly the kind of thing people leave open for days. `index.html` has an `app_version`
//      literal that was meant to catch this, but it only runs when a fresh `index.html` is parsed,
//      which is the one case that was never the problem, and nobody ever bumped it past 'v1.0.2'.
//
// So: ask the server what the current entry bundle is, compare it with the one this tab is
// actually running, and let the person decide when to reload. Never reload for them — a forced
// reload in a chat app throws away a half-typed message.

/**
 * The entry script filename the running page was booted with.
 *
 * Vite emits `<script type="module" crossorigin src="/assets/index-<hash>.js">` into the built
 * `index.html`, and the hash IS the content. Comparing filenames therefore compares builds exactly,
 * with no version number for anyone to forget to bump.
 *
 * In dev the entry is `/src/main.tsx`, which has no hash and never changes — hence `null`, which
 * the caller treats as "cannot tell", not as "up to date".
 */
export function runningEntry(scripts: readonly { src: string }[]): string | null {
  for (const s of scripts) {
    const name = entryFromSrc(s.src);
    if (name) return name;
  }
  return null;
}

/** `https://host/assets/index-D1OdOYH2.js?x=1` → `index-D1OdOYH2.js`; anything else → null. */
function entryFromSrc(src: string): string | null {
  if (!src) return null;
  // Only the app's own hashed entry counts. reCAPTCHA and the Google API loader are also in
  // document.scripts, and they change on Google's schedule, not ours — treating one of those as
  // "the app version" would show the notice at random.
  const m = /\/assets\/(index-[A-Za-z0-9_-]+\.js)(?:[?#]|$)/.exec(src);
  return m ? m[1] : null;
}

/**
 * The entry script named by a freshly fetched `index.html`.
 *
 * Pure and separately tested, because this is the part that silently returns nothing when the
 * markup shifts — and "found nothing" must never be mistaken for "there is a new version".
 */
export function entryFromHtml(html: string): string | null {
  const m = /<script[^>]+src="[^"]*\/assets\/(index-[A-Za-z0-9_-]+\.js)"/i.exec(html);
  return m ? m[1] : null;
}

export type VersionCheck = 'same' | 'new' | 'unknown';

/**
 * Compare what is running with what the server serves now.
 *
 * Returns `unknown` for every ambiguity — offline, a non-200, markup we could not parse, dev mode.
 * That asymmetry is deliberate: a false "new version available" trains people to ignore the bar,
 * and the bar is only worth having if it is always true.
 */
export async function checkForNewVersion(
  fetchImpl: typeof fetch = fetch,
  scripts: readonly { src: string }[] = Array.from(document.scripts),
): Promise<VersionCheck> {
  const running = runningEntry(scripts);
  if (!running) return 'unknown';
  try {
    // `cache: 'no-store'` rather than trusting the response header: this must be right even from a
    // browser that still holds the pre-fix `max-age=3600` copy of the entry document.
    const res = await fetchImpl('/index.html', { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const served = entryFromHtml(await res.text());
    if (!served) return 'unknown';
    return served === running ? 'same' : 'new';
  } catch {
    // Offline is the ordinary case here, not an error worth reporting.
    return 'unknown';
  }
}
