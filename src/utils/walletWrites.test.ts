// src/utils/walletWrites.test.ts
//
// How the Wallet issues its writes (03.10.2026), held on the SOURCE because the screen needs a DOM,
// a signed-in Firebase and a network switch, and this suite has none of them. The behaviour of the
// pieces is tested where they live (pendingWrite.test.ts, walletLedger.test.ts, uploadFile.test.ts);
// the real SDK offline was measured on a bench (DEVLOG 03.10). What is left — and what each check
// below stands for — is wiring that would silently undo one of those:
//
//   * an `await` on a Firestore write: the spinner that cannot end without a connection;
//   * a wait for the server without a bound, or one that trusts navigator.onLine === true;
//   * a write issued before it is written down: a refusal after a reload would go unreported;
//   * the hand-over started before the edit is confirmed: it copies the card the SERVER holds;
//   * changes judged on a cached answer, or one still carrying a local write.
//
// Read with the TypeScript parser, not regexes over the text, so a comment cannot satisfy a check.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const FILE = resolve(process.cwd(), 'src', 'screens', 'Wallet.tsx');
const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const WRITES = new Set(['setDoc', 'updateDoc', 'deleteDoc', 'addDoc']);

function all(root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => { if (pred(n)) out.push(n); ts.forEachChild(n, visit); };
  visit(root);
  return out;
}
const calleeName = (n: ts.Node): string | null =>
  ts.isCallExpression(n) ? n.expression.getText(sf) : null;
const callsTo = (root: ts.Node, name: string) => all(root, (n) => calleeName(n) === name) as ts.CallExpression[];

/** The function assigned to `const <name> = …` (or declared `function <name>`). */
function fn(name: string): ts.Node {
  const found = all(sf, (n) =>
    (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && !!n.initializer)
    || (ts.isFunctionDeclaration(n) && n.name?.getText(sf) === name));
  expect(found, name).toHaveLength(1);
  const d = found[0];
  return ts.isVariableDeclaration(d) ? d.initializer! : d;
}
const pos = (n: ts.Node) => n.getStart(sf);

/**
 * `updateLedger(uid, (l) => record(l, …))` calls inside `root` — the record has to REACH the ledger.
 * Counting bare `record(` calls was satisfied by one wrapped in a function nobody called (mutation W3).
 */
const recordsIntoLedger = (root: ts.Node) => callsTo(root, 'updateLedger').filter((c) => {
  const f = c.arguments[1];
  return c.arguments[0]?.getText(sf) === 'uid' && !!f && ts.isArrowFunction(f)
    && ts.isCallExpression(f.body) && calleeName(f.body) === 'record';
});

describe('the scan is looking at the real screen', () => {
  it('finds the Wallet\'s writes (an empty scan must not pass)', () => {
    const writes = all(sf, (n) => WRITES.has(calleeName(n) ?? ''));
    expect(writes.length).toBeGreaterThanOrEqual(6);
  });
});

describe('no write is awaited', () => {
  it('no `await` on a Firestore write anywhere in the Wallet, and no addDoc (it hands the id over only on the server\'s answer)', () => {
    const awaited = all(sf, (n) => ts.isAwaitExpression(n) && WRITES.has(calleeName(n.expression) ?? ''));
    expect(awaited.map((n) => n.getText(sf))).toEqual([]);
    expect(all(sf, (n) => calleeName(n) === 'addDoc')).toEqual([]);
  });

  it('every wait for an answer is bounded by waitBound(navigator.onLine, …)', () => {
    const waits = callsTo(sf, 'settleWithin');
    expect(waits.length).toBeGreaterThanOrEqual(2); // the card save and the category change
    for (const w of waits) expect(w.arguments[1]?.getText(sf), w.getText(sf)).toMatch(/^waitBound\(navigator\.onLine, /);
  });
});

describe('saving a card', () => {
  const save = fn('saveCard');

  it('writes the change down BEFORE issuing it', () => {
    const recorded = recordsIntoLedger(save).map(pos);
    const issued = [...callsTo(save, 'setDoc'), ...callsTo(save, 'updateDoc')].map(pos);
    expect(recorded).toHaveLength(1);
    expect(issued.length).toBe(2);
    for (const p of issued) expect(recorded[0]).toBeLessThan(p);
  });

  it("the card carries the change's own id, made before the data it goes into (review 03.10)", () => {
    const text = save.getText(sf);
    expect(text).toMatch(/const opId = newOpId\(\);\s*const assetData = \{[\s\S]*?lastWriteId: opId,/);
    // The ledger entry and the write use that same id.
    expect(text).toMatch(/record\(l, \{\s*opId, kind:/);
  });

  it('a new card gets its id up front (doc(collection(…))), and imageUrl is never undefined', () => {
    expect(save.getText(sf)).toMatch(/doc\(collection\(db, 'assets'\)\)/);
    expect(save.getText(sf)).toMatch(/imageUrl: url \?\? null/);
  });

  it('the hand-over starts only after the edit\'s answer was waited for, and never on no answer', () => {
    const hand = callsTo(save, 'transferAssetCopy');
    const wait = callsTo(save, 'settleWithin');
    expect(hand).toHaveLength(1);
    expect(wait).toHaveLength(1);
    expect(pos(wait[0])).toBeLessThan(pos(hand[0]));
    // Inside the transfer branch, a no-answer return comes before the call.
    const branch = all(save, (n) => ts.isIfStatement(n) && n.expression.getText(sf) === 'transferTo && editing')[0] as ts.IfStatement;
    expect(branch, 'the transfer branch').toBeTruthy();
    const noAnswer = all(branch.thenStatement, (n) => ts.isIfStatement(n) && /answer\.kind === 'noAnswer'/.test(n.expression.getText(sf)));
    expect(noAnswer).toHaveLength(1);
    expect(all(noAnswer[0], (n) => ts.isReturnStatement(n)).length).toBeGreaterThan(0);
    expect(pos(noAnswer[0])).toBeLessThan(pos(hand[0]));
    // And a refusal in time returns before the transfer branch.
    const refused = all(save, (n) => ts.isIfStatement(n) && n.expression.getText(sf) === "answer.kind === 'refused'");
    expect(refused).toHaveLength(1);
    expect(pos(refused[0])).toBeLessThan(pos(branch));
  });

  it('a photo upload can be stopped, and a stop writes nothing', () => {
    const up = callsTo(save, 'uploadFile');
    expect(up).toHaveLength(1);
    expect(up[0].getText(sf)).toMatch(/signal: abort\.signal/);
    expect(save.getText(sf)).toMatch(/if \(err instanceof UploadAborted\) return;/);
  });
});

describe('leaving, closing, handing over (review 03.10)', () => {
  it('when the screen goes, the form session moves on, so a late refusal lands in the ledger, not in an alert', () => {
    const effects = callsTo(sf, 'useEffect').filter((c) => /isMounted\.current = true;/.test(c.getText(sf)));
    expect(effects).toHaveLength(1);
    expect(effects[0].getText(sf)).toMatch(/return \(\) => \{ isMounted\.current = false; session\.current\+\+; \};/);
  });

  it('Cancel, Escape and Back close the form in every phase — Back is never a dead press', () => {
    const body = fn('requestCloseForm').getText(sf);
    expect(body).not.toMatch(/return;/);
    expect(body).toMatch(/closeForm\(\);/);
  });

  it('a card being handed over cannot start a second hand-over: the save returns, and Save is held', () => {
    expect(fn('saveCard').getText(sf)).toMatch(/if \(transferTo && editing && handOverCardId === editing\.id\) return;/);
    const submit = all(sf, (n) => ts.isJsxAttribute(n) && n.name.getText(sf) === 'disabled'
      && /handOverCardId === editingAsset\.id/.test(n.getText(sf)));
    expect(submit.length).toBeGreaterThanOrEqual(1);
  });

  it('a hand-over outcome after leaving is an alert only for the account that started it', () => {
    const body = fn('tellNote').getText(sf);
    expect(body).toMatch(/if \(mounted\.current\) \{ setWalletNote\(note\); return; \}/);
    expect(body).toMatch(/if \(auth\.currentUser\?\.uid === uid\) alert\(/);
    // Every hand-over outcome goes through it.
    expect(all(fn('saveCard'), (n) => calleeName(n) === 'setWalletNote')).toEqual([]);
    expect(callsTo(fn('saveCard'), 'tellNote').length).toBeGreaterThanOrEqual(3);
  });

  it('"Not sent yet" is MOUNTED late (useDelayedFlag), not only shown late', () => {
    expect(src).toMatch(/const unsentShown = useDelayedFlag\(pendingIds\.length > 0 \|\| ledger\.entries\.length > 0, 1200\);/);
    expect(src).toMatch(/\{unsentShown && pendingIds\.includes\(asset\.id\) && \(/);
    expect(src).toMatch(/\{unsentShown && \(\s*<p role="status"/);
  });
});

describe('deleting a card', () => {
  it('written down before it is issued, and never awaited', () => {
    const del = fn('handleDelete');
    const r = recordsIntoLedger(del).map(pos);
    const d = callsTo(del, 'deleteDoc').map(pos);
    expect(r).toHaveLength(1);
    expect(d).toHaveLength(1);
    expect(r[0]).toBeLessThan(d[0]);
  });
});

describe('the verdict', () => {
  it('the owned listener carries metadata and per-card pending ids, and judges only a server answer with nothing pending', () => {
    const owned = callsTo(sf, 'liveQuery').find((c) => c.arguments[1]?.getText(sf) === "'Wallet.assets'");
    expect(owned, 'the owned listener').toBeTruthy();
    expect(owned!.arguments[4]?.getText(sf)).toBe('{ includeMetadataChanges: true, pendingIds: true }');
    // The listener keeps the server's answer only when it is drained, and asks for a verdict.
    expect(owned!.arguments[2].getText(sf)).toMatch(/drained = !meta\.fromCache && !meta\.hasPendingWrites \? docs : null;\s*judge\(\);/);
    // The verdict uses nothing else, and nothing at all without it.
    const judge = fn('judge');
    const body = judge.getText(sf);
    expect(body).toMatch(/const docs = drained;\s*if \(!docs\) return;/);
    const rec = callsTo(judge, 'reconcile');
    const cats = callsTo(judge, 'judgeCategoryOps');
    expect(rec).toHaveLength(1);
    expect(cats).toHaveLength(1);
    expect(rec[0].arguments[1].getText(sf)).toBe('docs');
    expect(cats[0].arguments[1].getText(sf)).toBe('docs');
    expect(body.indexOf('if (!docs) return;')).toBeLessThan(body.indexOf('reconcile('));
    expect(callsTo(sf, 'reconcile')).toHaveLength(1); // nowhere else in the screen
  });

  it('an entry too young for the last answer is looked at again when it comes due (review 03.10)', () => {
    const body = fn('judge').getText(sf);
    expect(body).toMatch(/const next = nextDueAt\(after\);\s*if \(next !== null\) lookAgain = setTimeout\(judge, /);
  });
});

describe('categories', () => {
  it('adding to the list is a union carrying the defaults when none is stored — never a whole array that erases another device\'s additions', () => {
    for (const name of ['handleCreateCategory', 'handleUpdateCategory']) {
      const text = fn(name).getText(sf);
      expect(text, name).toMatch(/arrayUnion\(\.\.\.unionFor\(listIsStored, \[/);
    }
  });

  it('every write to the user document is a merge — an update of one that does not exist yet is refused (found on the bench, 03.10)', () => {
    // `userRef` is `doc(db, 'users', uid)` in finishCategoryChange.
    expect(fn('finishCategoryChange').getText(sf)).toMatch(/const userRef = doc\(db, 'users', uid\);/);
    const toUser = all(sf, (n) => WRITES.has(calleeName(n) ?? '')
      && /^(doc\(db, 'users', |userRef$)/.test((n as ts.CallExpression).arguments[0]?.getText(sf) ?? '')) as ts.CallExpression[];
    expect(toUser.length).toBeGreaterThanOrEqual(4); // create, rename (first step), finish, dropping a refused new name
    for (const c of toUser) {
      expect(calleeName(c), c.getText(sf)).toBe('setDoc');
      expect(c.arguments[2]?.getText(sf), c.getText(sf)).toBe('{ merge: true }');
    }
  });

  it('a rename lists the new name BEFORE any card carries it', () => {
    const upd = fn('handleUpdateCategory');
    const union = all(upd, (n) => calleeName(n) === 'arrayUnion').map(pos);
    const change = callsTo(upd, 'changeCategory').map(pos);
    expect(union).toHaveLength(1);
    expect(change).toHaveLength(1);
    expect(union[0]).toBeLessThan(change[0]);
  });

  it('the list is changed only after every card was accepted, and only while no card of mine still carries the name', () => {
    // The decision itself is pure and tested (walletLedger.test.ts, categoryOutcome); here: the list
    // write comes after both early returns, and nothing else writes the list.
    const finish = fn('finishCategoryChange');
    const text = finish.getText(sf);
    const partial = text.indexOf("if (o.result === 'partial') {");
    const kept = text.indexOf("if (o.result === 'kept') return;");
    const write = text.indexOf('void setDoc(userRef, write');
    expect(partial).toBeGreaterThan(-1);
    expect(kept).toBeGreaterThan(partial);
    expect(write).toBeGreaterThan(kept);
    expect(text.slice(partial, kept)).toMatch(/return;\s*\}\s*$/);
  });

  it('a category change is written down before its cards are touched, and decided in-page only from answers in time, while mounted (review 03.10)', () => {
    const change = fn('changeCategory');
    const recorded = callsTo(change, 'recordCategoryOp').map(pos);
    const issued = callsTo(change, 'updateDoc').map(pos);
    expect(recorded).toHaveLength(1);
    expect(issued).toHaveLength(1);
    expect(recorded[0]).toBeLessThan(issued[0]);
    expect(change.getText(sf)).toMatch(/if \(answer\.kind === 'acked' && mounted\.current\) \{/);
  });
});

describe('no shared busy flag', () => {
  it('the one `loading` that tied the form, the categories and the photo scan together is gone', () => {
    expect(all(sf, (n) => ts.isIdentifier(n) && (n.text === 'setLoading' || n.text === 'loading'))).toEqual([]);
  });
});
