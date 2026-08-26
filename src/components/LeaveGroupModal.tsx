import { useState, useEffect } from 'react';
import { X, LogOut, AlertTriangle, CheckSquare, Square, Trash2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, updateDoc, arrayRemove, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { deleteGroupCascade } from '../serverActions';
import { reportError } from '../reportError';
import { useModalBack } from '../hooks/useModalBack';
import { format } from 'date-fns';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';

interface LeaveGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  isOwner: boolean;
  onSuccess: () => void;
}

export default function LeaveGroupModal({ isOpen, onClose, groupId, groupName, isOwner, onSuccess }: LeaveGroupModalProps) {
  const { language } = useThemeStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [involvedEvents, setInvolvedEvents] = useState<any[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [fetchingEvents, setFetchingEvents] = useState(false);
  // Distinguishes "the list is empty" from "we could not read the list". Without it, a rejected
  // read rendered "you are not part of any upcoming events" and the delete button below it stayed
  // live — with an empty keep-set, which means "delete all of mine".
  const [eventsLoaded, setEventsLoaded] = useState(false);

  useModalBack(isOpen, onClose);

  useEffect(() => {
    if (isOpen && groupId && auth.currentUser) {
      fetchInvolvedEvents();
    } else {
      setInvolvedEvents([]);
      setSelectedEventIds(new Set());
      setError('');
    }
  }, [isOpen, groupId]);

  const fetchInvolvedEvents = async () => {
    if (!auth.currentUser || !groupId) return;
    setFetchingEvents(true);
    setEventsLoaded(false);
    try {
      const q = query(collection(db, 'events'), where('groupId', '==', groupId));
      const snapshot = await getDocs(q);
      const allGroupEvents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Filter events the user is a part of
      const involved = allGroupEvents.filter((ev: any) => {
        const isOwnerOfEvent = ev.ownerId === auth.currentUser?.uid;
        const isAssignee = ev.assigneeId === auth.currentUser?.uid || (ev.assigneeIds && ev.assigneeIds.includes(auth.currentUser?.uid));
        return isOwnerOfEvent || isAssignee;
      });

      // Sort by date
      involved.sort((a: any, b: any) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

      setInvolvedEvents(involved);
      // Auto-select all by default
      setSelectedEventIds(new Set(involved.map(e => e.id)));
      setEventsLoaded(true);
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'LeaveGroupModal.fetchInvolvedEvents' });
      setError(t('leaveGroupEventsFailed', language));
    } finally {
      setFetchingEvents(false);
    }
  };

  const toggleEvent = (id: string) => {
    const newSet = new Set(selectedEventIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedEventIds(newSet);
  };

  const handleAction = async () => {
    if (!auth.currentUser || !groupId) return;
    setLoading(true);
    setError('');

    try {
      if (isOwner) {
        // The whole teardown is one server call now. It used to be a client loop that deleted
        // every event in the group; `allow delete` on events is owner-only, so the first event
        // belonging to another member threw — after some of the owner's own were already gone,
        // and before the invites or the group document were touched. It could not complete, and
        // every retry destroyed a little more.
        //
        // The server deletes only the caller's own unkept events and re-parents everyone else's
        // to personal, so losing the group does not lose anybody else's data.
        await deleteGroupCascade({ groupId, keepEventIds: Array.from(selectedEventIds) });
      } else {
        // LEAVE GROUP FLOW
        // 1. For kept events, create a personal copy
        for (const ev of involvedEvents) {
          if (selectedEventIds.has(ev.id)) {
            const { id, ...eventData } = ev;
            await addDoc(collection(db, 'events'), {
              ...eventData,
              groupId: null,
              sharedWithFamily: false,
              ownerId: auth.currentUser.uid, // make them the owner of the copy
              assigneeIds: [auth.currentUser.uid], // reset assignees to just them
              assigneeId: auth.currentUser.uid
            });
          }
        }

        // 2. Remove user from group members
        await updateDoc(doc(db, 'groups', groupId), {
          members: arrayRemove(auth.currentUser.uid)
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), {
        context: isOwner ? 'LeaveGroupModal.deleteGroup' : 'LeaveGroupModal.leaveGroup',
      });
      setError(isOwner ? t('deleteGroupFailed', language) : t('leaveGroupFailed', language));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            {isOwner ? <Trash2 className="w-5 h-5 text-red-500" /> : <LogOut className="w-5 h-5 text-amber-500" />}
            {isOwner ? 'Delete Group' : 'Leave Group'}
          </h3>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {isOwner 
              // The dictionary values carry their own quotation marks around {group} (ro „…",
              // fr « … »), so nothing is added around them here.
              ? t('leaveGroupOwnerBody', language).replace('{group}', groupName)
              : t('leaveGroupBody', language).replace('{group}', groupName)
            }
          </p>

          {fetchingEvents ? (
            <div className="py-8 flex justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : involvedEvents.length > 0 ? (
            <div className="mt-2">
              <h4 className="text-sm font-semibold mb-2 text-zinc-800 dark:text-zinc-200">
                {t('leaveGroupKeepQuestion', language)}
              </h4>
              <p className="text-xs text-zinc-500 mb-3">
                {isOwner
                  ? t('leaveGroupOwnerHint', language)
                  : t('leaveGroupMemberHint', language)}
              </p>
              
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {involvedEvents.map(ev => (
                  <div 
                    key={ev.id} 
                    onClick={() => toggleEvent(ev.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedEventIds.has(ev.id) 
                        ? 'bg-primary/5 border-primary/30' 
                        : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div className="mt-0.5 text-primary">
                      {selectedEventIds.has(ev.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-zinc-400" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${selectedEventIds.has(ev.id) ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        {ev.title}
                      </p>
                      {ev.date && (
                        <p className="text-xs text-zinc-500">{format(new Date(ev.date), 'MMM d, yyyy')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 italic py-2">
              {eventsLoaded ? t('leaveGroupNoEvents', language) : t('leaveGroupListUnavailable', language)}
            </p>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3 bg-white dark:bg-zinc-900">
          <button 
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleAction}
            // Refuses to act while the keep-list is unknown: an empty selection means
            // "delete all of mine", which is not what an unread list should authorise.
            disabled={loading || !eventsLoaded}
            className={`flex-1 py-2.5 rounded-xl font-medium text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
              isOwner ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'
            }`}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : isOwner ? (
              <>{t('deleteGroup', language)}</>
            ) : (
              <>{t('leaveGroup', language)}</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
