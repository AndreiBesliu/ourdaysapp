// src/utils/roadmapProposals.ts
//
// Claude's proposals for the admin's roadmap (07.11.2026, Admin → Roadmap, "Proposed by Claude"). They come from the
// backlog (BACKLOG.md, OWNER_VERIFY.md) and ship with the app: Claude never writes to live, so a proposal reaches the
// admin with a deploy, and Andrei adds it to a lane or dismisses it. What was done with each is kept on the server
// (`roadmapProposals/{id}`), so an added or dismissed one does not come back.
//
// The ids are kept for good: an id used once means that proposal, so a changed proposal gets a new id. In Romanian,
// like the backlog they come from; the admin's own words stay in English, like the rest of the admin.

import type { RoadmapArea, RoadmapLane } from '../../functions/src/roadmapCore';

export interface RoadmapProposal {
  id: string;
  title: string;
  note: string;
  area: RoadmapArea;
  /** Where it would go if added. */
  lane: Exclude<RoadmapLane, 'done'>;
}

export const ROADMAP_PROPOSALS: readonly RoadmapProposal[] = [
  {
    id: 'storage-messaging-on-demand',
    title: 'Firebase Storage și Messaging la cerere',
    note: 'Ultimul candidat măsurat din pachetul de pornire: ~44 kB. Storage doar la prima încărcare de poză, Messaging doar la abonarea la push.',
    area: 'infra',
    lane: 'next',
  },
  {
    id: 'honest-window-notes',
    title: 'Note cinstite la arcade și la invitație',
    note: 'Azi spun „reîncarcă pagina” și când a căzut codul ferestrei, nu bucata ei. Ca la adăugare și detalii: „reîncarcă” doar când n-a venit bucata.',
    area: 'calendar',
    lane: 'next',
  },
  {
    id: 'bell-rows-deleted-message',
    title: 'Clopoțelul păstrează textul unui mesaj șters',
    note: 'Decizia ta: rămân așa (implicit; mesajul a ajuns deja pe telefoane) sau serverul golește rândurile acelui mesaj la ștergere.',
    area: 'chat',
    lane: 'later',
  },
  {
    id: 'android-rebuild',
    title: 'Reconstruirea aplicației Android',
    note: 'Decis pe 25.09: rămâne web app. APK-ul din mai are calendarul gol (citirile refuzate) și n-a avut push. Decizia: bundle local sau server.url.',
    area: 'infra',
    lane: 'later',
  },
  {
    id: 'reminders-per-owner',
    title: 'Memento-urile citite pe proprietar (5.3)',
    note: 'Parcat pe 29.10 („lasă-le așa deocamdată”). Proiectat pe ramura reminders-per-owner; remediul e la scriere (limite pe cont).',
    area: 'calendar',
    lane: 'later',
  },
  {
    id: 'game-notification-quota',
    title: 'O cotă pentru notificările de joc nou',
    note: 'Un membru poate crea și șterge jocuri la nesfârșit, fiecare cu push către grup. Implicit: aceeași cotă zilnică precum cererile de prietenie.',
    area: 'arcade',
    lane: 'later',
  },
  {
    id: 'finished-game-locked',
    title: 'Un joc terminat să nu mai poată fi rescris',
    note: 'Azi orice membru poate modifica un joc „finalized”, deci și clasamentul. Blocarea ar refuza „Next Round” în APK; decizia ta.',
    area: 'arcade',
    lane: 'later',
  },
  {
    id: 'bell-text-from-server',
    title: 'Textul clopoțelului compus pe server',
    note: 'notifyUsers scrie orice titlu și text în clopoțelul altui membru (cu cotă). Închiderea: o listă de chei și textul compus pe server.',
    area: 'chat',
    lane: 'later',
  },
  {
    id: 'admin-owner-level',
    title: 'Un nivel de owner în admin',
    note: 'Azi orice admin poate face alt admin. O felie de autorizare (owner citit din Firestore, nu din claim) deblochează și publicarea din admin.',
    area: 'admin',
    lane: 'later',
  },
  {
    id: 'card-code-reload',
    title: 'Codul cardului: buton de reîncărcare',
    note: 'Când codul unui card nu se încarcă, se arată numărul și „reîncarcă pagina când ai semnal”, fără buton.',
    area: 'wallet',
    lane: 'later',
  },
];

/** The proposals nothing was done with yet, in the order they are listed. */
export function openProposals(
  proposals: readonly RoadmapProposal[],
  done: Readonly<Record<string, 'added' | 'dismissed'>>,
): RoadmapProposal[] {
  return proposals.filter((p) => !done[p.id]);
}

/** The ones dismissed, to bring back if that was a slip. */
export function dismissedProposals(
  proposals: readonly RoadmapProposal[],
  done: Readonly<Record<string, 'added' | 'dismissed'>>,
): RoadmapProposal[] {
  return proposals.filter((p) => done[p.id] === 'dismissed');
}
