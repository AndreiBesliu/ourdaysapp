// src/utils/conversations.ts
// One list out of two collections.
//
// A group chat lives at `groups/{id}/messages` and a private one at `chats/{id}/messages`. They
// are separate collections on purpose — a direct chat is NOT a two-person group, because thirteen
// places in this app list groups by membership and every one of them would have to learn to skip
// a kind of group it has never heard of (see `functions/src/directChat.ts`).
//
// The cost of that decision is paid here, once: the screen wants a single sorted list, so this is
// where the two are merged. Everything downstream sees one shape.
//
// Pure: no React, no Firestore.

export type ConversationKind = 'group' | 'chat';

export interface Conversation {
  /** Group id or chat id. Unique WITHIN a kind, so the React key has to include the kind. */
  id: string;
  kind: ConversationKind;
  /** The group's name, or the other person's. */
  title: string;
  members: string[];
  /** Epoch ms of the last message, or 0 when nothing has been said. */
  lastAt: number;
  /** A one-line preview, already trimmed by the server. */
  lastText: string;
  lastBy: string | null;
  /** The other person, for a direct chat. Null for a group. */
  otherUid: string | null;
  photoURL: string | null;
}

export interface RawGroup {
  id: string;
  name?: unknown;
  members?: unknown;
  lastMessageAt?: unknown;
  lastMessageText?: unknown;
  lastMessageBy?: unknown;
}

export interface RawChat {
  id: string;
  members?: unknown;
  lastMessageAt?: unknown;
  lastMessageText?: unknown;
  lastMessageBy?: unknown;
}

/** What the screen knows about people: `profiles` merged with the caller's own user doc. */
export type People = Record<string, { name?: string; email?: string; photoURL?: string } | undefined>;

/**
 * Firestore hands timestamps back in three shapes depending on where they came from: a
 * `Timestamp` with `toMillis`, a plain number from an optimistic local write, or `null` while a
 * `serverTimestamp()` is still pending. All three have to sort.
 */
export function millisOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const maybe = value as { toMillis?: () => number; seconds?: number } | null | undefined;
  if (maybe && typeof maybe.toMillis === 'function') {
    const ms = maybe.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (maybe && typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  return 0;
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** What to call somebody, in the order the app already uses elsewhere. */
export function personName(people: People, uid: string, unknownLabel: string): string {
  const p = people[uid];
  const name = (p?.name || '').trim();
  if (name) return name;
  const email = (p?.email || '').trim();
  if (email) return email.split('@')[0];
  return unknownLabel;
}

/**
 * Merge groups and direct chats into one list, newest conversation first.
 *
 * `unknownLabel` and `untitledGroup` are passed in already translated: this module must not import
 * `t`, or it could not be tested without the dictionary.
 */
export function buildConversations(args: {
  groups: RawGroup[];
  chats: RawChat[];
  people: People;
  myUid: string;
  unknownLabel: string;
  untitledGroup: string;
}): Conversation[] {
  const { groups, chats, people, myUid, unknownLabel, untitledGroup } = args;

  const fromGroups: Conversation[] = groups
    .filter((g) => !!g?.id)
    .map((g) => ({
      id: g.id,
      kind: 'group' as const,
      title: str(g.name).trim() || untitledGroup,
      members: strList(g.members),
      lastAt: millisOf(g.lastMessageAt),
      lastText: str(g.lastMessageText),
      lastBy: typeof g.lastMessageBy === 'string' ? g.lastMessageBy : null,
      otherUid: null,
      photoURL: null,
    }));

  const fromChats: Conversation[] = chats
    .filter((c) => !!c?.id)
    .map((c) => {
      const members = strList(c.members);
      // A chat always has two members; `find` rather than `[1]` because the order is whatever the
      // server sorted it into, and a malformed document should degrade rather than mislabel.
      const other = members.find((m) => m !== myUid) ?? null;
      return {
        id: c.id,
        kind: 'chat' as const,
        title: other ? personName(people, other, unknownLabel) : unknownLabel,
        members,
        lastAt: millisOf(c.lastMessageAt),
        lastText: str(c.lastMessageText),
        lastBy: typeof c.lastMessageBy === 'string' ? c.lastMessageBy : null,
        otherUid: other,
        photoURL: (other && people[other]?.photoURL) || null,
      };
    });

  return [...fromGroups, ...fromChats].sort((a, b) => {
    if (b.lastAt !== a.lastAt) return b.lastAt - a.lastAt;
    // A stable tie-break matters more than which way it goes: without one, two conversations that
    // have never been used swap places on every render, and the list flickers.
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.id.localeCompare(b.id);
  });
}

/** The key a list item needs. Ids are unique per collection, not across both. */
export function conversationKey(c: Pick<Conversation, 'kind' | 'id'>): string {
  return `${c.kind}:${c.id}`;
}

export function findConversation(
  list: Conversation[], key: string | null,
): Conversation | null {
  if (!key) return null;
  return list.find((c) => conversationKey(c) === key) ?? null;
}

/**
 * People you could start a new conversation with: everybody you share a group with, plus your
 * friends — minus yourself and minus anyone you already have a chat with.
 *
 * Exactly the set `openDirectChat` will accept, so the picker cannot offer somebody the server
 * will then refuse. A control that offers a choice and fails on it is worse than one that does
 * not offer it.
 */
export function startableWith(args: {
  groups: RawGroup[];
  friends: { uid?: unknown }[];
  existing: Conversation[];
  myUid: string;
}): string[] {
  const { groups, friends, existing, myUid } = args;

  const already = new Set(
    existing.filter((c) => c.kind === 'chat' && c.otherUid).map((c) => c.otherUid as string),
  );

  const out: string[] = [];
  const seen = new Set<string>([myUid]);
  const consider = (uid: unknown) => {
    if (typeof uid !== 'string' || !uid || seen.has(uid) || already.has(uid)) return;
    seen.add(uid);
    out.push(uid);
  };

  groups.forEach((g) => strList(g.members).forEach(consider));
  friends.forEach((f) => consider(f?.uid));
  return out;
}
