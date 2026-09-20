// src/utils/dayLabel.test.ts
//
// Printing a stored day without moving it.
//
// Dates are stored as `yyyy-MM-ddT00:00:00.000Z` and read back in UTC, so the stored day and the
// typed day agree everywhere. The trap is on the way OUT: date-fns `format` renders an instant in
// the READER's zone, and west of Greenwich midnight UTC is the evening before — so
// `format(new Date(ev.date), 'd MMM')` prints the previous day.
//
// ── Why this is a small file and not a big one ────────────────────────────────────────────
//
// "Event Date Timezone Shift" has been on the roadmap since 26.05, described as pervasive, with
// about a dozen sites named. Re-measured today: ten of them were closed by the span work in
// September, which moved storage and comparison onto `dayOf`/`occursOn`. One was a fallback that
// `spanOf` can only reach when the date is unparseable, where the old line printed the words
// "Invalid Date" at somebody rather than the wrong day. That left exactly ONE live instance — the
// event list in `LeaveGroupModal`.
//
// Repeating a four-month-old finding without re-measuring would have made this a rewrite of a
// dozen call sites. It is three lines.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { format } from 'date-fns';
import { dayAsLocalDate, eventDayAsLocalDate } from './dayLabel';

describe('a stored day as something a local formatter can print', () => {
  it('formats as the day it names, whatever the reader is set to', () => {
    // The property that matters, stated as the output rather than the mechanism: the 20th prints
    // as the 20th. Note what this can and cannot hold: it is zone-independent BY CONSTRUCTION, so
    // it passes everywhere — including in a zone where the broken version would also pass. The
    // thing that actually catches a regression is the source guard below, and the mutation run
    // that proves it, which runs under TZ=America/Los_Angeles because west of Greenwich is the
    // only place the bug exists at all.
    const d = dayAsLocalDate('2026-09-20')!;
    expect(format(d, 'yyyy-MM-dd')).toBe('2026-09-20');
    expect(d.getDate()).toBe(20);
    expect(d.getMonth()).toBe(8);
    expect(d.getFullYear()).toBe(2026);
  });

  it('reads the day out of a stored instant first', () => {
    expect(format(eventDayAsLocalDate('2026-09-20T00:00:00.000Z')!, 'yyyy-MM-dd')).toBe('2026-09-20');
    // A stored instant late in the UTC day still belongs to that UTC day, because `dayOf` says so.
    expect(format(eventDayAsLocalDate('2026-09-20T23:30:00.000Z')!, 'yyyy-MM-dd')).toBe('2026-09-20');
  });

  it('refuses a day that does not exist instead of rolling it forward', () => {
    // `new Date(2026, 1, 31)` is 3 March, silently. A date field that has been corrupted should
    // not come back as a different, plausible-looking day.
    expect(dayAsLocalDate('2026-02-31')).toBeNull();
    expect(dayAsLocalDate('2026-13-01')).toBeNull();
  });

  it('refuses everything unparseable, so no caller can print "Invalid Date"', () => {
    for (const bad of ['', '2026-9-20', 'tomorrow', '2026-09-20T00:00:00Z', null, undefined, 42, {}]) {
      expect(dayAsLocalDate(bad as unknown), String(bad)).toBeNull();
    }
    expect(eventDayAsLocalDate('not a date')).toBeNull();
    expect(eventDayAsLocalDate(undefined)).toBeNull();
  });

  it('keeps a leap day', () => {
    expect(format(dayAsLocalDate('2028-02-29')!, 'yyyy-MM-dd')).toBe('2028-02-29');
  });
});

describe('nothing hands a stored instant to a local formatter', () => {
  const SRC = resolve(process.cwd(), 'src');

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'warlord') continue;
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) sourceFiles(file, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(file);
    }
    return out;
  }

  /** `format(new Date(<anything>.date), …)` — the exact shape that moves the day. */
  function offenders(): string[] {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const sf = ts.createSourceFile(
        file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
      );
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)
            && n.expression.getText(sf) === 'format'
            && n.arguments.length >= 1
            && ts.isNewExpression(n.arguments[0])
            && n.arguments[0].expression.getText(sf) === 'Date'
            && (n.arguments[0].arguments?.length ?? 0) === 1) {
          const arg = n.arguments[0].arguments![0].getText(sf);
          // `format(new Date(), …)` is "now", which is genuinely a local instant and correct.
          if (/\.date\b|\bdate\b|dateIso/.test(arg)) {
            hits.push(`${file.slice(SRC.length + 1).replace(/\\/g, '/')}`
              + `:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} — format(new Date(${arg}))`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return hits;
  }

  it('finds no site formatting a stored date in the reader’s zone', () => {
    expect(
      offenders(),
      'A stored date is midnight UTC. date-fns `format` renders in the reader’s zone, so west of '
      + 'Greenwich this prints the PREVIOUS day. Use eventDayAsLocalDate(ev.date) — it reads the '
      + 'day in UTC and rebuilds it as a local Date, which formats as itself everywhere.',
    ).toEqual([]);
  });
});
