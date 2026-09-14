// src/utils/errorState.test.ts
//
// The whole system rests on one claim: a group marked resolved comes BACK on its own if it happens
// again. Without that, "resolved" records a feeling rather than a fact, and the quickest way to an
// empty error panel is to mark everything resolved. Most of what follows tests that, from both
// directions — it must come back when it should, and must stay quiet when it should not.

import { describe, it, expect } from 'vitest';
import {
  ERROR_STATUSES, STATUS_RANK, effectiveStatus, groupDocId, isErrorStatus, recurredSince, joinState,
} from '../../functions/src/errorState';

const AUG = '2026-08-01T10:00:00.000Z';
const SEP = '2026-09-01T10:00:00.000Z';

describe('a resolved group that happens again', () => {
  it('comes back by itself, without anybody remembering to check', () => {
    expect(effectiveStatus({ status: 'resolved', watermark: AUG }, SEP)).toBe('regressed');
  });

  it('stays resolved while nothing new arrives', () => {
    expect(effectiveStatus({ status: 'resolved', watermark: SEP }, SEP)).toBe('resolved');
    expect(effectiveStatus({ status: 'resolved', watermark: SEP }, AUG)).toBe('resolved');
  });

  it('is not tripped by the very occurrence it was resolved at', () => {
    // The watermark IS the newest occurrence at the moment of resolving. Comparing inclusively
    // would make every resolve regress itself on the next render, which is the kind of defect that
    // makes people stop trusting a panel entirely.
    expect(effectiveStatus({ status: 'resolved', watermark: SEP }, SEP)).toBe('resolved');
  });

  it('does not regress a group that was merely SEEN', () => {
    // `seen` claims nothing about the code — only "I know". A new occurrence does not contradict it.
    expect(effectiveStatus({ status: 'seen', watermark: AUG }, SEP)).toBe('seen');
  });

  it('still reports that a seen group is STILL happening', () => {
    // Worth showing, but as a flag rather than a status: one field, one meaning.
    expect(recurredSince({ status: 'seen', watermark: AUG }, SEP)).toBe(true);
    expect(recurredSince({ status: 'seen', watermark: SEP }, AUG)).toBe(false);
  });
});

describe('a group nobody has touched', () => {
  it('is new', () => {
    expect(effectiveStatus(null, SEP)).toBe('new');
    expect(effectiveStatus(undefined, SEP)).toBe('new');
    expect(effectiveStatus({}, SEP)).toBe('new');
  });

  it('has not "recurred since" anything, because there is no since', () => {
    expect(recurredSince(null, SEP)).toBe(false);
    expect(recurredSince({}, SEP)).toBe(false);
  });

  it('treats an unreadable stored status as new rather than as resolved', () => {
    // Failing towards "somebody should look at this" is the only safe direction: the other way
    // hides a problem behind corrupt data.
    for (const junk of ['done', 'RESOLVED', 42, null, {}]) {
      expect(effectiveStatus({ status: junk } as never, SEP)).toBe('new');
    }
  });

  it('treats a missing or unparseable watermark as "no recurrence known"', () => {
    expect(effectiveStatus({ status: 'resolved' }, SEP)).toBe('resolved');
    expect(effectiveStatus({ status: 'resolved', watermark: 'yesterday' }, SEP)).toBe('resolved');
  });

  it('does not regress on an unparseable lastSeen', () => {
    expect(effectiveStatus({ status: 'resolved', watermark: AUG }, 'soon')).toBe('resolved');
    expect(effectiveStatus({ status: 'resolved', watermark: AUG }, null)).toBe('resolved');
  });
});

describe('what an admin is allowed to say', () => {
  it('accepts exactly the three real statuses', () => {
    expect(ERROR_STATUSES).toEqual(['new', 'seen', 'resolved']);
    for (const s of ERROR_STATUSES) expect(isErrorStatus(s)).toBe(true);
  });

  it('refuses `regressed` — it is derived, never chosen', () => {
    // Letting it be written would allow a group to be parked in a state the watermark cannot undo.
    expect(isErrorStatus('regressed')).toBe(false);
  });

  it('refuses anything else', () => {
    for (const junk of ['', 'open', 'closed', 'Seen', 1, null, undefined, {}]) {
      expect(isErrorStatus(junk)).toBe(false);
    }
  });
});

describe('the document id for a fingerprint', () => {
  it('is stable for the same fingerprint', () => {
    expect(groupDocId('errorboundary::boom')).toBe(groupDocId('errorboundary::boom'));
  });

  it('never contains a slash, which Firestore forbids in an id', () => {
    expect(groupDocId('ai:suggestasset::failed at groups/abc')).not.toContain('/');
  });

  it('keeps two different fingerprints apart, including the tricky pair', () => {
    // If "/" were mapped onto a character the alphabet already uses, these two would collide and
    // resolving one would silently resolve the other.
    const a = groupDocId('a/b');
    const b = groupDocId('a%2Fb');
    expect(a).not.toBe(b);
    expect(groupDocId('x%y')).not.toBe(groupDocId('x%25y'));
  });

  it('avoids the ids Firestore reserves', () => {
    expect(groupDocId('.')).not.toBe('.');
    expect(groupDocId('..')).not.toBe('..');
    expect(groupDocId('__proto__::x').startsWith('__')).toBe(false);
  });

  it('stays within the length limit, and long fingerprints still differ', () => {
    const long = 'x'.repeat(3000);
    expect(new TextEncoder().encode(groupDocId(long)).length).toBeLessThanOrEqual(1500);
    expect(groupDocId(long)).not.toBe(groupDocId(`${long}y`));
  });

  it('gives an empty or non-string fingerprint something to hold, rather than throwing', () => {
    for (const junk of ['', null, undefined, 42]) {
      expect(groupDocId(junk as unknown)).toBeTruthy();
    }
  });
});

describe('the order the panel shows them in', () => {
  it('puts what needs attention first and what is done last', () => {
    const order = (['resolved', 'seen', 'new', 'regressed'] as const)
      .slice().sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b]);
    // Something believed fixed and still happening is worse news than something nobody has read.
    expect(order).toEqual(['regressed', 'new', 'seen', 'resolved']);
  });
});
describe('joining stored state onto groups', () => {
  const group = (key: string, lastSeen = SEP) => ({ key, lastSeen, count: 1 });

  it('never loses a group, however many there are', () => {
    // The defect this pins: state was fetched for the first 200 groups and then zipped BY INDEX
    // onto all of them, so everything past the cap silently reported "new". With 260 groups all
    // stored as resolved, the panel showed 200 resolved and 60 new — and never said so.
    const groups = Array.from({ length: 260 }, (_, i) => group(`bug-${i}`));
    const store = new Map(groups.map((g) => [g.key, { status: 'resolved', watermark: SEP }]));
    const joined = joinState(groups, (k) => store.get(k) || null);

    expect(joined).toHaveLength(260);
    expect(joined.every((g) => g.status === 'resolved')).toBe(true);
    expect(joined.filter((g) => g.status === 'new')).toHaveLength(0);
  });

  it('matches on the key, not on position', () => {
    // Order-independence is the property that makes the misalignment unrepresentable.
    const groups = [group('a'), group('b'), group('c')];
    const store = new Map([['c', { status: 'seen' as const, watermark: SEP }]]);
    const joined = joinState(groups, (k) => store.get(k) || null);
    expect(joined.map((g) => g.status)).toEqual(['new', 'new', 'seen']);

    const reversed = joinState([...groups].reverse(), (k) => store.get(k) || null);
    expect(reversed.find((g) => g.key === 'c')!.status).toBe('seen');
  });

  it('carries the regression through', () => {
    const store = new Map([['a', { status: 'resolved', watermark: AUG }]]);
    const [g] = joinState([group('a', SEP)], (k) => store.get(k) || null);
    expect(g.status).toBe('regressed');
    expect(g.recurred).toBe(true);
  });

  it('reports a resolve time only while the group is resolved', () => {
    // merge:true never removes a field, so a reopened group kept its resolvedAt. Reading against
    // the status actually held means the screen cannot describe a state that is over.
    const reopened = { status: 'new', watermark: SEP, resolvedAt: AUG, seenAt: null };
    const [g] = joinState([group('a')], () => reopened);
    expect(g.status).toBe('new');
    expect(g.statusAt).toBeNull();

    const resolved = { status: 'resolved', watermark: SEP, resolvedAt: AUG };
    expect(joinState([group('a')], () => resolved)[0].statusAt).toBe(AUG);
  });

  it('keeps every field the group already had', () => {
    const [g] = joinState([{ key: 'a', lastSeen: SEP, count: 7, sample: 'boom' }], () => null);
    expect(g.count).toBe(7);
    expect(g.sample).toBe('boom');
  });

  it('survives a lookup that returns nothing at all', () => {
    const joined = joinState([group('a'), group('b')], () => undefined);
    expect(joined.map((g) => g.status)).toEqual(['new', 'new']);
  });
});
