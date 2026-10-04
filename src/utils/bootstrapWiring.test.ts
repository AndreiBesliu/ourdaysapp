// src/utils/bootstrapWiring.test.ts
//
// App.tsx writes, at every start, only what utils/bootstrapWrites.ts decided (04.10.2026) — at once when
// the server answered the read, otherwise at the first answer the server confirms in the session. The
// decision is tested there; this holds the wiring, which needs a signed-in Firebase to run. Read with
// the TypeScript parser, so a comment cannot satisfy a check. The behaviour itself was reproduced and
// fixed on the real App.tsx against the emulators (DEVLOG 04.10).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const FILE = resolve(process.cwd(), 'src', 'App.tsx');
const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function all(root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => { if (pred(n)) out.push(n); ts.forEachChild(n, visit); };
  visit(root);
  return out;
}
const calls = (name: string, root: ts.Node = sf) =>
  all(root, (n) => ts.isCallExpression(n) && n.expression.getText(sf) === name) as ts.CallExpression[];
const guardOf = (n: ts.Node): string | null => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isIfStatement(p)) return p.expression.getText(sf);
  return null;
};
const declOf = (name: string): ts.Node => {
  const d = all(sf, (n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === name) as ts.VariableDeclaration[];
  expect(d, name).toHaveLength(1);
  return d[0].initializer!;
};

describe('the start writes only the plan', () => {
  it('the plan is made from the read itself', () => {
    expect(declOf('profileRead').getText(sf)).toBe('profileReadOf(userDocSnap)');
    const plans = calls('bootstrapPlan').map((c) => c.arguments[0].getText(sf));
    expect(plans).toEqual(['profileRead', 'later']);
  });

  it('users/{uid}: the plan\'s update now, and later only the fields the start could not decide', () => {
    const toUser = calls('setDoc').filter((c) => c.arguments[0].getText(sf) === 'userDocRef');
    expect(toUser.map((c) => c.arguments[1].getText(sf))).toEqual(['plan.userUpdate', 'rest.userFields']);
    expect(declOf('rest').getText(sf)).toMatch(/^laterWrites\(bootstrapPlan\(/);
  });

  it('profiles/{uid} and familyMembers: one function, each only when the plan says so', () => {
    const toProfile = calls('setDoc').filter((c) => /^doc\(db, 'profiles', /.test(c.arguments[0].getText(sf)));
    expect(toProfile).toHaveLength(1);
    expect(toProfile[0].arguments[1].getText(sf)).toBe('mirror');
    expect(guardOf(toProfile[0])).toBe('mirror');
    const init = calls('updateDoc').filter((c) => /familyMembers/.test(c.arguments[1]?.getText(sf) ?? ''));
    expect(init).toHaveLength(1);
    expect(guardOf(init[0])).toBe('initFamilyMembers');
    expect(calls('writeDerived').map((c) => c.getText(sf))).toEqual([
      'writeDerived(plan.mirror, plan.initFamilyMembers)',
      'writeDerived(rest.mirror, rest.initFamilyMembers)',
    ]);
  });

  it('the device zone reaches both plans only after the server\'s own validity check', () => {
    expect(declOf('zone').getText(sf)).toBe('isValidZone(detected) ? detected : null');
    expect(calls('bootstrapPlan').map((c) => c.arguments[3].getText(sf))).toEqual(['zone', 'zone']);
  });

  it('nothing else in App writes a name, a zone or familyMembers', () => {
    const literals = all(sf, (n) => ts.isObjectLiteralExpression(n)
      && n.properties.some((p) => ['name', 'timezone', 'familyMembers'].includes(p.name?.getText(sf) ?? ''))) as ts.ObjectLiteralExpression[];
    const written = literals.filter((l) => {
      let p: ts.Node | undefined = l.parent;
      while (p && !ts.isCallExpression(p)) p = p.parent;
      return !!p && ['setDoc', 'updateDoc'].includes((p as ts.CallExpression).expression.getText(sf));
    });
    expect(written.map((l) => l.getText(sf))).toEqual(['{ familyMembers: [] }']);
  });
});

describe('postponed, not dropped (review 04.10)', () => {
  it('only when the start had no answer the server confirmed, listening with metadata changes', () => {
    const later = calls('liveDoc').filter((c) => c.arguments[1]?.getText(sf) === "'App.authBootstrap.later'");
    expect(later).toHaveLength(1);
    expect(guardOf(later[0])).toBe("profileRead.kind !== 'server'");
    expect(later[0].arguments[4]?.getText(sf)).toBe('{ includeMetadataChanges: true }');
  });

  it('the later answer decides only when the server confirmed it, and only for the same account', () => {
    const later = calls('liveDoc').find((c) => c.arguments[1]?.getText(sf) === "'App.authBootstrap.later'")!;
    const body = later.arguments[2].getText(sf);
    expect(body).toMatch(/if \(later\.kind !== 'server'\) return;\s*finish\(\);\s*if \(auth\.currentUser\?\.uid !== currentUser\.uid\) return;/);
  });

  it('whatever an earlier sign-in waited for stops at the next one, and when App goes', () => {
    const handler = calls('onAuthStateChanged')[0].arguments[1].getText(sf);
    expect(handler).toMatch(/^async \(currentUser\) => \{\s*(\/\/[^\n]*\n\s*)*postponed\?\.\(\);\s*postponed = null;/);
    expect(src).toMatch(/return \(\) => \{\s*postponed\?\.\(\);\s*unsubscribe\(\);\s*\};/);
  });
});
