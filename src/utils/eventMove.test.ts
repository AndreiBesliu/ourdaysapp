// src/utils/eventMove.test.ts — moving an event between calendars, and its RSVP answers on the way
// (utils/eventMove.ts; Andrei, 05.10.2026). The rules refuse any other shape: rules-tests/events.test.ts.

import { describe, it, expect } from 'vitest';
import { AI_ASSIGNEE, answersForMove, dropsAnswers, inviteCandidates, moveOf, onlyMyAnswer, uidInvite } from './eventMove';

const ME = 'uid-me', ANA = 'uid-ana', BOB = 'uid-bob', DAN = 'uid-dan', EVE = 'uid-eve';

describe('moveOf', () => {
  it('names the four cases; null, undefined and the empty string all mean personal', () => {
    expect(moveOf('g1', 'g1')).toBe('none');
    expect(moveOf(null, undefined)).toBe('none');
    expect(moveOf('', null)).toBe('none');
    expect(moveOf('g1', null)).toBe('out');
    expect(moveOf(undefined, 'g1')).toBe('in');
    expect(moveOf('g1', 'g2')).toBe('across');
  });
});

describe('answersForMove', () => {
  const stored = { [ME]: 'yes', [ANA]: 'no', [BOB]: 'maybe' };

  it('nothing to write when the event stays, or goes out to personal: its answers stay as they are', () => {
    expect(answersForMove(stored, 'none', ME, [])).toBeNull();
    expect(answersForMove(stored, 'out', ME, [])).toBeNull();
  });

  it('into a group: only your answer goes, and only one the app writes', () => {
    expect(answersForMove(stored, 'in', ME, [ME, ANA, BOB])).toEqual({ [ME]: 'yes' });
    expect(answersForMove({ [ANA]: 'yes' }, 'in', ME, [ME, ANA])).toEqual({});
    expect(answersForMove({ [ME]: 'banana' }, 'in', ME, [ME])).toEqual({});
    expect(answersForMove(undefined, 'in', ME, [ME])).toEqual({});
  });

  it('between groups: exactly the answers of the people in the new one', () => {
    expect(answersForMove(stored, 'across', ME, [ME, ANA, EVE])).toEqual({ [ME]: 'yes', [ANA]: 'no' });
    expect(answersForMove(stored, 'across', ME, [])).toEqual({});
  });

  it('between groups, somebody else’s answer is carried as it is; your own only if the app writes it', () => {
    expect(answersForMove({ [ANA]: 'odd', [ME]: 'odd' }, 'across', ME, [ME, ANA])).toEqual({ [ANA]: 'odd' });
  });

  it('a stored value that is not a map is no answers', () => {
    for (const v of [null, 'x', [ME], 3]) {
      expect(answersForMove(v, 'across', ME, [ME])).toEqual({});
      expect(answersForMove(v, 'in', ME, [ME])).toEqual({});
    }
  });
});

describe('onlyMyAnswer', () => {
  it('your answer alone, or nothing', () => {
    expect(onlyMyAnswer({ [ME]: 'maybe', [ANA]: 'yes' }, ME)).toEqual({ [ME]: 'maybe' });
    expect(onlyMyAnswer({ [ANA]: 'yes' }, ME)).toEqual({});
    expect(onlyMyAnswer({ [ME]: true }, ME)).toEqual({});
    expect(onlyMyAnswer(null, ME)).toEqual({});
  });
});

describe('dropsAnswers', () => {
  it('true only when somebody’s answer would stay behind', () => {
    expect(dropsAnswers({ [ME]: 'yes', [ANA]: 'no' }, 'in', ME, [ME, ANA])).toBe(true);
    expect(dropsAnswers({ [ME]: 'yes' }, 'in', ME, [ME])).toBe(false);
    expect(dropsAnswers({ [ME]: 'yes', [ANA]: 'no' }, 'across', ME, [ME])).toBe(true);
    expect(dropsAnswers({ [ME]: 'yes', [ANA]: 'no' }, 'across', ME, [ME, ANA])).toBe(false);
    expect(dropsAnswers({ [ME]: 'yes', [ANA]: 'no' }, 'out', ME, [])).toBe(false);
    expect(dropsAnswers(undefined, 'across', ME, [])).toBe(false);
  });
});

describe('inviteCandidates', () => {
  const from = [ME, ANA, BOB, DAN];
  const to = [ME, BOB, EVE];

  it('the people on the event — assigned or answered — in the old group and not in the new one', () => {
    expect(inviteCandidates({ assigneeIds: [ANA, BOB], rsvps: { [DAN]: 'yes', [BOB]: 'no' } }, from, to, ME)).toEqual([ANA, DAN]);
  });

  it('each field on its own counts: the list, the older single field, the answers', () => {
    expect(inviteCandidates({ assigneeIds: [ANA] }, from, to, ME)).toEqual([ANA]);
    expect(inviteCandidates({ assigneeId: DAN }, from, to, ME)).toEqual([DAN]);
    expect(inviteCandidates({ rsvps: { [ANA]: 'maybe' } }, from, to, ME)).toEqual([ANA]);
  });

  it('never the mover, never the assistant, nobody already in the new group, nobody outside the old one', () => {
    expect(inviteCandidates({
      assigneeIds: [ME, AI_ASSIGNEE, BOB, 'uid-stranger'], rsvps: { [ME]: 'yes', [EVE]: 'yes' },
    }, from, to, ME)).toEqual([]);
  });

  it('never the mover, even when the new group’s list does not have them yet (a list read before they joined)', () => {
    expect(inviteCandidates({ assigneeIds: [ME, ANA] }, from, [BOB], ME)).toEqual([ANA]);
  });

  it('malformed fields name nobody', () => {
    expect(inviteCandidates({ assigneeIds: 'uid-ana', assigneeId: 3, rsvps: [ANA] }, from, to, ME)).toEqual([]);
  });
});

describe('uidInvite', () => {
  it('a uid and NO address: the only shape the rules let its recipient read by uid', () => {
    expect(uidInvite(ME, 'me@x.test', ANA, 'g2', 'Two', '2026-10-05T12:00:00.000Z')).toEqual({
      fromId: ME, fromEmail: 'me@x.test', toId: ANA, toEmail: null, groupId: 'g2', groupName: 'Two',
      status: 'pending', createdAt: '2026-10-05T12:00:00.000Z',
    });
  });
});
