// src/utils/verifiedEmail.test.ts
//
// An email-addressed listener must ask with the address the RULES will accept, or not ask at all.
//
// Since 20.09 `firestore.rules` honours the `toEmail` branch of `canAccessInvite` /
// `canAccessFriendReq` only for a verified address. A Firestore LIST query is validated against
// the rule WITHOUT reading any document, so a client that subscribes anyway does not get a shorter
// list — it gets the whole listener refused, and `liveQuery` reports that once per mount. Three
// listeners, one per screen visit, for every unverified account, forever.
//
// Two things are held here. The decision itself (what counts as proved), and the fact that no
// third site can quietly appear asking the old way.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { verifiedEmailFrom } from './verifiedEmail';

describe('what counts as an address this account has proved', () => {
  it('returns the address when the token says verified', () => {
    expect(verifiedEmailFrom({ email: 'dave@example.test', email_verified: true }))
      .toBe('dave@example.test');
  });

  it('lowercases it, because that is what the documents and the rule use', () => {
    // The client writes `toEmail.toLowerCase()`; the token carries the address as registered. A
    // query filter has to guarantee the rule it will be checked against, so both must be lowered.
    expect(verifiedEmailFrom({ email: 'Dave@Example.TEST', email_verified: true }))
      .toBe('dave@example.test');
  });

  it('refuses an address that has not been confirmed', () => {
    expect(verifiedEmailFrom({ email: 'dave@example.test', email_verified: false })).toBeNull();
    expect(verifiedEmailFrom({ email: 'dave@example.test' })).toBeNull();
  });

  it('will not accept the STRING "true" as a yes', () => {
    // `Boolean("false")` is true, and this repo has been caught by that twice. Claims are a bag
    // the Admin SDK can write anything into, and the rule compares with `== true`, so anything
    // looser here would put the client and the rules on different answers.
    expect(verifiedEmailFrom({ email: 'd@e.test', email_verified: 'true' })).toBeNull();
    expect(verifiedEmailFrom({ email: 'd@e.test', email_verified: 1 })).toBeNull();
    expect(verifiedEmailFrom({ email: 'd@e.test', email_verified: 'false' })).toBeNull();
  });

  it('refuses when there is no usable address', () => {
    expect(verifiedEmailFrom({ email_verified: true })).toBeNull();
    expect(verifiedEmailFrom({ email: '', email_verified: true })).toBeNull();
    expect(verifiedEmailFrom({ email: '   ', email_verified: true })).toBeNull();
    expect(verifiedEmailFrom({ email: 42, email_verified: true })).toBeNull();
    expect(verifiedEmailFrom(null)).toBeNull();
    expect(verifiedEmailFrom(undefined)).toBeNull();
  });
});

describe('no listener asks the old way', () => {
  const SRC = resolve(process.cwd(), 'src');

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'warlord') continue;
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) sourceFiles(file, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(file);
    }
    return out;
  }

  /** Every `where('toEmail', …)` call in the app, with the expression it filters by. */
  function toEmailFilters(): { file: string; line: number; arg: string }[] {
    const found: { file: string; line: number; arg: string }[] = [];
    for (const file of sourceFiles(SRC)) {
      const sf = ts.createSourceFile(
        file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
      );
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)
            && n.expression.getText(sf) === 'where'
            && n.arguments.length === 3
            && ts.isStringLiteral(n.arguments[0])
            && n.arguments[0].text === 'toEmail') {
          found.push({
            file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            arg: n.arguments[2].getText(sf),
          });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return found;
  }

  const filters = toEmailFilters();

  it('found the listeners, so an empty pass cannot be a silent pass', () => {
    // Three: group invites and the friend badge in CalendarHome, incoming requests in Friends.
    // A parser rather than a regex, because a regex over source is satisfied by a comment — which
    // is how two guards in this repo were green while testing nothing.
    expect(filters.length).toBe(3);
  });

  it('every one of them filters by the verified address', () => {
    // `auth.currentUser.email` is the shape that was there before, and it is the wrong fact: it
    // comes from the user record, while the rule reads the token claim. They disagree for the
    // minutes between confirming an address and the token being refreshed.
    const wrong = filters.filter((f) => f.arg !== 'verifiedEmail');
    expect(
      wrong.map((f) => `${f.file}:${f.line} — where('toEmail','==',${f.arg})`),
      "Filter by the value from useVerifiedEmail(). A LIST is validated against the rule without "
      + 'reading documents, so an unverified address does not return fewer rows — it refuses the '
      + 'whole listener and logs an error every time the screen mounts.',
    ).toEqual([]);
  });
});
