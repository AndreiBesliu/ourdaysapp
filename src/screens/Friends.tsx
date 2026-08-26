import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, doc, addDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { liveQuery, liveDoc } from '../utils/liveQuery';
import { db, auth } from '../firebase';
import { ArrowLeft, UserPlus, Mail, Check, X, Users, Clock, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { respondToFriendRequest, removeFriend } from '../serverActions';

interface Friend { uid: string; name?: string; email?: string }
interface FriendRequest { id: string; fromId: string; fromName?: string; fromEmail?: string; toId?: string | null; toEmail?: string | null; status: string }

export default function Friends() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const [tab, setTab] = useState<'friends' | 'requests'>('friends');

  const [friends, setFriends] = useState<Friend[]>([]);
  const [myName, setMyName] = useState('');
  const [incomingById, setIncomingById] = useState<FriendRequest[]>([]);
  const [incomingByEmail, setIncomingByEmail] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  // One flag per listener. There used to be a single `requestsLoadError` raised by all four and
  // rendered in one place, which made it dead code for three of them: a failed friend-list read
  // showed nothing, a failed outgoing read showed nothing, and — worse — a SUCCESSFUL incoming
  // snapshot cleared a flag raised by a different query on a different collection. A shared flag
  // is not a shortcut, it is four bugs.
  const [friendsLoadError, setFriendsLoadError] = useState(false);
  const [incomingLoadError, setIncomingLoadError] = useState(false);
  const [outgoingLoadError, setOutgoingLoadError] = useState(false);
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const myEmail = auth.currentUser?.email?.toLowerCase() || '';

  // My own user doc → friends array + name.
  useEffect(() => {
    if (!auth.currentUser) return;
    const unsub = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'Friends.myUserDoc',
      (data) => {
        setFriendsLoadError(false);
        setFriends(Array.isArray(data?.friends) ? data.friends : []);
        setMyName(data?.name || auth.currentUser?.displayName || (myEmail.split('@')[0] || 'Me'));
      },
      // The friend list going blank is the same lie as everywhere else on this screen.
      () => setFriendsLoadError(true));
    return () => unsub();
  }, [myEmail]);

  // Incoming requests (by uid and by email), pending only.
  useEffect(() => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const qId = query(collection(db, 'friend_requests'), where('toId', '==', uid), where('status', '==', 'pending'));
    // A friend request you were never shown is indistinguishable from one nobody sent, and the
    // person waiting on your answer cannot tell either.
    const unsubId = liveQuery<any>(qId, 'Friends.incomingById',
      (docs) => { setIncomingLoadError(false); setIncomingById(docs); },
      () => setIncomingLoadError(true));
    let unsubEmail = () => {};
    if (myEmail) {
      const qEmail = query(collection(db, 'friend_requests'), where('toEmail', '==', myEmail), where('status', '==', 'pending'));
      unsubEmail = liveQuery<any>(qEmail, 'Friends.incomingByEmail',
        (docs) => setIncomingByEmail(docs),
        () => setIncomingLoadError(true));
    }
    return () => { unsubId(); unsubEmail(); };
  }, [myEmail]);

  // Outgoing pending requests I sent.
  useEffect(() => {
    if (!auth.currentUser) return;
    const qOut = query(collection(db, 'friend_requests'), where('fromId', '==', auth.currentUser.uid), where('status', '==', 'pending'));
    const unsub = liveQuery<any>(qOut, 'Friends.outgoing',
      (docs) => { setOutgoingLoadError(false); setOutgoing(docs); },
      () => setOutgoingLoadError(true));
    return () => unsub();
  }, []);

  // Merge + dedupe incoming (a request can match by both uid and email).
  const incoming = (() => {
    const map = new Map<string, FriendRequest>();
    [...incomingById, ...incomingByEmail].forEach(r => { if (r.fromId !== auth.currentUser?.uid) map.set(r.id, r); });
    return Array.from(map.values());
  })();

  // Fetch avatars for the uids we display (friends + incoming senders).
  useEffect(() => {
    const ids = new Set<string>();
    friends.forEach(f => f.uid && ids.add(f.uid));
    incoming.forEach(r => r.fromId && ids.add(r.fromId));
    const missing = Array.from(ids).filter(id => !(id in photoMap));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(missing.map(async (id) => {
        try {
          const p = await getDoc(doc(db, 'profiles', id));
          updates[id] = p.exists() ? (p.data()?.photoURL || '') : '';
        } catch { updates[id] = ''; }
      }));
      if (!cancelled) setPhotoMap(prev => ({ ...prev, ...updates }));
    })();
    return () => { cancelled = true; };
  }, [friends, incoming.length]);

  const sendRequest = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!auth.currentUser) return;
    const target = email.trim().toLowerCase();
    setError(''); setSuccess('');
    if (!target) return;
    if (target === myEmail) { setError(t('cannotFriendSelf', language)); return; }
    if (friends.some(f => f.email?.toLowerCase() === target)) { setError(t('alreadyFriendsMsg', language)); return; }
    if (outgoing.some(r => r.toEmail === target)) { setError(t('requestAlreadyPending', language)); return; }
    setBusy(true);
    try {
      await addDoc(collection(db, 'friend_requests'), {
        fromId: auth.currentUser.uid,
        fromName: myName,
        fromEmail: myEmail || null,
        toId: null,
        toEmail: target,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setSuccess(t('friendRequestSent', language));
      setEmail('');
    } catch (err) {
      console.error('Friend request failed', err);
      setError(t('requestAlreadyPending', language));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (id: string, accept: boolean) => {
    setBusy(true);
    try { await respondToFriendRequest({ requestId: id, accept }); }
    catch (err) {
      console.error('Respond failed', err);
      if (accept && !auth.currentUser?.emailVerified) { setError(t('verifyEmailDesc', language)); setSuccess(''); }
    }
    finally { setBusy(false); }
  };

  const cancelOutgoing = async (id: string) => {
    try { await deleteDoc(doc(db, 'friend_requests', id)); }
    catch (err) { console.error('Cancel failed', err); }
  };

  const unfriend = async (uid: string) => {
    setBusy(true);
    try { await removeFriend(uid); }
    catch (err) { console.error('Unfriend failed', err); }
    finally { setBusy(false); }
  };

  const Avatar = ({ uid, name }: { uid?: string; name?: string }) => {
    const url = uid ? photoMap[uid] : '';
    return (
      <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden shrink-0">
        {url ? <img src={url} alt={name} className="w-full h-full object-cover" /> :
          <span className="text-sm font-bold text-zinc-500">{(name?.[0] || '?').toUpperCase()}</span>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-transparent pt-[60px]">
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-3 fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
        <div className="max-w-2xl w-full mx-auto px-4 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> {t('friendsTitle', language)}
          </h1>
        </div>
      </header>

      <main className="max-w-2xl w-full mx-auto p-4 flex flex-col gap-5">
        {/* Add a friend */}
        <form onSubmit={sendRequest} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> {t('addFriendTitle', language)}
          </h2>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-2.5 w-5 h-5 text-zinc-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('friendEmailPlaceholder', language)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <button type="submit" disabled={busy || !email.trim()} className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
              {t('sendRequest', language)}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-500 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
          {success && <p className="mt-2 text-sm text-emerald-500 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {success}</p>}
        </form>

        {/* Tabs */}
        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-xl w-fit">
          <button onClick={() => setTab('friends')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'friends' ? 'bg-white dark:bg-zinc-700 shadow-sm text-primary' : 'text-zinc-500'}`}>
            {t('friendsTab', language)} {friends.length > 0 ? `(${friends.length})` : ''}
          </button>
          <button onClick={() => setTab('requests')} className={`relative px-5 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'requests' ? 'bg-white dark:bg-zinc-700 shadow-sm text-primary' : 'text-zinc-500'}`}>
            {t('requestsTab', language)}
            {incoming.length > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{incoming.length}</span>}
          </button>
        </div>

        {/* Friends list */}
        {tab === 'friends' && (
          <div className="flex flex-col gap-2">
            {friends.length === 0 ? (
              <p className={`text-center text-sm py-10 ${friendsLoadError ? 'text-rose-500' : 'text-zinc-500'}`}>
                {friendsLoadError ? t('friendsLoadFailed', language) : t('noFriendsYet', language)}
              </p>
            ) : friends.map((f) => (
              <div key={f.uid} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar uid={f.uid} name={f.name} />
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{f.name || f.email}</p>
                    {f.email && <p className="text-xs text-zinc-500 truncate">{f.email}</p>}
                  </div>
                </div>
                <button onClick={() => unfriend(f.uid)} disabled={busy} className="p-2 text-zinc-400 hover:text-red-500 transition-colors shrink-0" title={t('removeFriendLabel', language)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Requests */}
        {tab === 'requests' && (
          <div className="flex flex-col gap-5">
            {/* Incoming */}
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">{t('incomingLabel', language)}</h3>
              {incoming.length === 0 ? (
                // "Nobody asked" and "we could not check" are the same picture otherwise, and the
                // person waiting on an answer is the one who pays for the confusion.
                <p className={`text-sm ${incomingLoadError ? 'text-rose-500' : 'text-zinc-500'}`}>
                  {incomingLoadError ? t('requestsLoadFailed', language) : t('noRequestsYet', language)}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {incoming.map((r) => (
                    <div key={r.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar uid={r.fromId} name={r.fromName} />
                        <div className="min-w-0">
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{r.fromName || r.fromEmail}</p>
                          {r.fromEmail && <p className="text-xs text-zinc-500 truncate">{r.fromEmail}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => respond(r.id, true)} disabled={busy} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-md text-sm font-medium flex items-center gap-1">
                          <Check className="w-4 h-4" /> {t('accept', language)}
                        </button>
                        <button onClick={() => respond(r.id, false)} disabled={busy} className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md text-sm font-medium flex items-center gap-1">
                          <X className="w-4 h-4" /> {t('decline', language)}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outgoing */}
            {/* Rendered when the read FAILED as well as when there is something to show — an
                invitation you sent must not disappear from your own screen without a word. */}
            {outgoingLoadError && (
              <p role="alert" className="text-sm text-rose-500">{t('outgoingLoadFailed', language)}</p>
            )}
            {outgoing.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">{t('sentLabel', language)}</h3>
                <div className="flex flex-col gap-2">
                  {outgoing.map((r) => (
                    <div key={r.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 text-zinc-500">
                        <Clock className="w-4 h-4 shrink-0" />
                        <p className="text-sm truncate">{r.toEmail}</p>
                      </div>
                      <button onClick={() => cancelOutgoing(r.id)} className="px-3 py-1.5 text-zinc-500 hover:text-red-500 text-sm font-medium transition-colors shrink-0">
                        {t('cancel', language)}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
