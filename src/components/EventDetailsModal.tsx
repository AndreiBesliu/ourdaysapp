import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, CheckCircle, FileText, Image as ImageIcon, Trash2, Edit2, GripVertical, Sparkles, Users, ThumbsUp, HelpCircle, ThumbsDown, MapPin, Bell } from 'lucide-react';
import { doc, updateDoc, deleteDoc, getDoc, arrayUnion, collection, query as fsQuery, where, getDocs, deleteField } from 'firebase/firestore';
import { reportError } from '../reportError';
import { planEventWrite } from '../utils/eventWriteTarget';
import { unsharedAttachedCards } from '../utils/assetAttach';
import { shareFieldsFor, groupNameOf } from '../utils/assetSharing';
import { createEventOverride } from '../serverActions';
import { db, auth } from '../firebase';
import AssetBarcode from './AssetBarcode';
import { Wallet } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { format } from 'date-fns';
import { useDialog } from '../hooks/useDialog';
import { useMenu } from '../hooks/useMenu';
import { getFrequencyKey } from '../utils/recurrence';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { t, getDateLocale } from '../utils/i18n';
import { useThemeStore } from '../store';
import { localZone, localDayKey } from '../utils/eventTime';
import { eventDayAsLocalDate, dayAsLocalDate } from '../utils/dayLabel';
import { spanRangeLabel } from '../utils/spanLabel';
import { generateChecklistForTask } from '../ai';
import { aiErrorKey, checklistReasonKey, checklistWorthRetrying } from '../utils/aiErrorKey';


interface EventDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: any | null;
  userMap?: Record<string, any>;
  groups?: any[];
  onEdit?: () => void;
}

export default function EventDetailsModal({ isOpen, onClose, event, userMap = {}, groups = [], onEdit }: EventDetailsModalProps) {
  const { language, timezone } = useThemeStore();
  const dateLocale = getDateLocale(language);
  const [loading, setLoading] = useState(false);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Keep local state for optimistic UI updates of checklist
  const [checklist, setChecklist] = useState<any[]>(event?.checklistItems || []);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [showOwnerProfile, setShowOwnerProfile] = useState(false);
  const [linkedAsset, setLinkedAsset] = useState<any | null>(null);
  const [linkedChecklistAssets, setLinkedChecklistAssets] = useState<Record<string, any>>({});
  // Reads that failed. An asset is readable by its owner or by the group named in its
  // `sharedGroupId`, and until 18.09 attaching a card to a group event shared it with nobody —
  // so everybody else got a refusal, the catch swallowed it, and the row rendered without the
  // one thing it is for. Attaching shares it now (assetAttach.ts), including on re-save.
  //
  // The failure is NOT narrowed to "not shared": a reviewer proved on the emulator that reading
  // an asset that does not EXIST is refused in the same way, because the rule dereferences a
  // null `resource`. So the message says both possibilities rather than asserting the one we
  // cannot tell apart.
  const [deniedChecklistAssets, setDeniedChecklistAssets] = useState<Set<string>>(new Set());
  const [mainAssetDenied, setMainAssetDenied] = useState(false);
  // The other half of the same refusal. The person who can repair it is the one who cannot see
  // it: the owner reads their own card, so the barcode renders for them exactly as it should,
  // and it is everybody else who gets the apology above. So the owner is told, and asked.
  const [sharingCards, setSharingCards] = useState(false);
  const [shareCardsFailed, setShareCardsFailed] = useState(false);

  useEffect(() => {
    if (event?.assetId) {
      const startedFor = event.id;
      setMainAssetDenied(false);
      const fetchAsset = async () => {
        try {
          const docRef = doc(db, 'assets', event.assetId);
          const docSnap = await getDoc(docRef);
          if (startedFor !== event?.id) return;
          if (docSnap.exists()) {
            setLinkedAsset({ id: docSnap.id, ...docSnap.data() });
          } else {
            setMainAssetDenied(true);
          }
        } catch (e) {
          // The same refusal the checklist rows get, and it used to leave the whole block
          // unrendered: no heading, no code, no reason. The biggest barcode on the screen
          // simply was not there.
          if (startedFor === event?.id) setMainAssetDenied(true);
          // Guaranteed, not hypothetical: assets are owner-only to read, while the EVENT carrying
          // the assetId is group-readable — so for every member but the linker this is denied
          // every time. Widening that read is a deferred decision; being quiet about it was not.
          reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.linkedAsset' });
        }
      };
      fetchAsset();
    } else {
      setLinkedAsset(null);
    }
    
    // Fetch checklist assets
    if (event?.checklistItems) {
      const startedFor = event?.id;
      const fetchChecklistAssets = async () => {
        const newMap: Record<string, any> = {};
        const refused = new Set<string>();
        for (const item of event.checklistItems) {
          if (item.assetId) {
            try {
              const docSnap = await getDoc(doc(db, 'assets', item.assetId));
              if (docSnap.exists()) {
                newMap[item.assetId] = { id: docSnap.id, ...docSnap.data() };
              }
            } catch (e) {
              refused.add(item.assetId);
              reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.checklistAssets' });
            }
          }
        }
        // The modal is never unmounted — CalendarHome only toggles `isOpen` — so a slower run
        // for the PREVIOUS event would otherwise land on top of the current one.
        if (startedFor !== event?.id) return;
        setLinkedChecklistAssets(newMap);
        setDeniedChecklistAssets(refused);
      };
      fetchChecklistAssets();
    }
  }, [event?.assetId, event?.checklistItems]);


  // Update local state when event changes
  React.useEffect(() => {
    if (event) {
      setChecklist(event.checklistItems || []);
    }
  }, [event]);

  // ── The AI checklist that did not happen ───────────────────────────────────────────────
  //
  // `autoSuggestChecklist` is an `onDocumentCreated` trigger: it fires ONCE per event, so a bad
  // ending is permanent. It used to have two, and this screen made both invisible. The skeleton
  // further down renders exactly while `ai_assistant` is in the assignees, so stripping that id
  // left an empty checklist and no explanation, and NOT stripping it left the skeleton spinning
  // for the life of the event. The trigger now writes `aiChecklist: { status, reason }`, and this
  // reads it.
  //
  // These live up here with the other hooks, and not beside the handler they serve, because
  // `if (!isOpen || !event) return null` sits between the two. That return is why this app has
  // shipped React #310 twice.
  const [aiRetrying, setAiRetrying] = useState(false);
  const [aiRetryError, setAiRetryError] = useState<string | null>(null);
  // Hides the card the moment a retry lands, without waiting for the snapshot to come back.
  const [aiOutcomeDone, setAiOutcomeDone] = useState(false);

  // Keyed on the event ID, NOT on `event`: that object gets a new identity on every Firestore
  // snapshot, and resetting there would wipe the error sentence before it could be read.
  //
  // The ref carries the same id for code that must ask "is this still the event I started on?"
  // AFTER an await — reading `event.id` there would read the closure's copy, which is the whole
  // problem. Written during render rather than in the effect so it is never a tick behind.
  const eventIdRef = useRef<string | undefined>(event?.id);
  eventIdRef.current = event?.id;
  // The live checklist, for code that must append to it AFTER an await. Reading the state
  // variable there reads the closure's copy, which is the whole problem; reading `event`
  // is no better, because that is a prop captured at the same moment.
  const checklistRef = useRef<any[]>([]);
  checklistRef.current = checklist;
  useEffect(() => {
    setAiRetrying(false);
    setAiRetryError(null);
    setAiOutcomeDone(false);
  }, [event?.id]);

  // The lightbox is local state on a modal that CalendarHome never unmounts — it only toggles
  // `isOpen` — so nothing ever cleared it. Open an event, tap its picture, press Escape: the modal
  // closed with `fullScreenImage` still set, and the NEXT event you opened appeared underneath the
  // previous event's photo. Keyed on `isOpen` alone and not on `event`, because `event` gets a new
  // identity on every Firestore snapshot and clearing there would shut the picture while you were
  // still looking at it.
  useEffect(() => {
    if (!isOpen) {
      setFullScreenImage(null);
      // Same reasoning, one state later: the owner card must not be waiting behind the next event.
      setShowOwnerProfile(false);
      setShareCardsFailed(false);
    }
  }, [isOpen]);

  // The picture is its own dialog, stacked above this one. Until now Escape over an open picture
  // closed the event details underneath it rather than the picture the user was looking at.
  const lightbox = useDialog(Boolean(fullScreenImage), () => setFullScreenImage(null), {
    label: t('walletImageViewer', language),
  });

  // Declared with the other hooks and above the early return, like everything else here —
  // see the note below about React #310.
  const { dialogRef, dialogProps } = useDialog(isOpen, onClose, { label: event?.title });

  // Floats inside the dialog above, so Escape must stop at the card. See `dialogStack`.
  //
  // Gated on `isOpen` as well: this component does not unmount when the event is closed, it
  // returns null — so a card left open would go on registering as an overlay with nothing on
  // screen, holding the top of the stack, eating the next Escape and freezing the calendar's
  // arrow keys until the user happened to click something.
  const ownerCard = useMenu(isOpen && showOwnerProfile, () => setShowOwnerProfile(false), {
    kind: 'popover',
    label: t('viewOwner', language),
  });

  // Held across renders so two quick taps cannot create two overrides — see resolveWriteTarget
  // below, which is the only thing that reads it.
  //
  // It is declared HERE, with the other hooks, rather than beside the code that uses it. Everything
  // past the guard below runs only while the modal is open, so a hook down there is a hook that
  // appears and disappears between renders of the same instance. CalendarHome keeps this modal
  // permanently mounted and toggles `isOpen`, so a closed render ran eight hooks and an open one
  // ran nine: React error #310, thrown on EVERY event anybody opened.
  const materialising = useRef<{ key: string; promise: Promise<string> } | null>(null);

  if (!isOpen || !event) return null;

  // Cards attached to THIS event that I own and that this event's group cannot read. Built from
  // the documents that actually loaded, so by construction it only ever names cards I can read,
  // and it uses the same function the save path uses — a rule written twice is a rule that
  // drifts. Measured on live on 19.09: two attachments on group events, neither shared, one of
  // them carrying a scannable code nobody else could see.
  const loadedAssets = [linkedAsset, ...Object.values(linkedChecklistAssets)].filter(Boolean) as any[];
  const cardsToShare = unsharedAttachedCards(event, loadedAssets, auth.currentUser?.uid || '');
  const shareCardNames = cardsToShare
    .map(({ assetId }) => loadedAssets.find((a) => a && a.id === assetId)?.name)
    .filter(Boolean)
    .join(', ');

  const shareCardsNow = async () => {
    setSharingCards(true);
    setShareCardsFailed(false);
    let failed = false;
    for (const { assetId, sharedGroupId } of cardsToShare) {
      try {
        await updateDoc(doc(db, 'assets', assetId), shareFieldsFor(sharedGroupId));
        // Nothing re-reads the asset — the modal is never unmounted and the fetch is keyed on
        // the event — so the notice would sit there after the write that answered it.
        setLinkedAsset((a: any) => (a && a.id === assetId ? { ...a, ...shareFieldsFor(sharedGroupId) } : a));
        setLinkedChecklistAssets((m) => (m[assetId] ? { ...m, [assetId]: { ...m[assetId], ...shareFieldsFor(sharedGroupId) } } : m));
      } catch (err) {
        // Updating my own asset: a refusal here is the rules disagreeing with the button, not
        // the user doing anything wrong, so it is reported and said out loud rather than eaten.
        failed = true;
        reportError(err instanceof Error ? err.message : String(err), { context: 'EventDetailsModal.shareCard' });
      }
    }
    setShareCardsFailed(failed);
    setSharingCards(false);
  };

  const isOwner = event.ownerId === auth.currentUser?.uid;
  const isInvitee = event.inviteeId === auth.currentUser?.uid;

  const assigneeIds: string[] = event.assigneeIds || (event.assigneeId ? [event.assigneeId] : []);
  const isAssignee = assigneeIds.includes(auth.currentUser?.uid || '');
  const hasAssignee = assigneeIds.length > 0;
  
  // Anyone involved can change task status, or edit description
  const canEdit = isOwner || isInvitee || isAssignee;

  // Where a change to THIS event actually goes.
  //
  // For an occurrence of a repeating series the id we were rendered from is synthetic
  // (`${parentId}_${date}`) and no document answers to it, so every write below used to fail in
  // silence. The first write materialises the occurrence into a real override — the same thing
  // editing it in AddEventModal already does — and the rest of the session goes there.
  // See src/utils/eventWriteTarget.ts for why neither the synthetic id nor the parent will do.
  //
  // The promise is held in a ref, not awaited twice: two quick taps must not create two overrides.
  // That ref is declared with the other hooks, ABOVE the early return — see the note there.
  //
  // KEYED, and that is not a detail. The ref was a bare promise, set on success and cleared only
  // on failure, in a modal CalendarHome never unmounts — it only toggles `isOpen`. So once any
  // occurrence had been materialised, every later occurrence of every series reused that same
  // promise and wrote into the FIRST one's override: tick a checklist item on next week's
  // rehearsal and it lands on last week's. Keyed on the parent and the date, a cached promise can
  // only ever answer for the occurrence it was created for.
  const resolveWriteTarget = async (): Promise<string> => {
    const plan = planEventWrite(event as any);
    if (plan.kind === 'direct') return plan.id;
    const key = `${plan.parentId}_${plan.overrideDate}`;
    const cached = materialising.current;
    const pending = (cached && cached.key === key ? cached.promise : null) ?? createEventOverride({
      parentId: plan.parentId,
      overrideDate: plan.overrideDate,
      data: plan.data,
    }).catch((err) => {
      // Clear the ref on failure. Caching a REJECTED promise would make one bad network moment
      // permanent for the life of the modal: every later tap would reject instantly, without ever
      // trying again, and look exactly like the dead button this whole change exists to fix.
      materialising.current = null;
      throw err;
    });
    materialising.current = { key, promise: pending };
    return pending;
  };

  const handleToggleTask = async () => {
    if (!canEdit) return;
    setLoading(true);
    const newStatus = event.taskStatus === 'completed' ? 'started' : 'completed';
    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { taskStatus: newStatus });
      event.taskStatus = newStatus; // optimistic update
      if (newStatus === 'completed') {
        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      } else {
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }
    } catch (e) {
      // Was console.error alone. Every one of these used to fail silently on a repeating
      // occurrence, so silence is exactly what must not happen here any more.
      setDeleteError(t('eventUpdateFailed', language));
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.update' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddAssignee = async (newId: string) => {
    if (!newId || newId === 'unassigned') return;
    setLoading(true);
    const updatedIds = Array.from(new Set([...assigneeIds, newId]));
    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { assigneeIds: updatedIds, assigneeId: updatedIds[0] || null });
      event.assigneeIds = updatedIds;
      event.assigneeId = updatedIds[0] || null;
    } catch (e) {
      // Was console.error alone. Every one of these used to fail silently on a repeating
      // occurrence, so silence is exactly what must not happen here any more.
      setDeleteError(t('eventUpdateFailed', language));
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.update' });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAssignee = async (removeId: string) => {
    setLoading(true);
    const updatedIds = assigneeIds.filter(id => id !== removeId);
    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { assigneeIds: updatedIds, assigneeId: updatedIds[0] || null });
      event.assigneeIds = updatedIds;
      event.assigneeId = updatedIds[0] || null;
    } catch (e) {
      // Was console.error alone. Every one of these used to fail silently on a repeating
      // occurrence, so silence is exactly what must not happen here any more.
      setDeleteError(t('eventUpdateFailed', language));
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.update' });
    } finally {
      setLoading(false);
    }
  };

  const handleEditChecklistText = async (itemId: string, newText: string) => {
    if (!canEdit) return;
    const newChecklist = checklist.map(item => 
      item.id === itemId ? { ...item, text: newText } : item
    );
    setChecklist(newChecklist);
    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { checklistItems: newChecklist });
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.handleEditChecklistText' });
      console.error(e);
      setChecklist(event.checklistItems || []);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!canEdit || !result.destination) return;
    const newItems = Array.from(checklist);
    const [reorderedItem] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, reorderedItem);
    setChecklist(newItems);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { checklistItems: newItems });
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.handleDragEnd' });
      console.error(e);
      setChecklist(event.checklistItems || []);
    }
  };

  const handleToggleChecklistItem = async (itemId: string) => {
    if (!canEdit) return;
    
    // Optimistic update
    const newChecklist = checklist.map(item => 
      item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
    );
    setChecklist(newChecklist);
    
    const isNowCompleted = newChecklist.find(i => i.id === itemId)?.isCompleted;
    Haptics.impact({ style: isNowCompleted ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});

    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { checklistItems: newChecklist });
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.handleToggleChecklistItem' });
      console.error("Failed to update checklist item:", e);
      // Revert on failure
      setChecklist(event.checklistItems || []);
    }
  };

  /**
   * Retry through `generateAIChecklist` — the callable that already exists, so the retry faces the
   * same auth, quota and budget the trigger faced. That is deliberate: the usual reason the
   * trigger stopped is a limit, and a retry must meet the same limit rather than route around it.
   */
  const handleRetryAiChecklist = async () => {
    if (!canEdit || aiRetrying) return;
    // The event this retry is FOR. A generation takes seconds, this modal is never unmounted, and
    // closing it and opening something else is the ordinary thing to do while waiting — so without
    // this the returned items were written into whatever event happened to be open, and the error
    // sentence appeared under an event that had never asked for anything. The two fetch effects
    // above guard the same hazard the same way; this handler was written without it.
    const startedFor = event.id;
    const stillHere = () => startedFor === eventIdRef.current;

    setAiRetrying(true);
    setAiRetryError(null);
    // TWO tries, and the line between them is the same one `withLedger` draws on the server: once
    // `generateChecklistForTask` has returned, the call has been PAID FOR. They shared one try, so
    // a refused write sent control to a catch that reverted the checklist — throwing away
    // suggestions somebody had just spent one of their fifty on, and blaming the AI for it.
    let suggestions: string[];
    try {
      suggestions = await generateChecklistForTask(event.title, event.description || '');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      reportError(raw, { context: 'EventDetailsModal.retryGenerate' });
      if (stillHere()) {
        const known = aiErrorKey(raw);
        setAiRetryError(known ? t(known, language) : t('aiChecklistFailed', language));
        setAiRetrying(false);
      }
      return;
    }

    if (!suggestions.length) {
      // A refusal states itself; an empty answer would otherwise look like a broken button.
      if (stillHere()) { setAiRetryError(t('aiChecklistNothing', language)); setAiRetrying(false); }
      return;
    }

    try {
      const newItems = suggestions.map((text, i) => ({
        id: `${Date.now()}${i}`,
        text: String(text),
        isCompleted: false,
        assetUrl: null,
        assetId: null,
      }));
      // The freshest list for the event being WRITTEN TO. If the reader is still on it, that is
      // the live state, which the `[event]` effect keeps in step with every snapshot. If they
      // have moved on, the ref now holds somebody else's checklist, so the closure's copy is the
      // best that exists. My previous attempt read `event.checklistItems` unconditionally, which
      // is a prop captured at the same instant as the state it replaced — no fresher, and often
      // staler, since it misses optimistic local edits.
      const base = stillHere()
        ? checklistRef.current
        : (Array.isArray(event.checklistItems) ? event.checklistItems : []);
      const merged = [...base, ...newItems];
      // The WRITE is UNCONDITIONAL, and that is the whole point of the two-try split.
      //
      // It said so already, twenty lines below a `if (!stillHere()) return;` that sat at the head
      // of this try and skipped the entire write. Closing the modal while the model was thinking —
      // which this handler's own comment calls the ordinary thing to do — threw away a generation
      // somebody had just spent one of their fifty daily calls on, left the failure card in place,
      // and invited them to spend another. The comment was right and the code was not.
      //
      // Nothing addressed here comes from the screen: `resolveWriteTarget` and `noteHome` both
      // derive from the closure's `event`, so the write cannot land on the wrong document however
      // long it takes.
      //
      // TWO documents for a repeating event, and they are not the same question.
      //
      //   the items  — belong to the DAY you retried, so they go to the occurrence, materialising
      //                an override if there is not one yet, exactly as ticking a box does.
      //   the note   — belongs to the SERIES. The trigger fired once, on the parent, and every
      //                occurrence inherits the parent's fields, so clearing it on the occurrence
      //                left every other occurrence still showing the card and still offering a
      //                Retry that costs another call. Clearing the parent answers it once.
      const plan = planEventWrite(event as any);
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { checklistItems: merged });
      const noteHome = plan.kind === 'override' ? plan.parentId : plan.id;
      await updateDoc(doc(db, 'events', noteHome), { aiChecklist: deleteField() })
        .catch((e) => {
          // The items are already saved; a failure here costs a stale card, not the work.
          reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.clearAiChecklistNote' });
        });

      // Only now, and only if the reader is still looking at this event. `setAiOutcomeDone(true)`
      // hides the amber card — which is where `aiRetryError` is rendered — so setting it BEFORE
      // the write made the "could not be saved" message unreachable by construction: the only
      // element that could show it had just been removed.
      if (stillHere()) {
        setChecklist(merged);
        setAiOutcomeDone(true);
      }
    } catch (e) {
      // Only the WRITE can reach this now. The items exist and were paid for, so they stay on
      // screen and the message says what actually failed — saving — rather than blaming the AI
      // and deleting the answer.
      const raw = e instanceof Error ? e.message : String(e);
      reportError(raw, { context: 'EventDetailsModal.retrySave' });
      if (!stillHere()) return;
      setAiRetryError(t('checklistNotSaved', language));
    } finally {
      if (stillHere()) setAiRetrying(false);
    }
  };

  const handleStartTask = async () => {
    if (!canEdit) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { taskStatus: 'started' });
      event.taskStatus = 'started'; // optimistic update
    } catch (e) {
      // Was console.error alone. Every one of these used to fail silently on a repeating
      // occurrence, so silence is exactly what must not happen here any more.
      setDeleteError(t('eventUpdateFailed', language));
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.update' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwner) return;

    // Check if this is a recurring event
    const isRecurringInstance = event.isRecurringInstance;
    const parentId = event.parentEventId;
    const hasRecurrenceRule = !!event.recurrenceRule;

    if (isRecurringInstance && parentId) {
      // Ask scope: delete this one or all
      const choice = window.confirm(t('deleteSeriesScope', language));
      setLoading(true);
      try {
        if (choice) {
          // Overrides FIRST, while the parent still exists to identify them — otherwise a failure
          // here leaves the series deleted and its individually-edited occurrences stranded in the
          // calendar forever, out of the Recurring panel and impossible to delete as a set.
          //
          // `ownerId == uid` is not a workaround, it is what makes the query legal: no branch of
          // the events read rule mentions `overrideOfParent`, and Firestore validates a LIST query
          // against the rules WITHOUT reading documents, so filtering on it alone is denied
          // outright. `createEventOverride` keeps the PARENT's ownerId and this button only shows
          // for a series you own, so the filter is both permitted and complete.
          // Same fix, same reasoning as RecurringEventsPanel.handleDeleteSeries.
          const overridesQuery = fsQuery(
            collection(db, 'events'),
            where('overrideOfParent', '==', parentId),
            where('ownerId', '==', auth.currentUser!.uid),
          );
          const overrideSnap = await getDocs(overridesQuery);
          await Promise.all(overrideSnap.docs.map((d) => deleteDoc(doc(db, 'events', d.id))));
          await deleteDoc(doc(db, 'events', parentId));
        } else {
          // Delete just this occurrence — add exception to parent
          const overrideDate = event.recurrenceDate;
          if (overrideDate) {
            await updateDoc(doc(db, 'events', parentId), { recurrenceExceptions: arrayUnion(overrideDate) });
          }
        }
        onClose();
      } catch (e) {
        // Was console.error alone: a half-finished delete that looks finished is the worst of the
        // three outcomes, so it says so and leaves the modal open.
        setDeleteError(t('recurringDeleteFailed', language));
        reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.deleteSeries' });
      } finally {
        setLoading(false);
      }
    } else if (hasRecurrenceRule) {
      // This is the master event itself
      if (!confirm(t('deleteSeriesConfirm', language))) return;
      setLoading(true);
      try {
        // Same ordering and the same `ownerId` clause as the branch above.
        const overridesQuery = fsQuery(
          collection(db, 'events'),
          where('overrideOfParent', '==', event.id),
          where('ownerId', '==', auth.currentUser!.uid),
        );
        const overrideSnap = await getDocs(overridesQuery);
        await Promise.all(overrideSnap.docs.map((d) => deleteDoc(doc(db, 'events', d.id))));
        await deleteDoc(doc(db, 'events', event.id));
        onClose();
      } catch (e) {
        setDeleteError(t('recurringDeleteFailed', language));
        reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.deleteMasterSeries' });
      } finally {
        setLoading(false);
      }
    } else {
      // Normal non-recurring delete
      if (!confirm(t('deleteEventConfirm', language))) return;
      setLoading(true);
      try {
        await deleteDoc(doc(db, 'events', event.id));
        onClose();
      } catch (e) {
        reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.handleDelete' });
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
  };

  // RSVP handling
  const rsvps: Record<string, string> = event.rsvps || {};
  const currentUserId = auth.currentUser?.uid || '';
  const myRsvp = rsvps[currentUserId] || null;
  const rsvpEnabled = !!event.rsvpEnabled;

  const handleRsvp = async (status: 'yes' | 'maybe' | 'no') => {
    if (!auth.currentUser) return;
    const newRsvps = { ...rsvps };
    if (myRsvp === status) {
      // Toggle off
      delete newRsvps[currentUserId];
    } else {
      newRsvps[currentUserId] = status;
    }
    try {
      // The same target as every other write in this file. It used to aim at the PARENT for a
      // recurring occurrence, so answering “not going” for one Tuesday answered it for every
      // Tuesday, past ones included — and there was no way to answer for a single date. The
      // comment that stood here described an override it never created.
      //
      // `resolveWriteTarget` materialises the occurrence first, exactly as ticking a checklist
      // item does. `rsvps` had to be added to OVERRIDE_FIELDS on the server for that to carry
      // the answers across: `rsvpEnabled` was on the list and `rsvps` was not, so the new
      // document kept the question and dropped everybody’s replies.
      await updateDoc(doc(db, 'events', await resolveWriteTarget()), { rsvps: newRsvps });
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e), { context: 'EventDetailsModal.handleRsvp' });
      console.error('Failed to update RSVP', e);
    }
  };

  const getRsvpUsers = (status: string) => Object.entries(rsvps).filter(([, s]) => s === status).map(([uid]) => uid);
  const yesUsers = getRsvpUsers('yes');
  const maybeUsers = getRsvpUsers('maybe');
  const noUsers = getRsvpUsers('no');

  const ownerId = event?.ownerId;
  const owner = ownerId ? (userMap[ownerId] || null) : null;

  const commonGroups = owner ? groups?.filter(g => g.members?.includes(owner.id)) || [] : [];

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} ref={dialogRef} {...dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-xl text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              {event.emoji && <span>{event.emoji}</span>}
              {event.title}
            </h3>
            <div className="flex items-center gap-3 mt-1 relative">
              <p className="text-sm text-primary font-medium flex items-center gap-1">
                <CalendarIcon className="w-4 h-4" />
                {(() => {
                  // The whole extent: "Monday 15 → Wednesday 17", and the clocks beside it. Days are
                  // parsed as LOCAL dates from their label — `new Date('…T00:00Z')` formatted locally
                  // is the previous day west of Greenwich, which is what this line used to do.
                  const asLocal = dayAsLocalDate;
                  const r = spanRangeLabel(event, timezone || localZone());
                  if (!r) {
                    // Reached only when `date` is missing or unparseable — `spanOf` returns null on
                    // nothing else. The old line handed that same value to `format`, which prints
                    // the words "Invalid Date" at somebody in six languages. Nothing is better.
                    const only = eventDayAsLocalDate(event.date);
                    return only ? format(only, 'EEEE, d MMMM yyyy', { locale: dateLocale }) : null;
                  }
                  const days = r.sameDay
                    ? format(asLocal(r.startDay)!, 'EEEE, d MMMM yyyy', { locale: dateLocale })
                    : `${format(asLocal(r.startDay)!, 'EEEE, d MMMM', { locale: dateLocale })} → ${format(asLocal(r.endDay)!, 'EEEE, d MMMM yyyy', { locale: dateLocale })}`;
                  return (
                    <>
                      {days}
                      {r.clocks && <span className="ml-2 text-zinc-500 tabular-nums">{r.clocks}{r.zoneNote ? ` · ${r.zoneNote.split('/').pop()}` : ''}</span>}
                    </>
                  );
                })()}
              </p>
              {(event.isRecurringInstance || event.recurrenceRule) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-medium rounded-full">
                  🔁 {t(getFrequencyKey(event.recurrenceRule?.frequency || event.parentFrequency || 'weekly'), language)}
                </span>
              )}
              {owner && (
                <div className="relative">
                  <button type="button" ref={ownerCard.triggerRef} {...ownerCard.triggerProps} onClick={() => setShowOwnerProfile(!showOwnerProfile)} className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary transition-all shadow-sm" title={t('viewOwner', language)}>
                    {owner.photoURL ? (
                      <img src={owner.photoURL} alt={owner.name || owner.email} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                        {(owner.name?.[0] || owner.email?.[0] || '?').toUpperCase()}
                      </span>
                    )}
                  </button>
                  
                  {showOwnerProfile && (
                    <div ref={ownerCard.menuRef} {...ownerCard.menuProps} className="absolute top-9 left-0 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-4 animate-in fade-in zoom-in duration-200 outline-none">
                      <div className="flex items-start gap-3 border-b border-zinc-100 dark:border-zinc-700 pb-3 mb-3">
                        <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 overflow-hidden shrink-0">
                          {owner.photoURL ? (
                            <img src={owner.photoURL} alt={owner.name || owner.email} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-bold text-zinc-500 dark:text-zinc-400">
                              {(owner.name?.[0] || owner.email?.[0] || '?').toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-base">{owner.name || owner.email?.split('@')[0]}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{owner.email}</p>
                        </div>
                      </div>
                      
                      <div>
                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">{t('commonGroups', language)}</p>
                        {commonGroups.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {commonGroups.map(g => (
                              <span key={g.id} className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
                                {g.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-500 italic">{t('noCommonGroups', language)}</p>
                        )}
                      </div>
                      
                      <button type="button" onClick={() => setShowOwnerProfile(false)} className="mt-4 w-full py-1.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg text-xs font-medium transition-colors">
                        {t('closeAction', language)}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && onEdit && (
              <button onClick={onEdit} className="p-2 text-primary hover:bg-primary/10 transition-colors rounded-full" aria-label={t('edit', language)} title={t('edit', language)}>
                <Edit2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors bg-zinc-100 dark:bg-zinc-800 rounded-full" aria-label={t('closeTooltip', language)} title={t('closeTooltip', language)}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {deleteError && (
            <p role="alert" className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 rounded-lg p-3">
              {deleteError}
            </p>
          )}
          
          {/* Task Status */}
          {event.isTask && (
            <div className="flex flex-col gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('taskOwnership', language)}</p>
                  {hasAssignee ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {assigneeIds.map(id => (
                        <span key={id} className="inline-flex items-center gap-1 bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded-full text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {userMap[id]?.name || userMap[id]?.email?.split('@')[0] || t('memberFallback', language)}
                          {(canEdit || id === auth.currentUser?.uid) && (
                            <button aria-label={t('removeAssignee', language)} onClick={() => handleRemoveAssignee(id)} className="text-zinc-500 hover:text-red-500 transition-colors ml-1" title={`Remove ${id === auth.currentUser?.uid ? 'yourself' : 'member'}`}>
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500 mt-1">{t('taskUnclaimed', language)}</p>
                  )}
                </div>
                
                <select
                  value="unassigned"
                  onChange={(e) => handleAddAssignee(e.target.value)}
                  disabled={loading}
                  className="text-xs bg-primary/10 text-primary rounded-md font-medium px-2 py-1.5 outline-none border-none cursor-pointer hover:bg-primary/20 transition-colors shrink-0"
                >
                  <option value="unassigned" disabled>{t('addAssignee', language)}</option>
                  {!isAssignee && <option value={auth.currentUser?.uid}>{t('taskAssignToMe', language)}</option>}
                  {Object.values(userMap)
                    .filter((u: any) => !assigneeIds.includes(u.id))
                    .filter((u: any) => event.groupId ? groups?.find(g => g.id === event.groupId)?.members?.includes(u.id) : u.id === auth.currentUser?.uid)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name || u.email?.split('@')[0]}</option>
                  ))}
                </select>
              </div>
              

                <div className="flex items-center gap-2 pt-1">
                  {event.taskStatus === 'completed' ? (
                    <button 
                      onClick={handleToggleTask}
                      disabled={loading || !canEdit}
                      className="flex-1 py-2 px-4 bg-emerald-500 text-white rounded-lg flex items-center justify-center gap-2 font-medium shadow-sm"
                    >
                      <CheckCircle className="w-5 h-5" /> {t('statusCompleted', language)}
                    </button>
                  ) : event.taskStatus === 'started' ? (
                    <>
                      <div className="flex-1 py-2 px-4 bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg flex items-center justify-center font-medium border border-amber-500/30">
                        {t('statusInProgress', language)}
                      </div>
                      <button 
                        onClick={handleToggleTask}
                        disabled={loading || !canEdit}
                        className="flex-1 py-2 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center gap-2 font-medium transition-colors shadow-sm"
                      >
                        <CheckCircle className="w-5 h-5" /> {t('finishTask', language)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={handleStartTask}
                        disabled={loading || !canEdit}
                        className="flex-1 py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center justify-center font-medium transition-colors shadow-sm"
                      >
                        {t('startTaskAction', language)}
                      </button>
                      <button 
                        onClick={handleToggleTask}
                        disabled={loading || !canEdit}
                        className="flex-1 py-2 px-4 bg-zinc-200 dark:bg-zinc-700 hover:bg-emerald-500 hover:text-white text-zinc-700 dark:text-zinc-300 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors group shadow-sm"
                      >
                        <CheckCircle className="w-5 h-5 text-zinc-400 group-hover:text-white" /> {t('completeTask', language)}
                      </button>
                    </>
                  )}
                </div>
            </div>
          )}

          {/* Location & Reminder */}
          {(event.location || event.reminderMinutes !== null && event.reminderMinutes !== undefined) && (
            <div className="flex flex-col gap-3">
              {event.location && (
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{event.location}</p>
                    <p className="text-xs text-zinc-500 group-hover:text-blue-500 transition-colors">{t('tapToOpenMap', language)}</p>
                  </div>
                </a>
              )}
              {event.reminderMinutes !== null && event.reminderMinutes !== undefined && (
                <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {event.reminderMinutes === 0 ? t('atTimeOfEvent', language) :
                       event.reminderMinutes === 15 ? t('min15Before', language) :
                       event.reminderMinutes === 60 ? t('hour1Before', language) :
                       event.reminderMinutes === 1440 ? t('day1Before', language) :
                       t('minutesBefore', language).replace('{n}', String(event.reminderMinutes))}
                    </p>
                    <p className="text-xs text-zinc-500">{t('reminderSet', language)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RSVP Section */}
          {rsvpEnabled && (
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {t('rsvpQuestion', language)}
              </p>
              
              {/* RSVP Buttons */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => handleRsvp('yes')}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    myRsvp === 'yes'
                      ? 'bg-emerald-500 text-white shadow-md ring-2 ring-emerald-500/30'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'
                  }`}
                >
                  <ThumbsUp className="w-4 h-4" /> {t('rsvpGoing', language)}
                </button>
                <button
                  onClick={() => handleRsvp('maybe')}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    myRsvp === 'maybe'
                      ? 'bg-amber-500 text-white shadow-md ring-2 ring-amber-500/30'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20'
                  }`}
                >
                  <HelpCircle className="w-4 h-4" /> {t('rsvpMaybe', language)}
                </button>
                <button
                  onClick={() => handleRsvp('no')}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    myRsvp === 'no'
                      ? 'bg-red-500 text-white shadow-md ring-2 ring-red-500/30'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/20'
                  }`}
                >
                  <ThumbsDown className="w-4 h-4" /> {t('rsvpNotGoing', language)}
                </button>
              </div>

              {/* RSVP Summary */}
              {(yesUsers.length > 0 || maybeUsers.length > 0 || noUsers.length > 0) && (
                <div className="space-y-2">
                  {yesUsers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t('rsvpGoing', language)} ({yesUsers.length})</span>{' — '}
                        {yesUsers.map(uid => userMap[uid]?.name || userMap[uid]?.email?.split('@')[0] || t('memberFallback', language)).join(', ')}
                      </span>
                    </div>
                  )}
                  {maybeUsers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="font-semibold text-amber-600 dark:text-amber-400">{t('rsvpMaybe', language)} ({maybeUsers.length})</span>{' — '}
                        {maybeUsers.map(uid => userMap[uid]?.name || userMap[uid]?.email?.split('@')[0] || t('memberFallback', language)).join(', ')}
                      </span>
                    </div>
                  )}
                  {noUsers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="font-semibold text-red-600 dark:text-red-400">{t('rsvpNotGoing', language)} ({noUsers.length})</span>{' — '}
                        {noUsers.map(uid => userMap[uid]?.name || userMap[uid]?.email?.split('@')[0] || t('memberFallback', language)).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {yesUsers.length === 0 && maybeUsers.length === 0 && noUsers.length === 0 && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">{t('noResponsesYet', language)}</p>
              )}
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4" /> {t('notesLabel', language)}
              </p>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                {event.description}
              </div>
            </div>
          )}

          {/* Interactive Checklist */}
          {checklist.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> {t('todoListLabel', language)}
              </p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="event-checklist">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      {checklist.map((item, index) => (
                        <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={!canEdit}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`flex flex-col gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/30 border rounded-lg ${snapshot.isDragging ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-zinc-200 dark:border-zinc-700'}`}
                            >
                              <div className="flex items-start gap-3">
                                {canEdit && (
                                  <div {...provided.dragHandleProps} className="mt-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing p-1 -ml-1 -mr-1">
                                    <GripVertical className="w-4 h-4" />
                                  </div>
                                )}
                                <button aria-label={t('toggleChecklistItem', language)} 
                                  onClick={() => handleToggleChecklistItem(item.id)}
                                  disabled={!canEdit}
                                  className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                                    item.isCompleted 
                                      ? 'bg-emerald-500 border-emerald-500 text-white' 
                                      : 'border-zinc-400 dark:border-zinc-500 text-transparent hover:border-primary'
                                  }`}
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </button>
                                <textarea 
                                  defaultValue={item.text}
                                  onInput={(e) => {
                                    e.currentTarget.style.height = 'auto';
                                    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value !== item.text) {
                                      handleEditChecklistText(item.id, e.target.value);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  ref={(el) => {
                                    if (el) {
                                      el.style.height = 'auto';
                                      el.style.height = `${el.scrollHeight}px`;
                                    }
                                  }}
                                  rows={1}
                                  disabled={!canEdit || item.isCompleted}
                                  className={`text-sm flex-1 pt-0.5 bg-transparent border-none focus:ring-0 outline-none min-w-0 resize-none overflow-hidden ${item.isCompleted ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}
                                />
                              </div>
                              {item.assetUrl && !item.isCompleted && (
                                <div className="ml-8 mt-1 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 self-start max-w-[200px] cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setFullScreenImage(item.assetUrl)}>
                                  <img src={item.assetUrl} alt={item.text} className="w-full h-auto" />
                                </div>
                              )}
                              {item.assetId && !item.isCompleted && deniedChecklistAssets.has(item.assetId) && (
                                <p className="ml-8 mt-2 text-xs text-amber-600 font-medium self-start max-w-[220px]">
                                  {t(event.groupId ? 'cardNotSharedWithGroup' : 'cardUnavailable', language)}
                                </p>
                              )}
                              {/* The copy people actually hold up at the till: it sits next to
                                  "buy milk". It carried the old four-format chain until 18.09. */}
                              {item.assetId && !item.isCompleted && linkedChecklistAssets[item.assetId]?.barcodeValue && (
                                <div className="ml-8 mt-2 bg-white p-3 rounded-xl flex flex-col items-center justify-center border border-zinc-200 dark:border-zinc-700 self-start">
                                  <p className="font-semibold text-zinc-900 mb-2 text-xs">{linkedChecklistAssets[item.assetId].name}</p>
                                  <AssetBarcode
                                    value={linkedChecklistAssets[item.assetId].barcodeValue}
                                    format={linkedChecklistAssets[item.assetId].barcodeFormat}
                                    size="sm"
                                    language={language}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          )}

          {/* Why there is no checklist, and what to do about it.

              Shown only when the trigger recorded a failure. `ai_assistant` has been removed by
              then — it fires once, so leaving it would promise work that can never run — which is
              why the skeleton below no longer draws and this takes its place. */}
          {!aiOutcomeDone && event.aiChecklist?.status === 'failed' && (
            <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> {t('aiChecklistNotGenerated', language)}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {t(checklistReasonKey(event.aiChecklist.reason), language)}
              </p>
              {/* When the note is not from today, say when it IS from.

                  Four of the sentences above were written for the moment of refusal and say
                  "today" and "tomorrow" — true when the trigger ran, and a lie every day after.
                  An event created last week still advised waiting until tomorrow, while Retry
                  would have worked immediately. The timestamp was already being stored and simply
                  never shown.

                  `at` is an INSTANT, unlike an event's `date`, so formatting it in the reader's
                  own zone is the correct thing to do rather than the trap. */}
              {(() => {
                const at = event.aiChecklist.at;
                const when = typeof at === 'string' ? new Date(at) : null;
                if (!when || Number.isNaN(when.getTime())) return null;
                if (localDayKey(when) === localDayKey(new Date())) return null;
                return (
                  <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-0.5">
                    {t('aiChecklistNotedOn', language)
                      .replace('{date}', format(when, 'd MMM', { locale: dateLocale }))}
                  </p>
                );
              })()}
              {aiRetryError && (
                <p className="text-xs text-red-700 dark:text-red-400 mt-1.5">{aiRetryError}</p>
              )}
              {canEdit && checklistWorthRetrying(event.aiChecklist.reason) && (
                <button
                  type="button"
                  onClick={handleRetryAiChecklist}
                  disabled={aiRetrying}
                  className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-60 flex items-center gap-1.5"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${aiRetrying ? 'animate-pulse' : ''}`} />
                  {aiRetrying ? t('generatingChecklist', language) : t('retry', language)}
                </button>
              )}
            </div>
          )}

          {/* AI Generating Skeletons */}
          {checklist.length === 0 && event.assigneeIds?.includes('ai_assistant') && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" /> {t('generatingChecklist', language)}
              </p>
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <div className="w-5 h-5 rounded-full border border-zinc-200 dark:border-zinc-700 shrink-0"></div>
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3"></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked Asset Barcode / Details */}
          {/* The card was attached but cannot be read. Saying so where it would have been, rather
              than rendering nothing: the person is standing at a till looking for it. The wording
              covers both causes because the rules cannot tell them apart — see the state above. */}
          {event.assetId && mainAssetDenied && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <Wallet className="w-4 h-4" /> {t('linkedAssetCode', language)}
              </p>
              <p className="text-xs text-amber-600 font-medium">
                {t(event.groupId ? 'cardNotSharedWithGroup' : 'cardUnavailable', language)}
              </p>
            </div>
          )}

          {linkedAsset && linkedAsset.barcodeValue && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <Wallet className="w-4 h-4" /> {t('linkedAssetCode', language)}
              </p>
              <div className="bg-white p-4 rounded-xl flex flex-col items-center justify-center w-full min-h-[150px] border border-zinc-200 dark:border-zinc-700">
                <p className="font-semibold text-zinc-900 mb-4 text-center">{linkedAsset.name}</p>
                <AssetBarcode
                  value={linkedAsset.barcodeValue}
                  format={linkedAsset.barcodeFormat}
                  size="md"
                  language={language}
                />
              </div>
            </div>
          )}

          {/* The same refusal, seen from the only side that can end it. */}
          {cardsToShare.length > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                {t(cardsToShare.length === 1 ? 'cardHiddenFromGroup' : 'cardsHiddenFromGroup', language).replace(
                  '{group}',
                  groupNameOf(groups || [], event.groupId) || t('group', language),
                )}
              </p>
              {shareCardNames && (
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">{shareCardNames}</p>
              )}
              <button
                type="button"
                onClick={shareCardsNow}
                disabled={sharingCards}
                className="mt-2 text-xs font-semibold text-amber-900 dark:text-amber-100 underline underline-offset-2 disabled:opacity-50"
              >
                {sharingCards ? t('sharingCards', language) : t('shareCardsWithGroup', language)}
              </button>
              {shareCardsFailed && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t('shareCardsFailed', language)}</p>
              )}
            </div>
          )}

          {/* Image Attachment */}
          {event.imageUrl && (
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4" /> {t('attachedAsset', language)}
              </p>
              <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setFullScreenImage(event.imageUrl)}>
                <img src={event.imageUrl} alt={t('altEventAttachment', language)} className="w-full h-auto max-h-48 object-contain" />
              </div>
            </div>
          )}
          
        </div>

        {/* Footer */}
        {isOwner && (
          <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex justify-end">
            <button 
              onClick={handleDelete}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> {t('deleteEventAction', language)}
            </button>
          </div>
        )}

      </div>

      {/* Full Screen Image Modal */}
      {fullScreenImage && (
        <div onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }} ref={lightbox.dialogRef} {...lightbox.dialogProps} className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-pointer">
          <img src={fullScreenImage} className="max-w-full max-h-full object-contain animate-in fade-in zoom-in duration-200" alt={t('altFullScreenAsset', language)} />
          <button aria-label={t('closeAction', language)} className="absolute top-4 right-4 text-white/50 hover:text-white bg-black/50 hover:bg-black/80 transition-all p-2 rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
