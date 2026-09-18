import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar as CalendarIcon, Image as ImageIcon, Wallet, Trash2, CheckCircle2, Sparkles, GripVertical, Search, Check } from 'lucide-react';
import { addDoc, collection, query, where, updateDoc, doc, getDoc } from 'firebase/firestore';
import { liveQuery } from '../utils/liveQuery';
import { mergeAssets, shareFieldsFor } from '../utils/assetSharing';
import { localZone, timeFieldsFor, endFieldsFor, spanOf, dayOf, dayPlus, dayOffsetBetween } from '../utils/eventTime';
import { formSpan, SPAN_MESSAGE_KEY } from '../utils/eventForm';
import { keepAssignees } from '../utils/eventTargeting';
import { sharesForAttachments } from '../utils/assetAttach';
import { groupNameOf } from '../utils/assetSharing';
// Not imported before: `reportError` here resolved to the DOM global, which takes one argument
// and reports to the console instead of to errorLogs. TypeScript caught it; nothing else would.
import { reportError } from '../reportError';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { generateChecklistForTask, suggestEventCategoryAI, suggestAssetForTextAI } from '../ai';
import { notifyUsers } from '../notifications';
import { createEventOverride } from '../serverActions';
import { format } from 'date-fns';
import { getRecurrenceEndDate, getFrequencyLabel } from '../utils/recurrence';
import { useDialog } from '../hooks/useDialog';
import { useMenu } from '../hooks/useMenu';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import * as chrono from 'chrono-node';
import { EVENT_COLORS, eventSwatchClass } from '../utils/eventColors';
import { shiftedSeriesStart } from '../utils/recurrence';
import { createAskScheduler, type AskScheduler } from '../utils/aiSuggestionGate';

interface ChecklistItem {
  id: string;
  text: string;
  isCompleted: boolean;
  assetUrl?: string | null; // Optional image attachment for this item
  assetFile?: File; // Temporary file before upload
  selectedAssetUrl?: string | null; // Image picked from wallet
  assetId?: string | null; // Asset ID from wallet
}

interface AddEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  editEvent?: any;
  initialTemplate?: any;
  userMap?: Record<string, any>;
  activeGroupId?: string | 'personal';
  groups?: any[];
}

const CATEGORIES = [
  { id: 'work', label: 'Work', color: 'bg-blue-500', defaultShared: false },
  { id: 'family_time', label: 'Group Time', color: 'bg-emerald-500', defaultShared: true },
  { id: 'chores', label: 'Chores/Errands', color: 'bg-amber-500', defaultShared: true },
  { id: 'health', label: 'Health/Medical', color: 'bg-rose-500', defaultShared: false },
  { id: 'other', label: 'Other', color: 'bg-zinc-500', defaultShared: false },
];

const PREDEFINED_EMOJIS = [
  '🎂', '🎉', '🥂', '⚽', '🛒', '💼', '✈️', '🚗', '⚕️', '💊',
  '📚', '🎓', '🎬', '🍿', '🎵', '🎮', '🧩', '🔧', '🧹', '🧺',
  '🍔', '🍕', '☕', '🍷', '🌿', '🐾', '💰', '💳', '🎁', '📅',
  '❤️', '⭐', '🔥', '💡', '📌'
];

// Reminder presets (minutes before the event) that have their own dropdown
// option; any other value is treated as a custom reminder.
const PRESET_REMINDERS = [0, 15, 60, 1440];
const REMINDER_UNIT_TO_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const;
type ReminderUnit = keyof typeof REMINDER_UNIT_TO_MINUTES;

export default function AddEventModal({ isOpen, onClose, selectedDate, editEvent, initialTemplate, userMap = {}, activeGroupId = 'personal', groups = [] }: AddEventModalProps) {
  const { language, timezone } = useThemeStore();
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState<string>('');
  const [description, setDescription] = useState('');
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [color, setColor] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [isTask, setIsTask] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isSuggestingCategory, setIsSuggestingCategory] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error' | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (descriptionRef.current) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
    }
  }, [description]);
  const [users, setUsers] = useState<{id: string, name: string}[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('none');
  const [editScope, setEditScope] = useState<'this' | 'all' | null>(null);
  // Who is deliberately left OUT. The field used to be `visibleTo` — who may see it,
  // snapshotted when the event was written — and an allow-list cannot tell "excluded" from
  // "was not here yet", so it aged into a lie whenever somebody joined. See eventScope.ts.
  const [hiddenFrom, setHiddenFrom] = useState<string[]>([]);
  const [rsvpEnabled, setRsvpEnabled] = useState(false);
  const [location, setLocation] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);
  // '' means an all-day event, which is what every event in the app was until now.
  const [eventTime, setEventTime] = useState<string>('');
  // The form thinks in an end DATE, because that is what a person means by "until Thursday"; the
  // event stores an OFFSET, because that is what a recurring occurrence inherits unchanged.
  // `dayOffsetBetween` is the join, and it is the only place the two meet.
  const [endDate, setEndDate] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [showEnd, setShowEnd] = useState(false);

  // What will actually be stored, and why it might be refused. Derived rather than held in state
  // so the form cannot disagree with itself, and computed in src/utils/eventForm.ts so it can be
  // RUN: this screen is behind a login, and a decision that lives only in a component is one no
  // gate in this repo can see. The refusal itself is `spanProblem`, which the server applies to an
  // override too, so the two cannot come to different conclusions about the same event.
  const { offset: spanOffset, issue: spanIssue } = formSpan({
    startDay: eventDate, endDay: endDate, startTime: eventTime, endTime, showEnd,
  });
  const spanError = spanIssue ? t(SPAN_MESSAGE_KEY[spanIssue], language) : null;
  const [customReminder, setCustomReminder] = useState(false);
  const [customReminderValue, setCustomReminderValue] = useState('');
  const [customReminderUnit, setCustomReminderUnit] = useState<ReminderUnit>('minutes');

  // Set reminderMinutes and, for non-preset values, switch the UI into custom
  // mode decomposed into a value + unit (used on edit/draft/reset loads).
  const applyReminder = (rm: number | null) => {
    setReminderMinutes(rm);
    if (rm !== null && !PRESET_REMINDERS.includes(rm)) {
      setCustomReminder(true);
      if (rm % 1440 === 0) { setCustomReminderUnit('days'); setCustomReminderValue(String(rm / 1440)); }
      else if (rm % 60 === 0) { setCustomReminderUnit('hours'); setCustomReminderValue(String(rm / 60)); }
      else { setCustomReminderUnit('minutes'); setCustomReminderValue(String(rm)); }
    } else {
      setCustomReminder(false);
      setCustomReminderValue('');
      setCustomReminderUnit('minutes');
    }
  };
  
  // Wallet Assets
  const [ownedAssets, setOwnedAssets] = useState<any[]>([]);
  // Cards other people shared with the group this event belongs to. Kept separate from the owned
  // list so a failure to read one never empties the other.
  const [groupSharedAssets, setGroupSharedAssets] = useState<any[]>([]);
  const assets = React.useMemo(
    () => mergeAssets(ownedAssets, [groupSharedAssets]),
    [ownedAssets, groupSharedAssets],
  );
  const [assetsLoadError, setAssetsLoadError] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState<'main' | string | null>(null); // 'main' or checklistItem id
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [removeMainImage, setRemoveMainImage] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(activeGroupId);
  const [showOwnerProfile, setShowOwnerProfile] = useState(false);

  // New UX features states
  const [suggestedAsset, setSuggestedAsset] = useState<any | null>(null);
  const [lastAddedItemId, setLastAddedItemId] = useState<string | null>(null);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [saveUploadsToWallet, setSaveUploadsToWallet] = useState(false);

  const { dialogRef, dialogProps } = useDialog(isOpen, onClose, {
    label: editEvent ? t('edit', language) : t('addNewEvent', language),
  });

  // Asking which asset a piece of text is about: at most once per distinct question, and only
  // after the person has stopped. The rules and the timing both live in the scheduler, which is
  // tested on a fake clock in src/utils/aiSuggestionGate.test.ts — a second copy of them here is
  // how one version ends up proven and a different one shipped.
  //
  // Declared with the other hooks, ABOVE the `if (!isOpen) return null` below. CalendarHome keeps
  // this modal permanently mounted, so a hook past that guard appears and disappears between
  // renders of one instance: React error #310, which this app has already shipped once.
  const runAskRef = useRef<(text: string) => void>(() => {});
  const askSchedulerRef = useRef<AskScheduler | null>(null);
  if (!askSchedulerRef.current) {
    askSchedulerRef.current = createAskScheduler((text) => runAskRef.current(text));
  }

  useEffect(() => {
    // A fresh event is a fresh set of questions — the same words for a different event are worth
    // asking again. `reset` also drops anything pending, which matters on close: an ask that
    // survived would spend a call on a form nobody is looking at and land its suggestion on the
    // NEXT event opened.
    askSchedulerRef.current?.reset();
    return () => askSchedulerRef.current?.cancel();
  }, [isOpen]);

  // The asset picker opens on top of this form. Escape used to close the form underneath it and
  // throw away the whole edit.
  const assetPicker = useDialog(Boolean(showAssetPicker), () => setShowAssetPicker(null), {
    label: t('pickFromAssets', language),
  });

  // The owner card is the case that decided menus and dialogs share one stack: it floats INSIDE
  // this form, so Escape has to reach the card and stop there. Two stacks would have closed the
  // form with it and thrown away the edit — the original defect, in a new costume.
  //
  // Gated on `isOpen` too: this modal is never unmounted, only hidden behind `return null`, so a
  // card left open would keep registering as an overlay with nothing on screen — top of the stack,
  // eating the next Escape, and freezing the calendar's arrow keys behind it.
  const ownerCard = useMenu(isOpen && showOwnerProfile, () => setShowOwnerProfile(false), {
    kind: 'popover',
    label: t('viewOwner', language),
  });

  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;
    // Derive the assignee list from the group/family members already loaded by
    // CalendarHome (userMap) instead of reading the entire `users` collection.
    // This avoids enumerating every account in the app and keeps assignees
    // scoped to people the current user actually shares a group/family with.
    setUsers(
      Object.values(userMap)
        .map((u: any) => ({ id: u.id, name: u.name || u.email }))
        .filter((user) => user.id && user.id !== auth.currentUser?.uid)
    );

    // Fetch the current user's wallet assets. Must be filtered server-side by
    // ownerId — the Firestore rules only permit reading assets you own, so an
    // unfiltered query is rejected (permission-denied). (sharedWithFamily assets
    // owned by others aren't readable under the current rule — see DEVLOG.)
    const uid = auth.currentUser.uid;
    const assetsQuery = query(collection(db, 'assets'), where('ownerId', '==', uid));
    const unsubAssets = liveQuery<any>(assetsQuery, 'AddEventModal.assets',
      (docs) => { setAssetsLoadError(false); setOwnedAssets(docs); },
      // Deliberately does NOT clear `assets`: emptying the list on failure turned a denied read
      // into "you own nothing", and threw away a picker that was already populated when a late
      // failure arrived. Same query and same collection as the Wallet screen, which says so.
      () => setAssetsLoadError(true));

    return () => unsubAssets();
  }, [isOpen]);

  // While composing for a group, the group's shared wallet cards are offerable too — the read
  // rule allows them because we are a member, and the picker is the one place you would look.
  useEffect(() => {
    if (!isOpen || !auth.currentUser || !selectedGroupId || selectedGroupId === 'personal') {
      setGroupSharedAssets([]);
      return;
    }
    const unsub = liveQuery<any>(
      query(collection(db, 'assets'), where('sharedGroupId', '==', selectedGroupId)),
      'AddEventModal.sharedAssets',
      (docs) => setGroupSharedAssets(docs),
      // Same rule as the owned list: a denied read must not be shown as "nothing is shared".
      () => {},
    );
    return () => unsub();
  }, [isOpen, selectedGroupId]);

  useEffect(() => {
    if (editEvent && isOpen) {
      setTitle(editEvent.title || '');
      // The stored day, read the SAME way the end is read — out of the instant in UTC, which is
      // how every date in this app is written. `format(new Date(ev.date), …)` formats that instant
      // LOCALLY, and for anyone west of Greenwich a midnight-UTC instant is the previous evening:
      // the field showed 19 September for an event stored on the 20th, and saving wrote that back.
      //
      // That was wrong before spans existed and merely moved the event a day. With an end it
      // compounds: the end is read in UTC, the start locally, and the difference between them is
      // the offset that gets STORED — so a three-day trip opened in New York saved as four days,
      // then five, then six, with no gesture from anybody because the autosave fires a second
      // later. Proven: the local day of 2026-09-20T00:00:00Z is the 19th in New York and Los
      // Angeles, the 20th in Bucharest, London and Auckland.
      setEventDate(dayOf(editEvent.date) || format(new Date(), 'yyyy-MM-dd'));
      setDescription(editEvent.description || '');
      setChecklistItems(editEvent.checklistItems || []);
      setCategory(CATEGORIES.find(c => c.id === editEvent.categoryId) || CATEGORIES[0]);
      setColor(editEvent.color || null);
      setEmoji(editEvent.emoji || null);
      setIsTask(editEvent.isTask || false);
      setAssigneeIds(editEvent.assigneeIds || (editEvent.assigneeId ? [editEvent.assigneeId] : []));
      // `editEvent.visibleTo` is deliberately NOT read. Measured on live before dropping it:
      // not one group event carried an audience narrower than the snapshot taken when it was
      // written, and one named two people who were not even in its group.
      setHiddenFrom(Array.isArray(editEvent.hiddenFrom) ? editEvent.hiddenFrom : []);
      setRemoveMainImage(false);
      // These three were reset only on the NEW-event branch. The modal is mounted once and
      // never unmounted, so a card picked in an add-form that was closed without saving stayed
      // selected and was written onto the next event EDITED — and, since sharing was added
      // today, shared with that event's group as well. Found by review, not by anybody noticing.
      setImageFile(null);
      setSelectedAssetUrl(null);
      setSelectedAssetId(null);
      setSelectedGroupId(editEvent.groupId || 'personal');
      setRsvpEnabled(!!editEvent.rsvpEnabled);
      setLocation(editEvent.location || '');
      applyReminder(editEvent.reminderMinutes || null);
      setEventTime(typeof editEvent.time === 'string' ? editEvent.time : '');
      // Loaded from the OCCURRENCE, which for a series carries the parent's offset applied to its
      // own day — so editing one occurrence of a two-day series shows that occurrence's two days,
      // not the series start's. Without this, every edit of a multi-day event would quietly
      // collapse it back to a single day on the next save.
      {
        const span = spanOf(editEvent);
        const hasSpan = !!span && (span.offset > 0 || !!span.endTime);
        setEndDate(hasSpan ? span!.endDay : '');
        setEndTime(hasSpan && span!.endTime ? span!.endTime : '');
        setShowEnd(hasSpan);
      }
      // Default to the harmless choice, and reset it on every open.
      //
      // It used to start as null and was never reset, so two things went wrong at once:
      // saving without touching the choice fell through to "all occurrences", and a choice
      // of "all" made once stayed selected for the next event edited in the same session.
      // Asking for a confirmation was considered and rejected — people click past those.
      // The fix is that forgetting does the thing you can undo.
      setEditScope('this');
    } else if (isOpen && !editEvent) {
      let loadedDraft = false;
      const draftJSON = localStorage.getItem('ourDays_draftEvent');
      if (draftJSON) {
        try {
          const parsed = JSON.parse(draftJSON);
          if (window.confirm(t('draftRestorePrompt', language))) {
            setTitle(parsed.title || '');
            if (parsed.eventDate) setEventDate(parsed.eventDate);
            setDescription(parsed.description || '');
            if (parsed.checklistItems) setChecklistItems(parsed.checklistItems);
            if (parsed.categoryId) {
              const cat = CATEGORIES.find(c => c.id === parsed.categoryId);
              if (cat) setCategory(cat);
            }
            if (parsed.color !== undefined) setColor(parsed.color);
            if (parsed.emoji !== undefined) setEmoji(parsed.emoji);
            if (parsed.isTask !== undefined) setIsTask(parsed.isTask);
            if (parsed.assigneeIds) setAssigneeIds(parsed.assigneeIds);
            if (parsed.hiddenFrom) setHiddenFrom(parsed.hiddenFrom);
            if (parsed.selectedGroupId) setSelectedGroupId(parsed.selectedGroupId);
            if (parsed.repeat) setRepeat(parsed.repeat);
            if (parsed.rsvpEnabled !== undefined) setRsvpEnabled(parsed.rsvpEnabled);
            if (parsed.location !== undefined) setLocation(parsed.location);
            if (parsed.reminderMinutes !== undefined) applyReminder(parsed.reminderMinutes);
            if (typeof parsed.eventTime === 'string') setEventTime(parsed.eventTime);
            if (typeof parsed.endDate === 'string') setEndDate(parsed.endDate);
            if (typeof parsed.endTime === 'string') setEndTime(parsed.endTime);
            if (parsed.endDate || parsed.endTime) setShowEnd(true);
            loadedDraft = true;
          } else {
            localStorage.removeItem('ourDays_draftEvent');
          }
        } catch(e) {}
      }

      if (!loadedDraft) {
        setTitle(initialTemplate?.title || '');
        setEventDate(selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
        // This modal is never unmounted — CalendarHome only toggles `isOpen` — so anything not
        // reset here survives into the next event. Without these three, opening a three-day trip
        // and then tapping + carried the trip's end date into the new event: saved silently as
        // multi-day if the date was later, or refused with an error about a field nobody touched.
        setEndDate('');
        setEndTime('');
        setShowEnd(false);
        setShowOwnerProfile(false);
        setDescription('');
        setChecklistItems([]);
        setCategory(initialTemplate?.category ? CATEGORIES.find(c => c.id === initialTemplate.category) || CATEGORIES[0] : CATEGORIES[0]);
        setColor(initialTemplate?.color || null);
        setEmoji(initialTemplate?.emoji || null);
        setIsTask(initialTemplate?.isTask || false);
        setAssigneeIds(initialTemplate?.assigneeIds || []);
        setRepeat('none');
        setHiddenFrom([]);  // a new event is the whole group's until somebody is unticked
        setSelectedGroupId(activeGroupId);
        setRsvpEnabled(false);
        setLocation('');
        applyReminder(null);
      }
      setImageFile(null);
      setSelectedAssetUrl(null);
      setSelectedAssetId(null);
      setRemoveMainImage(false);
    }
    setShowOwnerProfile(false);
  }, [editEvent, isOpen, userMap, activeGroupId]);

  // Autosave draft
  useEffect(() => {
    if (isOpen && !editEvent) {
      const draft = {
        title, eventDate, eventTime, endDate, endTime, description, checklistItems, categoryId: category.id, color, emoji, isTask, assigneeIds, hiddenFrom, selectedGroupId, repeat, rsvpEnabled, location, reminderMinutes
      };
      if (title || description || checklistItems.length > 0) {
        localStorage.setItem('ourDays_draftEvent', JSON.stringify(draft));
      } else {
        localStorage.removeItem('ourDays_draftEvent');
      }
    }
    // `eventTime` was missing here before spans existed, so an end-only change would have
    // inherited the same silence: the draft is what survives the app being killed, and the one
    // field this feature added was the one it would not have saved.
  }, [title, eventDate, eventTime, endDate, endTime, showEnd, description, checklistItems, category, color, emoji, isTask, assigneeIds, hiddenFrom, selectedGroupId, repeat, rsvpEnabled, location, reminderMinutes, isOpen, editEvent]);

  //
  // The ids the event will actually STORE. Built from the same expression as `assetId` on the
  // write (`removeMainImage ? null : selectedAssetId || editEvent.assetId`), because a review
  // found the two disagreeing: on an EDIT `selectedAssetId` is null unless the picker was
  // reopened, so the main card — the biggest barcode on the other person's screen — was written
  // onto a group event and never shared, and the notice below stayed silent about it.
  const attachedAssetIds = React.useCallback(
    (items: any[]) => [
      // `imageFile` first: choosing a photo REPLACES the card as the event's image, and without
      // this the expression falls through to `editEvent.assetId` and shares the card you just
      // swapped out. (The event document still stores that stale assetId — a separate,
      // pre-existing bug, recorded in OWNER_VERIFY rather than widened into here.)
      imageFile || removeMainImage ? null : (selectedAssetId || (editEvent ? editEvent.assetId : null)),
      ...items.map((i: any) => i && i.assetId),
    ],
    [imageFile, removeMainImage, selectedAssetId, editEvent],
  );

  const cardsToShare = React.useMemo(
    () => sharesForAttachments(
      assets,
      attachedAssetIds(checklistItems),
      selectedGroupId !== 'personal' ? selectedGroupId : null,
      auth.currentUser?.uid || '',
    ),
    [assets, attachedAssetIds, checklistItems, selectedGroupId],
  );

  // Called after the event is written, on the two paths a PERSON can take: saving an edit and
  // creating. Never from the autosave — see the note there.
  const shareAttachedCards = React.useCallback(async (items: any[]) => {
    const shares = sharesForAttachments(
      assets,
      attachedAssetIds(items),
      selectedGroupId !== 'personal' ? selectedGroupId : null,
      auth.currentUser?.uid || '',
    );
    for (const { assetId, sharedGroupId } of shares) {
      try {
        await updateDoc(doc(db, 'assets', assetId), shareFieldsFor(sharedGroupId));
      } catch (err) {
        // The event is already saved; the card simply stays private. Reported rather than
        // swallowed, because the only symptom on the other person's screen is a missing barcode.
        reportError(err instanceof Error ? err.message : String(err), { context: 'AddEventModal.shareAttachedCard' });
      }
    }
  }, [assets, attachedAssetIds, selectedGroupId]);

  // Auto-save edits to Firestore
  useEffect(() => {
    if (isOpen && editEvent) {
      if (!title.trim() || !eventDate) return;
      // Autosave is the second write path and needs its own guard: the submit button can be
      // blocked while this effect keeps writing every second, which is how a half-typed end would
      // otherwise reach the database.
      if (spanIssue) return;
      // An occurrence of a repeating series has a synthetic id and no document behind it, so this
      // wrote into nothing on every debounce tick — and it ignores `editScope` entirely, which is
      // the reason NOT to simply route it through createEventOverride: on a debounce that would
      // mint an override per typing pause and litter the parent's exception list. Saving is left
      // to handleSubmit, which already asks whether you mean this one or all of them.
      if (editEvent.isRecurringInstance) return;
      
      setAutoSaveStatus('saving');
      const timeoutId = setTimeout(async () => {
        try {
          let imageUrl = removeMainImage ? null : (selectedAssetUrl || editEvent.imageUrl);
          
          const safeChecklistItems = checklistItems.map(item => ({
            id: item.id,
            text: item.text,
            isCompleted: item.isCompleted,
            assetUrl: item.assetUrl || null,
            assetId: item.assetId || null
          }));

          const baseEventData = {
            title,
            description,
            date: new Date(eventDate).toISOString(),
            checklistItems: safeChecklistItems,
            categoryId: category.id,
            color: color,
            groupId: selectedGroupId !== 'personal' ? selectedGroupId : null,
            hiddenFrom: selectedGroupId !== 'personal' ? hiddenFrom : [],
            imageUrl: imageUrl,
            isTask,
            assigneeIds,
            assigneeId: assigneeIds[0] || null,
            assetId: removeMainImage ? null : (selectedAssetId || editEvent.assetId),
            updatedAt: new Date().toISOString(),
            rsvpEnabled: rsvpEnabled,
            location: location,
            reminderMinutes: reminderMinutes,
        ...timeFieldsFor(eventTime, timezone || localZone()),
            ...endFieldsFor(spanOffset, endTime, !!eventTime)
          };

          await updateDoc(doc(db, 'events', editEvent.id), baseEventData);
          // No sharing here, deliberately, and it was here for one round of review. Autosave is
          // a draft-keeper: it runs a second after the form is POPULATED, before you have done
          // anything, so sharing from it widened access with no gesture behind it — it shared
          // with the group you were moving AWAY from, and `other-group` then refused to re-point
          // it at the real one. Closing the window could not call it back either.
          //
          // So the widening waits for Save, next to the line that warns about it. An edit that
          // is only autosaved leaves the card private, and the other person is now TOLD that
          // rather than seeing a row with no code (EventDetailsModal).
          setAutoSaveStatus('saved');
        } catch (e) {
          console.error('Autosave error', e);
          setAutoSaveStatus('error');
        }
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
    // `eventTime` was already missing here before spans existed — a time-only change was not
    // re-saved until something else changed — so the end fields are added alongside it rather than
    // inheriting the same quirk.
  }, [title, eventDate, eventTime, endDate, endTime, showEnd, spanIssue, description, checklistItems, category, color, isTask, assigneeIds, hiddenFrom, selectedGroupId, removeMainImage, selectedAssetId, selectedAssetUrl, rsvpEnabled, location, reminderMinutes, isOpen, editEvent]);

  if (!isOpen) return null;

  const handleCategoryChange = (cat: typeof CATEGORIES[0]) => {
    setCategory(cat);
  };

  // The checkbox still reads "this person can see it" — only what gets STORED is the
  // complement, so unticking is what leaves a trace and joining the group later leaves none.
  const toggleVisibility = (userId: string) => {
    setHiddenFrom(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // Attaching one of your wallet cards to a GROUP event makes it readable by that group, which
  // is the point — but it is still a widening of who can see something in your wallet, and the
  // card only says so afterwards, on another screen. Said here, before the save, using exactly
  // the decision the save will make.
  const toggleAssignee = (userId: string) => {
    setAssigneeIds(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };



  const runAssetSuggestion = async (text: string) => {
    try {
      const assetId = await suggestAssetForTextAI(text, assets);
      if (assetId) {
        const matchedAsset = assets.find(a => a.id === assetId);
        if (matchedAsset && suggestedAsset?.id !== matchedAsset.id) {
          setSuggestedAsset(matchedAsset);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };
  runAskRef.current = (text: string) => { void runAssetSuggestion(text); };

  /**
   * Ask which asset this text is about — at most once per distinct question, and only after the
   * person has stopped.
   *
   * This used to be a direct call on three events: the title losing focus, every checklist item
   * added, and every checklist item losing focus. Blurring an item you had not edited asked the
   * same question again, so a six-item list sent about thirteen calls with half of them repeats.
   * Measured in src/utils/aiSuggestionGate.test.ts: the same list now sends seven.
   *
   * The timer keeps only the LATEST text, which is right rather than merely cheap — the feature
   * sets ONE suggested asset, so the freshest thing typed is the one worth asking about. A normal
   * pause between items is longer than the interval, so they still get asked about individually;
   * only a genuine burst collapses.
   */
  const checkForAssetSuggestionsAI = (text: string) => {
    // Nothing to match against, or the person has already chosen — the one judgement that belongs
    // here rather than in the scheduler, because it is about this form, not about the question.
    if (selectedAssetId || assets.length === 0) return;
    askSchedulerRef.current?.request(text);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    
    // Chrono natural language date parsing with Romanian support
    if (!editEvent) {
      let parseableTitle = newTitle.toLowerCase();
      
      // Keywords
      parseableTitle = parseableTitle.replace(/\bmaine\b/g, 'tomorrow');
      parseableTitle = parseableTitle.replace(/\bazi\b/g, 'today');
      parseableTitle = parseableTitle.replace(/\bpoimaine\b/g, 'in 2 days');
      
      // Days of week
      parseableTitle = parseableTitle.replace(/\bluni\b/g, 'monday');
      parseableTitle = parseableTitle.replace(/\bmarti\b/g, 'tuesday');
      parseableTitle = parseableTitle.replace(/\bmiercuri\b/g, 'wednesday');
      parseableTitle = parseableTitle.replace(/\bjoi\b/g, 'thursday');
      parseableTitle = parseableTitle.replace(/\bvineri\b/g, 'friday');
      parseableTitle = parseableTitle.replace(/\bsambata\b/g, 'saturday');
      parseableTitle = parseableTitle.replace(/\bduminica\b/g, 'sunday');
      
      // Months
      parseableTitle = parseableTitle.replace(/\bianuarie\b/g, 'january');
      parseableTitle = parseableTitle.replace(/\bfebruarie\b/g, 'february');
      parseableTitle = parseableTitle.replace(/\bmartie\b/g, 'march');
      parseableTitle = parseableTitle.replace(/\baprilie\b/g, 'april');
      parseableTitle = parseableTitle.replace(/\bmai\b/g, 'may');
      parseableTitle = parseableTitle.replace(/\biunie\b/g, 'june');
      parseableTitle = parseableTitle.replace(/\biulie\b/g, 'july');
      parseableTitle = parseableTitle.replace(/\baugust\b/g, 'august');
      parseableTitle = parseableTitle.replace(/\bseptembrie\b/g, 'september');
      parseableTitle = parseableTitle.replace(/\boctombrie\b/g, 'october');
      parseableTitle = parseableTitle.replace(/\bnoiembrie\b/g, 'november');
      parseableTitle = parseableTitle.replace(/\bdecembrie\b/g, 'december');
      
      const parsed = chrono.parse(parseableTitle);
      if (parsed && parsed.length > 0) {
        const parsedDate = parsed[0].start.date();
        setEventDate(format(parsedDate, 'yyyy-MM-dd'));
      }
    }
  };

  const handleTitleBlur = async () => {
    if (!title.trim() || editEvent) return;
    setIsSuggestingCategory(true);
    try {
      const suggestedCategoryId = await suggestEventCategoryAI(title, description);
      if (suggestedCategoryId) {
        const cat = CATEGORIES.find(c => c.id === suggestedCategoryId);
        if (cat) setCategory(cat);
      }
      checkForAssetSuggestionsAI(title);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSuggestingCategory(false);
    }
  };

  const handleAddChecklistItem = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newItemText.trim()) return;
    const addedText = newItemText;
    const newId = Date.now().toString();
    setChecklistItems([
      ...checklistItems, 
      { id: newId, text: addedText, isCompleted: false }
    ]);
    setNewItemText('');
    setLastAddedItemId(newId);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    checkForAssetSuggestionsAI(addedText);
  };

  const handleGenerateChecklist = async () => {
    if (!title.trim()) {
      alert(t('titleFirstForAi', language));
      return;
    }
    setIsGeneratingAI(true);
    try {
      const suggestions = await generateChecklistForTask(title, description);
      if (suggestions.length === 0) {
        alert(t('aiNoChecklist', language));
        return;
      }
      
      const eventTitleLower = title.toLowerCase();
      const supermarkets = ['mega', 'auchan', 'penny', 'kaufland', 'carrefour', 'lidl', 'profi', 'profi', 'kaufland', 'carrefour', 'lidl'];
      const activeSupermarkets = supermarkets.filter(sm => eventTitleLower.includes(sm));
      
      const newItems = suggestions.map(text => {
        const lowerText = text.toLowerCase();
        const itemWords = lowerText.split(/\s+/).filter(w => w.length > 2);
        
        let bestAssetMatch: any = null;
        let highestScore = 0;

        assets.forEach(asset => {
          const assetNameLower = asset.name.toLowerCase();
          let score = 0;
          
          // Contextual supermarket match
          const matchesSupermarket = activeSupermarkets.some(sm => assetNameLower.includes(sm));
          const belongsToAnySupermarket = supermarkets.some(sm => assetNameLower.includes(sm));
          
          if (matchesSupermarket) score += 30; // Very high priority for contextual brands
          else if (belongsToAnySupermarket && activeSupermarkets.length > 0) score -= 50; // Huge penalty if it belongs to a DIFFERENT supermarket
          
          // Direct exact match
          if (assetNameLower === lowerText) score += 20;
          else if (assetNameLower.includes(lowerText) || lowerText.includes(assetNameLower)) score += 10;
          
          // Word overlap
          const assetWords = assetNameLower.split(/\s+/).filter((w: string) => w.length > 2);
          let overlap = 0;
          itemWords.forEach((iw: string) => {
            if (assetWords.some((aw: string) => aw === iw || aw.includes(iw) || iw.includes(aw))) overlap++;
          });
          
          score += (overlap * 5);

          if (overlap > 0 && score > highestScore) {
            highestScore = score;
            bestAssetMatch = asset;
          }
        });

        return {
          id: Date.now().toString() + Math.random(),
          text,
          isCompleted: false,
          assetId: bestAssetMatch && highestScore > 0 ? bestAssetMatch.id : null,
          selectedAssetUrl: bestAssetMatch && highestScore > 0 ? (bestAssetMatch.imageUrl || null) : null
        };
      });
      
      setChecklistItems(prev => [...prev, ...newItems]);
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    } catch (error: any) {
      alert(t('checklistFailed', language));
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleRemoveChecklistItem = (id: string) => {
    setChecklistItems(checklistItems.filter(item => item.id !== id));
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(checklistItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setChecklistItems(items);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  };

  const handleEditChecklistText = (id: string, newText: string) => {
    setChecklistItems(checklistItems.map(item => item.id === id ? { ...item, text: newText } : item));
  };

  const handleChecklistItemImage = (id: string, file: File) => {
    setChecklistItems(checklistItems.map(item => 
      item.id === id ? { ...item, assetFile: file } : item
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedDate) return;
    // The message is already on screen beside the fields; this stops the write.
    if (spanIssue) return;

    setLoading(true);
    try {
      let imageUrl = null;
      if (imageFile) {
        const fileRef = ref(storage, `events/${auth.currentUser?.uid}/${Date.now()}_${imageFile.name}`);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);

        if (saveUploadsToWallet) {
          await addDoc(collection(db, 'assets'), {
            name: title || 'Event Image',
            category: 'Uncategorized',
            categories: ['Uncategorized'],
            imageUrl: imageUrl,
            ownerId: auth.currentUser?.uid,
            createdAt: new Date().toISOString(),
            ...shareFieldsFor(selectedGroupId)
          });
        }
      } else if (selectedAssetUrl) {
        imageUrl = selectedAssetUrl;
      }

      // Upload checklist images
      const uploadedChecklistItems = await Promise.all(checklistItems.map(async (item) => {
        let finalItemUrl = item.assetUrl || null;
        if (item.assetFile) {
          const itemRef = ref(storage, `checklists/${auth.currentUser?.uid}/${Date.now()}_${item.assetFile.name}`);
          await uploadBytes(itemRef, item.assetFile);
          finalItemUrl = await getDownloadURL(itemRef);

          if (saveUploadsToWallet) {
            await addDoc(collection(db, 'assets'), {
              name: item.text || 'Checklist Item',
              category: 'Uncategorized',
              categories: ['Uncategorized'],
              imageUrl: finalItemUrl,
              ownerId: auth.currentUser?.uid,
              createdAt: new Date().toISOString(),
              ...shareFieldsFor(selectedGroupId)
            });
          }
        } else if (item.selectedAssetUrl) {
          finalItemUrl = item.selectedAssetUrl;
        }
        return { 
          id: item.id, 
          text: item.text, 
          isCompleted: item.isCompleted, 
          assetUrl: finalItemUrl === undefined ? null : finalItemUrl,
          assetId: item.assetId || null
        };
      }));

      const baseEventData = {
        title,
        description,
        checklistItems: uploadedChecklistItems,
        categoryId: category.id,
        color: color,
        emoji: emoji || null,
        ownerId: editEvent ? editEvent.ownerId : auth.currentUser.uid,
        groupId: selectedGroupId !== 'personal' ? selectedGroupId : null,
        sharedWithFamily: editEvent ? editEvent.sharedWithFamily : false, // Legacy fallback
        hiddenFrom: selectedGroupId !== 'personal' ? hiddenFrom : [],
        imageUrl: removeMainImage ? null : (imageUrl || (editEvent ? editEvent.imageUrl : null)),
        isTask: isTask,
        taskStatus: editEvent ? editEvent.taskStatus : (isTask ? 'not-started' : 'none'),
        assigneeIds: assigneeIds,
        assigneeId: assigneeIds[0] || null,
        assetId: removeMainImage ? null : (selectedAssetId || (editEvent ? editEvent.assetId : null)),
        updatedAt: new Date().toISOString(),
        rsvpEnabled: rsvpEnabled,
        // These two were collected by the form, written by the AUTOSAVE payload, and accepted by the
        // server's override whitelist — and then dropped here, on the path that actually creates the
        // event. So a location you typed never appeared, and a reminder you set never fired: both
        // readers (EventDetailsModal and the notification scheduler) gate on exactly these fields.
        //
        // One object serves create, non-recurring edit, scope='all' and the override, so adding them
        // here fixes all four. Both are always defined ('' and null), so there is no undefined for
        // Firestore to reject.
        location: location,
        reminderMinutes: reminderMinutes,
        ...timeFieldsFor(eventTime, timezone || localZone()),
        ...endFieldsFor(spanOffset, endTime, !!eventTime)
      };

      if (editEvent) {
        // Determine if we are editing a recurring instance
        const isRecurringInstance = editEvent.isRecurringInstance;
        const parentId = editEvent.parentEventId;

        if (isRecurringInstance && parentId) {
          // Ask user: edit this one or all?
          // Written as "only an explicit 'all' rewrites the series" rather than "anything that
          // is not 'this' rewrites the series". The difference is the whole defect: with the test
          // the other way round, every value the variable could hold except one — including the
          // null it used to start as — took the destructive path.
          const scope = editScope;
          if (scope !== 'all') {
            // The single-occurrence override keeps the ORIGINAL owner, so it's
            // created server-side (clients can only create events they own). The
            // function also adds the exception date to the parent.
            const overrideDate = editEvent.recurrenceDate; // e.g. '2026-06-15'
            await createEventOverride({
              parentId,
              overrideDate,
              data: { ...baseEventData, date: new Date(eventDate).toISOString() },
            });
          } else {
            // Edit the parent — that is, the SERIES.
            //
            // A series is one start date plus a rule, and every occurrence is computed from that
            // start. This used to write the opened occurrence's date onto the parent, so editing
            // the title of a September occurrence moved a series that began in August to September
            // and every earlier occurrence stopped existing. Measured on the real expander: nine
            // occurrences became three, and date-keyed exceptions were orphaned.
            //
            // The start now moves only when the date was actually CHANGED, and then by the same
            // offset — which is what moving a series means, and keeps its history. Leaving a
            // changed date unwritten was the other option and was rejected: a date field that
            // silently does nothing is the defect this codebase keeps producing.
            const parentRef = doc(db, 'events', parentId);
            const parentSnap = await getDoc(parentRef);
            const nextStart = shiftedSeriesStart(
              parentSnap.data()?.date, editEvent.recurrenceDate, eventDate,
            );
            await updateDoc(parentRef, {
              ...baseEventData,
              ...(nextStart ? { date: nextStart } : {}),
            });
          }
        } else {
          // Normal (non-recurring) edit
          await updateDoc(doc(db, 'events', editEvent.id), { ...baseEventData, date: new Date(eventDate).toISOString() });
        }
        await shareAttachedCards(uploadedChecklistItems);
        onClose();
        return; // Early return for edit
      } else {
        // Create new event
        const recurrenceRule = repeat !== 'none' ? { frequency: repeat } : null;
        await addDoc(collection(db, 'events'), {
          ...baseEventData,
          date: new Date(eventDate).toISOString(),
          createdAt: new Date().toISOString(),
          recurrenceRule,
          recurrenceExceptions: [],
          rsvps: rsvpEnabled && auth.currentUser ? { [auth.currentUser.uid]: 'yes' } : {}
        });
        
        await shareAttachedCards(uploadedChecklistItems);

        // Notify assignees (server-side via the notifyUsers Cloud Function —
        // clients can't write the notifications collection directly).
        const otherAssignees = assigneeIds.filter(id => id !== auth.currentUser?.uid);
        if (otherAssignees.length > 0 && isTask) {
          await notifyUsers({
            recipientIds: otherAssignees,
            type: 'task',
            // The rendered pair is the fallback; the KEYS are what the recipient renders, in
            // their own language rather than in mine.
            title: t('newTaskAssigned', language),
            body: `${t('taskAssignedBody', language)}${title}`,
            titleKey: 'newTaskAssigned',
            bodyKey: 'taskAssignedBody',
            param: title,
          });
        }
      }
      if (!editEvent) {
        localStorage.removeItem('ourDays_draftEvent');
      }
      setTitle('');
      setDescription('');
      setChecklistItems([]);
      setImageFile(null);
      setSelectedAssetUrl(null);
      setSelectedAssetId(null);
      setSaveUploadsToWallet(false);
      setAssigneeIds([]);
      setColor(null);
      setIsTask(false);
      setRepeat('none');
      setRsvpEnabled(false);
      onClose();
    } catch (error) {
      console.error("Error adding event: ", error);
      alert(t('eventAddFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const ownerId = editEvent ? editEvent.ownerId : auth.currentUser?.uid;
  const owner = ownerId ? (userMap[ownerId] || null) : null;

  const commonGroups = owner ? groups?.filter(g => g.members?.includes(owner.id)) || [] : [];

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} ref={dialogRef} {...dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
        
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-primary" />
            {editEvent ? t('edit', language) : t('addNewEvent', language)}
          </h3>
          <button aria-label={t('closeAction', language)} onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 relative">
              <input
                type="date"
                value={eventDate}
                onChange={(e) => {
                  const next = e.target.value;
                  // Moving the start moves the whole event: the end travels with it and the length
                  // is kept. Only bumping it when it would fall behind would silently shorten a
                  // three-day trip to two whenever its start was nudged forward by a day.
                  if (next && endDate) {
                    const keep = dayOffsetBetween(eventDate, endDate);
                    if (keep !== null) setEndDate(dayPlus(next, keep) ?? next);
                  }
                  setEventDate(next);
                }}
                className="text-sm font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg outline-none border-none focus:ring-2 focus:ring-primary/50 cursor-pointer min-w-[140px]"
                required
              />
              {/* Empty is a real answer, not a missing one: it means an all-day event, which is
                  what every event in this app has been. So no `required`. */}
              <input
                type="time"
                value={eventTime}
                onChange={(e) => {
                  setEventTime(e.target.value);
                  // Turning a timed event back into an all-day one clears the end CLOCK and keeps
                  // the end DATE. Leaving the clock behind froze the form: the end-time input is
                  // only rendered when there is a start time, so the refusal ("an end time needs a
                  // start time") pointed at a field that was no longer on screen, and both Save and
                  // the autosave refused with no way out but deleting the whole span.
                  if (!e.target.value) setEndTime('');
                }}
                aria-label={t('eventTimeLabel', language)}
                title={eventTime ? t('eventTimeLabel', language) : t('eventAllDay', language)}
                className="text-sm font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg outline-none border-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              />
              {/* The end is opt-in: almost every event is one day, and two more controls on every
                  form would cost all of them to serve a few. Revealed already filled in when the
                  event being edited has one. */}
              {!showEnd && (
                <button
                  type="button"
                  onClick={() => { setShowEnd(true); if (!endDate) setEndDate(eventDate); }}
                  className="text-xs font-medium text-primary hover:underline shrink-0"
                >
                  + {t('eventAddEnd', language)}
                </button>
              )}
              {owner && (
                  <div className="relative">
                    <button type="button" ref={ownerCard.triggerRef} {...ownerCard.triggerProps} onClick={() => setShowOwnerProfile(!showOwnerProfile)} className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary transition-all shadow-sm" title={t('viewOwner', language)}>
                      {owner.photoURL ? (
                        <img src={owner.photoURL} alt={owner.name || owner.email} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                          {(owner.name?.[0] || owner.email?.[0] || '?').toUpperCase()}
                        </span>
                      )}
                    </button>
                    
                    {showOwnerProfile && (
                      <div ref={ownerCard.menuRef} {...ownerCard.menuProps} className="absolute top-10 left-0 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-4 animate-in fade-in zoom-in duration-200 outline-none">
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
                            <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{owner.name || owner.email?.split('@')[0]}</p>
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

          {/* The end, when there is one. An end DATE is what a person means; the offset it becomes
              is derived above. `min` keeps the picker honest, but the real refusal is `spanIssue`,
              which the server applies too — a date input's `min` is a suggestion to a browser. */}
          {showEnd && (
            <div className="flex items-center gap-2 flex-wrap -mt-2">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('eventEndsOn', language)}</span>
              <input
                type="date"
                value={endDate}
                min={eventDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label={t('eventEndsOn', language)}
                className="text-sm font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg outline-none border-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              />
              {/* Only meaningful once the event has a start clock; without one it is an all-day
                  event that happens to last several days, and endFieldsFor drops the time anyway. */}
              {!!eventTime && (
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  aria-label={t('eventEndsOn', language)}
                  className="text-sm font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg outline-none border-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                />
              )}
              <button
                type="button"
                onClick={() => { setShowEnd(false); setEndDate(''); setEndTime(''); }}
                aria-label={t('eventRemoveEnd', language)}
                title={t('eventRemoveEnd', language)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {spanError && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 -mt-2">{spanError}</p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
              {t('eventTitle', language)}
              {isSuggestingCategory && <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>}
            </label>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              onBlur={handleTitleBlur}
              placeholder={t('eventTitlePh', language)}
              required
              className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('descNotes', language)}</label>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descNotesPh', language)}
              rows={1}
              className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none resize-none overflow-hidden min-h-[42px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('location', language)}</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('locationPh', language)}
                className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('reminder', language)}</label>
              <select
                value={customReminder ? 'custom' : (reminderMinutes === null ? '' : String(reminderMinutes))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    // Enter custom mode with a sensible non-preset default.
                    setCustomReminder(true);
                    setCustomReminderUnit('minutes');
                    setCustomReminderValue('30');
                    setReminderMinutes(30);
                  } else {
                    setCustomReminder(false);
                    setReminderMinutes(v === '' ? null : parseInt(v));
                  }
                }}
                className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
              >
                <option value="">{t('noReminder', language)}</option>
                <option value="0">{t('atTimeOfEvent', language)}</option>
                <option value="15">{t('min15Before', language)}</option>
                <option value="60">{t('hour1Before', language)}</option>
                <option value="1440">{t('day1Before', language)}</option>
                <option value="custom">{t('customReminder', language)}</option>
              </select>
              {customReminder && (
                <div className="flex gap-2 min-w-0">
                  <input
                    type="number"
                    min={1}
                    value={customReminderValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCustomReminderValue(raw);
                      const n = parseInt(raw);
                      if (!isNaN(n) && n > 0) setReminderMinutes(n * REMINDER_UNIT_TO_MINUTES[customReminderUnit]);
                    }}
                    placeholder="30"
                    className="w-16 shrink-0 px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
                  />
                  <select
                    value={customReminderUnit}
                    onChange={(e) => {
                      const unit = e.target.value as ReminderUnit;
                      setCustomReminderUnit(unit);
                      const n = parseInt(customReminderValue);
                      if (!isNaN(n) && n > 0) setReminderMinutes(n * REMINDER_UNIT_TO_MINUTES[unit]);
                    }}
                    className="flex-1 min-w-0 px-2 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
                  >
                    <option value="minutes">{t('unitMinutes', language)}</option>
                    <option value="hours">{t('unitHours', language)}</option>
                    <option value="days">{t('unitDays', language)}</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 bg-zinc-50 dark:bg-zinc-800/30 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('interactiveChecklist', language)}</label>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddChecklistItem())}
                placeholder="e.g., Buy Milk, Order Cake..."
                className="flex-1 px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
              />
              <button 
                type="button" 
                onClick={handleAddChecklistItem}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {t('addAction', language)}
              </button>
            </div>

            {(
              <button
                type="button"
                onClick={handleGenerateChecklist}
                disabled={isGeneratingAI}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50 rounded-lg text-sm font-medium transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50 mt-2"
              >
                {isGeneratingAI ? (
                  <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div> {t('generatingChecklist', language)}</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> {t('autoSuggestAI', language)}</>
                )}
              </button>
            )}

            {checklistItems.length > 0 && (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="checklist">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2 mt-3">
                      {checklistItems.map((item, index) => (
                        <Draggable key={item.id} draggableId={item.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`flex flex-col bg-white dark:bg-zinc-800 p-2 rounded-lg border ${snapshot.isDragging ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-zinc-200 dark:border-zinc-700'}`}
                            >
                              <div className="flex items-center gap-2">
                                <div {...provided.dragHandleProps} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing p-1 -ml-1">
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div 
                                  onClick={() => setChecklistItems(items => items.map(i => i.id === item.id ? { ...i, isCompleted: !i.isCompleted } : i))}
                                  className={`w-4 h-4 border rounded-sm shrink-0 flex items-center justify-center cursor-pointer transition-colors ${item.isCompleted ? 'bg-primary border-primary text-white' : 'border-zinc-300 dark:border-zinc-600'}`}
                                >
                                  {item.isCompleted && <Check className="w-3 h-3" />}
                                </div>
                                <textarea 
                                  value={item.text}
                                  onChange={(e) => {
                                    e.target.style.height = 'auto';
                                    e.target.style.height = `${e.target.scrollHeight}px`;
                                    handleEditChecklistText(item.id, e.target.value);
                                  }}
                                  onBlur={(e) => checkForAssetSuggestionsAI(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const newId = Date.now().toString();
                                      setChecklistItems(items => {
                                        const idx = items.findIndex(i => i.id === item.id);
                                        const newArray = [...items];
                                        newArray.splice(idx + 1, 0, { id: newId, text: '', isCompleted: false });
                                        return newArray;
                                      });
                                      setLastAddedItemId(newId);
                                      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
                                    } else if (e.key === 'Backspace' && item.text === '') {
                                      e.preventDefault();
                                      handleRemoveChecklistItem(item.id);
                                    }
                                  }}
                                  ref={(el) => {
                                    if (el) {
                                      el.style.height = 'auto';
                                      el.style.height = `${el.scrollHeight}px`;
                                      if (item.id === lastAddedItemId) {
                                        el.focus();
                                        setLastAddedItemId(null);
                                      }
                                    }
                                  }}
                                  rows={1}
                                  className={`flex-1 text-sm bg-transparent border-none focus:ring-0 outline-none min-w-0 resize-none overflow-hidden py-0 ${item.isCompleted ? 'line-through text-zinc-400 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-300'}`}
                                />
                                
                                <div className="flex items-center gap-1 shrink-0">
                                  <input 
                                    type="file" 
                                    id={`file-${item.id}`} 
                                    className="hidden" 
                                    accept="image/*"
                                    onChange={(e) => e.target.files && handleChecklistItemImage(item.id, e.target.files[0])}
                                  />
                                  <label htmlFor={`file-${item.id}`} className="cursor-pointer p-1 text-zinc-400 hover:text-primary transition-colors" title={t('uploadNewPhoto', language)}>
                                    <ImageIcon className={`w-4 h-4 ${item.assetFile ? 'text-primary' : ''}`} />
                                  </label>
                                  <button 
                                    type="button" 
                                    onClick={() => setShowAssetPicker(item.id)}
                                    className={`p-1 transition-colors ${item.selectedAssetUrl || item.assetId || (item.assetUrl && !item.assetFile) ? 'text-emerald-500' : 'text-zinc-400 hover:text-emerald-500'}`}
                                    title={t('pickFromAssets', language)}
                                  >
                                    <Wallet className="w-4 h-4" />
                                  </button>
                                  {(item.selectedAssetUrl || item.assetUrl || item.assetFile || item.assetId) && (
                                    <button 
                                      type="button" 
                                      onClick={() => setChecklistItems(checklistItems.map(i => i.id === item.id ? { ...i, assetUrl: null, selectedAssetUrl: null, assetId: null, assetFile: undefined } : i))}
                                      className="p-1 text-red-400 hover:text-red-500 transition-colors"
                                      title={t('removeAssetTooltip', language)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                <button type="button" onClick={() => handleRemoveChecklistItem(item.id)} className="p-1 text-zinc-400 hover:text-red-500 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              {!item.isCompleted && (item.assetFile || item.selectedAssetUrl || item.assetUrl || item.assetId) && (
                                <div className="ml-8 mt-2 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 self-start max-w-[120px]">
                                  {(item.assetFile || item.selectedAssetUrl || item.assetUrl || (item.assetId && assets.find(a => a.id === item.assetId)?.imageUrl)) ? (
                                    <img 
                                      src={item.assetFile ? URL.createObjectURL(item.assetFile) : (item.selectedAssetUrl || item.assetUrl || assets.find(a => a.id === item.assetId)?.imageUrl || '')} 
                                      alt="Preview" 
                                      className="w-full h-auto object-contain" 
                                    />
                                  ) : (
                                    <div className="p-2 flex flex-col items-center justify-center text-zinc-500">
                                      <Wallet className="w-6 h-6 mb-1 text-emerald-500" />
                                      <span className="text-[10px] text-center font-medium px-1 line-clamp-2">
                                        {item.assetId && assets.find(a => a.id === item.assetId)?.name ? assets.find(a => a.id === item.assetId)?.name : 'Linked Card'}
                                      </span>
                                    </div>
                                  )}
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
            )}

            {isGeneratingAI && (
              <div className="space-y-2 mt-3 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <div className="w-4 h-4 rounded-sm bg-zinc-200 dark:bg-zinc-700 shrink-0"></div>
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3"></div>
                    <div className="ml-auto w-4 h-4 rounded bg-zinc-200 dark:bg-zinc-700 shrink-0"></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {suggestedAsset && !selectedAssetId && (
              <div className="mb-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Link {suggestedAsset.name}?</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('matchesWalletCard', language)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => setSuggestedAsset(null)}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg transition-colors"
                  >
                    Dismiss
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setSelectedAssetId(suggestedAsset.id);
                      setSuggestedAsset(null);
                      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-emerald-500 text-white rounded-lg shadow-sm hover:bg-emerald-600 transition-colors"
                  >
                    Link Card
                  </button>
                </div>
              </div>
            )}
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('category', language)}</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryChange(cat)}
                  className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition-all ${
                    category.id === cat.id 
                      ? 'border-primary bg-primary/10 text-primary' 
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${cat.color}`} />
                  {t('cat_' + cat.id, language)}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('eventEmoji', language)}</label>
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEmoji(null)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      emoji === null 
                        ? 'border-primary bg-primary/10 text-primary' 
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {t('defaultIcon', language)}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 max-h-[140px] overflow-y-auto no-scrollbar border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 bg-zinc-50 dark:bg-zinc-900/50">
                  {PREDEFINED_EMOJIS.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEmoji(e)}
                      className={`w-8 h-8 flex items-center justify-center text-lg rounded-md transition-all ${
                        emoji === e ? 'bg-primary/20 scale-110 shadow-sm' : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:scale-110'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('customColor', language)}</label>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setColor(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    color === null 
                      ? 'border-primary bg-primary/10 text-primary' 
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  {t('defaultCategoryColor', language)}
                </button>
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${
                      color === c ? 'scale-110 ring-2 ring-offset-2 dark:ring-offset-zinc-900 ring-zinc-400' : 'hover:scale-105'
                    } ${eventSwatchClass(c)}`}
                  >
                    {color === c && <div className="w-2 h-2 bg-white rounded-full shadow-sm"></div>}
                  </button>
                ))}
              </div>
            </div>

          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('targetCalendar', language)}</label>
              <select 
                value={selectedGroupId}
                // Moving the event to another calendar re-derives the two lists that only mean
                // anything inside a group. Without this they were left alone while the form
                // below renders them FILTERED to the group now selected — so somebody not in
                // the new group vanished from the screen and stayed in the document: unseen by
                // you, unseeable by them (the event is filed on a calendar they do not have),
                // and still sent a reminder, because reminders go to assignees regardless of
                // the group. Retargeting to Personal was worse still: firestore.rules lets a
                // non-group event name only its own author, so the write was refused outright.
                onChange={(e) => {
                  const next = e.target.value;
                  const members = next === 'personal'
                    ? null
                    : (groups.find(g => g.id === next)?.members || []);
                  const uid = auth.currentUser?.uid || '';
                  setSelectedGroupId(next);
                  setAssigneeIds(prev => keepAssignees(members, uid, prev));
                  // Exclusions do not travel: somebody left out of the old group is a
                  // stranger to the new one, not a decision about it.
                  setHiddenFrom([]);
                }}
                className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
              >
                <option value="personal">{t('personalCalendar', language)}</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name} {t('calendar', language)}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('assignMembers', language)}</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {auth.currentUser && (
                  <button 
                    type="button"
                    onClick={() => toggleAssignee(auth.currentUser!.uid)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors ${
                      assigneeIds.includes(auth.currentUser.uid) 
                        ? 'bg-primary text-white border-primary' 
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {t('assignToMe', language)}
                    {assigneeIds.includes(auth.currentUser.uid) && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                )}
                
                <button 
                  type="button"
                  onClick={() => toggleAssignee('ai_assistant')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors ${
                    assigneeIds.includes('ai_assistant') 
                      ? 'bg-indigo-500 text-white border-indigo-500' 
                      : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                  }`}
                  title={t('aiAssistantTooltip', language)}
                >
                  <Sparkles className="w-3 h-3" />
                  {t('aiAssistant', language)}
                  {assigneeIds.includes('ai_assistant') && <CheckCircle2 className="w-3 h-3" />}
                </button>
                {selectedGroupId !== 'personal' && users.map(u => {
                  const belongsToGroup = groups.find(g => g.id === selectedGroupId)?.members?.includes(u.id);
                  if (!belongsToGroup) return null;
                  return (
                  <button 
                    key={u.id}
                    type="button"
                    onClick={() => toggleAssignee(u.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors ${
                      assigneeIds.includes(u.id) 
                        ? 'bg-primary text-white border-primary' 
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {u.name || 'Member'}
                    {assigneeIds.includes(u.id) && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                  );
                })}
              </div>
            </div>

            {!editEvent && (
              <div className="flex flex-col gap-2 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('repeat', language)}</label>
                <select 
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700 focus:ring-2 focus:ring-primary outline-none text-sm"
                >
                  <option value="none">{t('doesNotRepeat', language)}</option>
                  <option value="daily">Daily — until {eventDate ? format(getRecurrenceEndDate(new Date(eventDate), 'daily'), 'MMM d, yyyy') : '...'}</option>
                  <option value="weekly">Weekly — until {eventDate ? format(getRecurrenceEndDate(new Date(eventDate), 'weekly'), 'MMM d, yyyy') : '...'}</option>
                  <option value="monthly">Monthly — until {eventDate ? format(getRecurrenceEndDate(new Date(eventDate), 'monthly'), 'MMM d, yyyy') : '...'}</option>
                  <option value="yearly">Yearly — until {eventDate ? format(getRecurrenceEndDate(new Date(eventDate), 'yearly'), 'MMM d, yyyy') : '...'}</option>
                </select>
                {repeat !== 'none' && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    🔁 This event will repeat {repeat} until {eventDate ? format(getRecurrenceEndDate(new Date(eventDate), repeat), 'MMMM d, yyyy') : '...'}. Recurrence is not infinite.
                  </p>
                )}
              </div>
            )}

            {/* Edit scope prompt for recurring events */}
            {editEvent && (editEvent.isRecurringInstance || editEvent.recurrenceRule) && (
              <div className="flex flex-col gap-2 border border-indigo-200 dark:border-indigo-700/50 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-500/10">
                <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                  🔁 This is a recurring event ({getFrequencyLabel(editEvent.recurrenceRule?.frequency || editEvent.parentFrequency || 'weekly')})
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditScope('this')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      editScope === 'this'
                        ? 'bg-indigo-500 text-white'
                        : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {t('thisEventOnly', language)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditScope('all')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      editScope === 'all'
                        ? 'bg-indigo-500 text-white'
                        : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {t('allEventsInSeries', language)}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('makeTask', language)}</p>
                <p className="text-xs text-zinc-500">{t('trackProgress', language)}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={isTask}
                  onChange={(e) => setIsTask(e.target.checked)}
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 dark:peer-focus:ring-primary/50 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-primary"></div>
              </label>
            </div>

            {selectedGroupId !== 'personal' && (
              <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('enableRSVP', language)}</p>
                  <p className="text-xs text-zinc-500">{t('askMembersRSVP', language)}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={rsvpEnabled}
                    onChange={(e) => setRsvpEnabled(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-500/30 dark:peer-focus:ring-emerald-500/50 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}

            {selectedGroupId !== 'personal' && userMap && Object.keys(userMap).length > 1 && (
              <div className="flex flex-col border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/30">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('visibility', language)}</p>
                  <p className="text-xs text-zinc-500">{t('visibilityDesc', language)}</p>
                </div>
                <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col gap-2">
                  {Object.values(userMap)
                    .filter((u: any) => u.id !== auth.currentUser?.uid && (!groups || selectedGroupId === 'personal' || groups.find(g => g.id === selectedGroupId)?.members?.includes(u.id)))
                    .map((u: any) => (
                      <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hiddenFrom.includes(u.id)}
                          onChange={() => toggleVisibility(u.id)}
                          className="w-4 h-4 text-primary bg-zinc-100 border-zinc-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">{u.name || u.email?.split('@')[0]}</span>
                      </label>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex gap-2">
              <div className="flex-1 p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed text-center">
                <input 
                  type="file" 
                  id="file-upload" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setImageFile(e.target.files[0]);
                      // BOTH halves of the wallet selection. Clearing only the URL left the id
                      // behind, so the discarded card was still stored on the event — and shared.
                      setSelectedAssetUrl(null);
                      setSelectedAssetId(null);
                      setRemoveMainImage(false);
                    }
                  }}
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-primary transition-colors h-full">
                  <ImageIcon className="w-5 h-5" />
                  <span className="text-xs font-medium">{imageFile ? imageFile.name : t('uploadNewPhoto', language)}</span>
                </label>
              </div>
              
              <div className="flex-1 p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg border-dashed text-center flex flex-col justify-center items-center">
                <button 
                  type="button" 
                  onClick={() => setShowAssetPicker('main')}
                  className="flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-emerald-500 transition-colors w-full h-full"
                >
                  <Wallet className="w-5 h-5" />
                  <span className="text-xs font-medium">{selectedAssetUrl || selectedAssetId ? t('assetSelected', language) : t('pickFromAssets', language)}</span>
                </button>
              </div>
            </div>
            
            {(imageFile || selectedAssetUrl || (editEvent?.imageUrl && !removeMainImage)) && (
               <div className="flex flex-col gap-2 mt-3 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                 <div className="w-full flex justify-center bg-zinc-100 dark:bg-zinc-900 rounded-md overflow-hidden">
                   <img 
                     src={imageFile ? URL.createObjectURL(imageFile) : (selectedAssetUrl || editEvent?.imageUrl || '')}
                     alt="Main asset preview"
                     className="max-w-full max-h-48 object-contain"
                   />
                 </div>
                 <div className="flex justify-end w-full">
                   <button type="button" onClick={() => { setImageFile(null); setSelectedAssetUrl(null); setSelectedAssetId(null); setRemoveMainImage(true); }} className="text-red-500 text-xs font-medium flex items-center gap-1 hover:underline">
                     <Trash2 className="w-3 h-3" /> Remove Attached Asset
                   </button>
                 </div>
               </div>
            )}

            {cardsToShare.length > 0 && (
              <p className="mt-2 text-xs text-amber-600 font-medium">
                {t('cardWillBeSharedWith', language).replace(
                  '{group}',
                  groupNameOf(groups || [], selectedGroupId) || t('group', language),
                )}
              </p>
            )}

            {/* Save to Wallet Toggle */}
            {(imageFile || checklistItems.some(i => i.assetFile)) && (
              <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 animate-in fade-in slide-in-from-top-2 mt-3">
                <div>
                  <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{t('saveUploadsToWallet', language)}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('saveUploadsHint', language)}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={saveUploadsToWallet}
                    onChange={(e) => setSaveUploadsToWallet(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 dark:peer-focus:ring-emerald-500/50 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}
          </div>

          <div className="pt-2 shrink-0 flex items-center justify-between gap-4">
            {editEvent && (
              <div className="text-xs font-medium text-zinc-500 flex items-center gap-1.5 shrink-0">
                {autoSaveStatus === 'saving' && <><div className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin"></div> {t('saving', language)}</>}
                {autoSaveStatus === 'saved' && <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {t('saved', language)}</>}
                {autoSaveStatus === 'error' && <span className="text-red-500">{t('errorSaving', language)}</span>}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !title.trim() || autoSaveStatus === 'saving'}
              className={`w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 ${editEvent ? 'max-w-[140px] ml-auto' : ''}`}
            >
              {loading ? (editEvent ? 'Saving...' : 'Adding...') : (editEvent ? 'Done' : 'Save Event')}
            </button>
          </div>
        </form>

      </div>

      {/* Asset Picker Modal */}
      {showAssetPicker && (
        <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} ref={assetPicker.dialogRef} {...assetPicker.dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-500" />
                {t('pickFromAssets', language)}
              </h3>
              <button onClick={() => setShowAssetPicker(null)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input 
                  type="text" 
                  placeholder={t('searchAssets', language)}
                  value={assetSearchQuery}
                  onChange={(e) => setAssetSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-500"
                />
              </div>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 bg-zinc-100/50 dark:bg-zinc-900/50">
              {(() => {
                const filteredAssets = assets.filter(a => a.name.toLowerCase().includes(assetSearchQuery.toLowerCase()));
                if (filteredAssets.length === 0) {
                  return (
                    <div className="text-center py-10 text-zinc-500">
                      <Wallet className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p>{assetsLoadError ? t('assetsLoadFailed', language) : assetSearchQuery ? t('walletNoMatch', language) : t('walletNoAssets', language)}</p>
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredAssets.map(asset => (
                      <div 
                        key={asset.id}
                        onClick={() => {
                          if (showAssetPicker === 'main') {
                            setSelectedAssetUrl(asset.imageUrl || null);
                            setSelectedAssetId(asset.id);
                            setImageFile(null);
                            setRemoveMainImage(false);
                          } else {
                            setChecklistItems(checklistItems.map(item => 
                              item.id === showAssetPicker ? { ...item, selectedAssetUrl: asset.imageUrl || null, assetId: asset.id, assetFile: undefined } : item
                            ));
                          }
                          setShowAssetPicker(null);
                          setAssetSearchQuery('');
                        }}
                        className="group cursor-pointer bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden hover:border-emerald-500 hover:shadow-md transition-all relative"
                      >
                        <div className="aspect-square bg-zinc-100 dark:bg-zinc-900 relative flex items-center justify-center">
                          {asset.imageUrl ? (
                            <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300" />
                          ) : (
                            <Wallet className="w-10 h-10 text-zinc-400 opacity-50 group-hover:scale-110 transition-all duration-300" />
                          )}
                          <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/10 transition-colors"></div>
                        </div>
                        <div className="p-2 border-t border-zinc-100 dark:border-zinc-800">
                          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1 group-hover:text-emerald-500 transition-colors text-center">{asset.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
