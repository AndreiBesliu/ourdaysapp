// src/utils/aiChecklistOutcome.test.ts
//
// The rule this holds: an event that asked the AI for a checklist and did not get one must end up
// SAYING why, in the reader's language, with a retry when retrying could work.
//
// ── Why the test lives here and not in `functions/` ───────────────────────────────────────
//
// Half of the property is on the server (which reason is recorded) and half is on the client
// (whether that reason has a sentence in six languages). Split across two suites, the seam is
// exactly where a new reason would be added on one side and never translated on the other — and
// the person who saw the gap would be somebody's family, reading `ai-checklist/bad-output`.
//
// `functions/src/aiChecklistOutcome.ts` imports nothing but `./aiProviderError`, which imports
// nothing at all, so this file can reach both sides without pulling `firebase-admin` into a suite
// that CI runs with only the root package installed. `functionsPurity.test.ts` keeps it that way.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import {
  checklistFailure,
  checklistReason,
  refundsQuota,
  worthRetrying,
  CHECKLIST_REASONS,
  CHECKLIST_QUOTA,
  CHECKLIST_UNCONFIGURED,
  CHECKLIST_BAD_OUTPUT,
  CHECKLIST_BUSY,
  CHECKLIST_ERROR,
  CHECKLIST_RUNNING,
  claimedByAnotherDelivery,
  claimStep,
  mayEndChecklist,
  maySucceedChecklist,
  isOwnClaim,
  checklistHoldMs,
} from '../../functions/src/aiChecklistOutcome';
import { checklistReasonKey, checklistWorthRetrying } from './aiErrorKey';
import {
  checklistNoteView, pendingSince, watchedFor, CHECKLIST_DEAD_RUN_MS, CHECKLIST_WATCH_MS, CHECKLIST_SKEW_CEILING_MS,
  DEAD_RUN_REASON, type ChecklistNoteInput,
} from './aiChecklistNote';
import { translations } from './i18nAll';

describe('which reason gets recorded', () => {
  it('prefers the reason we stated over anything inferred', () => {
    // A stated stop beats a guess. `checklistFailure(CHECKLIST_QUOTA)` carries an Error whose
    // message is the code itself, so a predicate reading `.message` could also match it — the
    // label has to win, or the order of the checks below would start deciding meaning.
    for (const reason of CHECKLIST_REASONS) {
      expect(checklistReason(checklistFailure(reason))).toBe(reason);
    }
  });

  it('names WHICH budget refused, not just that one did', () => {
    // "You have spent your daily budget" and "the AI is switched off" are different facts, and a
    // person can act on only one of them. `isOwnBudgetRefusal` answers yes/no; this needs more.
    const refusal = (code: string) => Object.assign(new Error(code), { code: 'resource-exhausted' });
    expect(checklistReason(refusal('ai-budget/kill-switch'))).toBe('ai-budget/kill-switch');
    expect(checklistReason(refusal('ai-budget/user-budget'))).toBe('ai-budget/user-budget');
    expect(checklistReason(refusal('ai-budget/global-budget'))).toBe('ai-budget/global-budget');
  });

  it('falls back rather than storing an ai-budget code nobody has translated', () => {
    // A fourth refusal added on the server would otherwise travel to the screen as raw ASCII.
    // A less precise sentence is a smaller loss than an untranslated one.
    const unknown = Object.assign(new Error('ai-budget/something-new'), { code: 'resource-exhausted' });
    expect(checklistReason(unknown)).toBe(CHECKLIST_ERROR);
  });

  it('tells the provider rationing us apart from something being broken', () => {
    expect(checklistReason({ status: 429, message: 'Too Many Requests' })).toBe(CHECKLIST_BUSY);
    expect(checklistReason({ status: 529, type: 'overloaded_error', message: 'Overloaded' })).toBe(CHECKLIST_BUSY);
    // Out of CREDIT is not busy: it is the app's limit, told with the callables' own code.
    expect(checklistReason(new Error('Your credit balance is too low to access the Anthropic API.'))).toBe('ai-budget/global-budget');
    expect(checklistReason({ status: 402, type: 'billing_error', message: 'billing' })).toBe('ai-budget/global-budget');
    // Deliberately narrow: a 503, a 400 or a 401 is somebody's problem to look at.
    expect(checklistReason({ status: 503, message: 'Service unavailable' })).toBe(CHECKLIST_ERROR);
    expect(checklistReason({ status: 401, type: 'authentication_error', message: 'Authentication failed' })).toBe(CHECKLIST_ERROR);
  });

  it('never throws on the shapes an unknown failure actually arrives in', () => {
    for (const odd of [null, undefined, '', 'boom', 0, {}, new Error('')]) {
      expect(CHECKLIST_REASONS).toContain(checklistReason(odd));
    }
  });
});

describe('what a reason implies', () => {
  it('refunds the quota unit whenever the call never reached the model', () => {
    // The trigger consumes a unit at the door, before anything else. A call our own budget refused
    // never reached the model and must not cost one of the owner's fifty.
    expect(refundsQuota('ai-budget/kill-switch')).toBe(true);
    expect(refundsQuota('ai-budget/user-budget')).toBe(true);
    expect(refundsQuota('ai-budget/global-budget')).toBe(true);

    // And the one that was missed, because it is not an `ai-budget/` code: there is no API key on
    // the service, and that check is the FIRST statement of the generation — strictly after the
    // unit was taken. Without this, every event created while the key is missing spends one of the
    // owner's fifty on a call that provably never happened, and a misconfiguration nobody can see
    // from the app eats the whole day's allowance for free.
    expect(refundsQuota(CHECKLIST_UNCONFIGURED)).toBe(true);
  });

  it('does NOT refund when the call really happened, or when nothing was taken', () => {
    // `tryConsumeQuota` returning false means nothing was consumed. Refunding there would hand
    // back an allowance nobody spent — one free call per event created, for as long as it lasted.
    expect(refundsQuota(CHECKLIST_QUOTA)).toBe(false);
    // These reached the model: it answered badly, or something broke. The allowance is spent.
    expect(refundsQuota(CHECKLIST_BAD_OUTPUT)).toBe(false);
    expect(refundsQuota(CHECKLIST_ERROR)).toBe(false);
  });

  it('refunds a busy provider — nothing was generated (26.09.2026, Claude)', () => {
    // Claude's 429 / 529 is a minute's capacity, not a spent daily allowance. The callables give
    // the unit back for it; the trigger does the same, or the card and Retry would charge differently.
    expect(refundsQuota(CHECKLIST_BUSY)).toBe(true);
  });

  it('offers a retry for everything except a server with no key', () => {
    // A button that cannot work, and that spends one of the fifty finding out, is worse than the
    // plain sentence saying the assistant is not set up.
    expect(worthRetrying(CHECKLIST_UNCONFIGURED)).toBe(false);
    for (const reason of CHECKLIST_REASONS.filter((r) => r !== CHECKLIST_UNCONFIGURED)) {
      expect(worthRetrying(reason), reason).toBe(true);
    }
  });

  it('agrees with the client copy of that decision', () => {
    // Two functions, one rule: the server uses `worthRetrying` to reason about it and the screen
    // uses `checklistWorthRetrying` to draw the button. They may not drift.
    for (const reason of CHECKLIST_REASONS) {
      expect(checklistWorthRetrying(reason), reason).toBe(worthRetrying(reason));
    }
  });
});

describe('one delivery does the work (31.10.2026)', () => {
  // Eventarc delivers "at least once". Every delivery carries the event as it was created, so the
  // claim is judged on the event as it is NOW: `live` is that, `created` the creation snapshot's note.
  const HOLD = 150_000;
  const NOW = Date.parse('2026-11-01T08:00:00.000Z');
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const running = (msAgo: number) => ({ status: CHECKLIST_RUNNING, at: at(msAgo) });

  it('a fresh running note written after creation is a claim by another delivery', () => {
    expect(claimedByAnotherDelivery(running(0), undefined, NOW, HOLD)).toBe(true);
    expect(claimedByAnotherDelivery(running(HOLD - 1), undefined, NOW, HOLD)).toBe(true);
  });

  it('a claim as old as the hold belongs to a delivery past its timeout: the work is free', () => {
    expect(claimedByAnotherDelivery(running(HOLD), undefined, NOW, HOLD)).toBe(false);
    expect(claimedByAnotherDelivery(running(HOLD * 10), undefined, NOW, HOLD)).toBe(false);
  });

  it('no note, a failed note, or a note with no readable time is no claim', () => {
    expect(claimedByAnotherDelivery(undefined, undefined, NOW, HOLD)).toBe(false);
    expect(claimedByAnotherDelivery(null, undefined, NOW, HOLD)).toBe(false);
    expect(claimedByAnotherDelivery({ status: 'failed', reason: CHECKLIST_ERROR, at: at(0) }, undefined, NOW, HOLD)).toBe(false);
    expect(claimedByAnotherDelivery({ status: CHECKLIST_RUNNING }, undefined, NOW, HOLD)).toBe(false);
    expect(claimedByAnotherDelivery({ status: CHECKLIST_RUNNING, at: 'soon' }, undefined, NOW, HOLD)).toBe(false);
    expect(claimedByAnotherDelivery({ status: CHECKLIST_RUNNING, at: NOW }, undefined, NOW, HOLD)).toBe(false);
  });

  it('the note the event was CREATED with is not a claim, however fresh', () => {
    // A personal event's create is open: a copy made on leaving a group, or a planted note, would
    // otherwise hold the work off forever, with the skeleton spinning.
    const planted = running(0);
    expect(claimedByAnotherDelivery({ ...planted }, planted, NOW, HOLD)).toBe(false);
    const future = { status: CHECKLIST_RUNNING, at: new Date(NOW + 3_600_000).toISOString() };
    expect(claimedByAnotherDelivery({ ...future }, future, NOW, HOLD)).toBe(false);
  });

  it('a delivery that claimed over a created note is still a claim', () => {
    expect(claimedByAnotherDelivery(running(1_000), running(60_000), NOW, HOLD)).toBe(true);
    expect(claimedByAnotherDelivery(running(1_000), { status: 'failed', at: at(1_000) }, NOW, HOLD)).toBe(true);
  });

  it('the hold is the trigger timeout plus the margin, and outlives the timeout', () => {
    expect(checklistHoldMs(120)).toBe(HOLD);
    expect(checklistHoldMs(120)).toBeGreaterThan(120_000);
  });
});

describe('each delivery knows its own claim (01.11.2026)', () => {
  const HOLD = checklistHoldMs(120);
  const NOW = Date.parse('2026-11-01T08:00:00.000Z');
  const ME = 'token-me';
  const claimBy = (by: string, msAgo = 1_000) => ({ status: CHECKLIST_RUNNING, at: new Date(NOW - msAgo).toISOString(), by });
  const open = (note?: unknown) => ({ assigneeIds: ['u1', 'ai_assistant'], ...(note ? { aiChecklist: note } : {}) });
  const done = (note?: unknown) => ({ assigneeIds: ['u1'], ...(note ? { aiChecklist: note } : {}) });

  it('own claim only with the same token and a running status', () => {
    expect(isOwnClaim(claimBy(ME), ME)).toBe(true);
    expect(isOwnClaim(claimBy('other'), ME)).toBe(false);
    expect(isOwnClaim({ ...claimBy(ME), status: 'failed' }, ME)).toBe(false);
    expect(isOwnClaim(undefined, ME)).toBe(false);
  });

  it('at the door: take open work, keep our own claim, skip the rest', () => {
    expect(claimStep(open(), undefined, ME, NOW, HOLD)).toBe('take');
    // A retried attempt reads the claim its earlier attempt committed: still ours, however fresh.
    expect(claimStep(open(claimBy(ME)), undefined, ME, NOW, HOLD)).toBe('ours');
    expect(claimStep(open(claimBy('other')), undefined, ME, NOW, HOLD)).toBe('skip');
    expect(claimStep(open(claimBy('other', HOLD)), undefined, ME, NOW, HOLD)).toBe('take');
    expect(claimStep(done(), undefined, ME, NOW, HOLD)).toBe('skip');
    expect(claimStep(done(claimBy(ME)), undefined, ME, NOW, HOLD)).toBe('skip');
    expect(claimStep(undefined, undefined, ME, NOW, HOLD)).toBe('skip');
  });

  it('an ending is ours to write: our claim, or open work nobody else holds', () => {
    expect(mayEndChecklist(open(claimBy(ME)), undefined, ME, NOW, HOLD)).toBe(true);
    // Our claim taken off by a move into a group, or never written because the claim threw.
    expect(mayEndChecklist(open(), undefined, ME, NOW, HOLD)).toBe(true);
    // Another delivery took over after our hold ran out: its work, not ours.
    expect(mayEndChecklist(open(claimBy('other')), undefined, ME, NOW, HOLD)).toBe(false);
    // Done by another delivery (no assistant, no note): nothing to end.
    expect(mayEndChecklist(done(), undefined, ME, NOW, HOLD)).toBe(false);
    // Its stale claim, and the work still open: the delivery that wrote it is gone.
    expect(mayEndChecklist(open(claimBy('other', HOLD)), undefined, ME, NOW, HOLD)).toBe(true);
    expect(mayEndChecklist(undefined, undefined, ME, NOW, HOLD)).toBe(false);
  });

  it('a paid list also lands over a failure another delivery recorded, and nowhere else new', () => {
    const failed = { status: 'failed', reason: CHECKLIST_QUOTA, at: new Date(NOW).toISOString() };
    expect(maySucceedChecklist(done(failed), undefined, ME, NOW, HOLD)).toBe(true);
    expect(mayEndChecklist(done(failed), undefined, ME, NOW, HOLD)).toBe(false);
    // Everything else as an ending.
    expect(maySucceedChecklist(open(claimBy(ME)), undefined, ME, NOW, HOLD)).toBe(true);
    expect(maySucceedChecklist(open(claimBy('other')), undefined, ME, NOW, HOLD)).toBe(false);
    expect(maySucceedChecklist(done(), undefined, ME, NOW, HOLD)).toBe(false);
    expect(maySucceedChecklist(undefined, undefined, ME, NOW, HOLD)).toBe(false);
  });
});

describe('the screen and a request nobody answered (01.11.2026)', () => {
  const NOW = Date.parse('2026-11-01T08:00:00.000Z');
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const running = (msAgo: number) => ({ status: 'running', at: iso(msAgo), by: 't' });
  const input = (over: Partial<ChecklistNoteInput>): ChecklistNoteInput => ({
    note: undefined, aiAssigned: true, checklistEmpty: true, createdAt: iso(1_000), ...over,
  });
  const WATCHED = CHECKLIST_WATCH_MS;

  it('waits longer than the server hold, and watches for at least the hold', () => {
    // 120 s is the AI functions' timeout, pinned by functions/test/claudeAuth.test.ts.
    expect(CHECKLIST_DEAD_RUN_MS - checklistHoldMs(120)).toBeGreaterThanOrEqual(60_000);
    expect(CHECKLIST_WATCH_MS).toBeGreaterThanOrEqual(checklistHoldMs(120));
  });

  it('a fresh claim keeps the skeleton; one past the wait, watched long enough, is a failure with Retry', () => {
    expect(checklistNoteView(input({ note: running(1_000) }), NOW, WATCHED)).toEqual({ kind: 'running' });
    expect(checklistNoteView(input({ note: running(CHECKLIST_DEAD_RUN_MS - 1) }), NOW, WATCHED)?.kind).toBe('running');
    const dead = checklistNoteView(input({ note: running(CHECKLIST_DEAD_RUN_MS) }), NOW, WATCHED);
    expect(dead).toEqual({ kind: 'failed', reason: DEAD_RUN_REASON, at: iso(CHECKLIST_DEAD_RUN_MS) });
    expect(checklistWorthRetrying(DEAD_RUN_REASON)).toBe(true);
    expect(CHECKLIST_REASONS).toContain(DEAD_RUN_REASON);
  });

  it('a device clock running ahead cannot show the card early: the watch must pass too', () => {
    // Stored 5 s ago, read by a clock 4 minutes fast: old by this clock, still working in fact.
    const fast = NOW + 240_000;
    expect(checklistNoteView(input({ note: running(5_000) }), fast, 0)?.kind).toBe('running');
    expect(checklistNoteView(input({ note: running(5_000) }), fast, WATCHED - 1)?.kind).toBe('running');
    expect(checklistNoteView(input({ note: running(5_000) }), fast, WATCHED)?.kind).toBe('failed');
    // Older than any skew: no watch needed.
    expect(checklistNoteView(input({ note: running(CHECKLIST_SKEW_CEILING_MS) }), NOW, 0)?.kind).toBe('failed');
  });

  it('no note, the assistant on and an empty checklist: the same wait, from the creation', () => {
    // A move into a group deletes the claim; the AI switched on in an edit is never served at all.
    expect(checklistNoteView(input({ createdAt: iso(1_000) }), NOW, WATCHED)).toEqual({ kind: 'running' });
    expect(checklistNoteView(input({ createdAt: iso(CHECKLIST_DEAD_RUN_MS) }), NOW, WATCHED))
      .toEqual({ kind: 'failed', reason: DEAD_RUN_REASON, at: iso(CHECKLIST_DEAD_RUN_MS) });
    // A stored Timestamp reads the same.
    const ts = { toMillis: () => NOW - CHECKLIST_SKEW_CEILING_MS };
    expect(checklistNoteView(input({ createdAt: ts }), NOW, 0)?.kind).toBe('failed');
    // Items already there (the skeleton is not drawn): nothing to say.
    expect(checklistNoteView(input({ createdAt: iso(CHECKLIST_SKEW_CEILING_MS), checklistEmpty: false }), NOW, 0)).toBeNull();
    // No readable creation time: nothing to count from.
    expect(checklistNoteView(input({ createdAt: undefined }), NOW, WATCHED)).toBeNull();
    expect(pendingSince(input({ createdAt: 'soon' }))).toBeNull();
  });

  it('nothing pending when the AI is not assigned: a copy keeps the note, not the promise', () => {
    // A personal copy made on leaving a group spreads the note, with the assignees reset.
    expect(checklistNoteView(input({ note: running(CHECKLIST_SKEW_CEILING_MS), aiAssigned: false }), NOW, WATCHED)).toBeNull();
    expect(checklistNoteView(input({ createdAt: iso(CHECKLIST_SKEW_CEILING_MS), aiAssigned: false }), NOW, WATCHED)).toBeNull();
  });

  it('a failed note is shown as it is, assigned or not; an unreadable claim is not', () => {
    expect(checklistNoteView(input({ note: { status: 'failed', reason: CHECKLIST_QUOTA, at: 'x' }, aiAssigned: false }), NOW, 0))
      .toEqual({ kind: 'failed', reason: CHECKLIST_QUOTA, at: 'x' });
    expect(checklistNoteView(input({ note: { status: 'running' } }), NOW, WATCHED)).toBeNull();
    expect(checklistNoteView(input({ note: { status: 'running', at: 'soon' } }), NOW, WATCHED)).toBeNull();
  });

  it('the watch starts on the first look and keeps counting for the same request', () => {
    const key = `test-${NOW}`;
    expect(watchedFor(key, 1_000)).toBe(0);
    expect(watchedFor(key, 61_000)).toBe(60_000);
    expect(watchedFor(`${key}-other`, 61_000)).toBe(0);
  });
});

describe('every reason has a sentence, in every language', () => {
  const LANGS = ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE'];

  it('found the six languages, so an empty pass cannot be a silent pass', () => {
    for (const lang of LANGS) expect(Object.keys(translations[lang] || {}).length).toBeGreaterThan(100);
  });

  it('maps each reason to a key that exists in all six', () => {
    // THE seam. A reason added on the server and never translated would reach a family as
    // `ai-checklist/bad-output`. `checklistReasonKey` never returns null, so the only way this
    // fails is a key with no string behind it — which is exactly the case worth failing on.
    const missing: string[] = [];
    for (const reason of CHECKLIST_REASONS) {
      const key = checklistReasonKey(reason);
      for (const lang of LANGS) {
        const value = translations[lang]?.[key];
        if (typeof value !== 'string' || !value.trim()) missing.push(`${reason} -> ${key} @ ${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('says the same thing about provider rationing as the callable does', () => {
    // The trigger and the callable classify with the SAME predicate, `isProviderQuotaError`, and
    // the person meets both within one gesture: the card shows the trigger's sentence, and Retry
    // runs the callable. They used to disagree — "the AI was busy, try again in a minute" against
    // "the app has reached today's AI limit, try again tomorrow" — which is not a wording nit,
    // it is the screen telling somebody two different things about one condition.
    //
    // Two codes, deliberately: the ledger and the health panel want to know WHICH limit. One
    // sentence, equally deliberately: the reader does not.
    // Under Claude (26.09.2026) the callables say "busy, try again in a minute"
    // (`ai-budget/provider-busy`), and so does the card.
    const fromTrigger = checklistReasonKey(CHECKLIST_BUSY);
    const fromCallable = checklistReasonKey('ai-budget/provider-busy');
    expect(fromTrigger).not.toBe(fromCallable);
    for (const lang of LANGS) {
      expect(translations[lang]?.[fromTrigger], `${lang}: the trigger's wording`)
        .toBe(translations[lang]?.[fromCallable]);
    }
  });

  it('gives each reason its own KEY — which is not the same as its own sentence', () => {
    // What this checks is key uniqueness, and the comment used to claim it checked that no two
    // reasons "read alike". They are different things, and since the provider-rationing sentence
    // is deliberately identical to the callables' "busy" one, the stronger claim is now FALSE
    // by design — so stating it here would have been a test lying about its own subject.
    //
    // Key uniqueness is still worth holding: it is what stops a generic fallback swallowing every
    // reason, which is the failure mode that would make all of this decorative. The test directly
    // above pins the one place two keys are meant to share wording.
    const keys = CHECKLIST_REASONS.map(checklistReasonKey);
    expect(new Set(keys).size).toBe(CHECKLIST_REASONS.length);
  });
});

describe('the trigger has no ending that tells nobody', () => {
  // Both of the original bugs were a `return` — a branch that decided to stop and left the event
  // claiming work that would never run. The shape that makes them impossible is: the generation
  // has no returns at all, so its only endings are "wrote the checklist" or "threw a reason", and
  // the trigger has exactly the two returns that mean "this trigger has no job here".
  const INDEX = resolve(process.cwd(), 'functions', 'src', 'index.ts');
  const sf = ts.createSourceFile(INDEX, readFileSync(INDEX, 'utf8'), ts.ScriptTarget.Latest, true);

  function functionNamed(name: string): ts.Node | null {
    let found: ts.Node | null = null;
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.getText(sf) === name) found = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  }

  /** Return statements directly inside `node`, not counting any nested function. */
  function returnsIn(node: ts.Node, root: ts.Node): ts.ReturnStatement[] {
    const out: ts.ReturnStatement[] = [];
    const visit = (n: ts.Node): void => {
      if (n !== root && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))) return;
      if (ts.isReturnStatement(n)) out.push(n);
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(node, visit);
    return out;
  }

  it('found runAutoChecklist, so an empty pass cannot be a silent pass', () => {
    expect(functionNamed('runAutoChecklist')).not.toBeNull();
  });

  it('the generation never returns — it writes, or it throws', () => {
    const fn = functionNamed('runAutoChecklist')!;
    expect(
      returnsIn(fn, fn).map((r) => r.getText(sf)),
      'A return in here is a stop that tells nobody: the caller cannot distinguish it from '
      + 'success, and the event is left advertising work that can never run. Throw '
      + 'checklistFailure(<reason>) instead.',
    ).toEqual([]);
  });

  it('the trigger keeps exactly the three returns that mean "not my job" — by NAME', () => {
    // COMPARED, not counted. The first version asserted `returnsIn(body).length === 2` and named
    // the two legitimate guards only in this comment — so substituting a silent failure return for
    // one of them keeps the count at two and the suite stays green, which is the precise defect
    // this repo has a memory about. A count answers "how many"; the question is "which".
    let trigger: ts.Node | null = null;
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'autoSuggestChecklist') trigger = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(trigger, 'autoSuggestChecklist not found').not.toBeNull();

    const handler = (trigger! as ts.VariableDeclaration).initializer!;
    let body: ts.Node | null = null;
    const findArrow = (n: ts.Node): void => {
      if (!body && ts.isArrowFunction(n)) body = n;
      ts.forEachChild(n, findArrow);
    };
    findArrow(handler);
    expect(body, 'no handler body').not.toBeNull();

    /** The `if` condition a return is guarded by, normalised to one line. */
    const guardOf = (r: ts.Node): string => {
      for (let p: ts.Node | undefined = r.parent; p && p !== body; p = p.parent) {
        if (ts.isIfStatement(p)) return p.expression.getText(sf).replace(/\s+/g, ' ').trim();
      }
      return '<unguarded>';
    };

    const guards = returnsIn(body!, body!).map(guardOf).sort();
    expect(guards).toEqual([
      '!data.assigneeIds || !data.assigneeIds.includes("ai_assistant")',
      '!snapshot',
      // Another delivery of the same creation has the work, or has finished it (31.10.2026).
      '!(await claimChecklistRun(snapshot.ref, data, token))',
    ].sort());
  });

  it('the claim sits inside the trigger’s try, so a claim that throws ends with a reason', () => {
    // Above the try, a failed claim rejects past the catch: no reason written, the assistant left
    // on, the skeleton spinning. The guard text above is the same either way (review of 01.11.2026).
    const calls: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === 'claimChecklistRun') calls.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(calls, 'claimChecklistRun is called once, by the trigger').toHaveLength(1);
    let inTry = false;
    for (let p: ts.Node | undefined = calls[0]; p?.parent; p = p.parent) {
      if (ts.isTryStatement(p.parent) && p.parent.tryBlock === p) { inTry = true; break; }
    }
    expect(inTry, 'a claim outside the try rejects past the catch: no reason, skeleton forever').toBe(true);
  });

  it('records an outcome on the failure path, as a CALL', () => {
    // Also rewritten. This was `expect(readFileSync(INDEX)).toContain('await recordChecklistOutcome(…)')`
    // — a raw substring over the whole file, in the one suite whose header argues against exactly
    // that. A comment describing the call, or a string literal quoting it, satisfies it; deleting
    // the call while leaving the comment does not break it. This repo has shipped that twice.
    let trigger: ts.VariableDeclaration | null = null;
    const findTrigger = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'autoSuggestChecklist') {
        trigger = n as ts.VariableDeclaration;
      }
      ts.forEachChild(n, findTrigger);
    };
    findTrigger(sf);
    expect(trigger, 'autoSuggestChecklist not found').not.toBeNull();

    // The catch clause of the trigger must CALL the recorder.
    let inCatch = 0;
    const walkCatch = (n: ts.Node): void => {
      if (ts.isCatchClause(n)) {
        const calls = (m: ts.Node): void => {
          if (ts.isCallExpression(m) && m.expression.getText(sf) === 'recordChecklistOutcome'
              && m.arguments.length === 4) inCatch++;
          ts.forEachChild(m, calls);
        };
        calls(n.block);
      }
      ts.forEachChild(n, walkCatch);
    };
    walkCatch(trigger!.initializer!);
    expect(inCatch, 'the trigger’s catch must call recordChecklistOutcome(snapshot, data, reason, token)')
      .toBe(1);

    // And the recorder must actually write the field the screen reads.
    let writesField = false;
    const fn = functionNamed('recordChecklistOutcome');
    expect(fn, 'recordChecklistOutcome not found').not.toBeNull();
    const findProp = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'aiChecklist') writesField = true;
      ts.forEachChild(n, findProp);
    };
    findProp(fn!);
    expect(writesField, 'recordChecklistOutcome must write an aiChecklist field').toBe(true);
  });
});
