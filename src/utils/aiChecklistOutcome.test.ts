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
} from '../../functions/src/aiChecklistOutcome';
import { checklistReasonKey, checklistWorthRetrying } from './aiErrorKey';
import { translations } from './i18n';

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
    expect(checklistReason(new Error('exceeded your current quota'))).toBe(CHECKLIST_BUSY);
    // Deliberately narrow: a 503 or a 400 is somebody's problem to look at.
    expect(checklistReason({ status: 503, message: 'overloaded' })).toBe(CHECKLIST_ERROR);
  });

  it('never throws on the shapes an unknown failure actually arrives in', () => {
    for (const odd of [null, undefined, '', 'boom', 0, {}, new Error('')]) {
      expect(CHECKLIST_REASONS).toContain(checklistReason(odd));
    }
  });
});

describe('what a reason implies', () => {
  it('refunds the quota unit only when OUR budget refused', () => {
    // The trigger consumes a unit at the door, before the budget is consulted. A call our own
    // budget refused never reached the model and must not cost one of the owner's fifty.
    expect(refundsQuota('ai-budget/kill-switch')).toBe(true);
    expect(refundsQuota('ai-budget/user-budget')).toBe(true);
    expect(refundsQuota('ai-budget/global-budget')).toBe(true);
  });

  it('does NOT refund when the quota is what stopped it', () => {
    // `tryConsumeQuota` returning false means nothing was consumed. Refunding there would hand
    // back an allowance nobody spent — one free call per event created, for as long as it lasted.
    expect(refundsQuota(CHECKLIST_QUOTA)).toBe(false);
    expect(refundsQuota(CHECKLIST_BAD_OUTPUT)).toBe(false);
    expect(refundsQuota(CHECKLIST_BUSY)).toBe(false);
    expect(refundsQuota(CHECKLIST_ERROR)).toBe(false);
    expect(refundsQuota(CHECKLIST_UNCONFIGURED)).toBe(false);
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
    const fromTrigger = checklistReasonKey(CHECKLIST_BUSY);
    const fromCallable = checklistReasonKey('ai-budget/global-budget');
    expect(fromTrigger).not.toBe(fromCallable);
    for (const lang of LANGS) {
      expect(translations[lang]?.[fromTrigger], `${lang}: the trigger's wording`)
        .toBe(translations[lang]?.[fromCallable]);
    }
  });

  it('does not give two different reasons the same sentence', () => {
    // A generic fallback for everything would pass the check above while telling nobody anything.
    // `unconfigured` and `error` must not read alike; nor may the two budget limits.
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

  it('the trigger keeps exactly the two returns that mean "not my job"', () => {
    // `if (!snapshot)` and `if (!assigneeIds.includes("ai_assistant"))`. Nothing has been promised
    // to anybody at either point. A third return would be a failure path that records nothing.
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
    expect(returnsIn(body!, body!).length).toBe(2);
  });

  it('records an outcome on the failure path', () => {
    // The counterpart to the two rules above: having thrown, something must write the reason.
    const src = readFileSync(INDEX, 'utf8');
    expect(src).toContain('await recordChecklistOutcome(snapshot, data, reason);');
    expect(src).toContain('aiChecklist: { status: "failed", reason, at:');
  });
});
