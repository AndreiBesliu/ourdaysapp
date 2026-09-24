// src/utils/requestSender.test.ts
//
// A friend request or invitation used to show `fromName` / `fromEmail` / `groupName` — fields its
// sender wrote — so a stranger read as "Mama <mama@…>". Now the server stamps the sender from
// Firebase Auth and the screen shows only that. See functions/src/senderIdentity.ts.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { shownSender, shownGroupName } from './requestSender';
import { senderStamp, stampedGroupName, trustedEmail } from '../../functions/src/senderIdentity';

const FORGED = { fromId: 'uid-stranger', fromName: 'Mama', fromEmail: 'mama@example.test', groupName: 'Family' };

describe('the server stamp', () => {
  it('takes the email from Auth and the name from the profile', () => {
    expect(senderStamp({ authEmail: 'Stranger@Example.test', authVerified: true, profileName: ' Mama ' }))
      .toEqual({ name: 'Mama', email: 'stranger@example.test', emailVerified: true });
  });

  it('falls back on the Auth email, never on anything the sender wrote', () => {
    expect(senderStamp({ authEmail: 'ion@example.test', profileName: '' }).name).toBe('ion');
    expect(senderStamp({}).name).toBe('Someone');
  });

  it('does not call an email verified that it does not have', () => {
    expect(senderStamp({ authVerified: true }).emailVerified).toBe(false);
    expect(senderStamp({ authEmail: 'x@y.test' }).emailVerified).toBe(false);
  });

  it('clamps what becomes somebody else’s screen', () => {
    expect(senderStamp({ profileName: 'x'.repeat(500) }).name).toHaveLength(40);
    expect(stampedGroupName('g'.repeat(500))).toHaveLength(60);
    expect(stampedGroupName('   ')).toBeNull();
    expect(stampedGroupName(42)).toBeNull();
  });

  it('accepts only something shaped like an email', () => {
    expect(trustedEmail('a@b')).toBe('a@b');
    for (const bad of ['', 'no-at-sign', 'two@@signs', 'a b@c', null, 7, {}]) {
      expect(trustedEmail(bad), String(bad)).toBeNull();
    }
  });
});

describe('what the recipient sees', () => {
  it('is the stamp, when there is one', () => {
    const s = shownSender({ ...FORGED, sender: { name: 'Ion', email: 'ion@example.test', emailVerified: true } });
    expect(s).toEqual({ name: 'Ion', email: 'ion@example.test', verified: true, unconfirmed: false });
  });

  it('never the sender’s own fields, even with nothing else to go on', () => {
    // The whole defect in one assertion: a request with forged fields and no stamp.
    const s = shownSender(FORGED);
    expect(s.name).toBeNull();
    expect(s.email).toBeNull();
    expect(s.unconfirmed).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/Mama|mama@/);
  });

  it('falls back on the sender’s CURRENT profile name, without an email, and says so', () => {
    expect(shownSender(FORGED, 'Ion Popescu'))
      .toEqual({ name: 'Ion Popescu', email: null, verified: false, unconfirmed: true });
  });

  it('marks an unverified Auth email as such', () => {
    // Email/password sign-up does not prove ownership: a stranger can register an address whose
    // real owner never signed up. Shown, but not presented as proof.
    expect(shownSender({ sender: { name: 'Mama', email: 'mama@example.test', emailVerified: false } }).verified)
      .toBe(false);
  });

  it('shows the group name the SERVER read, not the one in the invitation', () => {
    expect(shownGroupName(FORGED)).toBeNull();
    expect(shownGroupName({ ...FORGED, verifiedGroupName: 'Besliu' })).toBe('Besliu');
  });
});

describe('nothing reads the sender’s own fields any more', () => {
  // A second net, on the source. The functions above are tested by running them; this stops a
  // later screen or trigger from quietly reading `r.fromName` again. WRITES stay legal — the web
  // client still writes these fields, since the installed APK is not rebuilt yet — and a write is
  // a property ASSIGNMENT in an object literal, a different AST node from a property ACCESS.
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'warlord' || name === 'lib') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  const ROOTS = [resolve(process.cwd(), 'src'), resolve(process.cwd(), 'functions/src')];
  const FORGEABLE = new Set(['fromName', 'fromEmail']);

  /** Lines in `sf` that READ a forgeable field. The one predicate both tests below run. */
  function readsIn(sf: ts.SourceFile): number[] {
    const lines: number[] = [];
    const visit = (n: ts.Node): void => {
      const name =
        ts.isPropertyAccessExpression(n) ? n.name.text
        : ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) ? n.argumentExpression.text
        : null;
      if (name && FORGEABLE.has(name)) lines.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return lines;
  }

  function reads(): string[] {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(root)) {
        const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        for (const line of readsIn(sf)) {
          hits.push(`${file.slice(process.cwd().length + 1).split('\\').join('/')}:${line}`);
        }
      }
    }
    return hits;
  }

  it('finds none', () => {
    expect(reads(), 'fromName / fromEmail are written by the sender. Show the server stamp instead '
      + '(shownSender) and, on the server, take emails from Auth (authIdentityOf).').toEqual([]);
  });

  it('and the net is not blind: it finds a read when there is one', () => {
    // Runs the SAME predicate as the sweep above, on a line with two reads and one write.
    const sf = ts.createSourceFile('x.ts',
      ['const a = r.fromName;', 'const b = r["fromEmail"];', 'const c = { fromName: 1 };'].join('\n'),
      ts.ScriptTarget.Latest, true);
    expect(readsIn(sf)).toEqual([1, 2]); // the object-literal WRITE on line 3 is not a read
  });
});
