import { useState, useEffect } from 'react';
import { X, Settings2, Edit2, Check, Trash2, LogOut, UserMinus, UserPlus, AlertTriangle } from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, updateDoc, arrayRemove, collection, addDoc } from 'firebase/firestore';
import { deleteGroupCascade } from '../serverActions';
import { reportError } from '../reportError';
import { liveDoc } from '../utils/liveQuery';
import { useModalBack } from '../hooks/useModalBack';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';


interface GroupSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  isOwner: boolean;
  userMap: Record<string, any>;
  members: string[];
  onSuccess: () => void;
}

export default function GroupSettingsModal({
  isOpen, onClose, groupId, groupName, isOwner, userMap, members, onSuccess
}: GroupSettingsModalProps) {
  const { language } = useThemeStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editedName, setEditedName] = useState(groupName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [friendUids, setFriendUids] = useState<Set<string>>(new Set());
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  useModalBack(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setEditedName(groupName);
      setIsEditingName(false);
      setError('');
      setConfirmDanger(false);
      setSentTo(new Set());
    }
  }, [isOpen, groupName]);

  // My current friends (to hide the add-friend button for people I already have).
  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    const unsub = liveDoc<any>(doc(db, 'users', auth.currentUser.uid), 'GroupSettingsModal.friends',
      (data) => setFriendUids(new Set((data?.friends || []).map((f: any) => f.uid))),
      // Failing open here shows "Add friend" next to people who already are one; the request is
      // idempotent, so the cost is a wasted tap rather than a wrong state.
      () => setFriendUids(new Set()));
    return () => unsub();
  }, [isOpen]);

  const handleAddFriend = async (memberId: string) => {
    if (!auth.currentUser || memberId === auth.currentUser.uid) return;
    const myName = userMap[auth.currentUser.uid]?.name || auth.currentUser.displayName || 'Friend';
    try {
      await addDoc(collection(db, 'friend_requests'), {
        fromId: auth.currentUser.uid,
        fromName: myName,
        fromEmail: auth.currentUser.email?.toLowerCase() || null,
        toId: memberId,
        toEmail: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setSentTo(prev => new Set(prev).add(memberId));
    } catch (err) {
      console.error('Add friend failed', err);
    }
  };

  const handleRename = async () => {
    if (!editedName.trim() || editedName.trim() === groupName) {
      setIsEditingName(false);
      return;
    }
    setLoading(true);
    try {
      await updateDoc(doc(db, 'groups', groupId), { name: editedName.trim() });
      setIsEditingName(false);
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), {
        context: isOwner ? 'GroupSettingsModal.deleteGroup' : 'GroupSettingsModal.leaveGroup',
      });
      setError(isOwner ? t('deleteGroupFailed', language) : t('leaveGroupFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm(t('removeMemberConfirm', language))) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'groups', groupId), {
        members: arrayRemove(memberId)
      });
    } catch (err) {
      setError(t('actionFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrLeave = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    setError('');
    try {
      if (isOwner) {
        // One server call, for the same reason LeaveGroupModal now uses it: `allow delete` on
        // events is owner-only, so a client loop over every event in the group threw on the first
        // one belonging to another member — after destroying some of the owner's own.
        //
        // This entry point never offered a keep-list at all, so it passes none: the caller's own
        // group events go, and every other member's is re-parented to personal rather than
        // deleted. Deleting your group was never a licence to delete their calendar.
        await deleteGroupCascade({ groupId });
      } else {
        // Leave group
        await updateDoc(doc(db, 'groups', groupId), {
          members: arrayRemove(auth.currentUser.uid)
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(t('actionFailed', language));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            {t('groupSettings', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-700 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-6">

          {/* Group Name */}
          <section>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">{t('groupNameLabel', language)}</p>
            <div className="flex items-center gap-2">
              {isEditingName ? (
                <>
                  <input
                    autoFocus
                    value={editedName}
                    onChange={e => setEditedName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsEditingName(false); }}
                    className="flex-1 px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 outline-none focus:border-primary"
                  />
                  <button onClick={handleRename} disabled={loading} className="p-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setIsEditingName(false)} className="p-2 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    {groupName}
                  </span>
                  {isOwner && (
                    <button onClick={() => setIsEditingName(true)} className="p-2 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-zinc-500 hover:text-primary hover:bg-primary/10 transition-colors">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Members */}
          <section>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">{t('membersLabel', language)} ({members.length})</p>
            <div className="flex flex-col gap-2">
              {members.map(memberId => {
                const u = userMap[memberId];
                const isMe = memberId === auth.currentUser?.uid;
                return (
                  <div key={memberId} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
                    <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden shrink-0 text-sm font-bold text-zinc-600 dark:text-zinc-300">
                      {u?.photoURL ? (
                        <img src={u.photoURL} alt={u.name} className="w-full h-full object-cover" />
                      ) : (
                        (u?.name?.[0] || u?.email?.[0] || '?').toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {u?.name || u?.email?.split('@')[0] || 'Unknown'} {isMe && <span className="text-xs text-zinc-400">({t('youLabel', language)})</span>}
                      </p>
                      {u?.email && <p className="text-xs text-zinc-500 truncate">{u.email}</p>}
                    </div>
                    {!isMe && !friendUids.has(memberId) && (
                      sentTo.has(memberId) ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 shrink-0">{t('requestSentShort', language)}</span>
                      ) : (
                        <button
                          onClick={() => handleAddFriend(memberId)}
                          className="p-1.5 text-zinc-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors shrink-0"
                          title={t('addFriendShort', language)}
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                      )
                    )}
                    {isOwner && !isMe && (
                      <button
                        onClick={() => handleRemoveMember(memberId)}
                        disabled={loading}
                        className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                        title={t('removeMember', language)}
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Danger Zone */}
          <section>
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">{t('dangerZone', language)}</p>
            <div className="rounded-xl border border-red-200 dark:border-red-500/20 overflow-hidden">
              {!confirmDanger ? (
                <button
                  onClick={() => setConfirmDanger(true)}
                  className="w-full p-4 flex items-center gap-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-left"
                >
                  {isOwner ? <Trash2 className="w-5 h-5 shrink-0" /> : <LogOut className="w-5 h-5 shrink-0" />}
                  <div>
                    <p className="font-semibold text-sm">{isOwner ? t('deleteGroup', language) : t('leaveGroup', language)}</p>
                    <p className="text-xs text-red-400/80 mt-0.5">
                      {isOwner ? t('deleteGroupDesc', language) : t('leaveGroupDesc', language)}
                    </p>
                  </div>
                </button>
              ) : (
                <div className="p-4 bg-red-50 dark:bg-red-500/10">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                      {t('confirmCannotUndo', language)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDanger(false)} className="flex-1 py-2 text-sm font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors">
                      {t('cancel', language)}
                    </button>
                    <button
                      onClick={handleDeleteOrLeave}
                      disabled={loading}
                      className="flex-1 py-2 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {loading
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : isOwner ? t('deleteGroup', language) : t('leaveGroup', language)
                      }
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
