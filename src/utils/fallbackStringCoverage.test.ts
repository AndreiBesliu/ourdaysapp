// src/utils/fallbackStringCoverage.test.ts
//
// English hiding in the one place a text scanner is built not to look.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// `i18nCoverage.test.ts` blanks every `{…}` before it searches, on purpose: inside the braces is
// code, and reading code as prose is how a scanner reports 196 findings and gets ignored. But the
// commonest English left in this app lives exactly there:
//
//     {userMap[id]?.name || userMap[id]?.email?.split('@')[0] || 'Member'}
//     {parentMsg.isDeleted ? 'Deleted message' : (parentMsg.text || 'Photo')}
//
// A value that appears only when something is missing — no name, no text, a deleted message — so
// it is also the hardest thing to notice by looking at the screen. Measured on 19.09: twenty-nine
// of them across `src`, in the chat, the wallet, the event form and the settings screen.
//
// ── The one legitimate reason to leave one ────────────────────────────────────────────
//
// A fallback that is WRITTEN TO THE DATABASE must stay as it is. `fromName: myName || 'Friend'`
// is stored on a friend request and read by the RECIPIENT; resolving it through `t()` freezes the
// sender's language into shared data and shows it to somebody who never chose that language. The
// same goes for the name given to an account at sign-up and to an uploaded card.
//
// That is why the exemptions below are the exception LIST and not a count: every entry names the
// file, the literal and the reason. A new fallback has to be argued for, in here, in writing.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..');

/** The same two exemptions as the other guards: the game submodule and Andrei's own console. */
const SKIP_DIRS = new Set(['warlord', 'warlordPvp', 'warlordAdmin', 'node_modules']);
const SKIP_FILES = new Set(['Admin.tsx', 'Warlord.tsx']);

/**
 * `file::literal` pairs that are values, not labels.
 *
 * Each one is stored, sent, or compared by code. Translating any of them makes the app worse:
 * the reader gets the writer's language, or a lookup stops matching.
 */
const STORED_NOT_SHOWN = new Set([
  // Written as the account's `name` in Firestore the first time somebody signs in.
  'App.tsx::User',
  'screens/Login.tsx::User',
  // Written as the stored `name` of a card created from an event's image or checklist item.
  'components/AddEventModal.tsx::Event Image',
  'components/AddEventModal.tsx::Checklist Item',
  // A symbology name compared against by code (EAN_13, UPC_A …), never shown.
  'components/BarcodeScanner.tsx::UNKNOWN',
  // The message that goes to the error log, which I read in English.
  'components/ErrorBoundary.tsx::Render error',
  // Written as `fromName` on a friend request and read by the RECIPIENT.
  'components/GroupSettingsModal.tsx::Friend',
  // The three in plain `.ts` modules, brought into scope on 19.09. All three go to a log or to
  // a lookup, never to a screen.
  'ai.ts::Unknown error',            // the message handed to reportError when a callable throws
  'reportError.ts::Unknown error',   // the same, inside the reporter itself
  'utils/barcodeFormat.ts::CODE128', // a symbology name compared against, never shown
  'utils/eventTime.ts::UTC',         // an IANA zone id the runtime is asked for and may not give
  // (The wallet's `Uncategorized` was exempted here until 19.09, when it became the shared
  // constant `UNCATEGORIZED` in walletCategories.ts. The honesty test below is what noticed
  // that the exemption had nothing left to exempt — on the first commit after it was added.)
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, out);
      // `.ts` as well as `.tsx`: a fallback is an expression, and expressions live in plain
      // modules too. Walking only `.tsx` put a whole class of file out of scope by
      // construction — which is not a narrow net, it is a net with a side missing.
    } else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !SKIP_FILES.has(name)
               && !name.includes('.test.') && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * `|| 'Some English'` and `? 'Some English' :` — a literal that begins with a capital and reads
 * like a word, standing in for something that was not there.
 */
export function englishFallbacks(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // `||` is the fallback; `? '…'` the near branch of a ternary. A bare `: '…'` is only
    // counted when a `?` came earlier on the line, because otherwise it is an object property
    // — `name: 'Blue'` in a theme table is data, not a sentence.
    for (const m of line.matchAll(/(?:\|\||\?)\s*'([A-Z0-9][A-Za-z0-9 .!?…]{2,40})'/g)) {
      out.push({ line: i + 1, text: m[1] });
    }
    // `|| { name: 'Unknown' }` — an object standing in for a missing person, whose fields
    // are then rendered. Distinct from `name: 'Blue'` in a theme table, which is data.
    for (const m of line.matchAll(/\|\|\s*\{[^}]*'([A-Z0-9][A-Za-z0-9 .!?…]{2,40})'/g)) {
      out.push({ line: i + 1, text: m[1] });
    }
    // The far branch of a ternary whose NEAR branch is not a literal — the ordinary shape once
    // the near branch has been translated: `cond ? t('key', language) : 'English'`, or
    // `x?.name ? x.name : 'Linked Card'`. The rule this replaces needed quotes on BOTH sides,
    // so it went blind the moment half of a line was repaired.
    //
    // Requiring the `?` to come BEFORE the colon is what keeps an object property out:
    // `name: 'Blue'` in a theme table has no question mark in front of it.
    const q = line.indexOf('?');
    if (q >= 0) {
      for (const m of line.matchAll(/:\s*'([A-Z0-9][A-Za-z0-9 .!?…]{2,40})'/g)) {
        if (m.index !== undefined && m.index > q) out.push({ line: i + 1, text: m[1] });
      }
    }
  });
  // Two shapes that are never prose: a dotted identifier (`GroupSettingsModal.leaveGroup`,
  // the context handed to the error log) and a lone CamelCase token (`StaleChunk`). Both
  // are written by code for code. Anything with a space in it is left alone.
  // A run of three letters, so a numeric default like '0.00' is not read as a sentence.
  return out.filter(({ text }) => /[A-Za-z]{3}/.test(text)).filter(({ text }) =>
    !/^[A-Za-z]+(\.[A-Za-z]+)+$/.test(text) && !(!text.includes(' ') && /^[A-Z][a-z]+[A-Z]/.test(text)));
}

describe('a word a person reads is not left in one language by accident', () => {
  const files = walk(SRC);

  it('finds the screens at all, so this cannot pass by scanning nothing', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith('GroupChatWidget.tsx'))).toBe(true);
  });

  it('sees the shape that hid nineteen strings inside braces', () => {
    const sample = "<p>{userMap[id]?.name || 'Member'}</p>";
    expect(englishFallbacks(sample).map((h) => h.text)).toEqual(['Member']);
  });

  it('sees the branch as well as the fallback', () => {
    const sample = "<p>{msg.isDeleted ? 'Deleted message' : (msg.text || 'Photo')}</p>";
    expect(englishFallbacks(sample).map((h) => h.text)).toEqual(['Deleted message', 'Photo']);
  });

  it('is satisfied by a translated one', () => {
    expect(englishFallbacks("<p>{u.name || t('memberFallback', language)}</p>")).toEqual([]);
  });

  it('sees an object standing in for a missing person', () => {
    // `userMap[id] || { name: 'Unknown' }` — the literal is a property, so the plain
    // fallback pattern walks past it, and the word is rendered all the same.
    const sample = "const sender = userMap[msg.senderId] || { name: 'Unknown' };";
    expect(englishFallbacks(sample).map((h) => h.text)).toEqual(['Unknown']);
  });

  it('sees a label that begins with a number', () => {
    // Four of these sat in the details view's reminder line while the form's dropdown beside
    // it, saying the same four things, was translated.
    const sample = "{m === 15 ? '15 minutes before' : m === 60 ? '1 hour before' : ''}";
    expect(englishFallbacks(sample).map((h) => h.text)).toContain('15 minutes before');
  });

  it('walks past a theme table, a dotted context and a numeric default', () => {
    // The cost of looking inside braces: three shapes that are code or data, not sentences.
    expect(englishFallbacks("const THEMES = [{ name: 'Blue', hex: '#1d4ed8' }];")).toEqual([]);
    expect(englishFallbacks("context: isStale(e) ? 'StaleChunk' : 'ErrorBoundary',")).toEqual([]);
    expect(englishFallbacks("reportError(m, { context: 'LeaveGroupModal.leaveGroup' });")).toEqual([]);
    expect(englishFallbacks("const total = row.amount || '0.00';")).toEqual([]);
  });

  it('does not read a commented-out example as code', () => {
    expect(englishFallbacks("// it used to say || 'Member' here")).toEqual([]);
  });

  it('sees the far branch after the near one has been translated', () => {
    // The shape a half-finished sweep leaves behind, and the one the old rule was blind to:
    // it needed a quoted literal on BOTH sides of the colon.
    const a = "<span>{item.name ? item.name : 'Linked Card'}</span>";
    const b = "<span>{n > 0 ? t('hits', language) : '0 results'}</span>";
    expect(englishFallbacks(a).map((h) => h.text)).toContain('Linked Card');
    expect(englishFallbacks(b).map((h) => h.text)).toContain('0 results');
  });

  it('walks plain .ts modules too, not only .tsx', () => {
    // A fallback is an expression, and expressions live in plain modules. Walking `.tsx` only
    // left a whole class of file out of scope by construction.
    const plain = files.filter((f) => f.endsWith('.ts'));
    expect(plain.length).toBeGreaterThan(20);
    expect(plain.some((f) => f.endsWith(`${sep}reportError.ts`))).toBe(true);
  });

  it('every English fallback a person reads goes through t()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1).split(sep).join('/');
      for (const hit of englishFallbacks(readFileSync(f, 'utf8'))) {
        if (STORED_NOT_SHOWN.has(`${rel}::${hit.text}`)) continue;
        offenders.push(`${rel}:${hit.line}  '${hit.text}'`);
      }
    }
    expect(
      offenders,
      `English fallbacks outside t():\n${offenders.join('\n')}\n\n` +
        'If one of these is written to the database rather than shown, add it to ' +
        'STORED_NOT_SHOWN with the reason. Otherwise it needs a key in all six languages.',
    ).toEqual([]);
  });

  it('keeps the exemption list honest: every entry still exists in its file', () => {
    // An allow-list that outlives what it allows is a list nobody trusts. If a line is deleted or
    // finally translated, its exemption has to go with it.
    const stale: string[] = [];
    for (const entry of STORED_NOT_SHOWN) {
      const [rel, text] = entry.split('::');
      const f = files.find((x) => x.slice(SRC.length + 1).split(sep).join('/') === rel);
      if (!f || !englishFallbacks(readFileSync(f, 'utf8')).some((h) => h.text === text)) {
        stale.push(entry);
      }
    }
    expect(stale, `exemptions for something that is no longer there:\n${stale.join('\n')}`).toEqual([]);
  });
});
