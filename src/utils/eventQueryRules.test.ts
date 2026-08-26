// src/utils/eventQueryRules.test.ts
// A list query that no rule branch can satisfy is denied WHOLESALE — and looks like an empty result.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// Firestore validates a LIST query against the security rules without reading a single document.
// It has to: it cannot return a page and then discover the rules forbid it. So the query's own
// constraints must GUARANTEE the rule passes for every document the query could ever match.
//
// The practical consequence is unintuitive. `allow read` on `events` permits a document whose
// `ownerId` is you. It does NOT follow that you may query `where('overrideOfParent','==',id)` and
// receive the subset you own — that query is rejected outright, before any document is looked at,
// because nothing in it proves the results will be yours.
//
// This app has now shipped that exact bug three times against the same collection:
//   * RecurringEventsPanel.handleDeleteSeries — found, fixed, and documented in place;
//   * EventDetailsModal.handleDelete, occurrence branch — the fix was never carried over;
//   * EventDetailsModal.handleDelete, master branch — same.
// In each case the parent was deleted first and the denied query came second, so the destructive
// half completed, the reconciling half could not, and `console.error` was the only witness.
//
// So the check is mechanical from here on. The allowed field list is PARSED FROM THE RULES rather
// than hardcoded, so that changing the rules changes the test in the same commit.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const APP = join(__dirname, '..', '..');
const SRC = join(APP, 'src');

/** The fields a query may filter on to satisfy some branch of the `events` read rule. */
function allowedEventFilterFields(): string[] {
  const rules = readFileSync(join(APP, 'firestore.rules'), 'utf8');
  const match = /match \/events\/\{eventId\}[\s\S]*?allow read: if ([\s\S]*?);/.exec(rules);
  if (!match) throw new Error('could not find the events read rule in firestore.rules');
  const fields = new Set<string>();
  for (const m of match[1].matchAll(/resource\.data\.([A-Za-z0-9_]+)/g)) fields.add(m[1]);
  return [...fields].sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'warlord' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every `query(collection(db, 'events'), …)` call, returned as its raw argument text. */
function eventQueries(src: string): string[] {
  const out: string[] = [];
  const opener = /\b(?:fs)?[qQ]uery\s*\(\s*collection\(\s*db\s*,\s*['"]events['"]\s*\)/g;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    // Walk to the matching close paren so nested calls do not truncate the slice.
    let depth = 0;
    let i = m.index + m[0].lastIndexOf('(') - m[0].lastIndexOf('(');
    for (i = m.index; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe('every events list query can actually be served', () => {
  const allowed = allowedEventFilterFields();

  it('reads the allowed fields out of the rules rather than hardcoding them', () => {
    // If this list ever shrinks, some query below stops being legal — which is the point.
    expect(allowed).toContain('ownerId');
    expect(allowed).toContain('groupId');
    expect(allowed.length).toBeGreaterThanOrEqual(4);
  });

  it('finds the query sites at all, so this cannot pass by finding nothing', () => {
    const total = walk(SRC).reduce((n, f) => n + eventQueries(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('every one filters on a field some rule branch guarantees', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(APP.length + 1).split(sep).join('/');
      for (const q of eventQueries(readFileSync(file, 'utf8'))) {
        const fields = [...q.matchAll(/where\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]);
        if (fields.some((f) => allowed.includes(f))) continue;
        offenders.push(`${rel}: query filters on [${fields.join(', ') || 'nothing'}], none of which appear in the events read rule (${allowed.join(', ')})`);
      }
    }
    expect(offenders, `denied-by-construction event queries:\n${offenders.join('\n')}`).toEqual([]);
  });
});
