// functions/src/notifyStrings.ts
// The notification texts the SERVER has to render, in all six languages.
//
// ── Why the server needs its own copy at all ──────────────────────────────────────────
//
// A bell row stores `titleKey`/`bodyKey` and the reader's own client translates it — which is why
// those are already correct in six languages. A PUSH is different: it is drawn by the operating
// system from what the server sent, so the server has to pick the language before it sends. Every
// push this app has ever delivered was therefore hardcoded English, to everybody.
//
// It can pick correctly: `users/{uid}.language` is written whenever somebody chooses a language in
// Settings, and read back on sign-in.
//
// ── Why a second dictionary and not an import ─────────────────────────────────────────
//
// `src/utils/i18n.ts` is ~3000 lines and imports date-fns locales; pulling it into the functions
// bundle to render six short strings would be absurd. So this is a small, separate table of just
// the notification keys — and `notifyStrings.test.ts` refuses any key here that the app's
// dictionary does not also carry, in all six languages. That is the guard that matters: the bell
// row and the push must say the same thing, or a person gets two different accounts of one event.
//
// ── The shape, which is not negotiable ────────────────────────────────────────────────
//
// The bell renderer concatenates `${t(bodyKey)}${param}`, so a name goes at the END and a body
// phrased "{name} did X" cannot be expressed. Strings here follow the same rule so the two
// channels cannot diverge in wording.

export const NOTIFY_LANGS = ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE'] as const;
export type NotifyLang = (typeof NOTIFY_LANGS)[number];

export const DEFAULT_LANG: NotifyLang = 'en-US';

type Table = Record<string, Record<NotifyLang, string>>;

export const NOTIFY_STRINGS: Table = {
  // ── a friend request arrives (previously notified NOTHING at all) ──────────
  notifFriendRequest: {
    'en-US': 'New friend request',
    'ro-RO': 'Cerere de prietenie nouă',
    'fr-FR': 'Nouvelle demande d’ami',
    'es-ES': 'Nueva solicitud de amistad',
    'it-IT': 'Nuova richiesta di amicizia',
    'de-DE': 'Neue Freundschaftsanfrage',
  },
  notifFriendRequestBody: {
    'en-US': 'You have a friend request from ',
    'ro-RO': 'Ai o cerere de prietenie de la ',
    'fr-FR': 'Vous avez une demande d’ami de ',
    'es-ES': 'Tienes una solicitud de amistad de ',
    'it-IT': 'Hai una richiesta di amicizia da ',
    'de-DE': 'Du hast eine Freundschaftsanfrage von ',
  },

  // ── already in the app's dictionary; repeated here so a push can render it ──
  friendRequestAccepted: {
    'en-US': 'Friend request accepted',
    'ro-RO': 'Cerere de prietenie acceptată',
    'fr-FR': 'Demande d’ami acceptée',
    'es-ES': 'Solicitud de amistad aceptada',
    'it-IT': 'Richiesta di amicizia accettata',
    'de-DE': 'Freundschaftsanfrage angenommen',
  },
  friendRequestAcceptedBody: {
    'en-US': 'Your friend request was accepted by ',
    'ro-RO': 'Cererea ta de prietenie a fost acceptată de ',
    'fr-FR': 'Votre demande d’ami a été acceptée par ',
    'es-ES': 'Tu solicitud de amistad fue aceptada por ',
    'it-IT': 'La tua richiesta di amicizia è stata accettata da ',
    'de-DE': 'Deine Freundschaftsanfrage wurde angenommen von ',
  },
  inviteLinkUsed: {
    'en-US': 'Invitation accepted',
    'ro-RO': 'Invitație acceptată',
    'fr-FR': 'Invitation acceptée',
    'es-ES': 'Invitación aceptada',
    'it-IT': 'Invito accettato',
    'de-DE': 'Einladung angenommen',
  },
  inviteLinkUsedBody: {
    'en-US': 'Your invitation was accepted by ',
    'ro-RO': 'Invitația ta a fost acceptată de ',
    'fr-FR': 'Votre invitation a été acceptée par ',
    'es-ES': 'Tu invitación fue aceptada por ',
    'it-IT': 'Il tuo invito è stato accettato da ',
    'de-DE': 'Deine Einladung wurde angenommen von ',
  },
  newTaskAssigned: {
    'en-US': 'New Task Assigned',
    'ro-RO': 'Sarcină nouă atribuită',
    'fr-FR': 'Nouvelle tâche attribuée',
    'es-ES': 'Nueva tarea asignada',
    'it-IT': 'Nuova attività assegnata',
    'de-DE': 'Neue Aufgabe zugewiesen',
  },
  taskAssignedBody: {
    'en-US': 'You have been assigned to: ',
    'ro-RO': 'Ai fost desemnat la: ',
    'fr-FR': 'Vous avez été assigné à : ',
    'es-ES': 'Has sido asignado a: ',
    'it-IT': 'Sei stato assegnato a: ',
    'de-DE': 'Ihnen wurde zugewiesen: ',
  },
};

/** A language we can actually render. Anything unknown or absent falls back to English. */
export function normaliseLang(raw: unknown): NotifyLang {
  return (NOTIFY_LANGS as readonly string[]).includes(String(raw))
    ? (raw as NotifyLang)
    : DEFAULT_LANG;
}

/**
 * Render one key, appending `param` exactly the way the bell renderer does.
 *
 * An unknown key returns the key itself rather than throwing — the same behaviour as the app's
 * `t()`. A push that says `notifSomething` is ugly; a push that crashed the function that was
 * also writing the bell row would cost the notification entirely.
 */
export function renderNotify(key: string, lang: NotifyLang, param?: string): string {
  const row = NOTIFY_STRINGS[key];
  const base = row ? (row[lang] ?? row[DEFAULT_LANG]) : key;
  return param ? `${base}${param}` : base;
}
