// src/utils/assetQueryRules.test.ts
// The same mechanical check `eventQueryRules.test.ts` applies to events, now that `assets` has
// more than one read branch and can therefore get this wrong.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// Firestore validates a LIST query against the rules WITHOUT reading a document. The query's own
// constraints must guarantee the rule for every document it could ever match; a query that does
// not is rejected whole, and a rejected listener looks exactly like an empty wallet.
//
// Until this commit the `assets` rule had a single branch — `ownerId == request.auth.uid` — and
// both call sites happened to filter on `ownerId`, so there was nothing to get wrong. The rule now
// also permits `isMemberOfGroup(sharedGroupId)`, which means a second legal query shape exists and
// a third, illegal one (an unfiltered read, or a filter on `sharedWithFamily`) is newly tempting:
// `sharedWithFamily` is still on every document, still looks like the sharing flag, and is
// guaranteed by NO branch of the rule.
//
// The allowed fields are parsed out of `firestore.rules`, so tightening the rule fails this test
// in the same commit rather than in production.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const APP = join(__dirname, '..', '..');
const SRC = join(APP, 'src');

/**
 * Fields a query may filter on to satisfy some branch of the `assets` read rule.
 *
 * Read from the WHOLE `match /assets/{assetId}` block rather than from the `allow read` line
 * alone: the branches are written as helper functions (`sharedWithMe(d)`), so the field a query
 * must use appears as `d.sharedGroupId` inside the helper and never textually in `allow read`.
 * Scanning the block catches both spellings and keeps working if a branch is inlined later.
 */
function allowedAssetFilterFields(): string[] {
  const rules = readFileSync(join(APP, 'firestore.rules'), 'utf8');
  const HEADER = 'match /assets/{assetId}';
  const open = rules.indexOf(HEADER);
  if (open === -1) throw new Error('could not find the assets rule block in firestore.rules');
  // Start counting AFTER the header: the path segment `{assetId}` is itself a balanced pair, so
  // a walk that begins at the first `{` closes on it and returns the header as the whole block —
  // an empty field list that would wave every query through.
  let depth = 0;
  let end = open;
  for (let i = rules.indexOf('{', open + HEADER.length); i < rules.length; i++) {
    if (rules[i] === '{') depth++;
    else if (rules[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const block = rules.slice(open, end + 1);
  const fields = new Set<string>();
  for (const m of block.matchAll(/(?:resource\.data|\bd)\.([A-Za-z0-9_]+)/g)) fields.add(m[1]);
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

/** Every `query(collection(db, 'assets'), …)` call, as its raw argument text. */
function assetQueries(src: string): string[] {
  const out: string[] = [];
  const opener = /\b(?:fs)?[qQ]uery\s*\(\s*collection\(\s*db\s*,\s*['"]assets['"]\s*\)/g;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    let depth = 0;
    let i = m.index;
    for (; i < src.length; i++) {
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

describe('every assets list query can actually be served', () => {
  const allowed = allowedAssetFilterFields();

  it('reads the allowed fields out of the rules rather than hardcoding them', () => {
    expect(allowed).toContain('ownerId');
    expect(allowed).toContain('sharedGroupId');
  });

  it('does NOT allow the legacy boolean, which no rule branch guarantees', () => {
    // The trap this file exists for: `sharedWithFamily` is still written on every asset and still
    // reads like the sharing flag, but filtering on it proves nothing about who may read the
    // result, so such a query is denied wholesale and renders as an empty wallet.
    expect(allowed).not.toContain('sharedWithFamily');
  });

  it('finds the query sites at all, so this cannot pass by finding nothing', () => {
    const total = walk(SRC).reduce((n, f) => n + assetQueries(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('every one filters on a field some rule branch guarantees', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(APP.length + 1).split(sep).join('/');
      for (const q of assetQueries(readFileSync(file, 'utf8'))) {
        const fields = [...q.matchAll(/where\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]);
        if (fields.some((f) => allowed.includes(f))) continue;
        offenders.push(
          `${rel}: query filters on [${fields.join(', ') || 'nothing'}], none of which appear in the assets read rule (${allowed.join(', ')})`,
        );
      }
    }
    expect(offenders, `denied-by-construction asset queries:\n${offenders.join('\n')}`).toEqual([]);
  });
});
