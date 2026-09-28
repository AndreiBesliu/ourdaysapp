// scripts/offlineStamp.mjs
//
// The revision that ties the offline Cards page to the service worker (28.09.2026). Pure: strings in,
// strings out. Used by stamp-offline.mjs (build) and check-offline.mjs (predeploy, CI).
//
// The page carries `data-ourdays-offline-cards="<rev>"`; sw.js carries `const OFFLINE_REV = '<rev>';`.
// The worker stores the page only when the page's body shows the rev the worker was stamped with, so
// a half-deployed or stale page can never be stored under a new worker (public/sw.js).
import { createHash } from 'node:crypto';

export const PLACEHOLDER = '__OFFLINE_REV__';
export const SW_LINE_PLACEHOLDER = `const OFFLINE_REV = '${PLACEHOLDER}';`;
export const MAX_PAGE_BYTES = 700 * 1024;
const REV_RE = /^[0-9a-f]{16}$/;

/** 16 hex characters of sha256 over the UNSTAMPED page. */
export function revOf(unstampedHtml) {
  return createHash('sha256').update(unstampedHtml, 'utf8').digest('hex').slice(0, 16);
}

const count = (s, needle) => s.split(needle).length - 1;

/** What a built page must not be, as a list of sentences; empty when it is fine. */
export function pageProblems(unstampedHtml) {
  const out = [];
  const n = count(unstampedHtml, PLACEHOLDER);
  if (n !== 1) out.push(`the page must carry the placeholder exactly once, found ${n}`);
  // Nothing may load from elsewhere: the worker serves this one file with no network. Checked on the
  // markup with the inline script and style bodies removed (code may legitimately say `href=`).
  // The opening tags stay: `<script src=…>` is exactly what must be caught.
  const markup = unstampedHtml
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
  if (/\b(src|href)\s*=/i.test(markup)) out.push('the page loads something (src= or href= in its markup)');
  if (/firestore\.googleapis\.com|@firebase/.test(unstampedHtml)) out.push('the page contains Firebase');
  const bytes = Buffer.byteLength(unstampedHtml, 'utf8');
  if (bytes > MAX_PAGE_BYTES) out.push(`the page is ${bytes} bytes, over ${MAX_PAGE_BYTES}`);
  return out;
}

/** The worker source must carry the placeholder line exactly once. */
export function swProblems(unstampedSw) {
  const n = count(unstampedSw, SW_LINE_PLACEHOLDER);
  return n === 1 ? [] : [`sw.js must carry "${SW_LINE_PLACEHOLDER}" exactly once, found ${n}`];
}

export function stampPage(unstampedHtml, rev) {
  if (!REV_RE.test(rev)) throw new Error(`not a revision: ${rev}`);
  return unstampedHtml.replace(PLACEHOLDER, rev);
}

/** `rev` is 16 hex characters, or 'off' (the kill switch: the worker then removes the page). */
export function stampSw(unstampedSw, rev) {
  if (!REV_RE.test(rev) && rev !== 'off') throw new Error(`not a revision: ${rev}`);
  return unstampedSw.replace(SW_LINE_PLACEHOLDER, `const OFFLINE_REV = '${rev}';`);
}

/** The rev a stamped page carries, or null. */
export function pageRev(html) {
  const m = /data-ourdays-offline-cards="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

/** The rev a stamped worker carries, or null. */
export function swRev(sw) {
  const m = /^const OFFLINE_REV = '([^']*)';$/m.exec(sw);
  return m ? m[1] : null;
}

/**
 * Everything check-offline verifies about a finished dist, as sentences; empty when it is fine.
 * `killSwitch` is true when VITE_OFFLINE_CARDS=0 is set, the only case 'off' is accepted.
 */
export function distProblems({ html, sw, publicSw, killSwitch }) {
  const out = [];
  const rev = swRev(sw);
  if (rev === null) return ['dist/sw.js carries no OFFLINE_REV line'];
  if (rev === PLACEHOLDER) out.push('dist/sw.js was not stamped');
  if (rev === 'off' && !killSwitch) out.push("dist/sw.js is stamped 'off' but VITE_OFFLINE_CARDS=0 is not set");
  if (killSwitch && rev !== 'off') out.push('VITE_OFFLINE_CARDS=0 is set but dist/sw.js carries a live revision (rebuild with the flag)');
  // The worker in dist must be the source, but for the one stamped line (a replay of an older file by a
  // sync client, or a skipped stamp, is caught here). Line endings do not count: git may re-check-out
  // public/sw.js as CRLF on Windows between the build and the deploy.
  const lf = (s) => s.replace(/\r\n/g, '\n');
  if (lf(sw) !== lf(publicSw.replace(SW_LINE_PLACEHOLDER, `const OFFLINE_REV = '${rev}';`))) {
    out.push('dist/sw.js differs from public/sw.js beyond the stamped line');
  }
  if (rev !== 'off') {
    if (html === null) return [...out, 'dist/offline/cards.html is missing'];
    const prev = pageRev(html);
    if (prev !== rev) out.push(`the page carries rev ${prev}, the worker ${rev}`);
    const unstamped = html.replace(`data-ourdays-offline-cards="${prev}"`, `data-ourdays-offline-cards="${PLACEHOLDER}"`);
    if (revOf(unstamped) !== rev) out.push('the page does not hash to its rev (edited after stamping?)');
    out.push(...pageProblems(unstamped));
  }
  return out;
}
