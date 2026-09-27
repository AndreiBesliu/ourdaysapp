// src/utils/jobHealth.test.ts
//
// The scheduled-job health lines (functions/src/jobHealthCore.ts) and how the admin screen reads
// them (src/utils/jobHealthView.ts). Pure. What the DEPLOY reads — every scheduled export, its
// schedule and timeout — is held by functions/test/jobRuns.test.ts, off `__endpoint`.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  JOB_SCHEDULE, STUCK_MS, LATE_FACTOR, DEAD_FACTOR, FAIL_STREAK_FAIL, STARTS_WITHOUT_END_FAIL,
  SCHEDULER_HINT, LOGS_HINT, cronMinutes, coerceMarker, jobHealthChecks, jobsNeedingMissingStamp,
  fmtAgo, fmtEvery, type JobCheck,
} from '../../functions/src/jobHealthCore';
import { jobsState, jobsNeedingAttention } from './jobHealthView';

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const MIN = 60_000;

const lineFor = (markers: Record<string, unknown>, name: string, now = NOW): JobCheck => {
  const l = jobHealthChecks(markers, now).find((x) => x.name === name);
  if (!l) throw new Error(`no line for ${name}`);
  return l;
};

describe('cronMinutes', () => {
  it('reads the forms the jobs use', () => {
    expect(cronMinutes('*/5 * * * *')).toBe(5);
    expect(cronMinutes('0 * * * *')).toBe(60);
    expect(cronMinutes('17 * * * *')).toBe(60);
    expect(cronMinutes('0 */6 * * *')).toBe(360);
    expect(cronMinutes('30 2 * * *')).toBe(1440);
    expect(cronMinutes('  */15   *  * * * ')).toBe(15);
  });

  it('refuses the App Engine form — the one that restarts at every deploy', () => {
    expect(cronMinutes('every 5 minutes')).toBeNull();
    expect(cronMinutes('every 6 hours')).toBeNull();
    expect(cronMinutes('every 60 minutes')).toBeNull();
  });

  it('refuses what has no single interval', () => {
    expect(cronMinutes('*/7 * * * *')).toBeNull();   // 60 is not a multiple of 7
    expect(cronMinutes('0 */5 * * *')).toBeNull();   // 24 is not a multiple of 5
    expect(cronMinutes('0 0 * * 1')).toBeNull();     // weekly
    expect(cronMinutes('0 0 1 * *')).toBeNull();     // monthly
    expect(cronMinutes('0 60 * * *')).toBeNull();
    expect(cronMinutes('60 * * * *')).toBeNull();
    expect(cronMinutes('*/5 * * * * *')).toBeNull(); // six fields
    expect(cronMinutes('')).toBeNull();
    expect(cronMinutes(undefined)).toBeNull();
  });
});

describe('the job list', () => {
  it('has unique names, positive intervals and a label each', () => {
    const names = JOB_SCHEDULE.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const j of JOB_SCHEDULE) {
      expect(j.everyMinutes).toBeGreaterThan(0);
      expect(j.label.length).toBeGreaterThan(0);
    }
  });

  it('keeps STUCK_MS above every interval that could look like a run in progress', () => {
    // A 15-minute "stuck" threshold is about a single run, not the schedule — but it must at least
    // clear the platform timeout by a wide margin (held against the real timeouts off __endpoint).
    expect(STUCK_MS).toBeGreaterThanOrEqual(10 * MIN);
  });
});

describe('every scheduled job goes through runJob, with its own name', () => {
  // Per BODY, not per file: a file that mentions runJob somewhere satisfies nothing. Presto's first
  // parity check was satisfied by a disabled marker with the same name (memory: joburi programate).
  const dir = resolve(process.cwd(), 'functions/src');
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ f, text: readFileSync(resolve(dir, f), 'utf8') }));
  const exportsFound: { name: string; body: string; file: string }[] = [];
  for (const { f, text } of sources) {
    const re = /export const (\w+) = onSchedule\(/g;
    let m: RegExpExecArray | null;
    const starts: { name: string; at: number }[] = [];
    while ((m = re.exec(text))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].at : text.length;
      exportsFound.push({ name: s.name, body: text.slice(s.at, end), file: f });
    });
  }

  it('finds exactly the jobs on the list', () => {
    expect(exportsFound.map((e) => e.name).sort()).toEqual(JOB_SCHEDULE.map((j) => j.name).sort());
  });

  for (const j of JOB_SCHEDULE) {
    it(`${j.name}: one runJob call, named for itself`, () => {
      const e = exportsFound.find((x) => x.name === j.name);
      expect(e, `${j.name} has no onSchedule export`).toBeTruthy();
      const calls = [...e!.body.matchAll(/runJob\(\s*"(\w+)"/g)].map((c) => c[1]);
      expect(calls).toEqual([j.name]);
    });
  }
});

describe('coerceMarker', () => {
  it('reads garbage as nothing', () => {
    expect(coerceMarker(undefined)).toEqual({ at: 0, ok: true, detail: '', startedAt: 0, startsSinceEnd: 0, firstMissingAt: 0, failStreak: 0 });
    expect(coerceMarker({ at: 'yesterday', startedAt: -5, failStreak: NaN, startsSinceEnd: '3', detail: 7 }))
      .toEqual({ at: 0, ok: true, detail: '', startedAt: 0, startsSinceEnd: 0, firstMissingAt: 0, failStreak: 0 });
  });

  it('keeps ok false only when it IS false', () => {
    expect(coerceMarker({ ok: false }).ok).toBe(false);
    expect(coerceMarker({ ok: 0 }).ok).toBe(true);
  });
});

describe('jobHealthChecks', () => {
  const R = 'sendDueReminders'; // every 5 minutes
  const D = 'logErrorDigest';   // every 6 hours

  it('returns one line per job, in list order, whatever the markers', () => {
    expect(jobHealthChecks(null, NOW).map((l) => l.name)).toEqual(JOB_SCHEDULE.map((j) => j.name));
    expect(jobHealthChecks({ junk: { at: NOW } }, NOW).map((l) => l.name)).toEqual(JOB_SCHEDULE.map((j) => j.name));
  });

  it('a job with no marker at all is only "not yet" — never green', () => {
    for (const l of jobHealthChecks({}, NOW)) {
      expect(l.status).toBe('info');
      expect(l.lastRunAt).toBeNull();
    }
  });

  describe('never ran', () => {
    it('escalates by the age of firstMissingAt: info, then warn, then fail', () => {
      const every = 5 * MIN;
      expect(lineFor({ [R]: { firstMissingAt: NOW - every } }, R).status).toBe('info');
      expect(lineFor({ [R]: { firstMissingAt: NOW - every * LATE_FACTOR - MIN } }, R).status).toBe('warn');
      const dead = lineFor({ [R]: { firstMissingAt: NOW - every * DEAD_FACTOR - MIN } }, R);
      expect(dead.status).toBe('fail');
      expect(dead.message).toMatch(/NEVER/);
      expect(dead.hint).toBe(SCHEDULER_HINT);
    });
  });

  describe('the last run that ended', () => {
    it('recent and ok is green, with what it did', () => {
      const l = lineFor({ [R]: { at: NOW - 2 * MIN, ok: true, detail: 'due 1, sent 1' } }, R);
      expect(l.status).toBe('ok');
      expect(l.message).toContain('due 1, sent 1');
      expect(l.lastRunAt).toBe(NOW - 2 * MIN);
    });

    it('late past 1.5× the interval, stopped past 3×', () => {
      const every = 360 * MIN;
      expect(lineFor({ [D]: { at: NOW - every * LATE_FACTOR + MIN, ok: true } }, D).status).toBe('ok');
      expect(lineFor({ [D]: { at: NOW - every * LATE_FACTOR - MIN, ok: true } }, D).status).toBe('warn');
      const dead = lineFor({ [D]: { at: NOW - every * DEAD_FACTOR - MIN, ok: true } }, D);
      expect(dead.status).toBe('fail');
      expect(dead.hint).toBe(SCHEDULER_HINT);
    });

    it('a stopped job is judged as stopped even when its last run also failed', () => {
      const l = lineFor({ [R]: { at: NOW - 60 * MIN, ok: false, failStreak: 1, detail: 'boom' } }, R);
      expect(l.status).toBe('fail');
      expect(l.message).toMatch(/Has not run/);
    });

    it('one failure is amber; FAIL_STREAK_FAIL in a row is red', () => {
      const one = lineFor({ [R]: { at: NOW - MIN, ok: false, failStreak: 1, detail: 'failed 2' } }, R);
      expect(one.status).toBe('warn');
      expect(one.message).toContain('failed 2');
      expect(one.hint).toContain(R);
      const two = lineFor({ [R]: { at: NOW - MIN, ok: false, failStreak: FAIL_STREAK_FAIL } }, R);
      expect(two.status).toBe('fail');
      expect(two.message).toContain(String(FAIL_STREAK_FAIL));
    });
  });

  describe('a start with no end after it', () => {
    it('old: killed — red if nothing has ended for 3× the interval, amber if something recently did', () => {
      const every = 360 * MIN;
      const killed = lineFor({ [D]: { at: NOW - every, ok: true, startedAt: NOW - STUCK_MS - MIN, startsSinceEnd: 1 } }, D);
      expect(killed.status).toBe('warn');
      expect(killed.hint).toBe(LOGS_HINT);
      const never = lineFor({ [D]: { startedAt: NOW - STUCK_MS - MIN, startsSinceEnd: 1 } }, D);
      expect(never.status).toBe('fail');
      expect(never.hint).toBe(LOGS_HINT);
    });

    it('recent: a run in progress is judged by the last run that ended', () => {
      const l = lineFor({ [R]: { at: NOW - 5 * MIN, ok: true, detail: 'due 0', startedAt: NOW - 10_000, startsSinceEnd: 1 } }, R);
      expect(l.status).toBe('ok');
      expect(lineFor({ [R]: { startedAt: NOW - 10_000, startsSinceEnd: 1 } }, R).status).toBe('info');
    });

    it('a job killed on every run is red by its count of starts, although no start ever ages', () => {
      // Every five minutes a new start refreshes `startedAt`, so the STUCK_MS branch never fires.
      const first = lineFor({ [R]: { startedAt: NOW - MIN, startsSinceEnd: STARTS_WITHOUT_END_FAIL } }, R);
      expect(first.status).toBe('fail');
      expect(first.hint).toBe(LOGS_HINT);
      const later = lineFor({ [R]: { at: NOW - 16 * MIN, ok: true, startedAt: NOW - MIN, startsSinceEnd: STARTS_WITHOUT_END_FAIL } }, R);
      expect(later.status).toBe('fail');
      expect(later.hint).toBe(LOGS_HINT);
      // One short of it is still a run in progress.
      expect(lineFor({ [R]: { startedAt: NOW - MIN, startsSinceEnd: STARTS_WITHOUT_END_FAIL - 1 } }, R).status).toBe('info');
    });

    it('a start OLDER than the last end is not "in progress" (it is the run that ended)', () => {
      const l = lineFor({ [R]: { at: NOW - MIN, ok: true, startedAt: NOW - 2 * MIN, startsSinceEnd: 5 } }, R);
      expect(l.status).toBe('ok');
    });
  });
});

describe('jobsNeedingMissingStamp', () => {
  it('names only the jobs with no document', () => {
    expect(jobsNeedingMissingStamp({})).toEqual(JOB_SCHEDULE.map((j) => j.name));
    expect(jobsNeedingMissingStamp({ sendDueReminders: { startedAt: 1 }, expireIdleGames: 'junk' }))
      .toEqual(['expireIdleGames', 'logErrorDigest']);
  });
});

describe('formatting', () => {
  it('ages and intervals', () => {
    expect(fmtAgo(4 * MIN)).toBe('4 min');
    expect(fmtAgo(3 * 60 * MIN)).toBe('3 h');
    expect(fmtAgo(3 * 1440 * MIN)).toBe('3 days');
    expect(fmtEvery(5)).toBe('5 min');
    expect(fmtEvery(60)).toBe('hour');
    expect(fmtEvery(360)).toBe('6 hours');
    expect(fmtEvery(1440)).toBe('day');
  });
});

describe('the admin screen', () => {
  const line = { name: 'sendDueReminders', label: 'x', everyMinutes: 5, status: 'ok', message: 'm', hint: '', lastRunAt: 1, failStreak: 0 };

  it('keeps "not reported", "unreadable" and "the answer" apart', () => {
    expect(jobsState(undefined).kind).toBe('not-reported');
    expect(jobsState(null).kind).toBe('unreadable');
    expect(jobsState({}).kind).toBe('unreadable');
    // An empty or unreadable list is not "nothing wrong".
    expect(jobsState([]).kind).toBe('unreadable');
    expect(jobsState([{ name: 'x', status: 'great', message: 'm' }]).kind).toBe('unreadable');
    const s = jobsState([line, { junk: true }]);
    expect(s.kind).toBe('lines');
    expect(s.kind === 'lines' && s.lines).toEqual([line]);
  });

  it('the job list is part of the admin console only — its English-only exemption depends on it', () => {
    // src/utils/i18nCoverage.test.ts skips JobHealthList.tsx because only Admin.tsx renders it.
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, f.name);
        if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'warlord') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f.name) || f.name === 'jobHealth.test.ts') continue;
        if (/from\s+['"][^'"]*JobHealthList['"]/.test(readFileSync(p, 'utf8'))) importers.push(p.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/'));
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(importers).toEqual(['src/screens/Admin.tsx']);
  });

  it('counts warn and fail for the tab badge, and nothing it cannot read', () => {
    expect(jobsNeedingAttention([line, { ...line, name: 'a', status: 'warn' }, { ...line, name: 'b', status: 'fail' }, { ...line, name: 'c', status: 'info' }])).toBe(2);
    expect(jobsNeedingAttention(undefined)).toBe(0);
    expect(jobsNeedingAttention(null)).toBe(0);
  });
});
