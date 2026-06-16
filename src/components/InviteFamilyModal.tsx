import { useState, useEffect } from 'react';
import { X, UserPlus, Mail, AlertCircle, CheckCircle2, Share2, Check, Users } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc, doc, onSnapshot } from 'firebase/firestore';
import { useModalBack } from '../hooks/useModalBack';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';

interface Friend { uid: string; name?: string; email?: string }

interface InviteFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId?: string;
  groupName?: string;
  memberIds?: string[];
}

export default function InviteFamilyModal({ isOpen, onClose, groupId, groupName, memberIds = [] }: InviteFamilyModalProps) {
  const { language } = useThemeStore();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useModalBack(isOpen, onClose);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset transient state when the modal opens or the target group changes, so a
  // selection made for one group can't carry over to another.
  useEffect(() => {
    if (isOpen) { setSelected(new Set()); setError(''); setSuccess(''); setEmail(''); }
  }, [isOpen, groupId]);

  // Load my friends so I can invite them with one tap.
  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    const unsub = onSnapshot(doc(db, 'users', auth.currentUser.uid), (snap) => {
      const data = snap.data();
      setFriends(Array.isArray(data?.friends) ? data!.friends : []);
    });
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const toggle = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const createInvite = async (toEmail: string, toId: string | null) => {
    await addDoc(collection(db, 'group_invites'), {
      fromId: auth.currentUser!.uid,
      fromEmail: auth.currentUser!.email,
      toId,
      toEmail: toEmail.toLowerCase(),
      groupId: groupId || null,
      groupName: groupName || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  };

  const handleInviteFriends = async () => {
    if (!auth.currentUser || selected.size === 0) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const chosen = friends.filter(f => selected.has(f.uid) && f.email);
      for (const f of chosen) {
        await createInvite(f.email!, f.uid);
      }
      setSuccess(t('inviteSentMsg', language));
      setSelected(new Set());
    } catch (err) {
      console.error('Invite friends error:', err);
      setError(t('requestAlreadyPending', language));
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !auth.currentUser) return;
    if (email.toLowerCase() === auth.currentUser.email?.toLowerCase()) {
      setError(t('cannotFriendSelf', language));
      return;
    }
    setLoading(true); setError(''); setSuccess('');
    try {
      await createInvite(email, null);
      setSuccess(t('inviteSentMsg', language));
      setEmail('');
    } catch (err) {
      console.error('Invite error:', err);
      setError(t('requestAlreadyPending', language));
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    const text = `Hey! I've invited you to join my group "${groupName || 'Group'}" on Our Days.\n\nSign up or log in at https://our-days-2a939.web.app with your email to accept the invite!`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my group on Our Days', text }); }
      catch (err) { console.error('Error sharing', err); }
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  const invitableFriends = friends.filter(f => f.email);

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm flex flex-col max-h-[90vh] shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">

        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            {t('invite', language)} · {groupName || t('group', language)}
          </h3>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Invite friends */}
          {invitableFriends.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {t('inviteFriends', language)}
              </h4>
              <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                {invitableFriends.map((f) => {
                  const inGroup = memberIds.includes(f.uid);
                  const isSel = selected.has(f.uid);
                  return (
                    <button
                      key={f.uid}
                      onClick={() => !inGroup && toggle(f.uid)}
                      disabled={inGroup}
                      className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border text-left transition-colors ${inGroup ? 'opacity-50 border-zinc-200 dark:border-zinc-800' : isSel ? 'border-primary bg-primary/5' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{f.name || f.email}</p>
                        {f.email && <p className="text-xs text-zinc-500 truncate">{f.email}</p>}
                      </div>
                      {inGroup ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 shrink-0">{t('inGroupLabel', language)}</span>
                      ) : (
                        <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${isSel ? 'bg-primary border-primary text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>
                          {isSel && <Check className="w-3.5 h-3.5" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleInviteFriends}
                disabled={loading || selected.size === 0}
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {t('invite', language)}{selected.size > 0 ? ` (${selected.size})` : ''}
              </button>
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-400">{t('orInviteByEmail', language)}</span>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              </div>
            </div>
          )}

          {/* Invite by email */}
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-5 h-5 text-zinc-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('friendEmailPlaceholder', language)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {t('invite', language)}
            </button>
          </form>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="flex flex-col gap-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm rounded-lg flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{success}</p>
              </div>
              <button
                type="button"
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors font-medium text-sm"
              >
                <Share2 className="w-4 h-4" />
                {t('shareInvite', language)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
