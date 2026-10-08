// src/utils/eventShape.ts
//
// What the fields of an event that the screens show may hold (08.10.2026).
//
// ⚠ BYTE-IDENTICAL COPY at functions/src/eventShape.ts, enforced by
// src/utils/eventShapeServerCopy.test.ts. The rules (`eventFieldsOk` in firestore.rules) say the same
// thing in their own language, and src/utils/eventShape.test.ts holds the numbers equal.
//
// Every member of a group can edit every event of the group, and until that day nothing typed what
// they wrote: a title or an emoji that was a map put the whole app on the recovery screen for every
// member who opened the group's tab, with no way back inside the app; a list of exceptions that was
// not a list did the same from inside the calendar's own computation, and a date that was not a date
// crashed the panel of repeating events. The server's own door (`createEventOverride`, which writes on
// the Admin SDK and so never meets the rules) copied the same fields unchecked.
//
// It imports NOTHING: both runtimes hand it plain data.

/** The web form's limits on the free text of an event (the longest on live on 08.10.2026: a title of
 *  28, a note of 166, a place of 19). The FORM's only: the rules and the server judge these three by
 *  their kind, because the installed APK has no limit and what it writes must not be refused. An event's
 *  title also becomes a wallet card's name (walletAsset.ts), whose form limit is at least this. */
export const EVENT_TITLE_MAX = 500;
export const EVENT_DESCRIPTION_MAX = 5000;
export const EVENT_LOCATION_MAX = 300;
/** An emoji: the form offers 35, each at most two UTF-16 units. 16 leaves room for any one emoji. */
export const EVENT_EMOJI_MAX = 16;
/** Short labels the screens only compare or look up: task status, colour, category, time zone. */
export const EVENT_LABEL_MAX = 64;

/** A wall-clock time, as the form writes it ("09:30"), the same test as `isValidTime`. */
export const EVENT_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** A day ("2026-10-08", as the server writes an occurrence) or that day at a UTC time, as
 *  `toISOString` writes it (the web writes midnight, the installed APK any hour). */
export const EVENT_DATE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?Z)?$/;

/** The fields judged, in the order they are judged. Every other field is free, as it always was. */
export const EVENT_JUDGED_FIELDS = [
  'title', 'emoji', 'description', 'location', 'time', 'endTime', 'date',
  'checklistItems', 'recurrenceExceptions', 'recurrenceRule',
  'taskStatus', 'color', 'categoryId', 'timezone', 'reminderMinutes',
] as const;

const isText = (v: unknown, max: number): boolean => typeof v === 'string' && v.length <= max;
const isOptText = (v: unknown, max: number): boolean => v === null || v === undefined || isText(v, max);
const isPlainMap = (v: unknown): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whether one field holds what the app writes there. Absent (`undefined`) is judged like null. */
export function eventFieldOk(field: string, v: unknown): boolean {
  switch (field) {
    case 'title': return typeof v === 'string';
    case 'emoji': return isOptText(v, EVENT_EMOJI_MAX);
    case 'description':
    case 'location': return v === null || v === undefined || typeof v === 'string';
    case 'time':
    case 'endTime': return v === null || v === undefined || (typeof v === 'string' && EVENT_TIME.test(v));
    case 'date': return typeof v === 'string' && EVENT_DATE.test(v);
    case 'checklistItems':
    case 'recurrenceExceptions': return v === null || v === undefined || Array.isArray(v);
    case 'recurrenceRule': return v === null || v === undefined || isPlainMap(v);
    case 'taskStatus':
    case 'color':
    case 'categoryId':
    case 'timezone': return isOptText(v, EVENT_LABEL_MAX);
    // Any number, as the rules say `is number`: the details window prints it.
    case 'reminderMinutes': return v === null || v === undefined || typeof v === 'number';
    default: return true;
  }
}

/** Text cut to at most `max` UTF-16 units, on whole characters: a cut through an emoji would leave half
 *  of it, which is not text. Every client limit counts UTF-16 units, the rules count characters, so what
 *  this returns always passes them. */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** The first of the PRESENT fields of `data` that is not of the kind the app writes, or null. */
export function eventFieldProblem(data: Record<string, unknown>): string | null {
  for (const field of EVENT_JUDGED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field) && !eventFieldOk(field, data[field])) return field;
  }
  return null;
}
