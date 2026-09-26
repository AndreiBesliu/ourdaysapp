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

  it('the trigger keeps exactly the two returns that mean "not my job" — by NAME', () => {
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
    ].sort());
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
              && m.arguments.length === 3) inCatch++;
          ts.forEachChild(m, calls);
        };
        calls(n.block);
      }
      ts.forEachChild(n, walkCatch);
    };
    walkCatch(trigger!.initializer!);
    expect(inCatch, 'the trigger’s catch must call recordChecklistOutcome(snapshot, data, reason)')
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
