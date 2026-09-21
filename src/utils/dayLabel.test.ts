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
// about a dozen sites named. Re-measured on 20.09: ten were closed by the span work in September,
// which moved storage and comparison onto `dayOf`/`occursOn`. One was a fallback that `spanOf` can
// only reach when the date is unparseable, where the old line printed the words "Invalid Date" at
// somebody rather than the wrong day.
//
// I concluded "that leaves exactly ONE live instance" and wrote it here and in the DEVLOG. THAT WAS
// WRONG, and the guard below is why I could not see it. There were TWO: `LeaveGroupModal`, and the
// recurring-series panel, which does
//
//     const startDate = new Date(ev.date);          // …then format(startDate, …) two lines later
//
// The first version of this guard looked for `format(new Date(x.date))` as one expression. Binding
// the Date to a variable first walks straight past it — and a guard that is blind BY CONSTRUCTION
// is the failure this repo keeps repeating, so the fix is not a wider pattern but a different
// question. It now asks an ARCHITECTURAL one: no component builds a Date out of a stored `.date`
// at all. There is exactly one right way to do it and it lives in `dayLabel.ts`.

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

describe('no component builds a Date out of a stored event date', () => {
  const SRC = resolve(process.cwd(), 'src');
  const UTILS = join(SRC, 'utils');

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'warlord') continue;
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) sourceFiles(file, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(file);
    }
    return out;
  }

  /**
   * Every `new Date(<expr>.date)` outside `src/utils`.
   *
   * The rule is architectural rather than a shape-match, which is the whole point: the previous
   * version asked "is a Date literal being handed to `format`?" and a one-line variable binding
   * defeated it. This asks "did a component construct one at all?", which has no such hole —
   * whatever you do with it afterwards, you should not have built it.
   *
   * `src/utils` is exempt because that is where the legitimate uses live: `dayOf` reads the day in
   * UTC, `recurrence.ts` steps a series in UTC milliseconds, and `dayLabel.ts` is the sanctioned
   * conversion. Those are the model; components are presentation.
   */
  function offenders(): string[] {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.startsWith(UTILS)) continue;
      const sf = ts.createSourceFile(
        file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
      );
      const visit = (n: ts.Node): void => {
        if (ts.isNewExpression(n)
            && n.expression.getText(sf) === 'Date'
            && (n.arguments?.length ?? 0) === 1
            && ts.isPropertyAccessExpression(n.arguments![0])
            && n.arguments![0].name.getText(sf) === 'date') {
          hits.push(`${file.slice(SRC.length + 1).replace(/\\/g, '/')}`
            + `:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
            + ` — new Date(${n.arguments![0].getText(sf)})`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return hits;
  }

  it('finds none', () => {
    expect(
      offenders(),
      'A stored date is midnight UTC. Constructing a Date from it in a component means the next '
      + 'person to format it prints the PREVIOUS day for every reader west of Greenwich — which '
      + 'has now happened twice. Use eventDayAsLocalDate(ev.date) to display it, or dayOf(ev.date) '
      + 'to compare it.',
    ).toEqual([]);
  });

  it('and would find one if it were there, which the last guard could not', () => {
    // The negative control for the guard itself. The shape that defeated the previous version —
    // a Date bound to a variable, formatted later — must be the shape this one reports.
    const probe = ts.createSourceFile(
      'probe.tsx', 'const d = new Date(ev.date); const s = format(d, "d MMM");',
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
    );
    let found = 0;
    const visit = (n: ts.Node): void => {
      if (ts.isNewExpression(n)
          && n.expression.getText(probe) === 'Date'
          && (n.arguments?.length ?? 0) === 1
          && ts.isPropertyAccessExpression(n.arguments![0])
          && n.arguments![0].name.getText(probe) === 'date') found++;
      ts.forEachChild(n, visit);
    };
    visit(probe);
    expect(found).toBe(1);
  });
});
