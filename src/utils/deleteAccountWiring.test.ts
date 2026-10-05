// src/utils/deleteAccountWiring.test.ts
//
// Deleting your own account (04.10.2026): what the screens do with what utils/accountDeletion.ts and
// utils/formerMembers.ts decide. Those are tested where they live; this holds the wiring, which needs a
// signed-in Firebase to run. Read with the TypeScript parser, so a comment cannot satisfy a check.

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
  /** The value of attribute `attr` on every <tag>. */
  const attrs = (tag: string, attr: string): string[] =>
    (all((n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === tag) as (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[])
      .map((el) => {
        const a = el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === attr) as ts.JsxAttribute | undefined;
        const init = a?.initializer;
        return init && ts.isJsxExpression(init) ? init.expression!.getText(sf) : init ? init.getText(sf) : '';
      });
  return { sf, all, calls, decl, attrs };
}

describe('Settings: the button, and what happens after the server said yes', () => {
  const s = parse('screens/Settings.tsx');

  it('the button opens the dialog, which is handed the clean-up', () => {
    expect(s.attrs('DeleteAccountDialog', 'isOpen')).toEqual(['deletingAccount']);
    expect(s.attrs('DeleteAccountDialog', 'afterDeleted')).toEqual(['leaveDeletedAccount']);
    expect(s.attrs('button', 'onClick')).toContain('() => setDeletingAccount(true)');
  });

  it('nothing of the account stays on the device, in this order, ending in a full reload', () => {
    const body = s.decl('leaveDeletedAccount').getText(s.sf);
    expect(body).toMatch(/^async \(uid: string\) =>/);
    const order = [
      'stopOfflineWalletSync()', 'forgetOfflineWallet()', 'forgetAccountOnDevice(uid)', 'tellOtherTabs()',
      'releasePushThenSignOut(', 'terminate(db)', 'clearIndexedDbPersistence(db)',
      'markAccountDeleted()', "window.location.replace('/login')",
    ];
    const at = order.map((step) => body.indexOf(step));
    expect(at.every((i) => i >= 0), order.filter((_, k) => at[k] < 0).join(', ')).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the push token: invalidated on the device; there is no account document left to remove it from', () => {
    const release = s.calls('releasePushThenSignOut', s.decl('leaveDeletedAccount'));
    expect(release).toHaveLength(1);
    const text = release[0].arguments[0].getText(s.sf);
    expect(text).toMatch(/remembered: null/);
    expect(text).toMatch(/invalidateOnDevice: invalidatePushOnDevice/);
    // A report now would write back the error rows the deletion removed.
    expect(text).toMatch(/report: \(\) => \{\}/);
    // Signing out shares the same device step.
    expect(s.decl('handleSignOut').getText(s.sf)).toMatch(/invalidateOnDevice: invalidatePushOnDevice/);
  });
});

describe('a cache another tab holds cannot hold up the reload', () => {
  it('the clear is raced against a few seconds', () => {
    const s = parse('screens/Settings.tsx');
    const body = s.decl('leaveDeletedAccount').getText(s.sf);
    expect(body).toContain('await settleWithin((async () => { await terminate(db); await clearIndexedDbPersistence(db); })(), CACHE_CLEAR_WAIT_MS);');
  });

  it('and every other tab reloads when told, from the entry module', () => {
    const m = parse('main.tsx');
    expect(m.calls('onDeletedInAnotherTab').map((c) => c.getText(m.sf))).toEqual([
      "onDeletedInAnotherTab(window, () => window.location.replace('/login'))",
    ]);
  });
});

describe('the dialog hands the order to deleteOwnAccount', () => {
  const d = parse('components/DeleteAccountDialog.tsx');

  it('with the real steps behind each name', () => {
    const call = d.calls('deleteOwnAccount');
    expect(call).toHaveLength(1);
    const arg = call[0].arguments[0] as ts.ObjectLiteralExpression;
    const prop = (name: string) => {
      const p = arg.properties.find((x) => x.name?.getText(d.sf) === name);
      expect(p, name).toBeTruthy();
      return p!.getText(d.sf);
    };
    expect(prop('reauthenticate')).toMatch(/reauthenticateWithCredential\(user, EmailAuthProvider\.credential\(/);
    expect(prop('reauthenticate')).toMatch(/reauthenticateWithPopup\(user, new GoogleAuthProvider\(\)\)/);
    expect(prop('drainWrites')).toBe('drainWrites: () => waitForPendingWrites(db)');
    expect(prop('callDelete')).toBe('callDelete: () => deleteMyAccount()');
    expect(prop('accountState')).toBe('accountState: () => accountStateFrom(() => user.reload())');
    // The uid read BEFORE: once the account is gone, Auth may sign the session out on its own.
    expect(prop('afterDeleted')).toBe('afterDeleted: () => afterDeleted(uid)');
    expect(d.decl('uid').getText(d.sf)).toBe('user.uid');
    expect(prop('method')).toBe('method');
    expect(prop('onLine')).toBe('onLine: navigator.onLine');
  });

  it('while it runs, closing is refused, and Back is told so', () => {
    expect(d.decl('close').getText(d.sf)).toMatch(/^\(\): boolean \| void => \{\s*if \(busy\) return false;/);
    const h = parse('hooks/useOverlayHistory.ts');
    expect(h.sf.getText()).toMatch(/pushed = false;[^\n]*\n\s*if \(onBackRef\.current\(\) === false\) push\(\);/);
  });

  it('the submit is not enabled until the word matches, and the password is there when one is needed', () => {
    expect(d.decl('ready').getText(d.sf)).toMatch(/confirmationMatches\(typed, word\) && \(method !== 'password' \|\| password\.length > 0\) && !busy/);
    expect(d.attrs('button', 'disabled')).toContain('!ready');
  });
});

describe('the chat keeps a deleted account’s name', () => {
  it('Chat: the list, the rows and the conversation all read the map with the names added', () => {
    const c = parse('screens/Chat.tsx');
    expect(c.decl('shown').getText(c.sf)).toMatch(/^useMemo\(\(\) => withFormerMembers\(\s*people, \[\.\.\.groups, \.\.\.chats\],\s*\(name\) => deletedName\(name, t\('deletedAccountName', language\), t\('deletedAccount', language\)\),/);
    expect(c.calls('buildConversations')[0].arguments[0].getText(c.sf)).toMatch(/people: shown/);
    expect(c.attrs('ConversationRow', 'people')).toEqual(['shown']);
    expect(c.attrs('GroupChatWidget', 'userMap')).toEqual(['shown as Record<string, any>']);
    expect(c.attrs('GroupChatWidget', 'closedNote')).toEqual(["active.otherGone ? t('chatWithDeletedAccount', language) : undefined"]);
  });

  it('Chat: a deleted account has no profile to read', () => {
    const c = parse('screens/Chat.tsx');
    expect(c.decl('peopleKey').getText(c.sf)).toMatch(/const gone = formerMembersOf\(c\);[\s\S]*if \(!\(m in gone\)\) ids\.add\(m\)/);
  });

  it('CalendarHome: the names go to the group chat ONLY, never to the list of people an event can be assigned to', () => {
    const h = parse('screens/CalendarHome.tsx');
    expect(h.decl('chatUserMap').getText(h.sf)).toMatch(/withFormerMembers\(userMap, activeGroupDoc \? \[activeGroupDoc\] : \[\],\s*\(name\) => deletedName\(name, t\('deletedAccountName', language\), t\('deletedAccount', language\)\)\)/);
    expect(h.attrs('GroupChatWidget', 'userMap')).toEqual(['chatUserMap']);
    for (const tag of ['AddEventModal', 'EventDetailsModal', 'GroupSettingsModal', 'GamesHubModal', 'CalendarGrid']) {
      expect(h.attrs(tag, 'userMap').every((v) => v === 'userMap'), tag).toBe(true);
    }
  });

  it('a closed conversation offers no reply or edit on its messages', () => {
    const w = parse('components/GroupChatWidget.tsx');
    const guarded = (w.all((n) => ts.isBinaryExpression(n) && n.left.getText(w.sf) === '!closedNote') as ts.BinaryExpression[])
      .map((b) => b.right.getText(w.sf));
    expect(guarded.some((t) => /onClick=\{\(\) => startEditing\(msg\)\}/.test(t))).toBe(true);
    expect(guarded.some((t) => /setReplyingTo\(msg\)/.test(t))).toBe(true);
  });

  it('the widget shows the note INSTEAD of the message box, and no reply or edit banner over it', () => {
    const w = parse('components/GroupChatWidget.tsx');
    const closed = w.all((n) => ts.isConditionalExpression(n) && n.condition.getText(w.sf) === 'closedNote') as ts.ConditionalExpression[];
    expect(closed).toHaveLength(1);
    expect(closed[0].whenFalse.getText(w.sf)).toMatch(/^isRecording \?/);
    expect(closed[0].whenFalse.getText(w.sf)).toMatch(/<form onSubmit=\{handleSend\}/);
    const banners = w.all((n) => ts.isBinaryExpression(n) && /^(replyingTo|editingMsg) && !closedNote$/.test(n.left.getText(w.sf)));
    expect(banners).toHaveLength(2);
  });
});

describe('the admin\u2019s door', () => {
  it('waits as long as the deletion may run, like the person\u2019s own', () => {
    const a = parse('serverActions.ts');
    const call = a.calls('httpsCallable').map((c) => c.getText(a.sf));
    expect(call).toContain('httpsCallable(getFunctions(app), "adminModerateUser", { timeout: 560_000 })');
    expect(call).toContain('httpsCallable(getFunctions(app), "deleteMyAccount", { timeout: 560_000 })');
  });
});

describe('after the deletion', () => {
  it('the sign-in screen says it once', () => {
    const l = parse('screens/Login.tsx');
    expect(l.decl('[accountDeleted]' as string).getText(l.sf)).toBe('useState(() => takeAccountDeletedNotice())');
    expect(l.sf.getText()).toMatch(/\{accountDeleted && !error && \([\s\S]*?t\('accountDeletedNotice', language\)/);
  });
});
