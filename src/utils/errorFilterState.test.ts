// src/utils/errorFilterState.test.ts
//
// The Health tab greeted Andrei with "Nothing in this state." — because the landing chip was
// hard-coded to "Needs attention" and nothing needed attention. Five real problems sat one click
// away, invisible. The first test here is that exact screen.

import { describe, it, expect } from 'vitest';
import { errorStatusOf, inErrorState, landingErrorFilter } from './errorFilterState';

const g = (status: string | null | undefined) => ({ status });

// What the live panel actually held on 15 Sept 2026: one seen, four resolved, nothing open.
const THE_REAL_SCREEN = [g('seen'), g('resolved'), g('resolved'), g('resolved'), g('resolved')];

describe('the screen this file exists for', () => {
  it('opens on something that has content, not on the empty chip', () => {
    expect(landingErrorFilter(THE_REAL_SCREEN)).toBe('seen');
  });

  it('would have shown nothing under the old hard-coded chip', () => {
    // The old behaviour, for comparison: 'open' was fixed in advance and matched none of them.
    expect(THE_REAL_SCREEN.filter((x) => inErrorState(x, 'open'))).toHaveLength(0);
    // ...while the panel had five problems to show all along.
    expect(THE_REAL_SCREEN.filter((x) => inErrorState(x, 'all'))).toHaveLength(5);
  });
});

describe('choosing where to land', () => {
  it('prefers what came back over everything else', () => {
    expect(landingErrorFilter([g('resolved'), g('regressed'), g('new')])).toBe('open');
  });

  it('prefers unread over already known', () => {
    expect(landingErrorFilter([g('seen'), g('new')])).toBe('open');   // 'new' is inside 'open'
  });

  it('falls to seen when nothing is open', () => {
    expect(landingErrorFilter([g('seen'), g('resolved')])).toBe('seen');
  });

  it('falls to resolved when that is all there is', () => {
    expect(landingErrorFilter([g('resolved'), g('resolved')])).toBe('resolved');
  });

  it('lands on all when the log is empty, rather than on a chip', () => {
    expect(landingErrorFilter([])).toBe('all');
  });

  it('never lands on a chip that would render nothing', () => {
    // The property that matters, stated directly rather than through examples.
    const shapes = ['new', 'seen', 'resolved', 'regressed'];
    for (const a of shapes) {
      for (const b of shapes) {
        const groups = [g(a), g(b)];
        const landing = landingErrorFilter(groups);
        expect(groups.some((x) => inErrorState(x, landing))).toBe(true);
      }
    }
  });
});

describe('a group with no status at all', () => {
  // Hosting can deploy ahead of functions, so the browser may hold a build expecting a field the
  // server does not send yet. Such a group must stay VISIBLE; the old fall-through made it look
  // resolved, which is a panel quietly reporting that everything is fine.
  it('counts as new, not as resolved', () => {
    expect(errorStatusOf(g(undefined))).toBe('new');
    expect(errorStatusOf(g(null))).toBe('new');
    expect(errorStatusOf({})).toBe('new');
  });

  it('shows up under "needs attention" rather than disappearing', () => {
    expect(inErrorState(g(undefined), 'open')).toBe(true);
    expect(inErrorState(g(undefined), 'resolved')).toBe(false);
    expect(landingErrorFilter([g(undefined)])).toBe('open');
  });
});

describe('what each chip lets through', () => {
  it('treats "open" as new plus regressed', () => {
    expect(inErrorState(g('new'), 'open')).toBe(true);
    expect(inErrorState(g('regressed'), 'open')).toBe(true);
    expect(inErrorState(g('seen'), 'open')).toBe(false);
    expect(inErrorState(g('resolved'), 'open')).toBe(false);
  });

  it('matches the other chips exactly', () => {
    expect(inErrorState(g('seen'), 'seen')).toBe(true);
    expect(inErrorState(g('new'), 'seen')).toBe(false);
    expect(inErrorState(g('resolved'), 'resolved')).toBe(true);
    expect(inErrorState(g('regressed'), 'resolved')).toBe(false);
  });

  it('lets everything through "all", including a statusless group', () => {
    for (const x of [g('new'), g('seen'), g('resolved'), g('regressed'), g(undefined)]) {
      expect(inErrorState(x, 'all')).toBe(true);
    }
  });
});
