// src/utils/conversations.test.ts

import { describe, it, expect } from 'vitest';
import {
  buildConversations, conversationKey, findConversation, millisOf, personName, startableWith,
} from './conversations';

const ME = 'uid-me';
const ANA = 'uid-ana';
const BOB = 'uid-bob';

const PEOPLE = {
  [ME]: { name: 'Me' },
  [ANA]: { name: 'Ana', photoURL: 'https://x/ana.jpg' },
  [BOB]: { email: 'bob@example.test' },
};

const build = (groups: any[], chats: any[]) => buildConversations({
  groups, chats, people: PEOPLE, myUid: ME,
  unknownLabel: 'Someone', untitledGroup: 'Group',
});

describe('millisOf — three shapes, all of which have to sort', () => {
  it('a Firestore Timestamp', () => {
    expect(millisOf({ toMillis: () => 1700 })).toBe(1700);
  });

  it('a plain number, which is what an optimistic local write leaves', () => {
    expect(millisOf(1700)).toBe(1700);
  });

  it('a pending serverTimestamp is zero, not NaN', () => {
    // Firestore returns null between the local write and the server ack. NaN here would poison
    // the sort comparator and scramble the whole list for a second.
    expect(millisOf(null)).toBe(0);
    expect(millisOf(undefined)).toBe(0);
  });

  it('the raw {seconds} shape some reads produce', () => {
    expect(millisOf({ seconds: 2 })).toBe(2000);
  });

  it('rubbish is zero', () => {
    expect(millisOf('yesterday')).toBe(0);
    expect(millisOf({ toMillis: () => NaN })).toBe(0);
  });
});

describe('building the list', () => {
  it('a direct chat is titled with the OTHER person', () => {
    const [c] = build([], [{ id: 'c1', members: [ME, ANA] }]);
    expect(c.title).toBe('Ana');
    expect(c.otherUid).toBe(ANA);
    expect(c.photoURL).toBe('https://x/ana.jpg');
  });

  it('falls back to the email local part, then to a label', () => {
    expect(build([], [{ id: 'c1', members: [ME, BOB] }])[0].title).toBe('bob');
    expect(build([], [{ id: 'c1', members: [ME, 'nobody'] }])[0].title).toBe('Someone');
  });

  it('a group keeps its own name, and an unnamed one is not blank', () => {
    expect(build([{ id: 'g1', name: 'Family', members: [ME, ANA] }], [])[0].title).toBe('Family');
    expect(build([{ id: 'g1', name: '   ', members: [ME] }], [])[0].title).toBe('Group');
  });

  it('mixes both kinds and sorts newest first', () => {
    const list = build(
      [{ id: 'g1', name: 'Family', members: [ME, ANA], lastMessageAt: 100 }],
      [{ id: 'c1', members: [ME, ANA], lastMessageAt: 300 },
       { id: 'c2', members: [ME, BOB], lastMessageAt: 200 }],
    );
    expect(list.map((c) => `${c.kind}:${c.id}`)).toEqual(['chat:c1', 'chat:c2', 'group:g1']);
  });

  it('conversations nobody has used yet are ordered stably, not at random', () => {
    // Without a tie-break, two zero-timestamp rows swap on every render and the list flickers.
    const once = build([{ id: 'gB', name: 'Beta', members: [ME] }, { id: 'gA', name: 'Alpha', members: [ME] }], []);
    const twice = build([{ id: 'gA', name: 'Alpha', members: [ME] }, { id: 'gB', name: 'Beta', members: [ME] }], []);
    expect(once.map((c) => c.id)).toEqual(twice.map((c) => c.id));
    expect(once.map((c) => c.title)).toEqual(['Alpha', 'Beta']);
  });

  it('survives a malformed document instead of dropping the whole list', () => {
    const list = build(
      [{ id: 'g1', members: 'not an array' as unknown }],
      [{ id: 'c1', members: [ME] }],
    );
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.id === 'g1')!.members).toEqual([]);
    // A chat with only me in it has no other person; it must not claim to be from somebody.
    expect(list.find((c) => c.id === 'c1')!.title).toBe('Someone');
  });

  it('drops rows with no id rather than rendering a keyless item', () => {
    expect(build([{ id: '' } as any], [])).toEqual([]);
  });
});

describe('keys', () => {
  it('include the kind, because ids are only unique per collection', () => {
    // A group and a chat could genuinely share an id; a bare id as the React key would collapse
    // the two rows into one.
    expect(conversationKey({ kind: 'group', id: 'x' })).not.toBe(conversationKey({ kind: 'chat', id: 'x' }));
  });

  it('find the right one back', () => {
    const list = build([{ id: 'x', name: 'G', members: [ME] }], [{ id: 'x', members: [ME, ANA] }]);
    expect(findConversation(list, 'chat:x')!.title).toBe('Ana');
    expect(findConversation(list, 'group:x')!.title).toBe('G');
    expect(findConversation(list, 'group:nope')).toBeNull();
    expect(findConversation(list, null)).toBeNull();
  });
});

describe('who you can start a new conversation with', () => {
  it('people from your groups and your friends', () => {
    const who = startableWith({
      groups: [{ id: 'g1', members: [ME, ANA] }],
      friends: [{ uid: BOB }],
      existing: [],
      myUid: ME,
    });
    expect(who).toEqual([ANA, BOB]);
  });

  it('never yourself', () => {
    expect(startableWith({ groups: [{ id: 'g1', members: [ME] }], friends: [{ uid: ME }], existing: [], myUid: ME }))
      .toEqual([]);
  });

  it('not somebody you already have a chat with', () => {
    const existing = build([], [{ id: 'c1', members: [ME, ANA] }]);
    expect(startableWith({ groups: [{ id: 'g1', members: [ME, ANA, BOB] }], friends: [], existing, myUid: ME }))
      .toEqual([BOB]);
  });

  it('no duplicates when somebody is both a friend and in a group', () => {
    expect(startableWith({ groups: [{ id: 'g1', members: [ME, ANA] }], friends: [{ uid: ANA }], existing: [], myUid: ME }))
      .toEqual([ANA]);
  });

  it('is exactly what the server would accept, so the picker cannot offer a refusal', () => {
    // `openDirectChat` allows a friend OR somebody you share a group with. Offering anyone else
    // would be a control that fails when pressed.
    const who = startableWith({ groups: [{ id: 'g1', members: [ME, ANA] }], friends: [{ uid: BOB }], existing: [], myUid: ME });
    expect(who).not.toContain('a-stranger');
  });

  it('ignores malformed friend rows', () => {
    expect(startableWith({ groups: [], friends: [{}, { uid: 3 as unknown }, { uid: ANA }], existing: [], myUid: ME }))
      .toEqual([ANA]);
  });
});

describe('personName', () => {
  it('name, then email local part, then the label', () => {
    expect(personName(PEOPLE, ANA, '?')).toBe('Ana');
    expect(personName(PEOPLE, BOB, '?')).toBe('bob');
    expect(personName(PEOPLE, 'ghost', '?')).toBe('?');
    expect(personName({ x: { name: '   ' } }, 'x', '?')).toBe('?');
  });
});
