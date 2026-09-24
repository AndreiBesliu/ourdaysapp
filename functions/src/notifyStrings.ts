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

  // ── the four senders that used to push hardcoded English ───────────────────
  //
  // The Warlord ones are translated too. The game’s own screens stay English by the
  // owner’s decision, but a notification on a lock screen is not a screen you chose to
  // open — arriving in a language you do not read is worse than the inconsistency.
  notifNewMessage: {
    'en-US': 'New message from ',
    'ro-RO': 'Mesaj nou de la ',
    'fr-FR': 'Nouveau message de ',
    'es-ES': 'Mensaje nuevo de ',
    'it-IT': 'Nuovo messaggio da ',
    'de-DE': 'Neue Nachricht von ',
  },
  notifSentImage: {
    'en-US': 'Sent a photo',
    'ro-RO': 'A trimis o poză',
    'fr-FR': 'A envoyé une photo',
    'es-ES': 'Ha enviado una foto',
    'it-IT': 'Ha inviato una foto',
    'de-DE': 'Hat ein Foto gesendet',
  },
  notifSentMessage: {
    'en-US': 'Sent a message',
    'ro-RO': 'A trimis un mesaj',
    'fr-FR': 'A envoyé un message',
    'es-ES': 'Ha enviado un mensaje',
    'it-IT': 'Ha inviato un messaggio',
    'de-DE': 'Hat eine Nachricht gesendet',
  },
  notifNewGame: {
    'en-US': 'New game: ',
    'ro-RO': 'Joc nou: ',
    'fr-FR': 'Nouvelle partie : ',
    'es-ES': 'Partida nueva: ',
    'it-IT': 'Nuova partita: ',
    'de-DE': 'Neues Spiel: ',
  },
  notifNewGameBody: {
    'en-US': 'Started by ',
    'ro-RO': 'Pornit de ',
    'fr-FR': 'Lancée par ',
    'es-ES': 'Iniciada por ',
    'it-IT': 'Avviata da ',
    'de-DE': 'Gestartet von ',
  },
  notifWarlordChallenge: {
    'en-US': '⚔️ Warlord challenge',
    'ro-RO': '⚔️ Provocare Warlord',
    'fr-FR': '⚔️ Défi Warlord',
    'es-ES': '⚔️ Desafío de Warlord',
    'it-IT': '⚔️ Sfida Warlord',
    'de-DE': '⚔️ Warlord-Herausforderung',
  },
  notifWarlordChallengeBody: {
    'en-US': 'You have been challenged by ',
    'ro-RO': 'Ai fost provocat de ',
    'fr-FR': 'Vous avez été défié par ',
    'es-ES': 'Te ha desafiado ',
    'it-IT': 'Sei stato sfidato da ',
    'de-DE': 'Herausgefordert wurdest du von ',
  },
  notifWarlordJoined: {
    'en-US': '⚔️ Warlord: battle joined',
    'ro-RO': '⚔️ Warlord: bătălia a început',
    'fr-FR': '⚔️ Warlord : bataille engagée',
    'es-ES': '⚔️ Warlord: batalla iniciada',
    'it-IT': '⚔️ Warlord: battaglia iniziata',
    'de-DE': '⚔️ Warlord: Schlacht begonnen',
  },
  notifWarlordJoinedBody: {
    'en-US': 'Your challenge was accepted — it is your move.',
    'ro-RO': 'Provocarea ta a fost acceptată — e rândul tău.',
    'fr-FR': 'Votre défi a été accepté — c’est à vous.',
    'es-ES': 'Aceptaron tu desafío: te toca.',
    'it-IT': 'La tua sfida è stata accettata: tocca a te.',
    'de-DE': 'Deine Herausforderung wurde angenommen — du bist dran.',
  },
  notifWarlordTurn: {
    'en-US': '⚔️ Warlord: your turn',
    'ro-RO': '⚔️ Warlord: e rândul tău',
    'fr-FR': '⚔️ Warlord : à vous de jouer',
    'es-ES': '⚔️ Warlord: tu turno',
    'it-IT': '⚔️ Warlord: tocca a te',
    'de-DE': '⚔️ Warlord: du bist dran',
  },
  notifWarlordTurnBody: {
    'en-US': 'The enemy has ended their turn.',
    'ro-RO': 'Inamicul și-a încheiat tura.',
    'fr-FR': 'L’ennemi a terminé son tour.',
    'es-ES': 'El enemigo ha terminado su turno.',
    'it-IT': 'Il nemico ha concluso il suo turno.',
    'de-DE': 'Der Feind hat seinen Zug beendet.',
  },
  notifWarlordOver: {
    'en-US': '⚔️ Warlord: battle over',
    'ro-RO': '⚔️ Warlord: bătălia s-a încheiat',
    'fr-FR': '⚔️ Warlord : bataille terminée',
    'es-ES': '⚔️ Warlord: batalla terminada',
    'it-IT': '⚔️ Warlord: battaglia finita',
    'de-DE': '⚔️ Warlord: Schlacht vorbei',
  },
  notifWarlordVictory: {
    'en-US': 'Victory!',
    'ro-RO': 'Victorie!',
    'fr-FR': 'Victoire !',
    'es-ES': '¡Victoria!',
    'it-IT': 'Vittoria!',
    'de-DE': 'Sieg!',
  },
  notifWarlordVictoryRetreat: {
    'en-US': 'Victory — they retreated.',
    'ro-RO': 'Victorie — s-au retras.',
    'fr-FR': 'Victoire — ils se sont retirés.',
    'es-ES': 'Victoria: se retiraron.',
    'it-IT': 'Vittoria: si sono ritirati.',
    'de-DE': 'Sieg — sie haben sich zurückgezogen.',
  },
  notifWarlordDefeat: {
    'en-US': 'Defeat.',
    'ro-RO': 'Înfrângere.',
    'fr-FR': 'Défaite.',
    'es-ES': 'Derrota.',
    'it-IT': 'Sconfitta.',
    'de-DE': 'Niederlage.',
  },
  notifWarlordDefeatRetreat: {
    'en-US': 'Defeat — you retreated.',
    'ro-RO': 'Înfrângere — te-ai retras.',
    'fr-FR': 'Défaite — vous vous êtes retiré.',
    'es-ES': 'Derrota: te retiraste.',
    'it-IT': 'Sconfitta: ti sei ritirato.',
    'de-DE': 'Niederlage — du hast dich zurückgezogen.',
  },
  notifWarlordDraw: {
    'en-US': 'The battle ended in a draw.',
    'ro-RO': 'Bătălia s-a încheiat la egalitate.',
    'fr-FR': 'La bataille s’est terminée par un match nul.',
    'es-ES': 'La batalla terminó en empate.',
    'it-IT': 'La battaglia è finita in parità.',
    'de-DE': 'Die Schlacht endete unentschieden.',
  },

  // ── event reminders ──
  notifReminder: {
    'en-US': 'Reminder: ',
    'ro-RO': 'Memento: ',
    'fr-FR': 'Rappel : ',
    'es-ES': 'Recordatorio: ',
    'it-IT': 'Promemoria: ',
    'de-DE': 'Erinnerung: ',
  },
  notifReminderAt: {
    'en-US': 'Starts at ',
    'ro-RO': 'Începe la ',
    'fr-FR': 'Commence à ',
    'es-ES': 'Empieza a las ',
    'it-IT': 'Inizia alle ',
    'de-DE': 'Beginnt um ',
  },
  // Which DAY, too. "Starts at 09:00" on the eve of an all-day event read as today — and the
  // 09:00 is only where an all-day reminder is placed, not when anything starts.
  notifReminderAllDayToday: {
    'en-US': 'Today, all day',
    'ro-RO': 'Azi, toată ziua',
    'fr-FR': 'Aujourd’hui, toute la journée',
    'es-ES': 'Hoy, todo el día',
    'it-IT': 'Oggi, tutto il giorno',
    'de-DE': 'Heute, ganztägig',
  },
  notifReminderAllDayTomorrow: {
    'en-US': 'Tomorrow, all day',
    'ro-RO': 'Mâine, toată ziua',
    'fr-FR': 'Demain, toute la journée',
    'es-ES': 'Mañana, todo el día',
    'it-IT': 'Domani, tutto il giorno',
    'de-DE': 'Morgen, ganztägig',
  },
  notifReminderAllDayOn: {
    'en-US': 'All day, on ',
    'ro-RO': 'Toată ziua, pe ',
    'fr-FR': 'Toute la journée, le ',
    'es-ES': 'Todo el día, el ',
    'it-IT': 'Tutto il giorno, il ',
    'de-DE': 'Ganztägig, am ',
  },
  notifReminderTomorrowAt: {
    'en-US': 'Tomorrow at ',
    'ro-RO': 'Mâine la ',
    'fr-FR': 'Demain à ',
    'es-ES': 'Mañana a las ',
    'it-IT': 'Domani alle ',
    'de-DE': 'Morgen um ',
  },
  notifReminderOn: {
    'en-US': 'On ',
    'ro-RO': 'Pe ',
    'fr-FR': 'Le ',
    'es-ES': 'El ',
    'it-IT': 'Il ',
    'de-DE': 'Am ',
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
