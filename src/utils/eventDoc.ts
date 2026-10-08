// src/utils/eventDoc.ts
//
// An event as the screens may use it (08.10.2026). The rules and the server now take only what the
// app writes in the fields the screens show (eventShape.ts), but an event written before that day is
// still read, and it is read by every member of its group: in the month grid, the day timeline, the
// overview, the details window, the edit form, the repeating-events panel and the leave dialog. So the
// listeners pass every event through here, and a field that is not of the app's kind reaches the
// screens as the empty value of its kind.
//
// Two things are kept as stored, because a write sends them back:
//   * `rsvps` — the answer buttons spread the stored map into their write, and the rules refuse any
//     change to other people's answers; dropping a broken entry here would turn every answer into a
//     refused write;
//   * `imageUrl` — the edit form re-sends it; the screens show it only through `eventImageSrc`.
// When an edit writes a field back it writes the normalised value, which the rules take, so an edit
// repairs what it touches.

import { isValidTime } from './eventTime';
import { storageUrlOrNull } from './chatMessage';
import { EVENT_EMOJI_MAX, EVENT_LABEL_MAX } from './eventShape';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const label = (v: unknown): string | null => (typeof v === 'string' && v.length <= EVENT_LABEL_MAX ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isPlainMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One checklist item with an id and text the screens can use. An item that is not an object is left
 *  out; an id that is not text gets one from its place, so React keys and drag ids stay text. */
function normaliseItems(v: unknown): Record<string, any>[] {
  if (!Array.isArray(v)) return [];
  const out: Record<string, any>[] = [];
  v.forEach((item, i) => {
    if (!isPlainMap(item)) return;
    // The five fields the app stores on an item, and nothing else: the edit form keeps a picked file
    // and a picked card's link on the item as LOCAL state (`assetFile`, `selectedAssetUrl`), and one
    // planted in the stored list was taken for that (a file it could not read; a link it showed).
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : `item-${i}`,
      text: text(item.text),
      isCompleted: item.isCompleted === true,
      assetUrl: typeof item.assetUrl === 'string' && item.assetUrl ? item.assetUrl : null,
      assetId: typeof item.assetId === 'string' && item.assetId ? item.assetId : null,
    });
  });
  return out;
}

export function normaliseEvent<T extends Record<string, any>>(raw: T): T & { title: string } {
  const out: Record<string, any> = {
    ...raw,
    title: text(raw.title),
    emoji: typeof raw.emoji === 'string' && raw.emoji && raw.emoji.length <= EVENT_EMOJI_MAX ? raw.emoji : null,
    description: text(raw.description),
    location: text(raw.location),
    time: isValidTime(raw.time) ? raw.time : null,
    endTime: isValidTime(raw.endTime) ? raw.endTime : null,
    checklistItems: normaliseItems(raw.checklistItems),
    recurrenceExceptions: strings(raw.recurrenceExceptions),
    recurrenceRule: isPlainMap(raw.recurrenceRule) ? raw.recurrenceRule : null,
    taskStatus: label(raw.taskStatus),
    color: label(raw.color),
    categoryId: label(raw.categoryId),
    timezone: label(raw.timezone),
    assigneeId:typeof raw.assigneeId === 'string' && raw.assigneeId ? raw.assigneeId : null,
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : null,
    rsvps: isPlainMap(raw.rsvps) ? raw.rsvps : {},
    reminderMinutes: typeof raw.reminderMinutes === 'number' && Number.isFinite(raw.reminderMinutes) ? raw.reminderMinutes : null,
    // The edit form writes these two back as they are, and Firestore refuses `undefined` outright: an
    // event that lacked one could not be saved at all.
    assetId: typeof raw.assetId === 'string' && raw.assetId ? raw.assetId : null,
    sharedWithFamily: raw.sharedWithFamily === true,
  };
  // A date that is not text, or text no browser can read, is left out: every reader treats a missing
  // date as "no day". One that reads but is not of the form the app writes (an offset, say) is KEPT —
  // dropping it would hide the event, and the edit form would put it on today.
  if (typeof raw.date !== 'string' || Number.isNaN(Date.parse(raw.date))) delete out.date;
  // The note the AI checklist trigger leaves, as the server writes it; anything else is not shown. A
  // member could write one whose `reason` could not be turned into text, and the details window threw.
  const note = raw.aiChecklist;
  if (isPlainMap(note) && typeof note.status === 'string') {
    out.aiChecklist = {
      status: note.status,
      ...(typeof note.reason === 'string' ? { reason: note.reason } : {}),
      ...(typeof note.at === 'string' ? { at: note.at } : {}),
    };
  } else {
    delete out.aiChecklist;
  }
  // Absent stays absent where the app tells absent from empty: a legacy row with no `hiddenFrom`, and
  // one with a single `assigneeId` and no `assigneeIds` — the edit form falls back to the first only
  // when the list is missing, and an empty list there took the assignee off on the next autosave.
  if (raw.hiddenFrom !== undefined) out.hiddenFrom = strings(raw.hiddenFrom);
  if (raw.assigneeIds !== undefined) out.assigneeIds = strings(raw.assigneeIds);
  return out as T & { title: string };
}

/** The event's photo to show, or null: only a Firebase Storage download link. */
export function eventImageSrc(ev: { imageUrl?: unknown } | null | undefined): string | null {
  return storageUrlOrNull(ev?.imageUrl);
}
