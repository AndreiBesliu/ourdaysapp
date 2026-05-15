import { X, Repeat, Trash2, Edit2, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { deleteDoc, doc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useState } from 'react';
import { useModalBack } from '../hooks/useModalBack';
import { getRecurrenceEndDate, getFrequencyLabel } from '../utils/recurrence';

interface RecurringEventsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  events: any[];
  onEditEvent: (event: any) => void;
}

const FREQ_COLORS: Record<string, string> = {
  daily: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  weekly: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  monthly: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  yearly: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
};

export default function RecurringEventsPanel({ isOpen, onClose, events, onEditEvent }: RecurringEventsPanelProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  useModalBack(isOpen, onClose);

  if (!isOpen) return null;

  // Filter to only recurring master events the user owns or can see
  const recurringEvents = events.filter(
    (ev: any) => ev.recurrenceRule && ev.recurrenceRule.frequency
  );

  // Group by frequency
  const grouped: Record<string, any[]> = {};
  for (const ev of recurringEvents) {
    const freq = ev.recurrenceRule.frequency;
    if (!grouped[freq]) grouped[freq] = [];
    grouped[freq].push(ev);
  }

  const handleDeleteSeries = async (ev: any) => {
    if (!confirm(`Delete the entire "${ev.title}" recurring series?`)) return;
    setDeletingId(ev.id);
    try {
      await deleteDoc(doc(db, 'events', ev.id));
      // Clean up override docs
      const overridesQuery = query(collection(db, 'events'), where('overrideOfParent', '==', ev.id));
      const overrideSnap = await getDocs(overridesQuery);
      for (const d of overrideSnap.docs) {
        await deleteDoc(doc(db, 'events', d.id));
      }
    } catch (e) {
      console.error('Failed to delete series', e);
    } finally {
      setDeletingId(null);
    }
  };

  const frequencyOrder: Array<string> = ['daily', 'weekly', 'monthly', 'yearly'];

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Repeat className="w-5 h-5 text-indigo-500" />
            Recurring Events
          </h3>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-5">
          {recurringEvents.length === 0 ? (
            <div className="text-center py-12">
              <Repeat className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No recurring events yet.</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Create one by selecting a repeat frequency when adding an event.</p>
            </div>
          ) : (
            frequencyOrder.map(freq => {
              const items = grouped[freq];
              if (!items || items.length === 0) return null;
              return (
                <div key={freq}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${FREQ_COLORS[freq] || 'bg-zinc-100 text-zinc-500'}`}>
                      {getFrequencyLabel(freq as any)}
                    </span>
                    <span className="text-xs text-zinc-400">{items.length} series</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((ev: any) => {
                      const startDate = new Date(ev.date);
                      const endDate = getRecurrenceEndDate(startDate, freq as any);
                      const isOwner = ev.ownerId === auth.currentUser?.uid;
                      
                      return (
                        <div
                          key={ev.id}
                          className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">{ev.title}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-xs text-zinc-500 flex items-center gap-1">
                                <CalendarIcon className="w-3 h-3" />
                                {format(startDate, 'MMM d, yyyy')}
                              </span>
                              <span className="text-xs text-zinc-400">→</span>
                              <span className="text-xs text-zinc-500">
                                {format(endDate, 'MMM d, yyyy')}
                              </span>
                            </div>
                            {ev.recurrenceExceptions && ev.recurrenceExceptions.length > 0 && (
                              <p className="text-xs text-amber-500 mt-1">
                                {ev.recurrenceExceptions.length} exception{ev.recurrenceExceptions.length > 1 ? 's' : ''}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isOwner && (
                              <>
                                <button
                                  onClick={() => onEditEvent(ev)}
                                  className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                  title="Edit Series"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteSeries(ev)}
                                  disabled={deletingId === ev.id}
                                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                  title="Delete Series"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
