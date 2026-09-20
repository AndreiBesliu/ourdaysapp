// src/screens/Chat.tsx
// The chat tab: conversations on the left, the conversation on the right.
//
// ── The two layouts are one layout ────────────────────────────────────────────────────
//
// Desktop shows both panes side by side. Mobile shows exactly one — the list until you pick
// something, the conversation after — with a back control that clears the selection.
//
// That is the same state in both cases (`selected`), and the difference is only which panes are
// allowed to be on screen at a width. Rendering two different trees would mean two sets of
// listeners, two scroll positions, and a conversation that forgets where it was when a phone is
// turned sideways.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, query, where } from 'firebase/firestore';
import { ArrowLeft, MessageCircle, Plus, Users, X } from 'lucide-react';
import { auth, db } from '../firebase';
import { liveDoc, liveQuery } from '../utils/liveQuery';
import { reportError } from '../reportError';
import { openDirectChat } from '../serverActions';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import GroupChatWidget from '../components/GroupChatWidget';
import { useDialog } from '../hooks/useDialog';
import {
  buildConversations, conversationKey, findConversation, personName, startableWith,
  type Conversation, type People,
} from '../utils/conversations';

export default function Chat() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const uid = auth.currentUser?.uid || '';

  const [groups, setGroups] = useState<any[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  const [people, setPeople] = useState<People>({});
  const [friends, setFriends] = useState<{ uid?: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);

  // ── the two collections ────────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return;

    const unsubGroups = liveQuery<any>(
      query(collection(db, 'groups'), where('members', 'array-contains', uid)),
      'Chat.groups',
      (docs) => { setLoadError(false); setGroups(docs); },
      () => setLoadError(true),
    );

    const unsubChats = liveQuery<any>(
      query(collection(db, 'chats'), where('members', 'array-contains', uid)),
      'Chat.chats',
      (docs) => setChats(docs),
      // Deliberately does not set the error banner: a group list that loaded is still a usable
      // screen, and blanking it because the private chats failed would hide what did work.
      () => {},
    );

    const unsubMe = liveDoc<any>(
      doc(db, 'users', uid), 'Chat.me',
      (data) => setFriends(Array.isArray(data?.friends) ? data.friends : []),
      () => setFriends([]),
    );

    return () => { unsubGroups(); unsubChats(); unsubMe(); };
  }, [uid]);

  // ── the people in them ─────────────────────────────────────────────────────
  //
  // Read from `profiles`, the public mirror — `users` is owner-only. One pass over every id that
  // appears in either collection, so a name is never missing from one list and present in another.
  const peopleKey = useMemo(() => {
    const ids = new Set<string>();
    groups.forEach((g) => (g.members || []).forEach((m: string) => ids.add(m)));
    chats.forEach((c) => (c.members || []).forEach((m: string) => ids.add(m)));
    friends.forEach((f) => f?.uid && ids.add(f.uid));
    ids.delete(uid);
    return [...ids].sort().join(',');
  }, [groups, chats, friends, uid]);

  useEffect(() => {
    const ids = peopleKey ? peopleKey.split(',') : [];
    if (ids.length === 0) return;
    let cancelled = false;

    (async () => {
      const next: People = {};
      // Each read is guarded on its own: one refusal used to discard every profile already read,
      // which turned a whole screen of names into blanks. Same shape, same reason, as the member
      // map in CalendarHome.
      for (const id of ids) {
        try {
          const snap = await getDoc(doc(db, 'profiles', id));
          if (snap.exists()) next[id] = snap.data() as People[string];
        } catch (err) {
          reportError(err instanceof Error ? err.message : String(err), { context: 'Chat.profile' });
        }
      }
      if (!cancelled) setPeople((prev) => ({ ...prev, ...next }));
    })();

    return () => { cancelled = true; };
  }, [peopleKey]);

  const conversations = useMemo(() => buildConversations({
    groups, chats, people, myUid: uid,
    unknownLabel: t('chatSomeone', language),
    untitledGroup: t('group', language),
  }), [groups, chats, people, uid, language]);

  const active = findConversation(conversations, selected);

  const canStartWith = useMemo(() => startableWith({
    groups, friends, existing: conversations, myUid: uid,
  }), [groups, friends, conversations, uid]);

  const handleStart = async (otherUid: string) => {
    setStarting(true);
    try {
      const { chatId } = await openDirectChat(otherUid);
      setPicking(false);
      setSelected(conversationKey({ kind: 'chat', id: chatId }));
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'Chat.openDirect' });
      setLoadError(true);
    } finally {
      setStarting(false);
    }
  };

  // Which pane a phone is allowed to show. On desktop both are, always.
  const showList = !active;
  const showPane = !!active;

  return (
    <div className="h-[100dvh] flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-3 shrink-0">
        <div className="max-w-6xl w-full mx-auto px-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            aria-label={t('back', language)}
            className="p-1.5 -ml-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-primary">
            <MessageCircle className="w-6 h-6" />
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{t('chatTab', language)}</h1>
          </div>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="bg-rose-50 dark:bg-rose-500/10 px-4 py-2 shrink-0">
          <p className="text-sm text-rose-700 dark:text-rose-300 max-w-6xl mx-auto">{t('chatLoadFailed', language)}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 max-w-6xl w-full mx-auto flex">
        {/* ── conversations ──────────────────────────────────────────────── */}
        <aside className={`${showList ? 'flex' : 'hidden'} md:flex w-full md:w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900`}>
          <div className="p-3 shrink-0">
            <button
              onClick={() => setPicking(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white font-semibold hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              {t('chatNew', language)}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-500 text-center">{t('chatNoConversations', language)}</p>
            ) : conversations.map((c) => (
              <ConversationRow
                key={conversationKey(c)}
                conversation={c}
                people={people}
                myUid={uid}
                language={language}
                active={conversationKey(c) === selected}
                onSelect={() => setSelected(conversationKey(c))}
              />
            ))}
          </div>
        </aside>

        {/* ── the conversation ───────────────────────────────────────────── */}
        <main className={`${showPane ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 flex-col bg-white dark:bg-zinc-900`}>
          {active ? (
            <GroupChatWidget
              // Remounted per conversation on purpose: the pane holds a message list, a draft, a
              // scroll position and a read marker, and carrying any of those across a switch
              // would show one conversation's state inside another.
              key={conversationKey(active)}
              convId={active.id}
              convKind={active.kind}
              title={active.title}
              userMap={people as Record<string, any>}
              members={active.members}
              embedded
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center">
              <p className="text-sm text-zinc-400">{t('chatPickOne', language)}</p>
            </div>
          )}
        </main>
      </div>

      {picking && (
        <StartChatSheet
          candidates={canStartWith}
          people={people}
          language={language}
          busy={starting}
          onPick={handleStart}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Avatar({ name, photoURL, group }: { name: string; photoURL: string | null; group: boolean }) {
  return (
    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden shrink-0">
      {photoURL ? (
        <img src={photoURL} alt="" className="w-full h-full object-cover" />
      ) : group ? (
        <Users className="w-5 h-5 text-zinc-500" aria-hidden="true" />
      ) : (
        <span className="text-sm font-bold text-zinc-500">{(name[0] || '?').toUpperCase()}</span>
      )}
    </div>
  );
}

function ConversationRow({ conversation: c, people, myUid, language, active, onSelect }: {
  conversation: Conversation;
  people: People;
  myUid: string;
  /** Optional because the store holds it as optional; `t()` falls back to English on its own. */
  language?: string;
  active: boolean;
  onSelect: () => void;
}) {
  // "You: …" on your own last message, the way every messenger does it, so a preview is never
  // mistaken for something the other person said.
  const prefix = c.lastBy === myUid
    ? `${t('chatYou', language)}: `
    : c.kind === 'group' && c.lastBy
      ? `${personName(people, c.lastBy, t('chatSomeone', language))}: `
      : '';

  return (
    <button
      aria-label={`${t('chatOpenConversation', language)}: ${c.title}`}
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
        active ? 'bg-primary/10' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      <Avatar name={c.title} photoURL={c.photoURL} group={c.kind === 'group'} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{c.title}</p>
        <p className="text-xs text-zinc-500 truncate">
          {c.lastText ? `${prefix}${c.lastText}` : t('chatNothingYet', language)}
        </p>
      </div>
    </button>
  );
}

function StartChatSheet({ candidates, people, language, busy, onPick, onClose }: {
  candidates: string[];
  people: People;
  language?: string;
  busy: boolean;
  onPick: (uid: string) => void;
  onClose: () => void;
}) {
  // Rendered only while picking, so it is open for exactly as long as it is mounted.
  const { dialogRef, dialogProps } = useDialog(true, onClose, { label: t('chatStartWith', language) });

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef} {...dialogProps}
        className="bg-white dark:bg-zinc-900 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[80vh] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('chatStartWith', language)}</h2>
          <button onClick={onClose} aria-label={t('closeAction', language)} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto">
          {candidates.length === 0 ? (
            // Says what is missing, next to where you pressed — rather than an empty box.
            <p className="px-5 py-6 text-sm text-zinc-500 text-center">{t('chatNobodyToStart', language)}</p>
          ) : candidates.map((uid) => {
            const name = personName(people, uid, t('chatSomeone', language));
            return (
              <button
                aria-label={`${t('chatStartWith', language)} ${name}`}
                key={uid}
                disabled={busy}
                onClick={() => onPick(uid)}
                className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <Avatar name={name} photoURL={people[uid]?.photoURL || null} group={false} />
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
