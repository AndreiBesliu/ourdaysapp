// functions/test/regions.test.ts — where each function deploys (31.10.2026).
//
// The callables run in europe-central2, next to the database, AND in us-central1, where the installed APK
// (a frozen bundle, built before 31.10) calls the ones it knows. Everything else — the scheduled jobs and the
// Firestore triggers — runs in europe-central2 only. A trigger with a second copy fires twice per document:
// two pushes and two bell rows per chat message (onMessageCreated keys no row), two paid Claude calls and two
// checklists per AI event (autoSuggestChecklist), two announcements per game. The reminders dedupe themselves
// (reminder_log claims), so they are not the reason; the triggers are.
//
// Read off `__endpoint` in the compiled lib, as globalOptions.test.ts does and for the same reason. The first
// guard was a regex on the source, and the review of 31.10.2026 found it blind: it never matched a scheduled
// job (their options follow comment lines), nor a region after a `document: "a/{b}"` path, nor one arriving
// through a spread such as AI_FUNCTION_OPTS.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const LIB = resolve(process.cwd(), 'functions/lib');

type Endpoint = { region?: unknown; callableTrigger?: unknown };

const mod = require(resolve(LIB, 'index.js')) as Record<string, unknown>;
const fns = Object.entries(mod).filter(
  ([, v]) => typeof v === 'function' && (v as { __endpoint?: unknown }).__endpoint,
) as [string, { __endpoint: Endpoint }][];
const callables = fns.filter(([, f]) => f.__endpoint.callableTrigger);
const others = fns.filter(([, f]) => !f.__endpoint.callableTrigger);
const where = (list: typeof fns, want: string[]) =>
  list.filter(([, f]) => JSON.stringify(f.__endpoint.region) !== JSON.stringify(want))
    .map(([k, f]) => `${k}: ${JSON.stringify(f.__endpoint.region)}`);

describe('the regions', () => {
  it('reads every function — a load that yielded nothing cannot pass', () => {
    // 55 on 31.10.2026: 42 callables, 10 Firestore triggers, 3 scheduled jobs.
    expect(callables.length).toBeGreaterThanOrEqual(42);
    expect(others.length).toBeGreaterThanOrEqual(13);
  });

  it('every callable is in europe-central2 and in us-central1', () => {
    expect(where(callables, ['europe-central2', 'us-central1'])).toEqual([]);
  });

  it('every scheduled job and trigger is in europe-central2 only', () => {
    expect(where(others, ['europe-central2'])).toEqual([]);
  });

  it('the six that moved from us-central1 are among them', () => {
    const names = others.map(([k]) => k);
    for (const n of ['onMessageCreated', 'onGameCreated', 'autoSuggestChecklist', 'sendDueReminders', 'expireIdleGames', 'logErrorDigest']) {
      expect(names, n).toContain(n);
    }
  });
});
