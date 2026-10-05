// src/utils/eventMoveWiring.test.ts
//
// Where the move rules (utils/eventMove.ts; Andrei, 05.10.2026) are wired, which needs a signed-in
// Firebase to run: AddEventModal and LeaveGroupModal. Read with the TypeScript parser, so a comment
// cannot satisfy a check.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

function parse(rel: string) {
  const file = resolve(process.cwd(), 'src', rel);
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const all = (pred: (n: ts.Node) => boolean, root: ts.Node = sf): ts.Node[] => {
    const out: ts.Node[] = [];
    const visit = (n: ts.Node): void => { if (pred(n)) out.push(n); ts.forEachChild(n, visit); };
    visit(root);
    return out;
  };
  const calls = (name: string, root: ts.Node = sf) =>
    all((n) => ts.isCallExpression(n) && n.expression.getText(sf) === name, root) as ts.CallExpression[];
  const decl = (name: string): ts.Expression => {
    const d = all((n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === name) as ts.VariableDeclaration[];
    expect(d, name).toHaveLength(1);
    return d[0].initializer!;
  };
  return { sf, all, calls, decl };
}

const enclosingFunction = (n: ts.Node): ts.Node => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p)) return p;
  }
  throw new Error('no function');
};

describe('AddEventModal: a move waits for Save, and Save writes what the rules accept', () => {
  const m = parse('components/AddEventModal.tsx');

  it('autosave leaves before saving anything while the calendar differs from the event’s', () => {
    const saving = m.calls('setAutoSaveStatus').filter((c) => c.arguments[0]?.getText(m.sf) === "'saving'");
    expect(saving).toHaveLength(1);
    const body = enclosingFunction(saving[0]);
    const at = saving[0].getStart(m.sf);
    const guards = (m.all((n) => ts.isIfStatement(n), body) as ts.IfStatement[])
      .filter((s) => s.getStart(m.sf) < at && /\breturn\b/.test(s.thenStatement.getText(m.sf)))
      .map((s) => s.expression.getText(m.sf));
    expect(guards).toContain("moveOf(editEvent.groupId, selectedGroupId !== 'personal' ? selectedGroupId : null) !== 'none'");
  });

  it('both saves that can move an event write the move’s answers, then invite whom it says', () => {
    const submit = m.decl('handleSubmit');
    const writes = m.calls('updateDoc', submit);
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      const obj = w.arguments[1];
      expect(ts.isObjectLiteralExpression(obj), w.getText(m.sf)).toBe(true);
      const spreads = (obj as ts.ObjectLiteralExpression).properties.filter(ts.isSpreadAssignment).map((s) => s.expression.getText(m.sf));
      expect(spreads, w.getText(m.sf)).toContain('move.fields');
    }
    expect(m.calls('inviteAlong', submit).map((c) => c.arguments[0].getText(m.sf))).toEqual(['move.invitees', 'move.invitees']);
  });

  it('a pending move clears the autosave status, so Done is never left disabled by a cancelled run', () => {
    const guard = (m.all((n) => ts.isIfStatement(n)
      && n.expression.getText(m.sf).startsWith('moveOf(editEvent.groupId')) as ts.IfStatement[]);
    expect(guard).toHaveLength(1);
    const then = guard[0].thenStatement.getText(m.sf);
    expect(then).toMatch(/setAutoSaveStatus\(null\);\s*return;/);
  });

  it('the move is planned on the event as it is now: the normal edit reads it first', () => {
    const plans = m.calls('planMove', m.decl('handleSubmit')).map((c) => c.arguments[0].getText(m.sf));
    expect(plans).toEqual(['parentSnap.data() || {}', '(await getDoc(ref)).data() || {}']);
  });

  it('the tick to invite is off again on another calendar', () => {
    const onChange = m.all((n) => ts.isJsxAttribute(n) && n.name.getText(m.sf) === 'onChange'
      && /setSelectedGroupId\(next\)/.test(n.getText(m.sf))) as ts.JsxAttribute[];
    expect(onChange).toHaveLength(1);
    expect(m.calls('setInviteOnMove', onChange[0]).map((c) => c.arguments[0].getText(m.sf))).toEqual(['false']);
  });

  it('invitations go by uid alone, and only to the people the move found', () => {
    const along = m.decl('inviteAlong');
    expect(m.calls('uidInvite', along)).toHaveLength(1);
    const invitees = m.decl('planMove').getText(m.sf);
    expect(invitees).toMatch(/move === 'across' && inviteOnMove\s*\?\s*inviteCandidates\(cur, membersOf\(cur\.groupId\), membersOf\(targetGroupId\), me\)\.filter\(\(u\) => moveInvitees\.includes\(u\)\)/);
  });
});

describe('LeaveGroupModal: the copy you keep holds your answer only', () => {
  it('its rsvps are onlyMyAnswer of the event’s', () => {
    const l = parse('components/LeaveGroupModal.tsx');
    const copies = l.calls('addDoc').filter((c) => ts.isObjectLiteralExpression(c.arguments[1]));
    expect(copies).toHaveLength(1);
    const rsvps = (copies[0].arguments[1] as ts.ObjectLiteralExpression).properties
      .find((p) => ts.isPropertyAssignment(p) && p.name.getText(l.sf) === 'rsvps') as ts.PropertyAssignment | undefined;
    expect(rsvps?.initializer.getText(l.sf)).toBe('onlyMyAnswer(eventData.rsvps, auth.currentUser.uid)');
  });
});

describe('CalendarHome: invitations by uid alone are shown with the others', () => {
  it('the list on screen is both listeners’ invitations, once each', () => {
    const h = parse('screens/CalendarHome.tsx');
    const list = h.decl('pendingFamilyInvites').getText(h.sf);
    expect(list).toMatch(/\[\.\.\.invitesByEmail, \.\.\.invitesByUid\]/);
    expect(list).toMatch(/!seen\.has\(i\.id\)/);
  });
});
