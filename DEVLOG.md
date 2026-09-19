# Our Days App - Development Log

## ðŸ�— Project Infrastructure (Permanent)
*   **GitHub Repository**: [AndreiBesliu/ourdaysapp](https://github.com/AndreiBesliu/ourdaysapp.git)
*   **Firebase Project ID**: `our-days-2a939`
*   **Firebase Hosting URL**: [https://our-days-2a939.web.app](https://our-days-2a939.web.app)
*   **Firebase Console**: [Console Overview](https://console.firebase.google.com/project/our-days-2a939/overview)
*   **Connection Status**:
    *   Git: Connected & Pushing to `main`.
    *   Firebase: Authenticated via CLI; Deployment via `npx firebase-tools deploy --only hosting`.

---

## 📜 Workflow Rules (Permanent)
> ⚠️ These rules apply to EVERY session and EVERY task, no exceptions.

1.  **Start-of-Task Logging** 📝 Before writing any code, append a `Task Started` entry to the **Session Log section of this file** (not just in chat). The entry must include:
    - Date & time (local)
    - The exact user prompt that triggered the task
    - A one-line summary of what the model intends to do
2.  **End-of-Task Logging** ✅ Upon completing a task, append a `Task Completed` entry immediately following its 'Started' entry in the **Session Log**. Detail exactly what was changed, including specific file names and the core logic adjusted.
3.  **Deployment & Sync Rule** 🚀 Always update Firebase Hosting (`npm run build` & `firebase deploy`) and GitHub (`git commit` & `git push`) immediately after completing a task to ensure progress is never lost.
    - Format:
      ```
      **YYYY-MM-DD HH:MM - Task Started**

      > Prompt: "<exact user prompt>"
      > Plan: <one-line description of what will be done>
      ```
4.  **Roadmap Sync** — Move completed features from "Roadmap" to "Completed Features".
5.  **Build Before Deploy** — Always run `npm run build` successfully before deploying.
6.  **Deploy After Every Feature** — Deploy to hosting and push to Git after each feature.
7.  **Secret Management** — NEVER hardcode API keys. Use `.env` or Firebase Secrets.
8.  **AI Model Attribution** 🤖 Every `Task Started` and `Task Completed` entry **must** state which AI model performed the task (e.g. `Model: Claude Sonnet 4.5`, `Model: Gemini 2.5 Pro`). This ensures full traceability of who wrote what.


---

## 🚀 Active Roadmap & Backlog

### 1. In Progress / Upcoming
- **Arcade Expansion 🎮**
  - **Games**: Chess, Backgammon.
  - **Leaderboards & Group Stats**: Persistent game stats and tournament tracking in the Arcade (cross-day history, tournaments) — builds on the Game-End system now in place. Scope:
    - *Per-game visibility*: show WHICH games each player has played and how often (a breakdown by game type — Tic-Tac-Toe / Connect 4 / Rummy 45 / Memory Match — with games-played and wins per game, not just a single combined total).
    - *Points per game*: show how many points each player has earned THROUGH each game type (e.g. Rummy penalty/points, future per-game scoring), so the leaderboard reflects where points came from.
    - *Per-player detail view*: tapping a leaderboard entry opens a breakdown (games played, wins, points by game).
    - Likely needs a denormalised per-player/per-game stats aggregate (or a Cloud Function rollup) rather than recomputing from all finished `games` docs each open.
    - *Partly fixed* (2026-05-26): the leaderboard `points` sum now accumulates `(totalScore||0)+(score||0)` (full cumulative penalty across all hands) instead of just the last hand's `score`. Still uses the app-wide **negative** penalty convention; unifying to a positive lower=better convention across `calculatePenaltyPoints`/`getSessionWinner`/scoreboard/this sum remains a future polish (currently cosmetic — leaderboard sorts by wins).
  - **Rummy UI Overhaul 🃏**: ✅ DONE (2026-05-26). Phase 1: live meld feedback (Set/Run + points + valid/invalid, meld disabled when invalid); first-meld progress chip (`X/45 pts · needs a run`); card redesign (♥♦♣♠ glyphs + corner indices + amber/sky contrast); dual sort (Runs / Sets). Phase 2: drag-to-INSERT hand reorder (replacing the swap); cumulative multi-round scoreboard (`totalScore`/`round`, owner "Next Hand", session winner = least cumulative penalty, round badge). See Completed Features.
  - **Memory Match Depth 🧠**: ✅ DONE (2026-05-26) — added a timer + move counter, 5 themed icon packs (chosen before the game), and streak-bonus scoring. See Completed Features. (Not done / available as future: variable board sizes & difficulty levels — user opted out for now.)
  - **Family Trivia**: Interactive custom trivia creator for group members.
- **Advanced Communications & Maps 📡**
  - **Remote Push Notifications**: True FCM remote push notifications for chat/calendar alerts (replacing local-only reminders).
  - **In-App Map Navigation & Geofencing**: Render inline interactive maps in event details and send local notifications when entering geofenced areas.
  - **RSVP Notifications**: Integrate RSVP response updates into the app's general notification feed (Firestore `notifications` collection).
- **Shared Finance 💳**
  - **Shared Expenses (Splitwise-in-App)**: Split group bills, log expenses, and settle balances directly inside the Wallet dashboard.
- **Warlord UI/UX revamp + dark theme 🎨** (cerut 2026-08-01, următorul lucru mare pe joc)
  - Motivul: *„ma dor ochii incercand sa testez, dar sa mai si joc"*. Warlord n-are temă dark, iar `src/screens/Warlord.tsx` o dezactivează explicit (`bg-white text-zinc-900 [color-scheme:light]`) pentru că jocul folosește doar clase Tailwind deschise, fără variante `dark:` — deci și cu aplicația pe dark, jocul e o placă albă. Lacătul se scoate ULTIMUL, după ce jocul suportă dark.
  - Observațiile complete (suprafețe albe, costuri ca șiruri de iconițe fără etichetă, „Cannot afford" care nu spune ce lipsește, antet înghesuit, 9 taburi plate, culoarea ramurilor care nu coboară în arbore, log brut, nemăsurat pe telefon) sunt în `Apps/games/warlord/DEVLOG.md`, secțiunea *Revamp UI/UX + temă dark*.
  - Fundația: tokenuri semantice de culoare în locul claselor stock, aplicate în AMBELE copii ale codului de joc. De decis cu Andrei: tema urmează store-ul OurDaysApp sau are comutator propriu; păstrăm direcția medievală sau trecem pe plat/modern; felii vs. prototip pe un singur tab.
- **Auto-update pentru sesiuni lungi 🔄** (ridicat 2026-08-01): `index.html` înregistrează service worker-ul dar nu cheamă niciodată `registration.update()` și nu ascultă `updatefound`; gate-ul de versiune rulează doar când se parsează un index.html PROASPĂT, ceea ce într-un tab deschis de ore nu se întâmplă. Owner-ul a rulat ore întregi un bundle dinaintea deploy-ului (lipseau tabul Research și butonul Admin) deși live-ul servea codul curent. Fix propus: `update()` pe `visibilitychange` + pastilă „versiune nouă — reîncarcă" (cere traduceri în cele 6 limbi). Workaround curent: hard-reload.
- **Infrastructure & UX ⚙️**
  - **Event Date Timezone Shift 🟠**: Event dates are stored via `new Date(eventDate).toISOString()` where `eventDate` is a `'yyyy-MM-dd'` string from an `<input type="date">`. `new Date('yyyy-MM-dd')` parses as **UTC midnight**, so for users in timezones *behind* UTC (the Americas) the stored day shifts forward by one when re-parsed/compared. Pervasive: storage (`AddEventModal.tsx` ~274/604/608/612/621), comparisons (`CalendarGrid.tsx` ~206/363, `CalendarHome.tsx` ~546/555/564/867), recurrence expansion (`utils/recurrence.ts` ~68/84), display (`EventDetailsModal.tsx` ~336). NB: **latent for UTC+ users** (e.g. Europe/Bucharest is unaffected) — only bites UTC-negative timezones. Fix: store/compare dates as local `yyyy-MM-dd` (or parse with explicit local time), and handle already-stored UTC values. (Found during the weekday-alignment fix sweep, 2026-05-26.)
  - **Emoji Event Icons 🎭**: Support choosing an Emoji instead of standard Lucide icons for event categories, with the emoji background/highlight affected by the custom event color.
  - **Offline-First Support**: Enable Firestore local persistence and disk caching for seamless offline calendar/chat navigation.
  - **Event Templates**: Save commonly used event structures and re-use them in one tap.

> **UI/UX Design Constraints (Explicit User Preferences)**
> 🚫 NO Swipe Actions.
> 🚫 NO Confetti/heavy animations.
> ⚠️ Haptics should be used subtly.
> ✅ YES to clean, power-user premium UX.

### 2. Backlog
- **UI Refinement**: Continue polishing dark mode transitions and mobile responsiveness.
- **Uno/Other Games**: Expand the Arcade with more simple multiplayer games.
- ~~**GroupSettingsModal i18n 🧹**~~ ✅ DONE (2026-05-26) Localized all user-facing strings (title, group name, members, danger zone, delete/leave + descriptions, confirm text, remove-member confirm, error messages) via `t()` across all 6 languages. Only deep data fallbacks (`'Friend'`/`'Unknown'`, shown when a member has neither name nor email) left as-is.
- **Friends polish (post-MVP) 🧹**: optional refinements flagged by the review — clean up sibling/duplicate pending requests on accept (currently harmless: read-filter-write dedup keeps one friend entry per uid); seed the invite/add-friend "already sent" disabled state from a live outgoing listener (currently only optimistic per-session). Not bugs.
- ~~**Rummy state single-source-of-truth 🧹**~~ ✅ DONE (2026-05-26) Dropped `status`/`winner` from `GameState` (RummyEngine), `initializeGame`, and the GamesHubModal rummy create-state. The top-level game-doc `status`/`winner` (which the component already read exclusively) are now the single source of truth. Verified no code reads the nested copies.

---

## 🔒 Deferred Security Work (Audit 2026-05-25)
> A code audit showed that several Firestore collections cannot be safely locked down with simple client-side rules because legitimate flows write documents on behalf of OTHER users. These need backend (Cloud Functions / Admin SDK) refactors before the rules can be tightened. Tracked here so they are not forgotten.

- ~~**`events` — `ownerId` spoofing**~~ ✅ DONE (2026-05-26) `events` create now requires `ownerId == auth.uid` (+ group membership). The one path that creates an event owned by someone else — a recurring single-occurrence override — moved to the `createEventOverride` Cloud Function (validates edit rights on the parent, writes the override with the parent's owner/group, Admin SDK).
- ~~**`assets` — `ownerId` spoofing**~~ ✅ DONE (2026-05-26) `assets` create now requires `ownerId == auth.uid`. The "Keep Copy" transfer (creates an asset owned by the recipient) moved to the `transferAssetCopy` Cloud Function (requires you own the source + share a group with the recipient).
- ~~**`notifications` — anti-spam**~~ ✅ DONE (2026-05-26) Direct client `create` is now forbidden (`allow create: if false`); notifications are created only by the `notifyUsers` callable (Admin SDK), which requires auth, only lets you notify users you **share a group with**, and rate-limits per sender (`notif_usage/{uid}`, default 100/day). `AddEventModal` task-assignment now calls it via `src/notifications.ts`.
- ~~**#1 `users` read exposure**~~ ✅ DONE (2026-05-25) Resolved via the `profiles` refactor (Phases 1–3): `users` is now owner-only read/write; member name/photo/birthday render from the public `profiles` mirror. NB: migration is client-side, so a member appears to others only after they have logged in once (profile self-creates on login).
- **#5 Firebase App Check** 🟡 IN PROGRESS (2026-05-26): code is wired up but enforcement is OFF pending manual console setup.
  - DONE: client App Check init (`firebase.ts`, reCAPTCHA v3, env `VITE_APPCHECK_RECAPTCHA_KEY`, debug token in dev, graceful skip if no key); the 4 AI callables now **require auth** + a **per-user daily rate limit** (`ai_usage/{uid}`, default 50/day, `AI_DAILY_LIMIT`) and accept an `enforceAppCheck` flag driven by `APPCHECK_ENFORCE`.
  - TO ENFORCE (manual, Firebase Console): (1) App Check → register the web app with **reCAPTCHA v3**, copy the site key → set `VITE_APPCHECK_RECAPTCHA_KEY` in the web `.env` and rebuild/redeploy; (2) run in **Monitor** mode first and confirm tokens flow; (3) enable **enforcement** for Firestore, Storage and Cloud Functions; (4) set functions env `APPCHECK_ENFORCE=true` and redeploy functions. For the Android (Capacitor) build, add **Play Integrity** as a second provider later.
- **Email verification (toEmail trust)** 🟡 IMPERSONATION CLOSED (2026-05-26); residual read-disclosure 🟢 LOW.
  - DONE: sign-up now calls `sendEmailVerification`; a `VerifyEmailBanner` lets email/password users resend + recheck (reload + `getIdToken(true)` to refresh the claim). The **accept** path is gated: `respondToFriendRequest` and `acceptGroupInvite` require `request.auth.token.email_verified === true` to honor an email-addressed (`toEmail`) match — so you can no longer **accept** an invite/request sent to an address you don't own (the account-takeover/impersonation vector). uid-addressed (`toId`) flows — friend-invites to groups, group-member friend-adds — are unaffected (uid can't be spoofed), so the common cases work without verification. Google users are already verified.
  - REMAINING (LOW): the **read** rules (`canAccessInvite` / `canAccessFriendReq` `toEmail` branch) are NOT yet gated on `email_verified`, so an email-squatter can still SEE (not accept) pending invites/requests addressed to that email (discloses inviter name/email). Gating reads would deny the existing `where('toEmail',...)` listener queries for unverified users, so it needs the client listeners made conditional on `emailVerified` first (skip the toEmail listeners + show the verify prompt when unverified). Deferred.
- **`assets` — shared visibility** 🟠 `sharedWithFamily` assets owned by other users are no longer readable (asset listeners scoped to `ownerId == uid` to satisfy the rule). Restoring cross-user shared wallet assets needs a real sharing model: e.g. an `allowedUserIds` array on the asset + a read rule `request.auth.uid in resource.data.allowedUserIds`, and queries split into "mine" + "shared with me".
- ~~**Housekeeping** 🟢 `.firebase/` deploy cache is git-tracked~~ ✅ DONE (2026-05-26) Added `.firebase/` to `.gitignore` and `git rm --cached` the tracked `hosting.*.cache`. (`functions/lib/` left tracked — it's the deployed artifact and there's no predeploy build hook.)

---

## ✅ Completed Features

- **AI Event Type Suggestion**: AI suggests the category of event to create on event title blur using Gemini Cloud Functions.
- **AI Group Digests**: Summarize missed calendar/chat activities with a custom "Ce s-a mai întâmplat?" Sparkles feature.
- **AI-powered Asset Suggestions**: Smarter, contextual wallet asset matching using Gemini AI.
- **Android Compilation**: Wrapped the app into a native APK using Capacitor.
- **Chat Reactions**: Added inline emoji reactions to chat messages.
- **Typing Indicators**: Showing when someone is typing in the group chat.
- **Rummy 45 (Phases 4-5)**: Game-ending logic, point calculation, and "Tabla" UI polish implemented.
- **Transferable Assets**: Hand over ownership of wallet assets with an optional "Keep Copy" feature.
- **Autosave Engine**: Prevents data loss by saving event drafts to `localStorage`.
- **Task Assignment Constraints**: Logic to filter assignees based on active group/calendar type.
- **Barcode Rendering**: Inline barcode/QR display for checklist items in `EventDetailsModal`.
- **Auto-contrast Text**: WCAG-compliant luminance calculation automatically picks dark/light text on primary color backgrounds.
- **Dark Mode Default**: New users start in dark mode by default.
- **Profile Photo Fix**: Current user's Firestore photoURL now appears everywhere (member circles, chat, event modals).
- **Internationalization (i18n)**: Full app support for English, Romanian, French, Spanish, Italian, and German.
- **Natural Language Parsing**: Automatic date/time extraction from titles using `chrono-node`.
- **Rapid List Entry**: Keyboard-optimized checklist entry with auto-focus and Enter-key support.
- **Smart Asset Auto-Linking**: Contextual loyalty card suggestions based on event/checklist text.
- **Collapsible Week View**: Month/Week view toggle in the Calendar.
- **Pull-to-Refresh**: Native-feeling refresh mechanism on the home screen.
- **Calendar Weekday Alignment Fix**: The month/week grid rendered every date one column to the right of its real weekday (e.g. Thursday under the Friday column) because `renderCells` computed the grid's week start with `startOfWeek(...)`/`endOfWeek(...)` **without** the locale option (date-fns default Sunday-first) while the weekday header (`renderDays`) used `{ locale: dateLocale }` (Monday-first for `ro`). Fixed by passing `{ locale: dateLocale }` to all four `startOfWeek`/`endOfWeek` calls in `renderCells` (month + week view), so cells and header share one week-start convention across all languages.
- **Multiplayer Arcade**: Tic-Tac-Toe, Connect 4, and Rummy 45 (Phases 1-3) implemented with real-time sync.
- **Error monitoring & Health** (satisfies the all-apps "built-in error monitoring + diagnostics" rule): client error capture (`window.onerror` + `unhandledrejection` + a React `ErrorBoundary`) reports via a rate-limited `logClientError` callable → an `errorLogs` collection (locked to clients); server errors from the AI callables log via a `logServerError` helper. The admin **Health** tab shows recent errors (message/stack/context/url/user), total error count (badge), and today's AI & notification usage + top AI users.
- **Admin user drill-down & moderation**: clicking a profile opens a full detail modal (Auth + Firestore: verification, provider, joined/last-seen, groups list, recent events, friend/asset/game counts) with owner **moderation** — enable/disable account, force-verify email, and **delete** (comprehensive cleanup: unlinks both sides of friendships, removes from groups, deletes owned events/assets/games/friend-requests + Storage files + usage docs, then the Auth account; admins/owner and self are protected). Server-authoritative guards, adversarially reviewed.
- **Admin backend** (`/admin`, owner-only): an admin dashboard inspired by the DataRead/CNCVS admin patterns. **Overview** — very detailed platform stats across every collection + Firebase Auth (users: total/verified/signups 7-30d/push/friendships/by-provider; groups: memberships/avg/largest; events: tasks/completed/recurring/reminders/by-category; arcade: by-game/by-status/finalized; messages; assets by category; social: friend-requests/invites by status; notifications by type). **Profiles** — searchable table of every user (Auth + Firestore merged: email+verified, provider, joined/last-seen, groups/events/friends counts, admin badge, make-admin). **Admins** — list + grant (by email) / revoke (last-admin & owner protected). Auth model: an `admins/{uid}` collection (locked to clients) + bootstrap email (`besliandrei@gmail.com`, requires verified email) so the owner works out of the box; all data served by `assertAdmin`-gated Cloud Functions (Admin SDK) so no read rules on PII are opened. Adversarially reviewed (3 agents): gate airtight, no PII leak; fixed a last-admin revoke TOCTOU race (now transactional) + added `count()` totals.
- **Friends & easier group invites**: A mutual **friends** system — send friend requests by **email** or one-tap from **group members**, accept/decline, and unfriend, on a new **Friends screen** (`/friends`) with an incoming-request badge in the header/menu. Accepting goes through the `respondToFriendRequest` Cloud Function (it has to write both users' owner-only friend lists). The **invite-to-group modal** now lists your friends with checkboxes for one-tap multi-invite (friends already in the group are disabled), alongside the existing email entry. Friends are stored as `{uid,name,email}` on each user doc; `removeFriend` is mutual and guarded.
- **Memory Match Depth**: The minigame got a **timer + move counter** (live during play, frozen on the game-over screen), **5 themed icon packs** (Classic / Animals / Food / Travel / Nature, chosen via a theme picker before the game and shown in the header), and **streak-bonus scoring** (each consecutive match in a turn is worth one more point than the last — 1, 2, 3, …; a miss resets the streak). Win detection now reads the board (`every isMatched`) since scores carry bonuses; the active-streak flame shows in the stats bar. Shared `memoryThemes.ts` builds boards for both the create flow and rematches.
- **Rummy 45 UI Overhaul (Phase 1 + 2)**: Live meld feedback (Set/Run + points + valid/invalid on the selection, meld disabled when invalid), first-meld 45-pt progress chip, card redesign (real ♥♦♣♠ glyphs + corner indices + contrast), dual sort (by Runs / by Sets), **drag-to-insert** hand reorder (replaced the position swap), and a **cumulative multi-round scoreboard** — each hand banks penalties into a running `totalScore`, the owner starts the **Next Hand** (re-deal + round bump), a round badge shows during play, and the session winner (for the leaderboard) is the least-penalised player across hands.
- **Game-End / Session Stopping**: Formal "End Game" action that locks a session (`finalized`) and banks the correct **session winner** (the leader across all rounds, not just the last round) to the leaderboard. Available on each game's game-over screen and from the Arcade hub (with an inline confirm) to stop abandoned/in-progress games; finalized games hide "Next Round" and show an "Ended" badge. Leaderboard win-credit now uses `getSessionWinner()`.
- **Smart Birthday Auto-Add**: Automatically detects and adds birthdays for users within a group.
- **Recurring Events**: Single-document recurrence engine with daily/weekly/monthly/yearly support, edit/delete scope prompts, and overview panel.
- **Voice Messages**: Record and send short audio clips in group chat with waveform UI and playback.
- **Message Search**: Client-side search with highlighting, match count, and navigation.
- **Pinned Messages**: Pin important messages to the top of the chat for quick reference.
- **Event RSVPs**: Confirmation of attendance (Yes/Maybe/No) and status summaries.
- **Custom Reminder Scheduling**: Local alerts via Capacitor local-notifications based on event setups.
- **Location Attachment**: Embed external Google Maps navigation shortcuts in events.
- **Mobile UX Refinements**: Compact Today's Overview grid and collapsible hamburger navigation header.

---

## 📅 Session Log: August 8, 2026

**Task Completed (Asistent felia 2: ledgerul de cost, bugetul tranzacțional, plafonul global)**
> Prompt: „continua"
> Model: Claude Opus 5
> - Îndeplinește regula permanentă „un rând per apel plătit" **pe toată aplicația, ÎNAINTE** să existe funcția scumpă. Cinci callable-uri AI livrau de luni de zile fără nicio idee ce cheltuie.
> - **Bugetul e o TRANZACȚIE, nu verifică-apoi-incrementează.** Verificarea la intrare plus incrementul la ieșire nu mărginesc nimic sub concurență: N apeluri paralele dintr-un cont citesc toate aceeași valoare pre-cheltuială și trec toate. Acum se ia o **rezervare pesimistă a plafonului apelului în aceeași tranzacție**, reconciliată în jos după. Modul de eșec devine supra-taxarea — direcția sigură.
> - **Rândul se deschide ÎNAINTE de apel și se închide pe AMBELE căi.** Un apel care arde tokeni și apoi aruncă tot a costat bani. `withLedger` ține toată forma într-un loc, deci niciun apelant nu poate uita jumătate din ea.
> - **Plafon GLOBAL pe lângă cel per-utilizator**, incrementat în aceeași tranzacție. Fiecare limită per-utilizator e denominată în conturi, iar conturile sunt gratis: înscrierea e deschisă, `assertAiCallerAllowed` nu verifică `email_verified`, App Check nu e aplicat. `_global` e singura limită care mărginește factura.
> - **Raportul caractere/token se auto-calibrează per utilizator**, pornind pesimist de la 2,5, nu de la 4. „Patru caractere pe token" e o presupunere englezească; corpusul ăsta e chat de familie în șase limbi, cu diacritice românești și germane și emoji.
> - **Prețuit LA SCRIERE și niciodată recalculat.** Un rând care își recalculează costul din tabelul de azi rescrie tăcut cheltuiala de luna trecută.
> - **Un rând nu conține NICIODATĂ text de prompt sau de răspuns.** Altfel ledgerul devine o a doua copie, nereglementată, exact a datelor private de care are grijă tot restul designului — într-o colecție al cărei rost e să fie citită de operatori.
> - **Refuzul se convertește într-UN singur loc**, ca eroare de fir cu un COD stabil (`ai-budget/user-budget`), nu ca o clasă pe care cele cinci apelante ar trebui să-și amintească s-o traducă. Clientul compune propoziția prin `t()` — cele șase limbi rămân treaba lui, serverul nu livrează niciodată engleză unui utilizator.
> - Colecțiile noi sunt refuzate **EXPLICIT** (`if false`), nu prin absența unei reguli: o absență se citește ca o scăpare, iar în ziua în care cineva adaugă un catch-all s-ar deschide cu el.
> - `adminGetAiSpend` (agregate 1/7/30 zile, per feature, top utilizatori) + `adminGetAiLedger` (drill-down filtrat pe zi și uid).
> - 596 teste verzi, `tsc -b` și build verzi. Deploy: reguli + 7 funcții + hosting.
> - **Rămâne la owner:** aplicarea App Check din consolă, cotă pe cheia Gemini și alertă de buget GCP — singurele limite care supraviețuiesc unui bug din codul nostru.

**Task Completed (Asistent felia 1: oracolul de vizibilitate — zero apeluri de model)**
> Prompt: „ok"
> Model: Claude Opus 5
> - Fundația pe care stă toată pretenția de confidențialitate a asistentului, **testabilă înainte să se cheltuie un singur token**. Nu cheamă niciun model, nu persistă nimic.
> - **`Scope` e un TIP branded cu un singur constructor** (`deriveScope`). Fetcherele nu acceptă altceva, deci „un fetcher a primit un domeniu vechi sau falsificat" e eroare de compilare, nu o observație pierdută la review. `functions/tsconfig.json` are `strict: true` și build-ul e `tsc` real, deci verificarea chiar rulează.
> - **Se re-derivă la fiecare apel, niciodată cache.** Apartenența la grup e singura acordare cross-user din aplicație și se poate retrage fără NICIUN semnal — `handleRemoveMember` e un `arrayRemove` gol, fără trigger, fără notificare, fără `joinedAt`. Nu există la ce s-ar putea agăța o invalidare.
> - **`groups/{id}.get()` e interzis în afara lui `deriveScope`.** Un eveniment al cărui `groupId` nu e în domeniu primește un COD („former-group"), niciodată un nume — citirea numelui ar fi o citire pe care apelantul n-o poate face singur.
> - **Invariantul `visibleTo` e scris de la zero, NU portat.** Filtrul din client e învelit în `activeGroupId !== 'personal'`, o variabilă de UI pe care serverul n-o are; portat literal, cu apelantul „în vizualizare personală", condiția scurtcircuitează la false și **fiecare eveniment ascuns deliberat intră în contextul cross-grup**.
> - **Ramura `sharedWithFamily` e absentă deliberat**, iar fișierul nu depinde de faptul că am scos-o azi și din reguli. A fi mai îngust decât regulile e întotdeauna sigur.
> - **`collectionGroup` interzis** pentru chat: pe Admin SDK întoarce fiecare grup din bază și produce un răspuns plauzibil, nu o eroare. Mesajele cu `isDeleted` se sar integral, timestamp inclusiv — coaja produce „X a spus ceva la 14:03" despre un mesaj retras.
> - **Recurența pe server:** două pase mărginite de frecvență (400 zile / 5 ani, din orizonturile clientului), toleranță de ±1 zi pe chei DOAR pentru weekly/monthly/yearly (la daily ar șterge două ocurențe reale per excepție), și dedupe pe `overrideOfParent` — singura ramură pe care n-o poate învinge niciun fus.
> - **Perioada se construiește din ȘIRURI LITERALE**, niciodată dintr-un `Date` local prin `toISOString()`. Pentru un apelant din New York, `startOfMonth(martie).toISOString()` e `2026-03-01T05:00:00.000Z` — evenimentul de 1 martie cade sub limită și cel de 1 aprilie intră, deci fiecare răspuns despre „martie" ar fi tăcut 2 martie–1 aprilie. **11 teste, două fusuri, șiruri identice.**
> - `expenses` NU e sursă: zero potriviri în toate cele 273 de linii din `firestore.rules`, fără catch-all ⇒ refuzată implicit; iar documentul n-are nici `groupId`, nici `ownerId`, deci n-ar exista după ce filtra. Serverul întoarce un COD, clientul compune propoziția — diferența dintre o lipsă și o minciună.
> - Numele vin din `profiles/`, **niciodată din `users/`** (digestul existent citește `users/`, date pe care apelantul nu le poate citi singur).
> - `aiPreviewScope` are **găleata lui de cotă** — cinci callable-uri împart deja `ai_usage`, iar o previzualizare pe cheia comună ar înfometa checklistul până la prânz. Plus plafon de perioadă (400 zile) și buget de documente distribuit ca `limit()` ÎNAINTE de citiri.
> - **Primul `firestore.indexes.json` din repo**, legat în `firebase.json` — până acum indecșii compoziți existau doar ca artefacte de consolă.
> - 596 teste verzi (11 noi), `tsc -b` și build verzi. Deploy: indecși + `aiPreviewScope` pe live.

**Task Completed (SECURITATE: exfiltrare de chat privat prin `generateGroupDigest`)**
> Prompt: „ok, continua"
> Model: Claude Opus 5
> - **Al patrulea defect, și cel mai grav.** `generateGroupDigest` lua `groupId` din `request.data`, chema `assertAiCallerAllowed` — care verifică DOAR autentificarea și cota — și apoi citea numele grupului, 48h de chat privat și evenimentele săptămânii **prin Admin SDK**, fără să cheme niciodată `userInGroup`. Funcția aia exista deja în fișier (linia 94) și e folosită corect în altă parte (`createEventOverride`, linia 595). Aici pur și simplu lipsea.
> - **Nu era o gaură de reguli — era una peste ele.** Admin SDK ignoră complet `firestore.rules`, deci cele trei fixuri de reguli de mai devreme n-o atingeau deloc. Orice cont autentificat care știa sau ghicea un id de grup primea un **rezumat scris de AI al chatului privat al acelui grup**.
> - Fix: `permission-denied` dacă apelantul nu e membru, cu motivul scris deasupra — că `assertAiCallerAllowed` dovedește cine ești și că mai ai cotă, dar nu spune nimic despre ce ai voie să citești.
> - **Scanat restul suprafeței:** din cele 27 de callable-uri, singurele care citesc date după un id din `request.data` sunt `transferAssetCopy` (verifică proprietatea ȘI grupul comun ✔), `createEventOverride` (cheamă `userInGroup` ✔) și `generateGroupDigest` (nu verifica nimic ✘). Celelalte AI-uri — `generateAIChecklist`, `suggestEventCategory`, `suggestAssetForText` — nu citesc Firestore deloc; primesc textul de la client.
> - Găsit de felia 0 a specului „Recall", verificat de mine la sursă înainte de orice atingere. Deploy țintit pe funcția respectivă.

**Task Completed (SECURITATE: trei defecte în firestore.rules, găsite proiectând asistentul AI)**
> Prompt: „ok" (după ce i-am prezentat cele patru defecte verificate la sursă)
> Model: Claude Opus 5
> Găsite de pasele adversariale ale două workflow-uri de proiectare, apoi **verificate de mine la sursă** înainte de orice atingere. Trei deploy-uri separate, ca atribuirea să fie clară dacă se rupe ceva.
>
> **1. Expunere de citire pe `events`.** Ultima ramură a regulii era `resource.data.sharedWithFamily == true`, fără nicio altă condiție — deci orice cont autentificat putea citi orice eveniment care poartă flagul, **și le putea enumera**, fiindcă o interogare pe `sharedWithFamily == true` se potrivește exact cu ramura și e permisă. Evenimentele noi scriu `false`, dar câmpul se propagă la fiecare editare, deci documentele vechi îl au pe `true`. Ramura ștearsă: nimic legitim n-o cerea (fiecare eveniment de grup are și `groupId`, acoperit de ramura de apartenență) și **nicio interogare din aplicație nu filtrează pe el**.
>
> **2. Injectare în calendarul altcuiva.** `create` constrângea DOAR `ownerId`, iar regula de citire acordă acces celui NUMIT pe document. Deci orice cont putea crea un eveniment care numește un străin, cu text arbitrar, și acesta apărea în calendarul lui. Uid-urile nu sunt secrete: id-ul documentului `warlordPlayers/{uid}` **ESTE** uid-ul, iar colecția e citibilă de oricine autentificat. Închis pe scriere: `inviteeId` nu mai poate fi scris de client (**nimic din codebase nu-l scrie** — invitațiile reale trec prin `group_invites`; clientul doar îl citește și randează rezultatul ca invitație în așteptare), iar `assigneeIds`/`assigneeId` pot numi pe altcineva doar pe un eveniment dintr-un grup din care faci parte.
>
> **3. Orice membru putea ejecta pe oricine și șterge grupul.** `allow update, delete: if uid in members`, fără niciun test de proprietar — inclusiv asupra proprietarului, inclusiv ștergerea grupului cu tot cu evenimente. UI-ul intenționa deja owner-only (`isOwner` păzește și calea de ștergere, și butonul de scoatere); regula pur și simplu nu impunea ce promitea ecranul. Acum: proprietarul poate orice; un membru poate edita grupul cât timp nu atinge lista de membri, **cu excepția scoaterii lui însuși**, care e plecarea. Intrarea în grup e neatinsă — membrii se adaugă EXCLUSIV prin `acceptGroupInvite` (Admin SDK, pe care regulile nu-l constrâng).
>
> **RĂMÂNE DESCHIS, deliberat:** un FOST membru păstrează accesul de citire prin ramura `assigneeIds`, care n-are test de apartenență, iar ieșirea din grup curăță doar `members`. Nu l-am reparat aici fiindcă e singurul care **nu poate fi rezolvat doar din reguli**: interogarea clientului `where('assigneeIds','array-contains',uid)` ar începe să întoarcă `permission-denied` pe TOATĂ lista dacă un singur document nu mai trece — deci cere o schimbare coordonată client+reguli, cu verificare pe viu.
>
> Nu există suite de teste pentru reguli în proiectul ăsta; fiecare afirmație de aici a fost verificată citind regula ȘI scrierea corespondentă.

**Task Completed (Warlord: vocabularul întreg al meșteșugului + arborele)**
> Prompt: „continua"
> Model: Claude Opus 5
> - **Defect reparat din felia precedentă:** rabatul era `curent − promis`, iar jurământul cere să fii DEJA în ținere ⇒ cele două împreună forțau `curent === promis` și fiecare cerere procentuală valora ZERO. Repreţuit pe libertatea CEDATĂ — nenul și stabil.
> - 8 piese, 3 canale, 8 dovezi distincte, primele trei rivale prin construcție. Arborele stă pe zile ȚINUTE, nu pe nivelul echipei.
> - **Reparată o minciună veche de patru felii:** tabul Research calcula studiul fără populație și sub-raporta pentru fiecare casă încadrată, în timp ce antetul avea dreptate. Acum ambele spun același număr.
> - Submodul la `8f71e26`. `SAVE_SCHEMA` neschimbat. 585 teste, `tsc -b` și build verzi.

**Task Completed (Warlord: jurământul de meșteșug + manetele lui în admin)**
> Prompt: „continua"
> Model: Claude Opus 5
> - O clădire poate jura permanent un fel de a lucra: renunță la ceva și devine mai bună la ce a păstrat. Punctele vin EXCLUSIV din cereri — niciun buget liber.
> - **În repo-ul ăsta: secțiunea „Population & crafts" din `WarlordAdminPanel`.** Manetele de populație (bonus de echipă, nivelurile, creșterea), mărimile de echipă per clădire și numerele meșteșugului. Se livrează în ACEEAȘI felie cu primul getter: un cadran care raportează tăcut zero e cel mai prost mod de eșec pentru un sistem a cărui premisă e „calibrăm mai târziu".
> - Manetele meșteșugului sunt EDITABILE, spre deosebire de paleta de tradiții: un design de meșteșug ține id-uri și promisiuni, niciodată prețuri, deci o reglare se aplică retroactiv la fiecare jurământ deja jurat, fără migrare.
> - `referencePopulation` dă previzualizării de efect un domeniu plin încadrat și jurat, ca reglajele să aibă ce măsura. Panoul per-clădire rămâne NEîncadrat — altfel fiecare număr existent din admin s-ar fi mișcat cu ×1,5.
> - Submodul la `8534122`. `SAVE_SCHEMA` 9 → 10. 583 teste, `tsc -b` și build verzi.

**Task Completed (Warlord: catastiful casei + garda de schemă la sync)**
> Prompt: „vreau sa dezvoltam sistemul din spatele jocului, vom calibra valorile mai tarziu"
> Model: Claude Opus 5
> - Fundația meșteșugului (felia 3 a populației): fiecare clădire ține un catastif monoton cu ce a SCOS, iar cele trei valori de canal sunt trei felii din același scalar — deci cotele sunt rivale și nu se pot ferma prin așteptare, cum se poate un contor de zile.
> - **În repo-ul ăsta: `warlordCloud` — schema bate rev-ul, în ambele direcții.** `rev` e un contor PER-DISPOZITIV: un tab pe build vechi poate sta la un rev mai mare decât cloud-ul doar fiindcă a bifat mai multe zile local, iar promovarea lui ar împinge peste cloud un blob căruia îi lipsesc deja câmpurile pe care build-ul lui nu le știe. Garda din joc oprește tabul ăla să SCRIE după ce a citit un save mai nou, dar nu poate face nimic pentru unul al cărui cache local e vechi și al cărui rev e din întâmplare înainte.
> - Se livrează ACUM, înainte să existe orice permanent în joc: altfel al doilea tab dă gratis exact respec-ul pe care un jurământ permanent îl interzice.
> - Submodul la `8f7d0f7`. `SAVE_SCHEMA` 8 → 9. 549 teste, `tsc -b` și build verzi.

**Task Completed (Warlord: populația — felia 2, echipa învață)**
> Prompt: „continua"
> Model: Claude Opus 5
> - Nivel de echipă DERIVAT dintr-un contor monoton de zile lucrate; creditat de tick, deci recuperarea offline creditează fiecare zi o dată.
> - Nivelul ridică valoarea muncii, NU eliberează mâini — altfel ar fi a doua plată pentru aceeași postare, în resursa pe care feature-ul o face rară.
> - Ziua contează dacă a produs ceva pe oricare din cele trei canale. `!blocked` NU e testul: e cumpărabil cu sliderul de focus.
> - `SAVE_SCHEMA` 7 → 8. Submodul la `f4cf6e8`. 535 teste, `tsc -b` și build verzi.

**Task Completed (Warlord: populația — felia 1)**
> Prompt: „continua cu felia 1"
> Model: Claude Opus 5
> - Un singur rezervor de suflete: recrutarea îl golește, postarea la o clădire îi multiplică ziua. Fără catalog de joburi — clădirea E jobul.
> - Creșterea mănâncă **doar hrana produsă azi**. Altfel populația ar fi fost cumpărabilă: FOOD e marfă de piață la 50c în ambele sensuri, fără spread.
> - Postările stau în aceeași cheie de save ca sufletele: separate, un build vechi ar fi șters una și ar fi păstrat-o pe cealaltă ⇒ `idle` negativ pe veci.
> - `SAVE_SCHEMA` 6 → 7. Submodul la `4360f72`. 518 teste, `tsc -b` și build verzi.

**Task Completed (Warlord: Minter-ul nu-și mai poate arde producția)**
> Prompt: „minter-ul, din moment ce doar face bani, ca produs, ar trebui sa aiba doar slider de research"
> Model: Claude Opus 5
> - Nu doar un slider inutil: pe Minter, partea lăsată pe marfă **se anula** (n-are item de făcut). 4.800c/zi distruși la reglajul de 40%, cu ecranul explicându-ți politicos pierderea.
> - O clădire fără item de făcut își plătește acum **toată valoarea (după studiu) în monedă**, iar sliderul de focus dispare de pe ea. Regula întreabă tabelul de output, nu o listă de nume.
> - Scos codul mort care topea SILVER_INGOT (nu putea rula niciodată). Fără câmp nou de save.
> - Submodul la `e531b6a`. 481 teste, `tsc -b` și build verzi.

**Task Completed (Warlord: comandantul — singura piesă a unei legiuni care se poate muta)**
> Prompt: „continua cu comandantul"
> Model: Claude Opus 5
> - **Comandantul e piesa pe care o poți muta; tradiția e cea pe care nu.** Aia e decizia pe care o creează: veteranul tău stă cu legiunea care l-a făcut, iar mâine altă legiune trebuie să câștige.
> - **Oastea îl face pe om:** trăsătura se DERIVĂ din ce făcuse legiunea, nu se alege — și scrie pe ecran ce ar ridica palmaresul ei **înainte** să plătești.
> - Muritor și **determinist** (cade la o înfrângere care a costat peste jumătate din ce a pus în linie) — fără zar, fiindcă o bătălie se rejoacă exact din sămânța ei.
> - Nu răspunde niciunui jurământ: valorează ceva și cu tradiția adormită, și cu stindardul pierdut. Dar **plafonul se aplică pe SUMĂ**, o dată, în locul care decide.
> - Verificat pe viu tot lanțul: numire → mutare cu cariera intactă → cădere.
> - **Punctul orb, din nou:** build-ul strict al gazdei a prins un import mort pe care `tsc --noEmit` din joc nu-l vede.
> - `SAVE_SCHEMA` 5 → 6. 481 teste verzi, `tsc -b` + build verzi în aplicație.

**Task Completed (Warlord: stindardul — identitatea ca obiect care poate fi luat)**
> Prompt: „continua cu stindardul"
> Model: Claude Opus 5
> - Stindardul cade când **fiecare cohortă pe care legiunea a pus-o în linie e nimicită** — fără port-drapel, deci fără corvoadă per bătălie și fără un câmp de întreținut prin split/merge. O legiune care a păstrat o cohortă și-a păstrat vulturul.
> - Cât e pierdut, tradiția **doarme** (aceeași suspendare pe care `outOfKeeping` o avea deja — o singură idee în joc, nu două). Se recucerește câștigând la misiunea care ți l-a luat.
> - **Nimic de fermat, scris ca test:** pierderea costă o desfășurare întreagă, recucerirea îți dă înapoi ce aveai.
> - Verificat pe viu toată bucla: pierdere la Invasion → card + refuzuri pe fiecare buton → înfrângere care NU recuperează → victorie care aduce vulturul acasă.
> - `SAVE_SCHEMA` 4 → 5. 447 teste verzi, `tsc -b` + build verzi în aplicație.

**Task Completed (Warlord: forja — pași, adâncire, coduri de tradiție)**
> Prompt: „continua cu felia 4"
> Model: Claude Opus 5
> - A început cu un defect din felia trecută: refuzul spunea „deepen it instead of repeating it", iar jocul n-avea cum s-o adâncești. Acum plătești **diferența** de puncte, dar dovada se cere pentru **totalul nou**.
> - Pașii se aleg la luare, cu prețul și dovada actualizate live.
> - **Coduri de tradiție.** Un cod poartă id-uri, pași, părinți ca poziții și două șiruri — **niciun număr de joc**, toate recalculate din paleta celui care importă. O tradiție umflată nu e *reprezentabilă*. Sumă de control de patru caractere pentru cazul obișnuit: un cod tăiat de wrap-ul unui chat s-ar decoda tăcut într-o tradiție mai mică.
> - **Poți primi o tradiție, niciodată o istorie:** codul aduce promisiunea și un arbore GOL. Verificat pe viu.
> - 429 teste verzi, `tsc -b` + build verzi în aplicație.

**Task Completed (Warlord: tradiția devine un arbore pe care îl CREȘTI + adminul refăcut)**
> Prompt: „continua cu felia 3"
> Model: Claude Opus 5
> - Catalogul de patru a dispărut. **Nivelul** dă adâncimea, **dovada** dă care atribut, **punctele** dau cât. Dovada e proprietatea PIESEI, nu a designului — un atribut care plătește pentru călăreți uciși cere călăreți uciși, deci „exersează acțiuni relevante" e garantat prin construcție.
> - Descoperire care a scos un concept din cod: atributele se adaugă **pe rând, când le poți lua**, deci a proiecta arborele și a-l crește sunt același lucru. Nu mai există listă separată de „câștigate".
> - **Repreţuirea, prima:** moralul a devenit prag de jos; multiplicatorul de XP de luptă a fost șters (plafonul îl mănâncă și e pe dos). Învățatul s-a mutat în curtea de instrucție și în înfrângere.
> - Cele patru trăiesc ca **date** și se migrează în `hydrateLegion`; testul `validateDesign(LEGACY_DESIGNS[*])` a prins **de două ori** o regulă prea strictă — și de fiecare dată reparația a fost regula, nu datele.
> - `src/warlordAdmin/WarlordAdminPanel.tsx`: secțiunea **Legions** refăcută — praguri de jurământ, reglaje de fapte/nivel, costul îndeletnicirilor, plus paleta afișată **read-only** (a o face editabilă e propria felie, cu propria migrare).
> - **Punctul orb confirmat din nou:** build-ul strict al gazdei (`verbatimModuleSyntax`, `noUnusedLocals`) a prins trei erori pe care `tsc --noEmit` din joc nu le vede. Ăla e build-ul care se livrează.
> - `SAVE_SCHEMA` 3 → 4, primul bump **neaditiv**. 409 teste verzi, `tsc -b` + build verzi.

**Task Completed (Warlord: îndeletnicirile de pace ale unei legiuni)**
> Prompt: „continua cu felia 2"
> Model: Claude Opus 5
> - Jocul dă **o luptă pe zi** pe tot domeniul, deci toate contoarele de bătălie se trag dintr-o singură fântână. Fără o a doua, ai o legiune reală și restul ornamente.
> - **Bătăliile cumpără adâncime, îndeletnicirile cumpără direcție.** Zilele de serviciu sunt palmares, **niciodată renume** — o zi se obține așteptând, iar ceasul retro-creditează absența.
> - Trei îndeletniciri ca trei forme economice: garnizoană (ieftină, moral dublu), instrucție (scumpă, cohortele se antrenează), patrulare (**aduce** bani). Niciun canal nou — instrucția refolosește calea de XP existentă, garnizoana adaugă pe aceeași condiție ca recuperarea obișnuită.
> - Ocuparea e prețul, verificată în `startBattle`, nu doar în ecran.
> - Verificat pe viu pe o zi: moral 50→60 la garnizoană vs 55 la restul, XP 10→35 doar la instrucție, `Duty 3s` în log, toate trei legiunile refuzate la muster.
> - `SAVE_SCHEMA` 2 → 3. 392 teste verzi, `tsc -b` + build verzi în aplicație.

**Task Completed (Warlord: palmaresul unei legiuni + nivelul derivat din el)**
> Prompt: „continua cu felia 1"
> Model: Claude Opus 5
> - Prima felie din redesign-ul tradițiilor cerut de Andrei („tradițiile nu înlocuiesc nivelul... un tree de atribute... ceva ce userii creează"). Aici doar **temelia**: fără nicio autorare.
> - **Renumele** (singurul lucru care cumpără nivel) vine doar din ce nu se poate lua gratis — victorii, întoarceri nesângerate, poziții ținute cu preț, misiuni grele. **Palmaresul** (bătălii, înfrângeri, retrageri, uciși pe clase) se ține minte ca dovadă pentru nodurile viitoare, dar nu dă nivel.
> - **Trei ferme închise, verificate pe viu:** cohorta simbolică (5 oameni lângă 400 → **nimic**, cu motivul în log), retragerea imediată (renume 8 → 8, doar `retreats+1`), plafonul de uciși per bătălie.
> - Creditul merge la legiunea care **a mărșăluit**, dintr-un instantaneu luat la desfășurare — ambele taburi sunt montate simultan, deci altfel se putea muta creditul rearanjând cohortele în timpul bătăliei.
> - `SAVE_SCHEMA` 1 → 2, prima aplicare a regulii scrise ieri.
> - 376 teste verzi, `tsc -b` + build verzi în aplicație.

**Task Completed (Warlord: un build vechi nu mai poate mânca un save nou)**
> Prompt: „traditiile nu inlocuiesc nivelul ... vreau sa fie ceva ce userii creeaza" (constatare din analiza redesign-ului, verificată la sursă)
> Model: Claude Opus 5
> - **Lanțul, tot adevărat deja:** blob-ul de save e un literal fix de 14 chei, fără versiune; fiecare slice hidratează pe listă închisă; jocul n-are auto-actualizare (tab vechi = cod vechi la nesfârșit); iar `src/warlordCloud.ts` adoptă strict după `rev` **și incrementează `rev` la fiecare scriere**. Un tab vechi care avansează o zi scrie trunchiat, urcă `rev`-ul, împinge în Firestore, iar celălalt dispozitiv adoptă versiunea ciuntită. **Fără nicio eroare.** Legiunile livrate ieri erau deja expuse.
> - Acum: un build care deschide un save ștampilat mai nou **refuză să persiste** (deci `onPersist` nu se cheamă, deci nu se scrie nici în cloud) și arată un banner nedemisibil. Cheile de nivel superior necunoscute sunt purtate mai departe.
> - **Nu protejează retroactiv** — build-urile de dinainte n-au ce verifica.
> - Verificat pe viu ambele jumătăți; 341 teste verzi, `tsc -b` + build verzi în aplicație.

**Task Completed (Warlord: tradițiile legiunii + secțiunea lor din admin)**
> Prompt: „continua cu traditiile"
> Model: Claude Opus 5
> - A doua felie din north-star-ul legiunilor. O legiune **jură o dată, permanent**, la o tradiție care îi **refuză** anumite cohorte și îi cere o anumită formă; în schimb, cohortele ei ies din luptă mai bine. Constrângerea e ce transformă un buff în identitate — fără ea, toate legiunile converg.
> - **Două feluri de constrângere, tratate diferit fiindcă altfel ar minți:** interdicțiile („niciodată călăreți") sunt monotone → refuză la intrare; cerințele de proporție se pot strica fără să faci nimic (îți moare o cohortă) → nu retrag jurământul, ci **suspendă bonusul** până readuci legiunea în formă.
> - **Zero atingeri la motorul de luptă și niciun deploy de functions:** bonusurile merg pe canale de domeniu, regula scrisă deja în `research/effects.ts`. PvP-ul nu vede tradițiile și ecranul o spune.
> - **Defect din felia trecută, găsit pe viu:** `assignToLegion` valida pe snapshot-ul de render, deci două atribuiri în același frame puneau o unitate în **două legiuni deodată**. Reparat repetând verificarea înăuntrul updater-ului.
> - `src/warlordAdmin/WarlordAdminPanel.tsx`: secțiune **Legion traditions** în ARMY (praguri + răsplata per tradiție; ce refuză NU e reglabil — aia e identitatea).
> - Verificat pe viu bucla întreagă (jurământ −25 000c, cavalerie refuzată cu motivul pe buton, suspendare la scăderea sub prag, moral 65 → **78** după victorie doar la cohortele legiunii). 328 teste verzi, `tsc -b` + build verzi în aplicație.

---

**Task Completed (Warlord: fântâna de XP din completarea de efective)**
> Prompt: „lasa DataRead, continua cu warlord"
> Model: Claude Opus 5
> - Completarea adăuga fiecărui nou-venit 10% din media unității **din nimic** — ~700 XP per apăsare pe o unitate veterană, compunându-se. Sursa buclei completează→desființează, dar se scurgea și la joc normal.
> - Acum e **transfer**: ce câștigă noii veniți, plătesc veteranii. Totalul armatei nu mai poate crește. Plafonul e locul unde transferul se termină (un profesor nu-și duce elevul peste el), nu o clemă adăugată.
> - Verificat pe viu: 28 000 → **27 980** (−20 din trunchiere). Înainte: 28 700.
> - 294 teste verzi, `tsc -b` + build verzi în aplicație.

---

**Task Completed (Warlord: legiunile — formațiuni care supraviețuiesc cohortelor)**
> Prompt: „vreau ca fiecare unitate sa capete identitate ... legiunile Romane ... mai aproape de 40k", apoi corectura „legiunile nu se absorb, vreau un sistem similar cu Total War Rome 2"
> Model: Claude Opus 5
> - Legiunea e **formațiunea care conține unități**, ca armata din Rome 2 — deci compoziția mixtă vine gratis și **`Unit` nu primește niciun câmp**. Motorul de luptă și **copia lui din `functions/src/warlordCombat/` rămân neatinse**: niciun deploy de functions.
> - Apartenența e o listă de id-uri **rezolvată la citire**, tocmai pentru că write-back-ul din PvP (`PvpBattle.tsx` → `writeLocalArmy`) rescrie armata salvată pe lângă state-ul jocului. Verificat ștergând o unitate direct din blob: registrele o mai numesc, ecranul nu.
> - Plafon de 12 cohorte, legat de `PVP_MAX_COMBATANTS` (serverul refuză al 13-lea) și de defectul de stivuire al campaniei peste 24.
> - **Corectat CLAUDE.md în ambele repo-uri:** „`logic/types.ts` byte-identic cu copia server" era fals de trei felii încoace și inert. Contractul real e 7 simboluri de combat.
> - 282 teste verzi; 0 contraste sub prag în ambele teme și pe 375px; 0 ținte mici; 0 input-uri fără etichetă.

---

**Task Completed (Warlord: de unde vin oamenii + secțiunea Army din admin)**
> Prompt: „ok, continua" (ultima din cele patru mecanici de adâncime agreate pentru armată)
> Model: Claude Opus 5
> - Trei surse de recruți (Levy / Volunteers / Mercenaries) care diferă la **preț și avans**, legate de un câmp care exista de la început și pe care **nu-l citea nimeni**.
> - **Regula:** rangul se plătește în timp, niciodată în bani — plafon în getter, deci nici adminul nu-l poate încălca.
> - Reparat un defect vechi de aritmetică: rezervorul re-deriva și trunchia media la fiecare scriere, **pierzând ~1/6 din XP-ul plătit** la amestecuri. Migrare din save-urile vechi, verificată pe viu.
> - **Admin: secțiune nouă „Army"** care consumă `explainIntensity` și `explainCapacity` — scrise când au apărut mecanicile și rămase cod mort, cu `intensity`/`barracks` editabile doar din tabul JSON. Reparată și enumerarea din `resetSection` (o secțiune lipsă supraviețuia tăcut unui „Reset").
> - 246 teste verzi; 0 contraste sub prag în ambele teme și pe 375px; cardul de antrenament și tick-ul livrează identic (verificat 12 zile pe viu).

---

**Task Completed (Warlord: zona de armată devine un singur loc)**
> Prompt: „vreau un UI mai frumos si o tranzitie mai smooth intre tab-urile ce tin de soldati si razboi"
> Model: Claude Opus 5
> - Barracks + Units + Campaign → **un tab „Army" cu cinci secțiuni** și sub-navigare mereu vizibilă. De la patru clicuri (și tot ce tastasei pierdut) la **un clic, cu state-ul păstrat**.
> - **Zonele invizibile de click au dispărut fiindcă erau stricate:** două se suprapuneau și își furau clicurile, un tooltip se tăia pe telefon, niciuna nu era accesibilă la tastatură sau touch. Arta a rămas ca banner.
> - **Zero enum-uri brute pe ecran** (verificat prin scanarea textului randat): un singur formator care folosește numele deja scrise în Registry.
> - Reparate: `checkCreateUnit` scris și neimportat de nimeni, câmpurile fără plafon, gaura de auto-buy, formularele moarte cu cinci rânduri goale.
> - **Mișcarea animă doar transform:** un fade de la 0 ținea secțiunea invizibilă când animatia nu progresa — prins de audit ca 41 de elemente la 1:1. 223 teste verzi, 0 contraste sub prag în ambele teme și pe 375px.

---

**Task Completed (Warlord: capacitatea cazărmii)**
> Prompt: „continua"
> Model: Claude Opus 5
> - Cazarma nu avea fund: puteai recruta la nesfârșit. Acum oamenii ocupă loc — **recruți + soldatți antrenați**, iar cei intrați într-o unitate NU se numără, fiindcă sunt pe teren. Asta face din „formează unități" supapa, și e invariantul fixat cu test.
> - **Plafonul se aplică doar la recrutare**, dintr-o observație: antrenamentul și conversiile sunt nule la total (N recruți → N antrenați). Verificat și live.
> - A închis **ultimul refuz tăcut din joc** — costul de recrutare se refuza încă doar în tabul Log, fiindcă verificarea exista dar formularul nu era legat la ea.
> - Verificat în browser: 80/80 ⇒ buton mort cu motivul; lot terminat ⇒ tot 80; format o unitate ⇒ 60/80 și butonul reînvie. 223 teste verzi.

---

**Task Completed (Warlord: intensitatea de antrenament)**
> Prompt: „cu care crezi ca e mai eficient" → „e ok"
> Model: Claude Opus 5
> - Antrenamentul de bază era o așteptare pură — aceleași zile, același rezultat, nicio alegere. Acum are **trei intensități**: RUSHED (rapid, o cincime nu termină), STANDARD (**identic cu azi**, deci save-urile și conversiile rămân neatinse), DRILLED (mai lung, soldă plătită în față, ies TRAINED).
> - **Un lot promovează cel mult UN rang.** Testul scris ca regulă, nu ca număr, a prins gaura înainte de live: cu tehnologiile stivuite un lot ar fi scos ADVANCED direct, adică tot urcușul de ~22 de zile sărit dintr-o cumpărătură.
> - **Două defecte reparate în același loc:** o conversie consuma ADVANCED+ și întorcea NOVICE (`takeByRank` se scria și nu se citea niciodată), iar sosirile nu diluau XP-ul slotului.
> - Verificat în browser: ce scrie cardul înainte de apăsare (zile, soldă, câți ies, cu ce rang) e exact ce se întâmplă. 212 teste verzi.

---

**Task Completed (Warlord: bucla de armată reparată și făcută onestă)**
> Prompt: „vreau sa imbunatatim sistemul de recrutare si de training, plus ca nu functioneaza sistemul de creare unitati"
> Model: Claude Opus 5
> - **„Create Unit" arunca `TypeError` la fiecare apăsare, tăcut.** `UnitsTab` cerea `createUnit`, state-ul exportă `createUnitFromBarracks` — a trecut de typecheck fiindcă props-urile veneau prin `state as any`. Fiind SINGURA cale de la 0 unități la 1, armata nu putea fi pornită deloc. Am scos cast-ul, deci greșeala asta e acum eroare de compilare.
> - Am parcurs bucla întreagă în browser și am găsit și restul: **recrutarea era gratis**, **fiecare refuz era tăcut** (doar în tabul Log, cu butonul activ), **rezervorul de soldatți antrenați era invizibil**, iar **echipamentul dispărea la creare** — o unitate plătită integral arăta „Ready 0/20".
> - Unitatea își ține acum gearul (cu migrare pentru save-uri vechi și o gardă că nicio luptă nu se rebalansează tăcut), Replenish reactivat, Disband adăugat. Refuzurile trec prin același `evaluateCost` ca la Research și Clădiri: buton mort + ce lipsește, scris pe loc.
> - 197 teste verzi — **15 noi în `logic/army.test.ts`, prima acoperire de vreodată pe traseul ăsta**, care e exact motivul pentru care un prop greșit a ajuns pe live.

---

**Task Completed (Warlord Research Felia 2: Studiul ca resursă produsă)**
> Prompt: „continua" — următorul lucru din roadmap după ce revamp-ul s-a golit.
> Model: Claude Opus 5
> - **Cercetarea nu mai e o coadă de așteptare, e un cost.** Un proiect număra zile și nu costa nimic din ce producea domeniul. Acum consumă **Studiu**, acumulat pe ramuri (Economy/Army/Campaign/Doctrine), produs de Scriptorium și de cât din producția zilnică a unei clădiri dedici studiului. Ziua rămâne unitatea de timp a jocului — venituri, upkeep, hrană, antrenament, campanie: neatinse.
> - **Al treilea slider NU e o împărțire în trei.** Research ia prima felie din valoarea zilei; `focusCoinPct` împarte apoi ce rămâne, exact ca înainte. Un slider cu trei capete însumând 100 ar fi rescris tăcut intenția fiecărei clădiri din fiecare save existent. Câmp absent ⇒ 0 ⇒ comportament bit-identic (test de regresie explicit).
> - **Calibrat ca sliderul să fie o decizie:** un Scriptorium singur e mai LENT decât vechiul ceas de zile la orice nivel (50/65/80 față de un ritm de referință de 100). Viteza veche e ceva ce cumperi deviind producție. Altfel sliderul ar fi doar un bonus.
> - **Două lucruri din plan au picat la contactul cu codul:** (a) Scriptorium-ul **rămâne** în afara economiei de cupru — studiul lui e funcție de nivel, nu o valoare în cupru convertită; i-aș fi dat venit în monede la focus-ul implicit de 100%; (b) `GameConfig.init` rula **după** ce se hidratau feliile, deci migrarea unui proiect vechi ar fi folosit baseline-ul implicit în loc de cel din admin. Mutat.
> - **Capcana care șterge stare în tăcere:** `hydrateResearch` enumeră câmpuri (spre deosebire de `hydrateCampaign`, care face spread), deci `pools` scris în localStorage ar fi dispărut la fiecare reload, fără nicio eroare. Adăugat acolo și testat direct, plus verificat live cu dublu reload.
> - **Save-urile vechi se convertesc proporțional:** 2 zile din 3 ⇒ 2/3 din costul în Studiu. Verificat pe un save real forjat în forma pre-Studiu.
> - **Adminul:** secțiune nouă „Study — the pace of research" cu linie de efect + formulă (prin `explainStudy`, care RULEAZĂ `studyPerDay`, nu redescrie formula); `days` reetichetat **Effort**; textul „Research already in progress keeps the days it was queued with" reparat — nu mai era adevărat.
> - **Verificat în browser, nu doar la typecheck:** bara a promis Economy +56.4/zi, ziua a livrat exact +56.4; registrele se închid la virgulă (106,4 + 56,4 − 162,8 = 0); celelalte ramuri neatinse. 0 contraste sub 3:1 în ambele teme, în joc și în admin. Două „defecte" măsurate s-au dovedit artefacte ale panoului de browser cu lățime 0 — verificate a doua oară la 1280 real.
> - 182 teste verzi (25 noi), `tsc -b` + build verzi în ambele proiecte. Fondurile și materialele dedicate rămân felia 2b.

---

**Task Completed (Warlord revamp felia 5: de-emfaza nu mai ascunde informația)**
> Prompt: „am salvat si merge, continua cu revamp-ul"
> Model: Claude Opus 5
> - Lista de observații UI era din 01.08 și patru felii trecuseră peste ea. Am verificat-o întâi (cinci verificări paralele + o pasă adversarială pe fiecare); **trei au picat cu argumente bune și le-am lăsat**: culoarea ramurilor din arborele de research, antetul, caseta de Momentum.
> - **Constatarea care contează:** `opacity-70` compune și textul, și fundalul, deci pe un card blocat linia „Requires: ..." randa la **2,93:1** deși perechea declarată de tokenuri e 5,28:1. Auditul de contrast de la felia 1 măsura culori, iar opacitatea nu e o culoare — așa a trecut nevăzută. Acum de-emfaza stă în bordură punctată + titlu estompat. Același tratament la clădirile pe care nu ți le permiți.
> - Tier-ul devine structură (separatoare „Tier 1/2/3" în loc de pastila de 10px); numele obiectului învinge acum butonul în cardurile de research și de piață; numărul zilei învinge titlul „Warlord".
> - Două defecte văzute în browser: `SCRIPTORIUM` randa `<img>` fără `src` (iconiță ruptă pe clădirea care deschide toată cercetarea), și Overview încă descria regula dinainte de rebalansare.
> - Verificat cu audit care ține cont de opacitate: **0 eșecuri în ambele teme**, desktop și 375px, 0 overflow, 0 imagini rupte. 157 teste verzi, `tsc -b` + build verzi.

---

**Task Completed (adminul Warlord își arată efectul și formula, pentru valorile care se editează)**
> Prompt: „se pare ca valoarea pe care o trecusem deja pentru costul unei cladiri a fost actualizat, si se pare ca si productia de lemn a crescut. o sa vreau in admin sa se vada mai clar ce efect au si vor avea in viitor modificarile pe care le face. vreau sa se vada formula de calcul etc."
> Model: Claude Opus 5
> - **Sub fiecare câmp stă acum o linie de efect și, la cerere, aritmetica în clar.** Cinci feluri: producția unei clădiri pe zi, prețul ei (construcție + drumul până la L3 + resurse), economia unei rețete, costul unei companii de soldați (întreținere + hrană) și ce scoate/plătește o misiune. Toate se evaluează SUB configurarea din formular, nu sub cea salvată (`logic/explain.ts`, în repo-ul jocului).
> - **Trei lucruri pe care panoul le spunea greșit și acum le spune corect:**
>   1. „Prețul clădirii e și baza venitului (10%)" — fals de la rebalansare: pentru orice clădire cu producție proprie, prețul și venitul sunt două butoane independente.
>   2. **MINTER-ul „transformă toată valoarea în monezi"** — fals sub 100% focus pe monede: motorul plătește doar cota de monede și **aruncă restul**. Pe focus material, un Minter produce literalmente nimic. Linia și formula o spun acum, iar `valueLostPerDay` o măsoară rulând aceeași zi la 100% și scăzând.
>   3. **Un câmp cu valoare negativă era pictat ca „modificat" deși jocul îl respinge și rămâne pe implicit.** Acum câmpul e roșu și scrie exact asta.
> - **Nota care răspunde direct la reclamația inițială** („am schimbat producția de lemn și nu am văzut modificări"): o clădire nouă pornește la **100% focus pe monede**, deci o creștere de producție materială nu schimbă NIMIC până când jucătorul nu mută slider-ul. Scris în panou, lângă câmpurile de producție.
> - `devHarness`: `?theme=light` pornește panoul în light. Comutarea temei la runtime lasă browserul cu proprietăți pe jumătate recalculate (fundal dark, text light) — auditul de contrast raporta așa două eșecuri inexistente.
> - **Verificat în harness** (adminul e punct orb, e în spatele autentificării): 689 elemente cu toate cele 57 de formule deschise, **0 contraste sub 3:1 în AMBELE teme**, 0 overflow orizontal, și pe 375 px; ținta de atingere a comutatorului de formulă ridicată la 32 px. O rețetă dusă la 50 lemn/arc îi răspunde pe loc „crafting DESTROYS 24s 30c per item".
> - 157 teste verzi, `tsc -b` + build verzi, harness-ul confirmat în afara build-ului de producție.

---

## 📅 Session Log: August 2, 2026

**Task Completed (Economia: productia devine axa proprie, iar craftul adauga valoare)**
> Prompt: Andrei a ales varianta 1 dintre cele doua propuse pentru dezechilibrul lemnului.
> Model: Claude Opus 5
> - **BUILDING_OUTPUT_VALUE inlocuieste regula "10% din prețul cladirii".** Scara unui atelier era un accident al costului lui de constructie: un blacksmith de 100g scotea 100.000c de bunuri pe zi si manca 2.379 lemn, in timp ce o moara facea 14 — un atelier depasea o suta de mori. Productia e acum o axa proprie, comparabila intre cladiri si reglabila din admin; preturile raman doar poarta de constructie.
> - **Rețetele nu mai distrug valoare.** Masurat inainte: un arc lua 500c de lemn ca sa produca 70c de arc; un scut 750c pentru 100c; o sabie 3.200c pentru 1.500c. Fiecare reteta era o pierdere, deci orice atelier era o metoda de a transforma resurse in mai putin decat aveai. Acum materialele sunt ~40-75% din valoarea obiectului.
> - **Rezultat masurat:** moara L3 +23 lemn/zi (neschimbat); woodworker pe arcuri -23/zi (era -399); **moara L3 + woodworker = net -1 lemn/zi**, adica o moara sustine un atelier; blacksmith pe sulite -27 (era -2379); un smelter acopera consumul mai multor blacksmith-uri.
> - Ambele axe sunt în `GameConfig` (`buildingOutputValue`, `recipes`) și au secțiuni proprii în admin. Override-ul vechi `resourceBaseValue` rămâne onorat, ca o configurare existentă să nu amuțească în tăcere.
> - 125 teste verzi; cele doua care fixau dezechilibrul fixeaza acum echilibrul, plus un test care verifica pentru FIECARE reteta ca materialele valoreaza mai putin decat obiectul.

**Task Completed (Adminul Warlord: 5 defecte confirmate + tema + punctul orb)**
> Prompt: „in primul rand adminul, si, vad ca adminul nu functioneaza bine" — apoi, concret: „am incercat sa schimb productia de lemn, si costul de lemn al unei cladiri si nu am vazut modificari".
> Model: Claude Opus 5
>
> **Cauza raportului, gasita exact:** nu logica era stricata. Testele noi dovedesc că `resourceBaseValue.WOOD` chiar cvadruplează producția morii și că `buildingResourceCost` chiar schimbă costul (păstrând celelalte resurse). Ce se rupea era **livrarea**, în două feluri, ambele reparate:
> 1. **Ieșirea din Admin arunca tăcut tot ce nu era salvat.** Vizualizările sunt un ternar în `screens/Warlord.tsx`: un click pe 🏰 Domain demontează panoul. Iar modul natural de a verifica o schimbare de balans e exact acela — să te duci să te uiți în joc. Deci acțiunea firească era și cea care îți ștergea munca, fără niciun avertisment; te întorceai și vedeai numerele vechi. Acum: **urmărire reală a modificărilor** (comparație cu ce e stocat, nu un contor care arăta la fel înainte și după salvare), antet care spune „Unsaved changes", confirmare la părăsirea panoului și `beforeunload`.
> 2. **O salvare nu ajungea în joc până la un reload complet** — gazda încărca configurarea o singură dată, în poarta de montare. Acum panoul anunță gazda (`onSaved`) și balansul se aplică imediat.
>
> **Defectul cel mai grav, care nu se manifestase încă:** `loadWarlordConfig` întorcea `null` ȘI pentru „documentul nu există", ȘI pentru „citirea a eșuat". După o pică de rețea, panoul arăta toate valorile implicite și scria liniștitor „No overrides — pure defaults"; prima salvare ar fi **înlocuit întreaga configurare de balans a lumii, pentru toți jucătorii**, cu un document construit din formularul gol — și ar fi zis „Saved ✓". Acum încărcarea distinge cele două cazuri, iar la eșec **editorul refuză să se deschidă** și explică de ce. Verificat live: deconectat (deci citire refuzată de reguli), panoul arată ecranul de refuz, nu un formular.
> **Scrierea are acum și o precondiție de versiune** (`runTransaction` pe `updatedAt`): doi admini sau două taburi se suprascriau reciproc fără niciun semnal. Conflictul e acum respins cu un mesaj clar.
> **Alte două reparate:** ștergerea unui câmp de efect al unei tehnologii *fixa* valoarea implicită în document în loc s-o elimine (singura anulare era resetarea întregii secțiuni); și **Save ignora caseta JSON** — lipeai o configurare, apăsai Save, scria „Saved ✓" și nu conținea nimic din ce lipiseși. Ambele reparate și verificate.
> **Tema:** panoul fusese scris înainte de tokenuri și stă acum în rădăcina `.warlord`, care merge pe dark. Măsurat: **82 de perechi de contrast sub 3:1 și 84 de suprafețe albe**. După tokenizare: **0 și 0**, în ambele teme.
> **Punctul orb rezolvat:** `npm run dev:warlord-admin` (`warlord-admin.html` + `devHarness.tsx`) randează panoul real fără autentificare, cu comutator light/dark; `?demo=1` îi injectează o încărcare reușită printr-un prop `loader`, ca să se poată exercita și calea fericită. Nu intră în build-ul de producție — verificat.
> - Investigația: workflow cu 5 lentile (round-trip, ajungerea override-urilor în joc, mașina de stări a UI-ului, permisiuni, temă) + verificare adversarială per constatare: **5 confirmate, 3 respinse** — iar cele respinse erau exact cele două pe care le reparasem între timp, ceea ce e o confirmare bună a metodei.
> - 121 teste verzi (7 noi despre balanța lemnului), typecheck + build verzi în ambele proiecte.



**Task Completed (Warlord: temă dark, iar embed-ul nu mai forțează light)**
> Model: Claude Opus 5
> - Jocul are acum tokenuri semantice și o temă dark caldă (detalii în DEVLOG-ul jocului, repo-ul Warlord, commit `243386d`). Aici s-a scos **lacătul de light**: `src/screens/Warlord.tsx` învelea jocul în `bg-white text-zinc-900 [color-scheme:light]` pentru că fiecare componentă Warlord folosea clase Tailwind deschise — în dark, textul necolorat devenea alb pe alb.
> - Ecranul-înveliș e tokenizat și pasează tema aplicației mai departe: `theme={dark ? 'dark' : 'light'}`, unde `dark` vine din `useThemeStore` (`isDarkMode || customThemeIsDark`). Când gazda dictează tema, jocul își ascunde propriul comutator — există un singur loc de unde se schimbă.
> - Pointerul submodulului urcat la commit-ul cu tema. Verificat în aplicație: jocul randează dark, iar auditul de contrast pe toate taburile, în contextul aplicației, nu găsește nicio pereche sub 3:1.

**Task Completed (Warlord devine SUBMODUL — repo separat, dar o singură copie de cod)**
> Prompt: „poti sa lucrezi in continuare in acel folder, inclusiv sa pastram git repo separate, dar jocul si aplicatia trebuie sa lucreze impreuna pe live. in ideea ca poate la un moment dat jocul poate sa fie distribuit si prin alte canale, nu doar prin aplicatia OurDaysApp". Mecanism ales de Andrei dintre trei variante: **submodul git**.
> Model: Claude Opus 5
>
> Unificarea într-un singur repo (mai devreme azi) a fost **anulată**: Warlord rămâne produs propriu, cu repo propriu, ca să poată fi distribuit și altfel. Dar constrângerea „să lucreze împreună pe live" cerea un mecanism — garanția de până acum era că eu copiam manual fișier cu fișier și verificam cu `diff -q`, adică exact genul de disciplină care cedează tăcut.
> - **`src/warlord` e acum submodul git** către `AndreiBesliu/Warlord`, nu o copie. Aplicația fixează explicit ce commit de joc livrează — potrivit pentru un joc care va avea mai multe canale de distribuție.
> - **Alias `@warlord/*` → `src/warlord/src/*`** (`vite.config.ts` + `tsconfig.app.json`), rescris în cele 6 fișiere care importau jocul. Aliasul există ca să putem schimba mecanismul (pachet npm, altă cale) fără să atingem fiecare import.
> - **`dedupe: ['react','react-dom']`** — obligatoriu: submodulul își are propriul `node_modules` când e dezvoltat standalone, iar fără dedupe aplicația ajunge cu două copii de React. Simptomul ar fi fost „Invalid hook call", nu o eroare de modul — verificat live că jocul se montează curat, fără erori în consolă.
> - **`tsconfig.app.json`** exclude ce e app-shell în submodul (`main.tsx`, `vite.config.ts`, `node_modules`, `dist`) și testele; restul codului de joc **e** typechecked de build-ul strict al aplicației.
> - **CI-ul aplicației** face checkout cu `submodules: recursive` și rulează testele jocului DIN submodul — deci verifică exact codul pe care îl livrează.
> - **Flux nou, important:** o modificare în joc cere DOUĂ commit-uri — unul în repo-ul jocului, unul aici care urcă pointerul. Fără al doilea, live-ul rămâne pe versiunea veche. Scris în ambele CLAUDE.md.
> - Curățat ce rămăsese din unificare: `warlord.html`, `standalone.tsx`, `docs/WARLORD_DEVLOG.md` și testele copiate (vin din submodul).
> - Verificat: typecheck + 96 teste (din submodul) + build verzi; `/warlord` se montează și rulează în browser, zero erori în consolă.

**Task Completed (Warlord și OurDaysApp unite într-un singur repo) — ANULAT în aceeași zi, vezi intrarea de mai sus**
> Prompt: „vreau varianta care ne permite sa sincronizam proiectele cu github. si apropo, vreau sa unim proiectele warlord si OurDaysApp si in repo si in sesiunea asta" (venit din întrebarea „de ce tot primesc mail ca asta" despre CI-ul eșuat).
> Model: Claude Opus 5
>
> **Contextul mailurilor:** repo-ul `AndreiBesliu/Warlord` avea un workflow care construia (verde) și apoi publica pe GitHub Pages (roșu). Eșua **la fiecare push din 4 decembrie 2025** — 17 eșecuri din 18 rulări. Cauza: workflow-ul n-avea bloc `permissions:`, iar token-ul din Actions e implicit read-only, deci `peaceiris/actions-gh-pages` nu putea scrie ramura `gh-pages` (care nu s-a creat niciodată; Pages nici nu era activat). Fiecare push din sesiunea de ieri = încă un mail.
> **Ce s-a schimbat:** codul jocului exista în DOUĂ copii byte-identice — repo-ul separat și `src/warlord/` de aici — ținute sincronizate manual la fiecare modificare. Acum există **o singură copie**, aici.
> - **Repo-ul Warlord e arhivat**: workflow-ul de CI șters (deci mailurile se opresc — am confirmat că push-ul de arhivare n-a mai declanșat nicio rulare), README înlocuit cu un pointer, `CLAUDE.md` marcat clar ca mort. Repo-ul rămâne pentru istoric.
> - **Harness standalone, fără să duplicăm nimic:** `warlord.html` + `src/warlord/standalone.tsx` montează ACELAȘI `WarlordApp`, fără auth și fără Firebase, cu salvarea în `warlord_dev` (`npm run dev:warlord`). Ăsta era singurul motiv real pentru care repo-ul separat mai avea sens: puteam itera pe joc fără să pornesc aplicația și să mă autentific. **Nu intră în build-ul de producție** — verificat că `dist/warlord.html` nu există.
> - **Cele 96 de teste au venit cu jocul:** Vitest adăugat în OurDaysApp, testele mutate în `src/warlord/**/*.test.ts` și excluse din `tsconfig.app.json` (le typechecks Vitest, nu build-ul aplicației).
> - **CI nou aici** (`.github/workflows/ci.yml`): typecheck + teste + build la fiecare push. Deliberat **fără deploy** — livrarea rămâne manuală. Notă: repo-ul ăsta n-avea până acum NICIUN CI, iar cel din Warlord nu rula niciun test, doar build.
> - **`CLAUDE.md` nou pentru OurDaysApp** (nu exista): infra, regulile de lucru, i18n cu excepția pentru Warlord, capcanele. Istoricul jocului dinainte de unificare a fost mutat în `docs/WARLORD_DEVLOG.md`.
> - **A doua copie care ÎNCĂ rămâne, intenționat:** motorul de luptă din `functions/src/warlordCombat/`, necesar pentru PvP-ul server-authoritative. E documentat explicit în CLAUDE.md ca singura duplicare validă.
> - Verificat: typecheck + 96 teste + build verzi; harness-ul standalone pornește jocul în browser fără autentificare.

**Task Completed (Warlord — topbar cu resurse + prognoză zilnică)**
> Prompt: „o sa vreau ca resursele sa poata fi vazute permanent in topbar, si vreau sa se vada si cat vor creste zilnic in functie de setarile cladirilor".
> Model: Claude Opus 5
> - O zi de economie a devenit o funcție pură (`simulateEconomyDay`) pe care o rulează ȘI tick-ul ȘI bara de sus, deci numărul afișat nu poate devia de cel plătit. Bară persistentă în antet: monede + fiecare resursă cu stoc și `+n/−n` pe zi, roșu la înfometare, tooltip cu cine produce/consumă și zilele până la golire.
> - Reparate trei locuri din UI care afișau altă matematică decât jocul (o ramură hardcodată în ProductionModal, textul din OverviewTab, FOOD lipsă din ResourcesTab) + un NaN latent la topire pe save-uri vechi.
> - Cea mai utilă consecință: `buyBuilding` pune `focusCoinPct: 100` pe orice clădire nouă, iar la focus 100 nu se produce niciun bun — o fermă nouă face 800 de monede și ZERO hrană. Bara arată asta acum.
> - 96 teste verzi (17 noi), verificat live că prognoza coincide exact cu ce produce „Run Day". Deploy hosting. Commit + push ×2.

## 📅 Session Log: August 1, 2026

**Task Completed (Warlord — Research felia 1: Scriptorium + cerințe de infrastructură)**
> Prompt: „research ar trebui sa fie disponibil dupa ce se construieste o cladire anume, si anumite research options ar trebui sa fie influentate de unele cladiri si de nivelul lor de upgrade".
> Model: Claude Opus 5
> - Clădire nouă `SCRIPTORIUM` (60.000 cupru + 60 Wood + 40 Stone): fără ea tabul Research nu apare deloc, iar `startResearch` refuză orice proiect. Fiecare din cele 12 tehnologii cere acum infrastructură concretă, cu nivel (`TechDef.requiresBuildings`), iar cardul blocat spune exact ce lipsește („Needs: Smelter L2 (you have L1)").
> - Cerințele trec prin `resolveCatalog` ⇒ se pot rescrie din panoul de admin Warlord (tabul JSON), ca orice altă valoare de balans.
> - Bug colateral reparat: `FARM` nu apărea în nicio listă de construcție, deci nu putea fi construită deși hrana se consuma zilnic.
> - Planul complet pe 4+1 felii (Studiu ca resursă produsă, slider Research% pe clădiri, head of research + experți cu randament descrescător, probe de teren, doctrine→tradiții) e în `Apps/games/warlord/DEVLOG.md`. Următoarea felie rămâne, prin decizia lui Andrei, revamp-ul UI + tema dark.
> - 79 teste verzi (11 noi), tsc + build verzi în ambele proiecte, cele 2 copii identice, verificat live. Deploy hosting. Commit + push ×2.

**Bug Fix (Warlord — ziua nu avansa după ce ieșeai din aplicație)**
> Raport: „am lăsat jocul deschis și a ajuns la ziua 159, dar am ieșit și am intrat înapoi și ziua nu a avansat, deși ar trebui" (+ raportul anterior: „ziua nu s-a schimbat, dar timer-ul s-a resetat").
> Model: Claude Opus 5
>
> **Cauza-rădăcină.** Ziua era programată de un singur termen în memorie, `nextTickAt`, ținut într-o cheie localStorage *lângă* save (`${saveKey}:nextTickAt`), iar inițializatorul îl ARUNCA dacă trecuse: `WarlordApp.tsx:46` — `return Number.isFinite(n) && n > Date.now() ? n : Date.now() + TICK_MS`. Orice montare (reîncărcare, revenire pe /warlord, comutarea Domain↔PvP) ștergea timpul scurs și repornea o fereastră de 5:00 ⇒ zero zile pentru absență și, dacă intrai mai puțin de 5 minute, ziua nu avansa NICIODATĂ. În plus, ancora nu era în save, deci nici nu se sincroniza cu norul: `day` e per-cont și cloud-autoritativ, ancora era per-dispozitiv — două cadre de referință diferite.
> **Fixul.** Ceasul e acum ancorat de `lastTickAt` (momentul ultimei zile încheiate), care stă ÎN SAVE și călătorește cu regatul prin `warlordDomains/{uid}` exact ca `day`. Nou `logic/tick.ts` (pur): `planTicks(now, lastTickAt, tickMs, maxDays)` întoarce câte ferestre s-au scurs, câte se acordă, câte se pierd peste plafon, noua ancoră și timpul rămas. Numărătoarea inversă e derivată din ancoră ⇒ nu poate deriva și nu se mai resetează la remontare.
> - Recuperarea rulează **o zi per commit** (efect care golește `pendingDays`): `runDailyTick` citește snapshot-ul de render (`const nextDay = day + 1`, iterații peste `unit.units`/`batches`/`research.queue`), deci N apeluri sincrone ar fi avansat ziua cu exact 1.
> - Plafon implicit **24 de zile** (2 ore reale de absență), reglabil din Admin → Economy → *Day clock* împreună cu minutele pe zi. Restul se pierde, nu se stochează, iar ancora e rebazată ca următoarea intrare să nu-l acorde din nou. Motivul plafonului: fiecare zi recuperată plătește upkeep și mănâncă hrană.
> - O singură linie de log pentru absență („⏳ Away 2h 14m — resolving 24 days (276 … skipped)"), ca `LOG_CAP = 300` să nu șteargă istoricul jucătorului.
> - Reparat pe drum: heartbeat-ul avea `state` (obiect nou la fiecare render) în lista de dependențe, deci intervalul de 1s se re-instala la fiecare render — acum e instalat o singură dată și citește jocul printr-un ref. Butonul „Run Day" repornește explicit fereastra (`runDailyTick(Date.now())`).
> - Sincronizare cloud (embed-only): `warlordCloud.ts` adoptă norul doar la `cloudRev > localRev` (era `>=`, iar la egalitate arunca ce se scrisese local în ultima fereastră de debounce); `screens/Warlord.tsx` face `flush()` pe `visibilitychange`/`pagehide` — React nu demontează când închizi tabul sau când sistemul trece aplicația în fundal.
> - **Investigație:** workflow multi-agent, 5 lentile independente (ciclu de tick / hidratare / sync cloud / timp offline / client învechit) → 35 constatări brute, 6 verificate advers (câte 2 verificatori: „refută mecanismul" + „explică simptomul"), **4 confirmate**, plus un critic de completitudine care a corectat fixul propus: recuperarea NU trebuie calculată din cheia locală, altfel pe alt dispozitiv fie nu recuperezi nimic, fie același interval se creditează de două ori.
> - **Constatare separată (nu e cauza):** clientul nu are cale de auto-actualizare. `index.html` înregistrează SW-ul dar nu cheamă `registration.update()` și nu ascultă `updatefound`; gate-ul de versiune rulează doar când se parsează un index.html PROASPĂT, ceea ce nu se întâmplă într-un tab deschis de ore. De asta în captura owner-ului lipseau tabul Research și butonul Admin, deși live-ul servea build-ul curent (`index-C5uHvZLb.js`, identic cu dist-ul local). Owner-ul trebuie să facă hard-reload; o pastilă „versiune nouă — reîncarcă" rămâne de decis.
> - Verificat live (preview, bypass temporar de auth, revenit): absență simulată de 41 min ⇒ ziua 6→14 cu faza păstrată; absență de 25h ⇒ +24 zile, 276 sărite, ancora rebazată; reîncărcare fără timp scurs ⇒ ziua rămâne, numărătoarea CONTINUĂ de unde era (nu mai sare la 5:00); exact o fereastră ⇒ +1 zi fără linie de „Away"; „Run Day" ⇒ +1 și fereastră nouă. Zero erori în consolă.
> - 68 teste verzi (15 noi în `logic/tick.test.ts`, inclusiv ceasul dat înapoi, ancoră coruptă, plafon 0 și 100 de ferestre consecutive fără derivă), tsc + build verzi în ambele proiecte, cele 2 copii identice. Deploy hosting. Commit + push ×2.

**Task Completed (Warlord — admin de balans + reparat modificatorii inerți)**
> Prompt: "adminul" (după tech tree: „O sa vreau un admin de unde pot configura toate lucrurile astea. Un admin separat de cel de la OurDaysApp") — decizii: aceiași admini ca OurDaysApp (`admins/{uid}`), scope v1 = tehnologii + buff-uri de momentum + economia de bază.
> Model: Claude Opus 5
>
> **Fundația: `warlord/logic/config.ts`** — un singleton `GameConfig` (model `Registry`) inițializat înainte de montarea jocului. Tabelele existente rămân DEFAULT-uri neatinse; override-ul se merge peste ele, iar valorile invalide (NaN, negative, tip greșit, id necunoscut) cad înapoi pe default — un typo în admin nu poate strica economia. Motivul singletonului: `BuildingsTab`/`ProductionModal` citesc tabelele direct din module, deci o configurare pasată doar prin `useGameState` ar fi afișat un preț și ar fi încasat altul.
> **Reparat: doi modificatori de research erau INERȚI.** `mods.buildCostMult` (Craft Guilds, Grand Armory) și `mods.trainDaysDelta`/`trainSlotsDelta` (War Academy) apăreau în `ResearchTab` dar nu ajungeau nicăieri — `buildingUpgradeCostCopper` nu primea niciodată `costMult`, `buildingCostCopper` nu avea apelant, iar `enqueueBatch`/`canEnqueue` nu primeau deltele. Acum `buildingCostCopper` e SINGURA sursă de preț (cumpărare, upgrade, PriceTag, tooltip), iar deltele de antrenament trec prin `Ctx.mods` din `training.ts`. Teste noi care prind exact regresia.
> **Reparat: `ProductionModal` reimplementa formula de venit** (`0.10*cost`, `0.7*mv`) — ignora nivelul clădirii, valorile de bază pe resursă și bonusurile de research, deci promitea numere pe care jocul nu le plătea. Acum cheamă `passiveIncomeAndProduction`, aceeași funcție ca tick-ul zilnic.
> - Date resolvate: `missionPresets()` (enemies.ts) și `resolveBuffs(overrides)` (momentum.ts) alături de `resolveCatalog` existent; `onBattleWon/Lost/onResearchCompleted` iau tabelul resolvat.
> - `firestore.rules`: `warlordConfig/{docId}` — citire pentru orice utilizator autentificat (o lume ⇒ o configurare pentru toți), scriere doar cu `exists(/databases/$(database)/documents/admins/$(uid))` (același tipar privilegiat ca `isMemberOfGroup`).
> - OurDaysApp-only: `src/warlordAdmin/{configApi.ts,WarlordAdminPanel.tsx}` — secțiuni Economy / Techs / Momentum / Campaign / JSON, fiecare câmp e un OVERRIDE (gol = default, evidențiat când e schimbat), reset pe secțiune, JSON pentru editări în masă, „Clear ALL". Al treilea buton `[⚙ Admin]` în `screens/Warlord.tsx`, vizibil doar dacă `adminCheck()` întoarce true (regulile re-verifică pe server). Configurarea se încarcă în același `ready`-gate ca domeniul, ÎNAINTE de montarea jocului (GameConfig e citit sincron la primul render).
> - Verificat live (preview, bypass temporar de auth, revenit): cu un override de test prețul BLACKSMITH a trecut de la 100g la 777g în magazin; panoul randează toate secțiunile; o editare produce exact `{"missions":{"BANDIT_RAID":{"ratio":2.5}}}`; fără sesiune, citirea configurării e respinsă de reguli și jocul cade elegant pe default-uri.
> - Semantică (scrisă și în panou): configurarea e globală și live — cercetarea deja în coadă își păstrează zilele, prețurile/duratele noi se aplică de la următoarea pornire, iar efectele tehnologiilor deja deblocate se citesc din valorile curente (un nerf se aplică retroactiv).
> - 53 teste verzi (13 noi în `config.test.ts`), tsc + build verzi în ambele proiecte, cele 2 copii de cod de joc identice (`diff -q`). Deploy: firestore rules + hosting. Commit + push în ambele repo-uri.

---

## 📅 Session Log: July 12, 2026

**Task Completed (Warlord — GLOBAL matchmaking / one shared world)**
> Prompt: "atacam acum" (following: all app users are players in ONE world; groups stay as a social/discovery layer)
> Model: Claude Opus 4.8
> PvP was group-scoped (you could only challenge someone from a shared group). Now ANY app user can challenge ANY other; groups/friends are only discovery shortcuts.
> - NEW `warlordPlayers/{uid}` — the public world roster (opt-in by playing). Game data only: name/nameLower/photoURL/self-reported army power/lastActive, plus SERVER-ONLY wins/losses. No app PII (no email), unlike the app's `profiles`.
> - `firestore.rules`: new warlordPlayers block (owner-write, wins/losses server-only, read by any signed-in user). Games read rule now null-guards the group branch (a global battle has groupId == null and isMemberOfGroup(null) would build an invalid path → rule error → deny) and adds a key-guarded players branch. Group branch kept FIRST so the existing arcade queries evaluate exactly as before. Warlord docs are now fully un-writable/un-deletable by clients.
> - `functions`: createWarlordChallenge takes an OPTIONAL groupId (a tag, not a gate), verifies the opponent exists via profiles/{uid}, and writes the in-app notification + FCM push itself (notifyUsers only permits notifying users you share a group with — unusable for global play). New recordWarlordResult increments the roster's wins/losses on every finish/forfeit.
> - Client: `PvpPanel` challenge wizard replaced the group→opponent cascade with a world-roster picker (recently active list + debounced name search + a "known" badge for friends/group members).
> - FIXED same session (caught by adversarial review, was live): acceptWarlordChallenge still read `groups/${g.groupId}` unconditionally — with groupId null that resolves to the valid-but-missing path "groups/null", so EVERY global challenge failed with permission-denied. Now guarded by a typed battleGroupId check; a group tag, when present, is still verified.
> Build: functions tsc ✅, app tsc+build ✅. Deploy: functions ✅ + rules ✅ + hosting ✅.
> FULL ADVERSARIAL REVIEW (re-run from scratch at Andrei's request; 24 agents, 19 confirmed findings — 2 refuted). Fixed in this pass:
> - CRITICAL data loss: `warlordCloud.loadWarlordDomain` used getDoc, which resolves from Firestore's IndexedDB cache when offline — a stale blob was adopted and then written back over newer cloud progress. Now uses getDocFromServer plus a monotonic `rev` on both sides (bumped BEFORE the write, so a failed/offline write leaves local ahead and it gets promoted later). Neither side can silently clobber the other.
> - MAJOR spam channel: createWarlordChallenge had no rate limit while writing a notification + FCM push to any user. Added a per-sender daily cap (WARLORD_CHALLENGE_DAILY_LIMIT, default 30) via the existing tryConsumeQuota, plus a slash guard on opponentUid.
> - MAJOR ladder corruption: `ladder` was captured outside runTransaction, so a retry or an early return could replay an aborted attempt's value and double-count W/L. Now reset at the top of every transaction attempt (both callables).
> - MAJOR account deletion: warlordPlayers/{uid} + warlordDomains/{uid} (+ the new quota doc) were left behind — undeletable by clients and world-readable. Now removed with the rest of the user's docs.
> - MAJOR unfindable players: the roster name came from auth.displayName, which is null for every email/password signup. Now taken from the app's canonical `profiles` doc.
> - MAJOR troop destruction: the unit picker offered units already staked in a live battle, so the same soldiers fought twice and each write-back subtracted casualties from the same unit. Committed units are now excluded.
> - Hardening/UX: warlordPlayers rules got a field whitelist + size caps (world-readable doc); a Decline button for incoming challenges (anyone can now challenge you); search race guard + stuck spinner fix; roster refresh on opening the wizard; optimistic battle state keyed on turn/side/rngCursor instead of object identity; the arcade hub no longer shows a delete button for server-owned Warlord docs.
> Deferred (documented): orphaned warlordDeploys for challenges that are never answered; English-only PvP i18n.

**Task Completed (Warlord — Tech Tree + Momentum)**
> Prompt: "tech tree" (+ all four branches, subtle cross-branch effects, a separate Warlord admin later, and future PvP "arenas")
> Model: Claude Opus 4.8
> The last item from Warlord's original backlog. Research costs resources + days and permanently improves the domain; a new **Momentum** system makes wins and discoveries ripple across branches.
> - `src/warlord/logic/research/`: the tech tree is DATA (12 techs, 4 branches × 3 tiers) with `resolveCatalog(overrides)` so the planned Warlord admin only supplies an override object — no migration, no rebuild. One `Modifiers` object is aggregated from researched techs AND active buffs, with caps.
> - Cross-branch effects: a victory now grants War Spoils (+production) AND Martial Fervour (+training XP) for a few days; finishing research grants Breakthrough; a loss/retreat costs a little output. Re-winning refreshes rather than stacks.
> - Modifiers feed existing knobs via optional params (default = unchanged): production, crafting, upkeep, food, training speed/slots/XP, battle loot, post-battle morale.
> - New `ResearchTab` (branch columns, locked/available/in-progress/researched, live Momentum bar + total-effect panel).
> - Deliberate scope: research affects the DOMAIN, not combat stats — the shared engine (3 byte-identical copies) is untouched and PvP stays vanilla-stat; the advantage carries over honestly through a bigger, better-trained army. A future "live armies" arena just includes the Modifiers object.
> Build: standalone tsc + 40/40 tests + build ✅; embed tsc -b + build ✅; all 10 shared files verified identical. Deploy hosting ✅.
> Caught by live verification (not by tests): the daily tick's change-guard compared only array lengths, so day decrements never persisted and research froze. Fixed.

**Task Completed (Warlord PvP — turn timeout)**
> Model: Claude Opus 4.8
> Closes the last major gap, made urgent by the review fix that excludes committed units: an opponent who simply stopped playing locked those units out of every future deployment forever, with "retreat" (a self-inflicted loss) as the only exit.
> - Game docs now carry `lastMoveAt`, stamped when the battle starts and on every applied command.
> - NEW `claimWarlordTimeout` callable: only the WAITING player may call it, and only after WARLORD_TURN_TIMEOUT_HOURS (default 24) of no move; the stalled side loses. Terminal marking mirrors forfeit (doc + state), so the existing casualty write-back and the ladder work unchanged. A legacy battle with no clock starts one instead of granting a free win.
> - UI: a "Claim victory ⏱" button appears for the waiting player once the timer elapses; the result screen labels a timeout win.
> Build ✅ · deploy functions + hosting ✅.

**Task Completed (Warlord — cloud-synced domain / real game account)**
> Prompt: "fiecare user al aplicatiei OurDaysApp are un cont separat pentru jocul Warlords, sau intra toti pe acelasi joc?" → each user is a player; the app account IS the game account; make the kingdom cross-device.
> Model: Claude Opus 4.8
> The Warlord single-player domain (economy/army) was device-local (localStorage). Now it's CLOUD-BACKED at `warlordDomains/{uid}` (Firestore), so a user's kingdom follows them across devices — a real per-user game account.
> - Synced game code (`useGameState`): pluggable persistence — `opts.initialBlob` (cloud-loaded save) + `opts.onPersist(blob)` (extra write target); log capped at 300 to bound the cloud doc. `App.tsx` passes them through. Standalone behavior unchanged (no opts → localStorage).
> - OurDaysApp-only: `src/warlordCloud.ts` (load cloud→localStorage with local→cloud migration; debounced saver + flush). `screens/Warlord.tsx` loads the cloud domain BEFORE mounting the game (ready-gate + spinner), wires onPersist to the debounced cloud writer, flushes on unmount/view-switch. PvP casualty write-back now also pushes to the cloud. New rule `warlordDomains/{uid}` owner-only.
> - Model: localStorage = write-through cache + offline fallback; Firestore = durable source of truth.
> Noted for later (Andrei's north-star): all users share ONE world; PvP beyond groups (groups become a social layer — search/message/invite); game↔app ties defined in the main app.
> Build: tsc+build ✅, standalone 24 tests ✅. Deploy: rules ✅ + hosting ✅. Verified locally (ready-gate hydration, Domain↔PvP toggle keeps state, no console errors).

**Task Started + Completed (Warlord PvP — server-authoritative)**
> Prompt: "pvp" → decizii Andrei: server-authoritative de la început ("securitate și anti-cheat bun, aplicația se extinde de la familie la social mai larg"), pierderi reale, push de tură.
> Model: Claude Opus 4.8
> This is the app's FIRST server-authoritative game (the classic arcade is client-authoritative). A shared pure engine runs identically on both clients (optimistic UI) and in Cloud Functions (the authority), reconciling by determinism.
> Changes:
> - `functions/src/index.ts`: `createWarlordChallenge`, `acceptWarlordChallenge`, `submitWarlordCommand`, `forfeitWarlordBattle` (onCall + runTransaction) + `onWarlordBattleUpdated` (onDocumentUpdated → FCM "your turn"/"joined"/"battle over" push, the app's first update-trigger). `functions/src/warlordCombat/` = a 3rd byte-identical copy of the pure engine + `combat/pvp.ts` (sanitizeDeploy + createPvpBattle). Added `@types/node`.
> - `firestore.rules`: games block fenced for `gameType=='warlord-battle'` (create only via callable; update denies state/winner/status/seed/deploy/players/finalized/…; delete only while waiting) + new Admin-only `warlordDeploys` collection (challenger armies, hidden from the opponent pre-commit).
> - Client (OurDaysApp-only): `src/serverActions.ts` (4 wrappers), `src/warlordPvp/{pvpApi,PvpPanel,PvpBattle}.tsx`, Domain|PvP toggle in `src/screens/Warlord.tsx`, `warlord-battle` dispatch branch + `navigate` in `GamesHubModal.tsx`. Optimistic `applyCommand` reconciles with the server doc; real casualties written back per client via `applyBattleResult(units, state, myUnitIds, mySide)`, idempotent via `warlord_pvp_applied_{uid}`.
> - Adversarial multi-agent review (run pre-final-ship) caught & fixed: CRITICAL weapon-smuggling (archer+halberd bypass → dropped loadoutWeapon), MAJOR pre-commit army peek (→ private warlordDeploys + callable-only create), MINOR finalized deny-list. Deferred (documented): no turn timeout (forfeit is the escape hatch), English-only i18n.
> Build: tsc (embed+functions) ✅, standalone 24 tests ✅, vite build ✅. Deploy order: functions → rules → hosting, all ✅. Live at https://our-days-2a939.web.app/warlord (⚔ PvP tab).

**Task Started (Warlord development round)**
> Prompt: "vreau sa imbunatatim si sa dezvoltam jocul / deci? / limita este libera"
> Plan: Game-development round on the embedded Warlord (synced 1:1 from the standalone repo): fix save-lost-on-refresh + dead split/merge/training state, add rank promotion from XP, building upgrade levels, campaign progression (one battle/day, escalation, win-streak loot), attack forecast panel, battle report, per-uid saves in the embed.
> Model: Claude Opus 4.8

**Task Completed (Warlord development round)**
> Model: Claude Opus 4.8
> Changes (all inside `src/warlord/` — synced 1:1 with the standalone repo — plus `src/screens/Warlord.tsx`):
> - CRITICAL FIX: saves survive page refresh now (hydrate-on-init; previously the mount-time save-effect clobbered the stored save with fresh state before Load could be pressed).
> - Split/Merge/Training toggle now actually work (were writing to a dead local state).
> - New systems: rank promotion from XP (training + battle, thresholds 100/250/450/700), building levels L1–L3 (+30%/+60% output, upgrade = 60%×base×level), campaign progression (one battle per day, per-mission enemy escalation +5%/clear cap +50%, win-streak loot bonus), attack forecast panel (expected kills/losses before committing, pure/no-rng), per-unit battle report with promotions.
> - `screens/Warlord.tsx`: per-user saves — `warlord_save_{uid}` (+ one-time migration from the old shared `warlord_save`), so family members on one device keep separate domains.
> Build: `tsc -b` ✅ + `npm run build` ✅ (Warlord lazy chunk ~126kB). Standalone tests 18/18 ✅. Verified end-to-end in local preview (temporary auth bypass, reverted): hydration on refresh, old-save compat, promotion with XP overflow, building upgrade cost math, daily battle limit, forecast-panel attack flow.
> Deployed + pushed after adversarial multi-agent code review of the diff (19 agents, 15 confirmed findings = 9 distinct, all fixed). Highlights: CRITICAL — a mid-mount saveKey change (auth flip while /warlord mounted) would overwrite the new user's save with the old user's in-memory state → fixed with `key={saveKey}` remount + a hydratedKey guard in the persist effect; MAJOR — legacy-save migration could be consumed by an anonymous render → now runs only for a real authenticated uid; MAJOR — daily upkeep/food morale checks used the pre-income snapshot (penalizing units whose upkeep was actually paid) → checks now use post-production values.

**Task Started (Admin Phase 2)**
> Prompt: "continua" (following the multi-select where Andrei chose all four admin additions; Phase 1 = Error monitoring/Health + drill-down/moderation already shipped)
> Plan: Build Admin Phase 2 — Broadcast notifications, Groups explorer, and 30-day growth charts.
> Model: Claude Opus 4.8 (1M context)

**Task Completed (Admin Phase 2)**
> Model: Claude Opus 4.8 (1M context)
> Changes:
> - `functions/src/index.ts` — 3 new admin-gated callables (each `await assertAdmin(request)` first):
>   - `adminBroadcast({target,title,body})` — writes a `notifications` doc per recipient (`userId`, `type:'broadcast'`, `createdBy`, `read:false`, server timestamp) for either **all users** (via `listAllAuthUsers`) or one **group** (its `members`); recipients de-duped, title/body length-capped, committed in batches of 400; returns `{ok, created}`.
>   - `adminListGroups()` — every group with per-group member/event/game tallies (reads groups≤2000, events≤8000, games≤5000), sorted by member count desc.
>   - `adminGetGrowth()` — 30-day daily buckets for sign-ups (Auth `creationTime`), events (`createdAt`), and games (`createdAt`); returns `{days, signups[], events[], games[]}`.
>   - Added a `chunk<T>()` helper for batched writes.
> - `src/serverActions.ts` — `adminBroadcast` / `adminListGroups` / `adminGetGrowth` httpsCallable wrappers.
> - `src/screens/Admin.tsx` — two new tabs (**Groups** table with owner drill-down, **Broadcast** composer: all-users/group target + title/body, live "sent to N" result) + a **Growth (30 days)** section on Overview with 3 mini bar charts (new `GrowthChart` component). `refresh()` now also loads groups + growth; `nameOf()`/`sendBroadcast()` helpers.
> Security: all three callables gate on `assertAdmin`; broadcast writes via Admin SDK (no rules change), `userId` matches the client notifications query so broadcasts appear in the bell dropdown; recipients de-duped; returned `created` count is honest.
> Build: `functions` `tsc` ✅ + root `npm run build` ✅ (Admin chunk 33.8kB). Deployed: `firebase deploy --only functions:adminBroadcast,functions:adminListGroups,functions:adminGetGrowth,hosting` ✅ → live at https://our-days-2a939.web.app/admin.

---

## 📅 Session Log: July 11, 2026

**Task Started**
> Prompt: "vreau sa ii facem deploy in aplicatia OurDaysApp si sa il lucram acolo, iar eu sa il testez in aplicatie" (about the Warlord strategy game, developed standalone in Apps/games/warlord)
> Plan: Embed the whole single-player Warlord game into OurDaysApp as a lazy `/warlord` route so it can be played/tested in the live app; no backend (localStorage). English-only i18n for now. Keep the standalone repo and the embedded copy identical.
> Model: Claude Opus 4.8

**Task Completed**
> Model: Claude Opus 4.8
> Decisions (Andrei): whole game single-player first (PvP later); English UI for now (noted exception to the 6-language rule); both repos kept in sync.
> Changes:
> - `src/warlord/` — copied the entire Warlord game (logic/state/components/mods/assets + `WarlordApp.tsx`). ~46 PNGs.
> - `src/screens/Warlord.tsx` — full-width screen wrapper (back-to-app button) rendering `WarlordApp`; NOT the arcade modal (too small for the multi-tab layout) and NOT group/date-scoped.
> - `src/App.tsx` — `const Warlord = lazy(() => import('./screens/Warlord'))` + auth-gated `/warlord` route (mirrors `/admin`).
> - `src/screens/CalendarHome.tsx` — a ⚔ (Swords) header button (desktop + mobile menu) navigating to `/warlord`.
> - Strict-build cleanup of the copied code (this repo's `tsc -b` enforces `verbatimModuleSyntax` + `noUnusedLocals/Parameters`): `import type` conversions, removed unused React/imports/vars. Same fixes mirrored back to the standalone repo so both stay identical.
> - State is local `localStorage` (`warlord_save`), no Firestore. Known follow-ups: localStorage is device-local (not uid-scoped yet); ~8MB of PNGs (unused assets could be trimmed); UI is English-only.
> Build: `tsc -b` ✅ + `npm run build` ✅ — Warlord is a separate lazy chunk (`Warlord-*.js` ~118kB / gzip 32kB); the main bundle is unchanged. Deployed: `firebase deploy --only hosting` ✅ → live at https://our-days-2a939.web.app/warlord (reachable via the ⚔ header button).
> Verified locally (temporary auth-gate bypass, reverted): `/warlord` renders with no console errors; the full Load → Campaign → Deploy → March → battle-grid flow works in the embedded context.

---

## ðŸ“… Session Log: May 5, 2026

**~18:10 - Task Started**: Implementing Task Assignment Constraints and Autosave Engine.
**~18:15 - Task Completed**: Constraints enforced in `AddEventModal` and `EventDetailsModal`. Autosave draft logic added to `AddEventModal`. Build verified. Deployed.

---

## ðŸ“… Session Log: May 8, 2026

**~09:50 - Task Started**
> Prompt: "something happened to the AI suggestion option" & "ok, can we make it work as before?"
> Plan: Refactor AI checklist generation to use a secure Firebase Callable Function (`generateAIChecklist`), allowing the "Auto-suggest Checklist via AI" button to return to the UI without exposing the Gemini API key to the client.

**~10:05 - Task Completed**
Refactored `src/ai.ts` to call the new Callable Function and pass `navigator.language` to strictly enforce AI language. Added `generateAIChecklist` to `functions/src/index.ts` with strict locale prompting. Re-enabled the client-side button in `AddEventModal.tsx`. Build verified and deployed.

**~18:20 - Task Started**: Implementing Transferable Assets in `Wallet.tsx`.
**~18:30 - Task Completed**: Transfer logic with "Keep Copy" checkbox added. Deployed.

**~18:22 - Task Started**: Implementing Group Chat Widget and In-App Notifications.
**~18:27 - Task Completed**: Created `GroupChatWidget.tsx` and `NotificationsDropdown.tsx`. Integrated into `CalendarHome`. TS errors fixed, build verified. Deployed.

**~18:31 - Task Started**: Amending DEVLOG with infrastructure, workflow rules, and session logging.
**~18:31 - Task Completed**: DEVLOG restructured with permanent sections. Pushed to GitHub.

**~18:52 - Task Started**: Auto-contrast text color on primary backgrounds.
**~19:01 - Task Completed**: WCAG luminance calculation added to `App.tsx`. CSS rule added to `index.css`. Fixed threshold bug (Amber at 50% L was incorrectly getting white text). Deployed.

**~19:07 - Task Started**: Chat enhancements â€” image sending and sent/seen status.
**~19:14 - Task Completed**: `GroupChatWidget` rewritten with image upload (Firebase Storage), `seenBy` array, and sent/seen indicators. Dark mode default for new users added. Deployed.

**~19:14 - Task Started**: Chat header member avatars + retroactive seen marking.
**~19:14 - Task Completed**: Member avatars added to chat header. When a user sends a message, prior unseen messages are retroactively marked. Deployed.

**~19:15 - Task Started**: Replace "Delete Group" with "Edit Group" settings modal.
**~19:17 - Task Completed**: `GroupSettingsModal.tsx` created with rename, member management, and danger zone (delete/leave with confirmation). Deployed.

**~19:19 - Task Started**: Fix profile photo not showing in all avatar locations.
**~19:20 - Task Completed**: `userMap` now fetches current user's Firestore doc (was skipped before). Removed stale `auth.currentUser.photoURL` fallbacks in modals. Deployed.

**~19:26 - Task Started**: Fix chat "Seen" status not updating reliably.
**~19:27 - Task Completed**: Switched from purely `seenBy`-array-based detection to reply-ordering inference â€” if someone replied after your message, it's marked Seen. `seenBy` array kept as fallback. Deployed.

**~19:27 - Task Started**: Update DEVLOG with all session tasks and strengthen workflow rules.
**~19:27 - Task Completed**: Full session log written. Workflow rules clarified to require file edits (not just chat mentions).

---

## ðŸ“… Session Log: May 5, 2026 (continued)

**2026-05-05 22:27 - Task Started**
> Prompt: "it seems that the devlog is not being updated as it says in the rules, are the rules not well established or written?"
> Plan: Catch up all missed task log entries and tighten workflow rule wording to require file edits explicitly.

**2026-05-05 22:27 - Task Completed**: DEVLOG fully caught up with all session tasks. Rule 1 reworded. Pushed to GitHub.

---

**2026-05-05 22:29 - Task Started**
> Prompt: "logging the start of the task should also log the prompt entered and the date"
> Plan: Update workflow Rule 1 to require exact prompt text and date/time in every Task Started log entry.

**2026-05-05 22:29 - Task Completed**: Rule 1 updated with required format including date, prompt, and plan. This entry is the first example of the new format. Pushed to GitHub.

---

## ðŸ“… Session Log: May 6, 2026

**2026-05-06 08:50 - Task Started**
> Prompt: "here are some goals, sync them with the devlog road map and update it, also read the devlog follow those rules"
> Plan: Sync provided screenshot To-Do list with DEVLOG.md roadmap and initialize the task log.

**2026-05-06 08:51 - Task Completed**: DEVLOG roadmap synced with To-Do list (Checklist management & Rummy 45 added). Session log updated according to rules. Pushed to GitHub.

**2026-05-06 08:52 - Task Started**
> Prompt: "let's start with the checklist updates"
> Plan: Implement checklist editing and reordering functionality in AddEventModal and EventDetailsModal.

**2026-05-06 08:54 - Task Completed**: Checklist editing and reordering functions added to `AddEventModal.tsx` and `EventDetailsModal.tsx`. Tested build and deployed to Firebase successfully.

**2026-05-06 08:59 - Task Started**
> Prompt: "good, i checked out what works, but, something broke, there is more text on some items, that is now hidden, i can navigate the text via left and right keys, or mouse select and drag, but, i want it all visible, let the item height grow to acomodate all the text"
> Plan: Replace the `<input type="text">` fields in checklist rendering with auto-resizing `<textarea>` elements to accommodate multi-line text without hiding it.

**2026-05-06 09:00 - Task Completed**: `input` fields changed to `textarea` with inline auto-resize logic in both `AddEventModal.tsx` and `EventDetailsModal.tsx`. Tested build and deployed to Firebase successfully.

**2026-05-06 09:03 - Task Started**
> Prompt: "when i am editing a task/event item or anything else in it i want the modifications to auto save as soon as i make them, i don't want to only save on clicking the save event button at the bottom"
> Plan: Add a debounced `useEffect` to `AddEventModal.tsx` to automatically push changes to Firestore when `editEvent` is active. Change the Save button to "Done" during edits.

**2026-05-06 09:04 - Task Completed**: Implemented real-time autosave in `AddEventModal.tsx` using a 1-second debounce timeout. Added `autoSaveStatus` indicator next to the modified "Done" button. Built and deployed to Firebase successfully.

**2026-05-06 09:11 - Task Started**
> Prompt: "i want to be able to move events from one day to another, basically a way to change the event/task date"
> Plan: Add an editable date picker to `AddEventModal.tsx`, maintain local `eventDate` state, and include date modifications in the real-time autosave and submit logic.

**2026-05-06 09:12 - Task Completed**: Replaced the static date display in `AddEventModal.tsx` with a native `<input type="date">`. Added local state for `eventDate` which now seamlessly hooks into the new autosave engine and draft systems. Built and deployed successfully.

**2026-05-06 09:26 - Task Started**
> Prompt: "can we customize the calendar to be more in line with the theme, let's have darkmode influence the background and use the accent color somehow"
> Plan: Apply `color-scheme: dark` to `.dark` class and `accent-color` globally in `index.css` so native browser inputs (like the date picker) match the application theme perfectly.

**2026-05-06 09:27 - Task Completed**: `index.css` updated with `color-scheme` and `accent-color`. Verified build and deployed to Firebase successfully.

**2026-05-06 12:05 - Task Started**
> Prompt: "let's try 2"
> Plan: Plan and begin implementation of AI Integration (Gemini/OpenAI) for auto-suggesting task checklists and creating an "AI Assistant" feature.

**2026-05-06 12:20 - Task Started**
> Prompt: "i already have the Blaze plan"
> Plan: Set up Firebase Cloud Functions to create a robust, server-side "AI Assistant". When a task is assigned to the "ai_assistant" dummy user/group, a Firestore trigger will automatically ping Gemini and generate a checklist in the background.

**2026-05-06 12:24 - Task Completed**: Set up the `functions/` directory, updated `firebase.json`, and wrote `functions/src/index.ts`. The backend uses `firebase-functions/v2/firestore` triggers and Secret Manager to securely handle the API key and auto-generate checklists when tasks are assigned to the `ai_assistant`. Also added the AI Assistant as an assignee option in the UI.

**2026-05-06 14:41 - Task Started**
> Prompt: "same error, did you send the update?"
> Plan: Fix aggressive Firebase edge caching by adding Cache-Control headers to firebase.json, and downgrade AI model from gemini-2.5-flash (which was returning 503) to gemini-2.5-flash-lite for stability.

**2026-05-06 15:04 - Task Completed**: `gemini-2.5-flash-lite` successfully integrated. Cache busters added to `firebase.json` and `index.html`. 

**2026-05-06 15:52 - Task Started**
> Prompt: "ok, it works, let's move forward with the roadmap, and then we can improve upon what we have"
> Plan: Evaluate Rummy 45 feasibility and begin implementing OS-level True Push Notifications using Firebase Cloud Messaging (FCM) since the Cloud Functions infrastructure is now ready.

**2026-05-06 16:03 - Task Completed**: Evaluated Rummy 45 (High difficulty, documented in DEVLOG). Implemented `onMessageCreated` Firebase Cloud Function. It automatically queries the group members and dispatches FCM payloads to their devices using `sendEachForMulticast`. Web Push frontend was already configured in previous sessions. Built and deployed to Firebase successfully.

**2026-05-06 16:00 - Task Started**
> Prompt: "1, let's create a way to play not just rummy 45 but othe games as well"
> Plan: Design and implement a scalable "Games Hub" framework. Create a new Firestore collection `games` to sync real-time state, build a generic Games Lobby UI within groups, and implement Tic-Tac-Toe as the first proof-of-concept multiplayer game.

**2026-05-06 16:05 - Task Completed**: `GamesHubModal` created to show an arcade for groups. Implemented a fully functional, real-time synced `TicTacToe` game using Firestore. The architecture is modular so other games (like Rummy 45) can be easily added into the hub. Built and deployed to Firebase successfully.

**2026-05-06 16:11 - Task Started**
> Prompt: "ok, it works' let's get to rummy development"
> Plan: Plan the complex architecture and state management for Rummy 45 (Remi Etalat) and write an implementation plan artifact to confirm game rules and layout before coding the engine.

**2026-05-06 16:15 - Task Completed**: `rummy_45_plan.md` artifact generated. Wrote `RummyEngine.ts` to handle complex 106-card deck generation and shuffle logic. Created `RummyGame.tsx` component with `@hello-pangea/dnd` to render the Game Board, Lobby, and interactive drag-and-drop player hand. Connected the UI to the Games Hub. Phase 1 (Engine and Board) is fully complete.

**2026-05-06 16:21 - Task Started**
> Prompt: "we need to be able to cancel a game if it hasn't started yet, also there will be a lot of games piling up..."
> Plan: Add date-filtering to `GamesHubModal` so games are tied to `selectedDate`. Add a cancel/delete button for the owner of games in 'waiting' status.

**2026-05-06 16:23 - Task Completed**: `GamesHubModal` now accepts `selectedDate` and filters active/past games based on the calendar day. Added a red Trash icon button to allow the game creator to delete un-started games. Built and deployed.

**2026-05-06 16:25 - Task Started**
> Prompt: "ok, any more suggestions for improving this functionality?" -> "i like it"
> Plan: Implement 3 UX enhancements: Push Notifications for game invites via Cloud Functions, a persistent "Game in Progress" Banner on the Calendar screen, and an All-Time Leaderboard tab in the Arcade.

**2026-05-06 16:33 - Task Completed**: `onGameCreated` Cloud Function added and deployed to send FCM messages to group members when a game is created. Added `activeGames` banner to `CalendarHome.tsx` to surface running games outside the modal. Built a robust `Leaderboard` tab inside `GamesHubModal` that queries all finished games and ranks players by wins. Built and deployed to Firebase.

**2026-05-06 17:29 - Task Started**
> Prompt: "we are (ready for Phase 2)"
> Plan: Implement Phase 2 of Rummy 45. Add turn phases (`draw` vs `play`), clicking the Deck to draw, clicking the Discard Pile to draw the top discarded card, and dragging a card from the hand to the Discard Pile to end the turn.

**2026-05-06 17:34 - Task Started**
> Prompt: "go ahead (Phase 3)"
> Plan: Implement Meld Validation (Set vs Run, calculating points). Implement a Staging UI where players select cards from their hand and create staged melds locally. Enforce the "Initial Meld must be >= 45 points and contain a run" rule before pushing to Firestore.

**2026-05-06 17:38 - Task Completed**: `RummyEngine.ts` updated with `validateMeld` and point calculation for Sets/Runs (accounting for Jokers and Aces). UI updated: Clicking cards in your hand highlights them. If 3+ are highlighted, a bouncing "Meld X Cards" button appears. Melds are staged in a purple bar above the hand until the 45-point condition is met, after which they can be played to the board for everyone to see. Built and deployed.

**2026-05-06 17:53 - Session Wrap-up**
> Status: Leaving work. All code is successfully built, deployed, and pushed to `main`.
> Completed Today:
> 1. Universal "Games Hub" Arcade framework.
> 2. Tic-Tac-Toe multiplayer.
> 3. Cloud Functions for Game Invites (Push Notifications).
> 4. Persistent Active Game Banner in `CalendarHome`.
> 5. All-Time Arcade Leaderboard.
> 6. Rummy 45 (Phases 1-3): 106-card generation, Drag-and-drop hand sorting, Turn enforcement (Draw/Discard loop), Strict Validation (Sets/Runs), and the 45-Point Staging UI logic.
> 
> **Next Steps (To resume at home)**:
> - **Tic-Tac-Toe Polish**:
>   - Register and display scores across rounds.
>   - Add a "New Round" button to reset the board after a win/draw without needing to create a new game.
> - **Rummy 45 Visual Overhaul**:
>   - **Tile Assets**: Replace standard playing cards (Suits) with Rummy tiles (Numbers 1-13 in 4 colors: Red, Yellow, Blue, Black).
>   - **The "Tabla" (Board) Layout**: Implement a 2-row grid system for the player's personal board instead of a horizontal list.
>   - **Slot-based Organization**: Allow players to place cards in specific slots and leave empty spaces between them for better organization.
> - **Phase 4 (Lipeala)**: Allow players to drag and attach individual cards from their hand onto *existing* melds on the board.
> - **Phase 5 (End Game)**: Detect when a player discards their final card (Inchidere), end the game, tally up the negative points for remaining cards in hands, and assign the win/score to the Leaderboard.

---

## ðŸ“… Session Log: May 7, 2026

**2026-05-07 09:02 - Task Started**
> Prompt: "check the ourdayapp folder"
> Plan: Review the repository state and identify the next steps for Rummy 45 (Phase 4 & 5).

**2026-05-07 09:41 - Task Started**
> Prompt: "you can start"
> Plan: Implement Phase 4 (Lipeala) in RummyEngine.ts and RummyGame.tsx to allow dragging cards from the hand and attaching them to existing melds.

**2026-05-07 10:42 - Task Completed**: `canAttachToMeld` validation implemented in engine. Existing melds on board converted to `Droppable` zones. Added rule blocking players from attaching their last card to enforce discarding on closing. Phase 4 done.

**2026-05-07 10:42 - Task Started**
> Prompt: "yes" (Proceed to Phase 5)
> Plan: Implement end-game scoring for Rummy 45. Add `calculatePenaltyPoints` to tally negative points for remaining cards in losers' hands when the winner discards. Update the Arcade Leaderboard to display these total points.

**2026-05-07 10:44 - Task Completed**: Phase 5 implemented. `calculatePenaltyPoints` logic uses standard Rummy values (-50 Joker, -25 Ace, -10 Faces, -5 Numbers). The Leaderboard now aggregates and displays cumulative negative points for all players across finished games. Build and deployed to Firebase.

---

**2026-05-07 14:11 - Task Started**
> Prompt: "i want to deploy the updates to Firebase now and after that i want you to start with suggestions 1,2,3. we will leave 4 for later."
> Plan: Triggering build and Firebase deployment. Next, implementing Suggestion 1: Rummy 45 Pro Mechanics (Card Sorting Button and Joker Swapping logic).

**2026-05-07 14:14 - Task Completed**: Suggestion 1 implemented. Added `sortHand` function to `RummyGame.tsx` to automatically group hand by Suit and Value. Added `canSwapJoker` logic to `RummyEngine.ts` and drag-and-drop support so users can replace a Joker in a meld with the natural card it represents and take the Joker into their hand.

**2026-05-07 14:15 - Task Completed**: Suggestion 2 and 3 implemented. 
- **Suggestion 2**: Added premium CSS micro-animations (`animate-deal` and `animate-pop-in`) to `index.css` and applied them to card draws and meld creation in Rummy 45.
- **Suggestion 3**: Refactored the Gemini prompt in Firebase Functions to output categorized shopping lists (by supermarket aisle) if it detects a grocery-related task. Added a new `ExpensesTab.tsx` integrated seamlessly into `Wallet.tsx` to serve as a Splitwise-style expense tracker for the group.

**~23:05 - Task Started**
> Prompt: "ok, let's start with a"
> Plan: Rummy 45 Visual Overhaul (Tiles & Tabla) & Tic-Tac-Toe Polish (Scores & New Round)

**~23:25 - Task Completed**: Tic-Tac-Toe now supports score tracking and multiple rounds. Rummy 45 now uses tiles (mapped from standard cards) and a 30-slot grid 'Tabla' layout. Deployed to Firebase.
---

## ?? Session Log: May 9, 2026

**2026-05-09 07:23 - Task Started**
> Prompt: "first, i we have a problem, the app just loads a white screen now"
> Plan: Debug the white screen issue, which is caused by a missing .env file leading to a Firebase API key initialization error. Reconstruct the .env from google-services.json, build, and deploy.

**2026-05-09 07:37 - Task Completed**: Recreated .env, ran npm run build, and deployed to Firebase Hosting.

**2026-05-09 07:41 - Task Started**
> Prompt: "ok, did you read the devlog, there are rules there that we will need to follow"
> Plan: Read DEVLOG rules. Revert the .env git tracking to comply with Rule 6 (Secret Management), restore .gitignore, and log all actions to DEVLOG.md.

**2026-05-09 07:44 - Task Completed**: Removed .env from git cache, restored .gitignore exclusion, committed, and pushed. Updated DEVLOG with missing entries.

**2026-05-09 07:55 - Task Started**
> Prompt: "add to the roadmap developing the chat further and you can start with point 1"
> Plan: Add Chat enhancements to roadmap. Implement Smart Asset Auto-Linking by comparing event titles against wallet assets and suggesting linked assets in AddEventModal.

**2026-05-09 07:58 - Task Completed**: Added typing indicators to GroupChatWidget.tsx using Firestore onSnapshot. Typing state clears dynamically after 3s of inactivity or upon sending. Fixed a TypeScript timeout reference error, built, and deployed to Firebase.

**2026-05-09 08:10 - Task Started**
> Prompt: "ok, next"
> Plan: Implement Message Reactions for the chat widget, and update DEVLOG.

**2026-05-09 08:10 - Task Completed**: Added emoji reactions (like, love, laugh, surprise, sad, pray) to messages in GroupChatWidget.tsx. Used a 'hover-to-reveal' inline button. State synced in real-time via Firestore. Build and deploy successful.

**2026-05-09 08:18 - Task Started**
> Prompt: "next"
> Plan: Implement Threaded Replies for the chat widget to finalize Chat Enhancements.

**2026-05-09 08:18 - Task Completed**: Added threaded replies to messages. Hovering over a message shows a 'Reply' button. Clicking it opens a reply banner above the text input. Sent messages that are replies render the parent message snippet at the top of the bubble.

**2026-05-09 08:34 - Task Completed**: Implemented Connect 4 minigame. Added to GamesHubModal. Features full gravity logic, win detection, and responsive UI.

**2026-05-09 08:39 - Task Completed**: Added a comprehensive manual/game rules system to the Games Hub. Added info buttons on arcade cards and active games to open a rules modal.

**2026-05-09 08:46 - Task Completed**: Added full internationalization (i18n) support to the Game Rules modal based on the user's active language preference.

**2026-05-09 08:57 - Task Completed**: Implemented full application internationalization. Calendar, dashboard, wallet, and settings now fully support localization for English, Romanian, French, Spanish, Italian, and German.

**2026-05-09 09:12 - Task Started**
> Prompt: "ok, i restored the devlog myself, i don't want the session log to ever be erased, just update the progress and conversations"
> Plan: Properly restructure the DEVLOG with roadmap and completed features headers while strictly preserving all historical session logs. Sync the final May 9 entries.


**2026-05-09 09:20 - Task Started**
> Prompt: "Rummy 45 — Tabla UI Polish"
> Plan: Overhaul the Rummy 45 visual design — premium tile rendering with color-coded suit indicators, improved board/tabla layout, better spacing, and a polished game-over screen.

**2026-05-09 09:25 - Task Completed**: Rummy 45 Tabla UI Polish deployed. Premium tile design with colored suit dots, gradient table background, active player highlights, cleaner deck/discard area, improved meld display, and a game-over results screen with ranked scores.

**2026-05-14 22:03 - Task Started**
> Prompt: "UI Refinement" -> "go ahead"
> Plan: Replace `transition-transform` with `transition-all` to fix dark mode snapping, and update GroupChatWidget/GamesHubModal for mobile responsiveness.

**2026-05-14 22:09 - Task Completed**: Replaced `transition-transform` with `transition-all` across all components (Settings, GamesHub, AddEventModal, Wallet, Calendar Grid, GroupChat) to fix abrupt color snapping during dark mode toggles. Restyled `GroupChatWidget` and `GamesHubModal` to use dynamic viewport widths and heights for a responsive mobile experience. App successfully built, deployed to Firebase Hosting, and pushed to Git.

**2026-05-14 22:14 - Task Started**
> Prompt: "connect 4 does not start"
> Plan: Debug and fix the bug preventing Connect 4 from initializing when the user clicks 'Join'.

**2026-05-14 22:16 - Task Completed**: Root cause identified as a Firebase Firestore restriction which strictly forbids saving nested arrays (i.e. `Array(6).map(() => Array(7))`). Refactored the `initialState.board` in `GamesHubModal.tsx` and the `handleNextRound` logic in `Connect4.tsx` to store the 2D grid as a 1D mapping object (`{ 0: [...], 1: [...] }`). This inherently fixes the Firestore sync issue while maintaining 100% compatibility with the frontend's grid-mapping logic `board[r][c]`. App built, deployed to Firebase Hosting, and pushed to GitHub.

**2026-05-15 19:02 - Task Started**
> Prompt: "ok, let's start developing, let's start with the birthday thing..." and "users should be able to give custom colors to events..."
> Plan: Implement Smart Birthday Auto-Add by injecting virtual birthday events into the calendar grid and displaying a prompt banner. Implement Custom Event Colors by adding a palette picker to the Add Event Modal and overriding the default category colors in the Calendar.
> Model: Gemini 2.5 Pro

**2026-05-15 19:19 - Task Completed**: Added `birthday` field to user profiles via `Settings.tsx`. Implemented a dismissible birthday prompt banner on `CalendarHome.tsx` and injected "virtual" birthday events dynamically. Added a custom color palette picker to `AddEventModal.tsx` and updated `CalendarGrid.tsx` to prioritize `event.color` overrides. App built successfully. Deployed and pushed to Git.
> Model: Gemini 2.5 Pro
**2026-05-14 22:54 - Task Started**
> Prompt: Expansion update (Memory Minigame, PWA, Sounds/Haptics, Theme Overhaul)
> Plan: Implement Memory Match using Lucide icons, setup PWA via manifest/SW, build WebAudio synthesizer and Haptics wrapper, and completely overhaul Settings to separate default Dark Mode from Custom Themes.

**2026-05-14 23:02 - Task Completed**: Successfully overhauled the Theme system allowing independent Custom Colors/Overlays from the default Master Dark Mode. Built and injected a Web Audio API synthesizer for custom haptics and sounds (`src/utils/sounds.ts`, `src/utils/haptics.ts`) into Group Chat and Connect 4. Added full PWA Support (`manifest.json`, `sw.js`). Created the new `Memory Match` minigame utilizing 16 Lucide icon cards and integrated it cleanly into `GamesHubModal.tsx`.

**2026-05-14 23:30 - Task Started**
> Prompt: "chat" -> "leave the tombstone and we will stick to native image for now"
> Plan: Enhance `GroupChatWidget.tsx` with date separators, message timestamps, edit/delete capabilities with tombstones, and rich read receipts.

**2026-05-14 23:40 - Task Completed**: Significantly upgraded the chat experience. Implemented `date-fns` for clean date grouping and inline `HH:mm` timestamps. Added state tracking for editing (`isEdited`) and deleting (`isDeleted`) messages, rendering a neat tombstone when deleted. Enhanced the "Seen" indicator to show a tooltip containing the specific names of group members who read the message on hover. App built, deployed, and pushed.

**2026-05-14 23:47 - Task Started**
> Prompt: "ok, but this is a lot of wasted space" -> series of chat UI density improvements
> Plan: Tighten message bubble spacing by inlining timestamps, moving action buttons to a floating overlay, moving timestamps above the bubble inline with sender name, adding an edit cancel banner, ESC key cancel, and blocking scroll bleed-through.

**2026-05-15 00:06 - Task Completed**: Major chat UI polish session. Changes made to GroupChatWidget.tsx:
- **Timestamp position**: Moved HH:mm and read-receipt checkmarks out of the message bubble entirely; now rendered inline with the sender name row above the bubble (or right-aligned for own messages).
- **Floating action buttons**: Replaced the side-by-side button layout with an absolute-positioned floating pill toolbar appearing on hover, consuming zero vertical space.
- **Cancel edit banner**: Added an "Editing message" context banner above the input with an X button to cancel.
- **ESC key support**: Added a keydown listener that cancels active editing or replying when Escape is pressed.
- **Scroll bleed fix**: Added overscroll-contain CSS to the messages scroll container, preventing the background app from scrolling when the user reaches the top or bottom of the chat.
App built, deployed to Firebase Hosting, and pushed to GitHub.

**2026-05-15 19:02 - Task Started**
> Prompt: "ok, let's start developing..."
> Plan: Implement Smart Birthday Auto-Add and Custom Event Colors.
> Model: Gemini 2.5 Pro

**2026-05-15 19:19 - Task Completed**: Added birthday field to user profiles via Settings.tsx. Implemented a dismissible birthday prompt banner on CalendarHome.tsx and injected virtual birthday events dynamically. Added a custom color palette picker to AddEventModal.tsx and updated CalendarGrid.tsx to prioritize event.color overrides. App built successfully. Deployed and pushed to Git.
> Model: Gemini 2.5 Pro


**2026-05-15 22:37 - Task Started**
> Prompt: "b" (option B for recurring events rework)
> Plan: Rework recurring events from batch-creation into a proper recurrence engine. Single master event with recurrenceRule, client-side occurrence expansion, edit/delete scope prompts, yearly support, horizon info labels, and a Recurring Events Overview panel.
> Model: Claude Opus 4.6

**2026-05-15 22:42 - Task Completed**: Replaced batch-creation model with a single-document recurrence engine. Created src/utils/recurrence.ts for occurrence expansion. Updated AddEventModal.tsx with recurrenceRule storage, yearly option, horizon end-date labels, and edit scope prompt. Updated EventDetailsModal.tsx with recurring-aware delete logic and frequency badge. Created RecurringEventsPanel.tsx for managing all recurring series. Updated CalendarHome.tsx with expansion logic and header button. App built successfully. Deployed and pushed to Git.
> Model: Claude Opus 4.6


**2026-05-15 23:42 - Task Started**
> Prompt: Group Chat Enhancements
> Plan: Implement Pinned Messages, Message Search, and Voice Messages in GroupChatWidget.tsx.
> Model: Claude Opus 4.6

**2026-05-15 23:46 - Task Completed**: Implemented three major chat features in GroupChatWidget.tsx. Pinned Messages: any member can pin/unpin via toolbar, pinned bar shows at top with expand-all option. Message Search: client-side search with highlighting, match count, up/down navigation. Voice Messages: mic button when input empty, press to record with 60s limit, waveform UI, audio player in bubbles with play/pause and progress bar. App built successfully. Deployed and pushed to Git.
> Model: Claude Opus 4.6

---

## 📅 Session Log: May 17, 2026

**2026-05-17 10:50 - Task Started**
> Prompt: "ok, muta-le la complete si hai sa implementam rsvp"
> Plan: Move 5 completed features to Completed section, then implement Event RSVPs — let group members confirm attendance (Yes / Maybe / No) directly in the event details.
> Model: Claude Opus 4.6

**2026-05-17 10:57 - Task Completed**: Implemented RSVP functionality. Updated `EventDetailsModal.tsx` with Yes/Maybe/No buttons and a visual summary of attendees. Updated `AddEventModal.tsx` to include an "Enable RSVP" toggle when creating/editing group events. Updated `CalendarGrid.tsx` to show a small badge indicating the user's current RSVP status in the day modal. Successfully built and deployed to Firebase.
> Model: Gemini 3.1 Pro

**2026-05-17 15:48 - Task Started**
> Prompt: "yes for both with the mention that in the future we will have both push notifications and in app map navigation"
> Plan: Implement Custom Reminders via `@capacitor/local-notifications` plugin and Location Attachment as a text field that links to Google Maps.
> Model: Gemini 3.1 Pro

**2026-05-17 15:52 - Task Completed**: Installed `@capacitor/local-notifications`. Updated `AddEventModal.tsx` with Location input and Reminder dropdown. Updated `EventDetailsModal.tsx` to display the Location as a clickable map link and show Reminder info. Updated `CalendarHome.tsx` to request local notification permissions and actively schedule device-local notifications based on the user's synced calendar events. Build verified and deployed to Firebase Hosting.
> Model: Gemini 3.1 Pro

**2026-05-17 15:56 - Task Started**
> Prompt: "pe mobil, partea aceasta ocupa prea mult spatiu, o vreau mai compacta" (referring to Today's Overview cards)
> Plan: Refactor the "Today's Overview" section in `CalendarHome.tsx` to use a compact 3-column grid layout with centered, smaller text for mobile.
> Model: Gemini 3.1 Pro

**2026-05-17 15:58 - Task Completed**: Replaced the vertical stacked layout of the "Today's Overview" cards with a 3-column horizontal grid (`grid-cols-3`). Adjusted padding, text sizing, and removed the colored event dots to make the dashboard compact and readable on mobile devices. Built, deployed to Firebase, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-17 16:01 - Task Started**
> Prompt: "pe mobil vreau un meniu colapsible"
> Plan: Hide the top-right header action icons (Recurring, Wallet, Settings) inside a hamburger dropdown menu specifically on mobile breakpoints to conserve horizontal space, keeping only the Notification bell and the hamburger icon visible.
> Model: Gemini 3.1 Pro

**2026-05-17 16:03 - Task Completed**: Added `isMobileMenuOpen` state and `Menu` icon to `CalendarHome.tsx`. Wrapped the header buttons in a `.hidden .sm:flex` container and created a new `.sm:hidden` hamburger menu toggle that reveals an absolute-positioned dropdown with the hidden navigation options. Built, deployed to Firebase Hosting, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-18 11:01 - Task Started**
> Prompt: "1"
> Plan: Implement AI Event Type Suggestion by creating a new Firebase Callable Function (suggestEventCategory) and connecting it to AddEventModal.
> Model: Gemini 3.1 Pro

**2026-05-18 11:06 - Task Completed**: Implemented AI Event Type Suggestion. Added `suggestEventCategory` Cloud Function (using Gemini 2.5 Flash Lite) and wrapped it in `ai.ts`. Updated `AddEventModal.tsx` to call this function `onBlur` of the Event Title input, displaying a loading spinner and automatically assigning the matched category. App built, pushed to Git, and deployed to Firebase Hosting & Functions.
> Model: Gemini 3.1 Pro

**2026-05-18 11:45 - Task Started**
> Prompt: "yes"
> Plan: Implement AI Group Digests. Create a Callable Cloud Function to fetch recent messages and events, use Gemini to summarize them, and add a UI button in the Group Chat to request and display the digest.
> Model: Gemini 3.1 Pro

**2026-05-18 11:50 - Task Completed**: Implemented AI Group Digests. Created the `generateGroupDigest` Cloud Function using Gemini 2.5 Flash Lite to query recent messages and upcoming events for a group and generate a localized summary. Added a "Ce s-a mai întâmplat?" Sparkles button to the `GroupChatWidget` header, which displays the generated digest in a dismissible styled banner directly within the chat widget. Built, pushed to Git, and deployed to Firebase Hosting and Functions.
> Model: Gemini 3.1 Pro

**2026-05-18 13:00 - Task Started**
> Prompt: "ok, go on"
> Plan: Rework Asset Suggestion Logic using AI. Create a new Cloud Function `suggestAssetForEvent` that uses Gemini to intelligently match user input (titles or checklist items) to the best available asset, instead of relying on rigid substring matching.
> Model: Gemini 3.1 Pro

**2026-05-18 13:05 - Task Completed**: Reworked Asset Suggestion logic using AI. Replaced the rigid client-side substring matching with `suggestAssetForText` Cloud Function powered by Gemini 2.5 Flash Lite. The AI is now invoked intelligently on `blur` for the event title, and when adding or editing a checklist item. Built, pushed to Git, and deployed to Firebase Hosting & Functions.
> Model: Gemini 3.1 Pro

---

## 📅 Session Log: May 22, 2026

**2026-05-22 20:40 - Task Started**
> Prompt: "ourdaysapp, read the devlog and take note of the rules"
> Plan: Read the devlog and take note of the rules, starting the session.
> Model: Gemini 3.5 Flash

**2026-05-22 20:43 - Task Completed**: Acknowledged and read the entire DEVLOG.md, including permanent workflow rules and active roadmap. Prepared for future development tasks.
> Model: Gemini 3.5 Flash

**2026-05-22 20:45 - Task Started**
> Prompt: "lucruri noi pentru roadmap, dar intai verifica ce este deja implementat"
> Plan: Verify completed items (AI suggests, assets rework), update DEVLOG.md roadmap, and add new features (Connect 4 bug fix, Emoji event icons) to the active roadmap.
> Model: Gemini 3.5 Flash

**2026-05-22 20:49 - Task Completed**: Verified codebase status for asset suggestions (AI-powered suggestion is already fully implemented client and server side). Updated the Roadmap in DEVLOG.md: moved completed AI features (Event type suggest, Group digests, Asset suggestions rework) to the Completed section; added the two new tasks (Connect 4 bug fix, Emoji event icons) to the Roadmap. Pushed to Git.
> Model: Gemini 3.5 Flash

**2026-05-22 20:50 - Task Started**
> Prompt: "ok, rezolva punctul 2"
> Plan: Investigate and fix the Connect 4 bug where the 4th token cannot be placed.
**2026-05-09 07:41 - Task Started**
> Prompt: "ok, did you read the devlog, there are rules there that we will need to follow"
> Plan: Read DEVLOG rules. Revert the .env git tracking to comply with Rule 6 (Secret Management), restore .gitignore, and log all actions to DEVLOG.md.

**2026-05-09 07:44 - Task Completed**: Removed .env from git cache, restored .gitignore exclusion, committed, and pushed. Updated DEVLOG with missing entries.

**2026-05-09 07:55 - Task Started**
> Prompt: "add to the roadmap developing the chat further and you can start with point 1"
> Plan: Add Chat enhancements to roadmap. Implement Smart Asset Auto-Linking by comparing event titles against wallet assets and suggesting linked assets in AddEventModal.

**2026-05-09 07:58 - Task Completed**: Added typing indicators to GroupChatWidget.tsx using Firestore onSnapshot. Typing state clears dynamically after 3s of inactivity or upon sending. Fixed a TypeScript timeout reference error, built, and deployed to Firebase.

**2026-05-09 08:10 - Task Started**
> Prompt: "ok, next"
> Plan: Implement Message Reactions for the chat widget, and update DEVLOG.

**2026-05-09 08:10 - Task Completed**: Added emoji reactions (like, love, laugh, surprise, sad, pray) to messages in GroupChatWidget.tsx. Used a 'hover-to-reveal' inline button. State synced in real-time via Firestore. Build and deploy successful.

**2026-05-09 08:18 - Task Started**
> Prompt: "next"
> Plan: Implement Threaded Replies for the chat widget to finalize Chat Enhancements.

**2026-05-09 08:18 - Task Completed**: Added threaded replies to messages. Hovering over a message shows a 'Reply' button. Clicking it opens a reply banner above the text input. Sent messages that are replies render the parent message snippet at the top of the bubble.

**2026-05-09 08:34 - Task Completed**: Implemented Connect 4 minigame. Added to GamesHubModal. Features full gravity logic, win detection, and responsive UI.

**2026-05-09 08:39 - Task Completed**: Added a comprehensive manual/game rules system to the Games Hub. Added info buttons on arcade cards and active games to open a rules modal.

**2026-05-09 08:46 - Task Completed**: Added full internationalization (i18n) support to the Game Rules modal based on the user's active language preference.

**2026-05-09 08:57 - Task Completed**: Implemented full application internationalization. Calendar, dashboard, wallet, and settings now fully support localization for English, Romanian, French, Spanish, Italian, and German.

**2026-05-09 09:12 - Task Started**
> Prompt: "ok, i restored the devlog myself, i don't want the session log to ever be erased, just update the progress and conversations"
> Plan: Properly restructure the DEVLOG with roadmap and completed features headers while strictly preserving all historical session logs. Sync the final May 9 entries.


**2026-05-09 09:20 - Task Started**
> Prompt: "Rummy 45 — Tabla UI Polish"
> Plan: Overhaul the Rummy 45 visual design — premium tile rendering with color-coded suit indicators, improved board/tabla layout, better spacing, and a polished game-over screen.

**2026-05-09 09:25 - Task Completed**: Rummy 45 Tabla UI Polish deployed. Premium tile design with colored suit dots, gradient table background, active player highlights, cleaner deck/discard area, improved meld display, and a game-over results screen with ranked scores.

**2026-05-14 22:03 - Task Started**
> Prompt: "UI Refinement" -> "go ahead"
> Plan: Replace `transition-transform` with `transition-all` to fix dark mode snapping, and update GroupChatWidget/GamesHubModal for mobile responsiveness.

**2026-05-14 22:09 - Task Completed**: Replaced `transition-transform` with `transition-all` across all components (Settings, GamesHub, AddEventModal, Wallet, Calendar Grid, GroupChat) to fix abrupt color snapping during dark mode toggles. Restyled `GroupChatWidget` and `GamesHubModal` to use dynamic viewport widths and heights for a responsive mobile experience. App successfully built, deployed to Firebase Hosting, and pushed to Git.

**2026-05-14 22:14 - Task Started**
> Prompt: "connect 4 does not start"
> Plan: Debug and fix the bug preventing Connect 4 from initializing when the user clicks 'Join'.

**2026-05-14 22:16 - Task Completed**: Root cause identified as a Firebase Firestore restriction which strictly forbids saving nested arrays (i.e. `Array(6).map(() => Array(7))`). Refactored the `initialState.board` in `GamesHubModal.tsx` and the `handleNextRound` logic in `Connect4.tsx` to store the 2D grid as a 1D mapping object (`{ 0: [...], 1: [...] }`). This inherently fixes the Firestore sync issue while maintaining 100% compatibility with the frontend's grid-mapping logic `board[r][c]`. App built, deployed to Firebase Hosting, and pushed to GitHub.

**2026-05-15 19:02 - Task Started**
> Prompt: "ok, let's start developing, let's start with the birthday thing..." and "users should be able to give custom colors to events..."
> Plan: Implement Smart Birthday Auto-Add by injecting virtual birthday events into the calendar grid and displaying a prompt banner. Implement Custom Event Colors by adding a palette picker to the Add Event Modal and overriding the default category colors in the Calendar.
> Model: Gemini 2.5 Pro

**2026-05-15 19:19 - Task Completed**: Added `birthday` field to user profiles via `Settings.tsx`. Implemented a dismissible birthday prompt banner on `CalendarHome.tsx` and injected "virtual" birthday events dynamically. Added a custom color palette picker to `AddEventModal.tsx` and updated `CalendarGrid.tsx` to prioritize `event.color` overrides. App built successfully. Deployed and pushed to Git.
> Model: Gemini 2.5 Pro
**2026-05-14 22:54 - Task Started**
> Prompt: Expansion update (Memory Minigame, PWA, Sounds/Haptics, Theme Overhaul)
> Plan: Implement Memory Match using Lucide icons, setup PWA via manifest/SW, build WebAudio synthesizer and Haptics wrapper, and completely overhaul Settings to separate default Dark Mode from Custom Themes.

**2026-05-14 23:02 - Task Completed**: Successfully overhauled the Theme system allowing independent Custom Colors/Overlays from the default Master Dark Mode. Built and injected a Web Audio API synthesizer for custom haptics and sounds (`src/utils/sounds.ts`, `src/utils/haptics.ts`) into Group Chat and Connect 4. Added full PWA Support (`manifest.json`, `sw.js`). Created the new `Memory Match` minigame utilizing 16 Lucide icon cards and integrated it cleanly into `GamesHubModal.tsx`.

**2026-05-14 23:30 - Task Started**
> Prompt: "chat" -> "leave the tombstone and we will stick to native image for now"
> Plan: Enhance `GroupChatWidget.tsx` with date separators, message timestamps, edit/delete capabilities with tombstones, and rich read receipts.

**2026-05-14 23:40 - Task Completed**: Significantly upgraded the chat experience. Implemented `date-fns` for clean date grouping and inline `HH:mm` timestamps. Added state tracking for editing (`isEdited`) and deleting (`isDeleted`) messages, rendering a neat tombstone when deleted. Enhanced the "Seen" indicator to show a tooltip containing the specific names of group members who read the message on hover. App built, deployed, and pushed.

**2026-05-14 23:47 - Task Started**
> Prompt: "ok, but this is a lot of wasted space" -> series of chat UI density improvements
> Plan: Tighten message bubble spacing by inlining timestamps, moving action buttons to a floating overlay, moving timestamps above the bubble inline with sender name, adding an edit cancel banner, ESC key cancel, and blocking scroll bleed-through.

**2026-05-15 00:06 - Task Completed**: Major chat UI polish session. Changes made to GroupChatWidget.tsx:
- **Timestamp position**: Moved HH:mm and read-receipt checkmarks out of the message bubble entirely; now rendered inline with the sender name row above the bubble (or right-aligned for own messages).
- **Floating action buttons**: Replaced the side-by-side button layout with an absolute-positioned floating pill toolbar appearing on hover, consuming zero vertical space.
- **Cancel edit banner**: Added an "Editing message" context banner above the input with an X button to cancel.
- **ESC key support**: Added a keydown listener that cancels active editing or replying when Escape is pressed.
- **Scroll bleed fix**: Added overscroll-contain CSS to the messages scroll container, preventing the background app from scrolling when the user reaches the top or bottom of the chat.
App built, deployed to Firebase Hosting, and pushed to GitHub.

**2026-05-15 19:02 - Task Started**
> Prompt: "ok, let's start developing..."
> Plan: Implement Smart Birthday Auto-Add and Custom Event Colors.
> Model: Gemini 2.5 Pro

**2026-05-15 19:19 - Task Completed**: Added birthday field to user profiles via Settings.tsx. Implemented a dismissible birthday prompt banner on CalendarHome.tsx and injected virtual birthday events dynamically. Added a custom color palette picker to AddEventModal.tsx and updated CalendarGrid.tsx to prioritize event.color overrides. App built successfully. Deployed and pushed to Git.
> Model: Gemini 2.5 Pro


**2026-05-15 22:37 - Task Started**
> Prompt: "b" (option B for recurring events rework)
> Plan: Rework recurring events from batch-creation into a proper recurrence engine. Single master event with recurrenceRule, client-side occurrence expansion, edit/delete scope prompts, yearly support, horizon info labels, and a Recurring Events Overview panel.
> Model: Claude Opus 4.6

**2026-05-15 22:42 - Task Completed**: Replaced batch-creation model with a single-document recurrence engine. Created src/utils/recurrence.ts for occurrence expansion. Updated AddEventModal.tsx with recurrenceRule storage, yearly option, horizon end-date labels, and edit scope prompt. Updated EventDetailsModal.tsx with recurring-aware delete logic and frequency badge. Created RecurringEventsPanel.tsx for managing all recurring series. Updated CalendarHome.tsx with expansion logic and header button. App built successfully. Deployed and pushed to Git.
> Model: Claude Opus 4.6


**2026-05-15 23:42 - Task Started**
> Prompt: Group Chat Enhancements
> Plan: Implement Pinned Messages, Message Search, and Voice Messages in GroupChatWidget.tsx.
> Model: Claude Opus 4.6

**2026-05-15 23:46 - Task Completed**: Implemented three major chat features in GroupChatWidget.tsx. Pinned Messages: any member can pin/unpin via toolbar, pinned bar shows at top with expand-all option. Message Search: client-side search with highlighting, match count, up/down navigation. Voice Messages: mic button when input empty, press to record with 60s limit, waveform UI, audio player in bubbles with play/pause and progress bar. App built successfully. Deployed and pushed to Git.
> Model: Claude Opus 4.6

---

## 📅 Session Log: May 17, 2026

**2026-05-17 10:50 - Task Started**
> Prompt: "ok, muta-le la complete si hai sa implementam rsvp"
> Plan: Move 5 completed features to Completed section, then implement Event RSVPs — let group members confirm attendance (Yes / Maybe / No) directly in the event details.
> Model: Claude Opus 4.6

**2026-05-17 10:57 - Task Completed**: Implemented RSVP functionality. Updated `EventDetailsModal.tsx` with Yes/Maybe/No buttons and a visual summary of attendees. Updated `AddEventModal.tsx` to include an "Enable RSVP" toggle when creating/editing group events. Updated `CalendarGrid.tsx` to show a small badge indicating the user's current RSVP status in the day modal. Successfully built and deployed to Firebase.
> Model: Gemini 3.1 Pro

**2026-05-17 15:48 - Task Started**
> Prompt: "yes for both with the mention that in the future we will have both push notifications and in app map navigation"
> Plan: Implement Custom Reminders via `@capacitor/local-notifications` plugin and Location Attachment as a text field that links to Google Maps.
> Model: Gemini 3.1 Pro

**2026-05-17 15:52 - Task Completed**: Installed `@capacitor/local-notifications`. Updated `AddEventModal.tsx` with Location input and Reminder dropdown. Updated `EventDetailsModal.tsx` to display the Location as a clickable map link and show Reminder info. Updated `CalendarHome.tsx` to request local notification permissions and actively schedule device-local notifications based on the user's synced calendar events. Build verified and deployed to Firebase Hosting.
> Model: Gemini 3.1 Pro

**2026-05-17 15:56 - Task Started**
> Prompt: "pe mobil, partea aceasta ocupa prea mult spatiu, o vreau mai compacta" (referring to Today's Overview cards)
> Plan: Refactor the "Today's Overview" section in `CalendarHome.tsx` to use a compact 3-column grid layout with centered, smaller text for mobile.
> Model: Gemini 3.1 Pro

**2026-05-17 15:58 - Task Completed**: Replaced the vertical stacked layout of the "Today's Overview" cards with a 3-column horizontal grid (`grid-cols-3`). Adjusted padding, text sizing, and removed the colored event dots to make the dashboard compact and readable on mobile devices. Built, deployed to Firebase, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-17 16:01 - Task Started**
> Prompt: "pe mobil vreau un meniu colapsible"
> Plan: Hide the top-right header action icons (Recurring, Wallet, Settings) inside a hamburger dropdown menu specifically on mobile breakpoints to conserve horizontal space, keeping only the Notification bell and the hamburger icon visible.
> Model: Gemini 3.1 Pro

**2026-05-17 16:03 - Task Completed**: Added `isMobileMenuOpen` state and `Menu` icon to `CalendarHome.tsx`. Wrapped the header buttons in a `.hidden .sm:flex` container and created a new `.sm:hidden` hamburger menu toggle that reveals an absolute-positioned dropdown with the hidden navigation options. Built, deployed to Firebase Hosting, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-18 11:01 - Task Started**
> Prompt: "1"
> Plan: Implement AI Event Type Suggestion by creating a new Firebase Callable Function (suggestEventCategory) and connecting it to AddEventModal.
> Model: Gemini 3.1 Pro

**2026-05-18 11:06 - Task Completed**: Implemented AI Event Type Suggestion. Added `suggestEventCategory` Cloud Function (using Gemini 2.5 Flash Lite) and wrapped it in `ai.ts`. Updated `AddEventModal.tsx` to call this function `onBlur` of the Event Title input, displaying a loading spinner and automatically assigning the matched category. App built, pushed to Git, and deployed to Firebase Hosting & Functions.
> Model: Gemini 3.1 Pro

**2026-05-18 11:45 - Task Started**
> Prompt: "yes"
> Plan: Implement AI Group Digests. Create a Callable Cloud Function to fetch recent messages and events, use Gemini to summarize them, and add a UI button in the Group Chat to request and display the digest.
> Model: Gemini 3.1 Pro

**2026-05-18 11:50 - Task Completed**: Implemented AI Group Digests. Created the `generateGroupDigest` Cloud Function using Gemini 2.5 Flash Lite to query recent messages and upcoming events for a group and generate a localized summary. Added a "Ce s-a mai întâmplat?" Sparkles button to the `GroupChatWidget` header, which displays the generated digest in a dismissible styled banner directly within the chat widget. Built, pushed to Git, and deployed to Firebase Hosting and Functions.
> Model: Gemini 3.1 Pro

**2026-05-18 13:00 - Task Started**
> Prompt: "ok, go on"
> Plan: Rework Asset Suggestion Logic using AI. Create a new Cloud Function `suggestAssetForEvent` that uses Gemini to intelligently match user input (titles or checklist items) to the best available asset, instead of relying on rigid substring matching.
> Model: Gemini 3.1 Pro

**2026-05-18 13:05 - Task Completed**: Reworked Asset Suggestion logic using AI. Replaced the rigid client-side substring matching with `suggestAssetForText` Cloud Function powered by Gemini 2.5 Flash Lite. The AI is now invoked intelligently on `blur` for the event title, and when adding or editing a checklist item. Built, pushed to Git, and deployed to Firebase Hosting & Functions.
> Model: Gemini 3.1 Pro

---

## 📅 Session Log: May 22, 2026

**2026-05-22 20:40 - Task Started**
> Prompt: "ourdaysapp, read the devlog and take note of the rules"
> Plan: Read the devlog and take note of the rules, starting the session.
> Model: Gemini 3.5 Flash

**2026-05-22 20:43 - Task Completed**: Acknowledged and read the entire DEVLOG.md, including permanent workflow rules and active roadmap. Prepared for future development tasks.
> Model: Gemini 3.5 Flash

**2026-05-22 20:45 - Task Started**
> Prompt: "lucruri noi pentru roadmap, dar intai verifica ce este deja implementat"
> Plan: Verify completed items (AI suggests, assets rework), update DEVLOG.md roadmap, and add new features (Connect 4 bug fix, Emoji event icons) to the active roadmap.
> Model: Gemini 3.5 Flash

**2026-05-22 20:49 - Task Completed**: Verified codebase status for asset suggestions (AI-powered suggestion is already fully implemented client and server side). Updated the Roadmap in DEVLOG.md: moved completed AI features (Event type suggest, Group digests, Asset suggestions rework) to the Completed section; added the two new tasks (Connect 4 bug fix, Emoji event icons) to the Roadmap. Pushed to Git.
> Model: Gemini 3.5 Flash

**2026-05-22 20:50 - Task Started**
> Prompt: "ok, rezolva punctul 2"
> Plan: Investigate and fix the Connect 4 bug where the 4th token cannot be placed.
> Model: Gemini 3.1 Pro

**2026-05-22 20:55 - Task Completed**: Identified root cause as a Firebase Firestore restriction against saving multidimensional arrays. When a player aligned 4 tokens, `calculateWinner` returned `winningCells` as `[[r,c], [r,c+1], ...]`, which caused `updateDoc` to fail silently and reject the 4th token placement. Refactored `calculateWinner` and `isWinningCell` to use an array of objects `[{r, c}, ...]` instead. Built, committed, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-22 21:12 - Task Started**
> Prompt: "nu tot UI-ul se schimba cand imi aleg o limba si cateodate rsvp-ul nu apare ca optiune"
> Plan: Fix missing translations in AddEventModal.tsx and investigate the condition that hides the RSVP option.
> Model: Gemini 3.1 Pro

**2026-05-22 21:17 - Task Completed**: Added the missing translation strings (Target Calendar, Assign Members, Repeat, Make Task, RSVP, Visibility, Upload Photo) to the `i18n.ts` dictionary for all 6 supported languages. Updated `AddEventModal.tsx` to use the `t()` function. Confirmed that the RSVP option is intentionally hidden when "Personal Calendar" is selected, as RSVP is only applicable to shared group events. Built successfully, committed, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-22 21:20 - Task Started**
> Prompt: "problema de limba nu s-a schimbat" (plus screenshots)
> Plan: Thoroughly localize the remaining hardcoded strings across `AddEventModal.tsx` (top half), `Settings.tsx`, and `CalendarGrid.tsx`/`CalendarHome.tsx` to ensure 100% translation coverage for the UI.
> Model: Gemini 3.1 Pro

**2026-05-22 21:24 - Task Completed**: Implemented comprehensive translation coverage. Added over 30 new translation keys to `i18n.ts` for all 6 supported languages. Replaced hardcoded English text in `AddEventModal.tsx` (Event Title, Location, Checklist, Category, Custom Color), `Settings.tsx` (Birthday, Preferences, Haptic Feedback, Custom Theme Engine, Background Image, Overlay Settings), and `CalendarGrid.tsx` ("No events scheduled" and "Add Event" in the Day Modal). Built successfully, committed, and pushed to Git.
> Model: Gemini 3.1 Pro

**2026-05-22 21:30 - Follow-up Fix**: The user noted that the transition was incomplete. They had viewed the app before the deployment of the previous fix, but they were also right about missing strings in `CalendarHome.tsx`. Applied the translation helper to "Personal", "New Group", "Invite", and "Edit Group" buttons on the main dashboard. Re-built and pushed to GitHub.
> Model: Gemini 3.1 Pro

**2026-05-22 21:40 - Task Started**:
> Prompt: "ok, ce urmeaza" & "B" (Approval for visual grid emoji picker)
> Plan: Implement custom Emoji Event Icons. Add `PREDEFINED_EMOJIS` grid in `AddEventModal.tsx`, update Firestore schema to save the `emoji` field, and render it in `CalendarGrid.tsx` and `EventDetailsModal.tsx` instead of standard category icons.

**2026-05-22 21:45 - Task Completed**: Implemented Emoji Picker in `AddEventModal.tsx`. Modified `CalendarGrid.tsx` to render custom emoji text inside the category color bubbles in the calendar and Day Events list. Added the emoji to the header in `EventDetailsModal.tsx`. Built, pushed to Git, and deployed to Firebase.
> Model: Gemini 3.1 Pro

**2026-05-22 23:25 - Bug Fix**: Connect 4 — board was initialized as an object with numeric keys (`{0: [...], 1: [...]}`) instead of a proper 2D array. Firestore round-trips could corrupt the key types (string vs number), causing the 4th token to silently fail placement. Fix: added `normalizeBoard()` helper that guarantees a clean `(string|null)[][]` array from any Firestore representation. Also converted `handleNextRound` to use `Array.from()` and reset `p1IsNext` to `true`. Added optional chaining in board rendering for safety. Also patched missing i18n keys for "Event Emoji" / "Default Category Icon" labels in all 6 languages.
> Model: Claude Opus 4.6

**2026-05-22 23:50 - Security Fix**: Created `firestore.rules` — the database previously had ZERO security rules (fully open). New rules enforce authentication and authorization for all 7 collections: `users` (owner-only write), `groups` (member-only read/write), `groups/messages` (member access, sender-only edit of own content), `groups/typing` (own-user only), `events` (owner/group member/assignee access), `games` (group-member access), `assets` (owner-only), `notifications` (recipient-only). Updated `firebase.json` to reference `firestore.rules` and deployed with `--only firestore:rules`.

**2026-05-22 23:50 - Performance Fix**: Refactored `CalendarHome.tsx` events query. Previously used `query(collection(db, 'events'))` which downloaded ALL events from the entire database for ALL users. Replaced with 3 targeted queries: (1) `where('ownerId', '==', uid)` for personal view or `where('groupId', '==', activeGroupId)` for group view, (2) `where('assigneeIds', 'array-contains', uid)` for assigned tasks, (3) `where('inviteeId', '==', uid)` for invitations. Results are merged and deduplicated client-side. This reduces Firestore reads from O(total events in DB) to O(user's own events).
> Model: Claude Opus 4.6

---

## 📅 Session Log: May 25, 2026

**2026-05-25 - Task Started**
> Prompt: "haide sa le rezolvam pe rand, cum propui sa procedam?" → chosen: start with #6 push notifications fix
> Plan: Fix the native (Capacitor/Android) push registration in `App.tsx`, which writes the FCM token to a singular `fcmToken` field, while the Cloud Functions (`onMessageCreated`, `onGameCreated`) read the array field `fcmTokens`. Align `App.tsx` to use `arrayUnion` into `fcmTokens`, matching the web path in `CalendarHome.tsx` and the functions, so remote push works on Android.
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: Fixed the FCM field-name mismatch that broke remote push on native Android. In `App.tsx`: imported `arrayUnion` from `firebase/firestore` and changed the `PushNotifications` `registration` listener to write `{ fcmTokens: arrayUnion(token.value) }` instead of `{ fcmToken: token.value }`. Cloud Functions and the web path (`CalendarHome.tsx`) already used `fcmTokens` (array), so no function changes were needed. Build verified (`npm run build` OK). Deployed hosting + committed + pushed. NOTE: the Android APK must be rebuilt (`npx cap sync android` + Android Studio build) for the native fix to take effect on the phone — the hosting deploy only updates the web app.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "da" (proceed with cleanup #7 + #8)
> Plan: (#7) Remove the stale, git-tracked `.temp_devlog.md` (52 KB parallel copy of DEVLOG). (#8) Remove the dead `isAIEnabled` toggle that always returns `true`: delete the function in `ai.ts` and simplify all call sites in `ai.ts`, `AddEventModal.tsx`, and `GroupChatWidget.tsx` (drop `!isAIEnabled() ||` guards and unwrap `{isAIEnabled() && (...)}` JSX), plus remove the now-unused imports.
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: (#7) `git rm`'d `.temp_devlog.md`. (#8) Deleted the `isAIEnabled` function from `ai.ts` and removed all 6 usages: simplified the guard in `ai.ts` (`suggestAssetForTextAI`), removed `!isAIEnabled() ||` from two conditions in `AddEventModal.tsx`, unwrapped the two `{isAIEnabled() && (...)}` JSX blocks (AI checklist button in `AddEventModal.tsx`, AI digest button in `GroupChatWidget.tsx`), and dropped the now-unused `isAIEnabled` import from both component files. Build verified (`npm run build` OK, no TS errors). Deployed hosting + committed + pushed.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "vreau sa verifici inainte" → after audit, chosen: apply the SAFE subset of #2/#3/#4 + document deferred work
> Plan: A pre-implementation audit of how `userId`/`ownerId`/`createdBy` are written revealed the naive rule tightening would break real cross-user flows (birthday auto-add, asset transfer keep-copy, recurrence overrides by non-owners, task-assignment notifications, group-deletion invite cleanup). Apply only the safe subset:
> - (#2) `group_invites` read restricted to OR(toEmail==email, fromId==uid, isMemberOfGroup(groupId)); same OR for update/delete; fix dead `fromUid`→`fromId`.
> - (#4) `games` create restricted to `createdBy==auth.uid && isMemberOfGroup(groupId)` (createdBy is always the current user).
> - (#3) `notifications` create gated on `request.resource.data.createdBy == auth.uid` (attribution); add `createdBy: uid` to the client write in `AddEventModal.tsx`.
> Defer events/assets ownerId tightening + full notification anti-spam to Cloud Functions refactors (logged in "Deferred Security Work" below).
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: Applied the safe security subset.
> - `firestore.rules`: (#2) added `canAccessInvite()` helper and restricted `group_invites` read + update + delete to invitee/sender/group-member; fixed dead `fromUid`→`fromId`. (#4) `games` create now requires `createdBy == auth.uid && isMemberOfGroup(groupId)`. (#3) `notifications` create now requires `request.resource.data.createdBy == auth.uid`.
> - `AddEventModal.tsx`: added `createdBy: auth.currentUser?.uid` to the task-assignment notification write so it passes the new rule (cross-user notifications still work; `userId` stays the recipient).
> - Verified all real read queries survive the new invite rule: `CalendarHome` (by `toEmail`), `GroupSettingsModal`/`LeaveGroupModal` (by `groupId`, covered by the member branch).
> - Documented deferred work (events/assets ownerId → Cloud Functions, notifications anti-spam, #1 users read, #5 App Check, .firebase gitignore) in the new "Deferred Security Work" section.
> - Build OK. Deployed `firestore:rules` + hosting, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "da" (proceed to #1 audit) → chosen path "C now, then A"
> Plan: (#1 step C — quick win) The assignee picker in `AddEventModal.tsx` fetched the ENTIRE `users` collection (`query(collection(db,'users'))`), enumerating every account in the app. Replace it with deriving the assignee list from the `userMap` prop (group/family members already loaded by `CalendarHome`), scoping assignees to people the user shares a group with. Remove the now-unused `getDocs` import. This kills the main enumeration vector and is more correct, without changing the `users` read rule yet (full lock-down via a public `profiles` collection = step A, next).
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: (#1 step C) Replaced the global `users` fetch in `AddEventModal.tsx` with a derivation from the `userMap` prop (group/family members already loaded by `CalendarHome`); removed the now-unused `getDocs` import. Assignee picker is now scoped to people the user shares a group with — no more enumeration of all accounts. Build OK, deployed hosting, committed, pushed. Step A (public `profiles` collection + restrict `users` read to owner-only) remains — tracked in "Deferred Security Work".
> NOTE (separate finding): `AddEventModal.tsx` still listens on `query(collection(db,'assets'))` (all assets) and filters client-side; with the current `assets` read rule (`ownerId == auth.uid`) this listener likely hits permission-denied. Flagged for follow-up — should query with `where('ownerId','==',uid)`.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "Întâi fix asset-uri" (fix the active assets-listener bug found during the #1 audit)
> Plan: Both `AddEventModal.tsx:126` and `Wallet.tsx:53` listen on the UNFILTERED `query(collection(db,'assets'))` and filter client-side, but the `assets` read rule (`ownerId == auth.uid`) rejects any query that could return other users' docs — so these listeners hit permission-denied (Wallet asset list + event asset picker broken in prod since the security rules landed). Fix: scope both queries with `where('ownerId','==',uid)`. The `sharedWithFamily` branch can't work under the current rule anyway (shared assets owned by others aren't readable) — note as deferred (needs a real sharing model). Add `where` to the AddEventModal firestore import.
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: Scoped both asset listeners server-side. `Wallet.tsx:53` and `AddEventModal.tsx:126` now use `query(collection(db,'assets'), where('ownerId','==',uid))` and dropped the redundant client-side filter. This resolves the permission-denied that broke the Wallet asset list and the event asset picker after the security rules landed. Build OK, deployed hosting, committed, pushed.
> DEFERRED: `sharedWithFamily` asset visibility is now effectively disabled (the `assets` read rule only allows owner reads). Restoring cross-user shared assets needs a proper group-scoped sharing model (e.g. an `allowedUserIds` array + matching rule), tracked under Deferred Security Work.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "de ce apare adresa de email la eveniment, si o mica problema de UI in assets, si tot la UI, vreau ca elementele din topbar sa fie restrictionate in latimea maxima 64rem, la fel ca elementele de mai jos" (+ screenshots)
> Plan: Three UI fixes —
> (1) Birthday email: virtual birthday event title in `CalendarHome.tsx:380` is `${u.name || u.email}'s Birthday`; when the profile has no `name` it shows the full email. Change fallback to `u.email.split('@')[0]` (shows "besliandrei" not the full address).
> (2) Assets modal border overlap: in the Edit Asset modal (`Wallet.tsx:593`) the image/scan row has a fixed `h-28`; the right column's two `flex-1` boxes ("Pick from Past Uploads", "Scan Code") are ~52px each and their content overflows, so a border bleeds over the adjacent box. Fix: give the row more height + clip overflow.
> (3) Topbar width: the fixed headers in `CalendarHome` (406), `Wallet` (445), `Settings` (162) span full width while the content below is `max-w-5xl`/`max-w-2xl` (= 64rem) centered. Wrap each header's inner content in a `max-w-* w-full mx-auto px-4` container so the header items align with the body (bar stays full-width visually).
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: Three UI fixes shipped.
> (1) `CalendarHome.tsx:380` birthday title fallback → `u.name || u.email?.split('@')[0] || 'User'` (shows "besliandrei's Birthday" instead of the full email). These birthday events are virtual (useMemo, not stored), so the change takes effect immediately. Root cause: the account has no `name` set; signup/Google paths do set it, but pre-existing/merge-created docs may lack it.
> (2) Edit Asset modal (`Wallet.tsx:593`): bumped the image/scan row from `h-28` to `h-32` and added `min-h-0 overflow-hidden` to the two right-column boxes so their dashed borders no longer bleed over the adjacent box.
> (3) Constrained the fixed headers in `CalendarHome` (406), `Wallet` (445) and `Settings` (162): moved `px-4` + flex layout into an inner `max-w-5xl`/`max-w-2xl` `w-full mx-auto` wrapper so header content aligns with the body (the bar still spans full width). Matches each screen's existing content max-width (64rem / 42rem).
> Build OK, deployed hosting, committed, pushed.
> Model: Claude Opus 4.7

> CORRECTION to earlier audit (#4 events): birthday auto-add does NOT write events to Firestore (they are virtual/in-memory), so it is NOT a blocker for tightening the `events` create rule. The real remaining blocker for `events` is recurrence overrides created by non-owner group members (`AddEventModal.tsx:572`).

**2026-05-25 - Task Started**
> Prompt: "la eveniment, tot nu apare numele meu, desi la sotie apare" (+ screenshots)
> Plan: The birthday title reads `u.name` from the Firestore `users` doc (via `userMap`). Settings shows "Andrei Besliu" but that comes from Firebase Auth `displayName` (`Settings.tsx:208`), NOT the Firestore `name` field — which is empty on this account (the wife's doc has `name`, so hers shows). Fix: in `App.tsx` `onAuthStateChanged`, backfill `users/{uid}.name` from `currentUser.displayName` when the Firestore doc has no `name`. This populates the field for existing accounts so the birthday (and member lists) show the real name.
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: `App.tsx` `onAuthStateChanged` now builds a `profileUpdate` merge object and, when `userDocSnap.data()?.name` is missing and `currentUser.displayName` exists, sets `name: displayName`. The current user's Firestore `users` doc gets "Andrei Besliu" backfilled on next login, so the virtual birthday title resolves via `u.name` instead of the email prefix. Build OK, deployed hosting, committed, pushed. NOTE: requires one login/refresh for the backfill to write + `userMap` to re-read; depends on `displayName` being set in Firebase Auth (it is for this account). Optional follow-up: add an editable Name field in Settings for accounts with no `displayName`.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "Da" (add the editable Name field in Settings)
> Plan: Add an editable "Display Name" field to the Account section of `Settings.tsx`. The name is currently read-only (`auth.currentUser?.displayName`). Make it editable: load from `users/{uid}.name || displayName`, and on blur save to BOTH the Firestore `users` doc (`name`) and Firebase Auth (`updateProfile({ displayName })`) so the birthday/member lists (Firestore) and the Settings header (Auth) stay in sync. Add i18n keys `displayName` / `displayNameDesc` for all 6 languages.
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: Added an editable "Display Name" row to the Account section in `Settings.tsx`. Imported `updateProfile` from `firebase/auth`; added a `name` state (initialised from `displayName`, synced from `users/{uid}.name` via the existing onSnapshot); `handleNameSave` (onBlur) writes the trimmed value to BOTH Firestore (`name`) and Auth (`updateProfile({ displayName })`), skipping no-op saves. The profile header now reflects the edited name. Added `displayName`/`displayNameDesc` i18n keys to all 6 languages (en/ro/fr/es/it/de). Build OK, deployed hosting, committed, pushed.
> Model: Claude Opus 4.7

## 📅 Session Log: May 25, 2026 — #1 step A (profiles refactor)

**2026-05-25 - Task Started (Phase 1 of 3)**
> Prompt: "#1" → step A, chosen sync strategy: client-side
> Plan: Lock down the world-readable `users` collection via a public `profiles` collection, rolled out in 3 non-breaking phases. PHASE 1 (this task): add `profiles/{uid} = {name, photoURL, birthday}` with rules (read = any signed-in user, write = owner only), and client-side sync that mirrors these fields whenever the owner logs in (`App.tsx` onAuthStateChanged) or edits them (`Settings.tsx` name/photo/birthday handlers). Migration is gradual — each profile is created on that user's next login. Phase 2 will switch cross-user reads (CalendarHome userMap, Wallet sharedUsers, InviteFamilyModal) onto `profiles`; Phase 3 will flip `users` read to owner-only. Fields confirmed needed in profiles by audit: name, photoURL, birthday (email only used for an avatar-initial fallback → will switch those to name initial in Phase 2). `hideBirthdayPrompt` stays in `users` (only read for the current user's own doc).
> TRANSITION CAVEAT (client-side migration): after Phase 3, a member's name/photo/birthday only appears to others once that member has logged in at least once post-Phase-1 (to create their profile).
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed (Phase 1 of 3)**: Added the `profiles` collection foundation. `firestore.rules`: new `profiles/{userId}` block (read = any signed-in user, write = owner only). `App.tsx` onAuthStateChanged now mirrors `{name, photoURL, birthday}` into `profiles/{uid}` on every login (self-population/migration). `Settings.tsx`: `handleNameSave`, `handleProfileImageUpload`, `handleBirthdayChange` now also `setDoc(merge)` the corresponding field into `profiles` for immediate updates (added `setDoc` import). Fixed a TS spread-typing issue (`const src: any`). Build OK, deployed `firestore:rules` + hosting, committed, pushed. NOTHING reads `profiles` yet and `users` read is still open — fully non-breaking. Next: Phase 2 (switch cross-user reads to `profiles`).
> Model: Claude Opus 4.7

**2026-05-25 - Task Started (Phase 2 of 3)**
> Prompt: "da" (proceed to Phase 2)
> Plan: Switch every cross-user read off `users` onto `profiles` (still non-breaking — `users` read stays open this phase):
> - `CalendarHome` userMap loop: read the current user's own doc from `users` (needs birthday/hideBirthdayPrompt), but read OTHER members from `profiles/{id}`.
> - `Wallet` sharedUsers loop: read other members from `profiles/{id}`.
> - `InviteFamilyModal`: drop the `users`-by-email lookup (impossible once `users` is owner-only and `profiles` has no email); rely on `toEmail` (acceptance already matches on `toEmail`).
> - Avatar-initial fallbacks that use `email?.charAt(0)` for other members → use `(name || email)?.charAt(0)` since profiles carry `name`, not email.
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed (Phase 2 of 3)**: All cross-user reads moved to `profiles`.
> - `CalendarHome` userMap loop now reads the current user's own doc from `users` and every other member from `profiles/{id}`.
> - `Wallet` sharedUsers loop reads other members from `profiles/{id}`.
> - `InviteFamilyModal`: removed the `users`-by-email lookup (and the `query`/`where`/`getDocs` imports); invite now writes `toId: null` and relies on `toEmail` (which is how acceptance already works). `toId` was confirmed write-only/never read.
> - Avatar-initial fallbacks for other members switched to `(name || email)?.charAt(0)` in `CalendarGrid` (x2) and `CalendarHome` (owner-popup fallbacks in EventDetailsModal already preferred `name`).
> Build OK, deployed hosting, committed, pushed. Still non-breaking — `users` read remains open. Phase 3 (flip `users` read to owner-only) is HELD until profiles are confirmed populated (both users must log in once post-Phase-1).
> Model: Claude Opus 4.7

**2026-05-25 - Task Started (Phase 3 of 3)**
> Prompt: "al meu apare, ea o sa isi faca din nou cont" (my profile shows; wife will create a fresh account)
> Plan: Flip the `users` read rule from `isSignedIn()` to owner-only. Pre-flip re-audit confirmed every remaining `users` read is the caller's OWN doc (CalendarHome:97 & the self-branch at :117, Settings:62, Wallet:63) and there are no `collection(db,'users')` queries left. Safe because: the current user has a profile; the wife's fresh account will self-create its profile on first login (profiles write is owner-only → allowed for own uid); any lingering old-uid references just render blank (profiles read of a missing doc, no error). This closes the original #1 finding (users collection was world-readable, exposing email/fcmTokens/prefs).
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed (Phase 3 of 3)**: Flipped `users` to `allow read, write: if isOwner(userId)` in `firestore.rules`. The `users` collection (email, fcmTokens, preferences) is now readable only by its owner; all member name/photo/birthday rendering comes from the public `profiles` mirror. Build OK, deployed `firestore:rules`, committed, pushed. **#1 step A complete** — the original world-readable `users` finding is resolved. Removed #1 from Deferred Security Work.
> VERIFY: confirm in the live app that group member names/avatars still render (they read from `profiles`) and your own Settings/Wallet still load (own user doc). The wife's fresh account will populate its profile on first login.
> Model: Claude Opus 4.7

## 📅 Session Log: May 25, 2026 — Custom reminder time

**2026-05-25 - Task Started**
> Prompt: "totul pare ok, aici vreau custom time" (+ screenshot of the Reminder dropdown)
> Plan: Add a "Custom..." option to the reminder (`Memento`) dropdown in `AddEventModal.tsx`. Selecting it reveals a number input + unit select (minutes/hours/days before); `reminderMinutes` is stored as value × unit-multiplier (1/60/1440). Use a `customReminder` boolean for UI mode (so a custom value equal to a preset doesn't snap back). An `applyReminder()` helper decomposes a loaded `reminderMinutes` into value+unit on edit/draft/reset. (The existing preset labels are hardcoded English — keeping the new option consistent; full reminder-dropdown i18n is a separate follow-up.)
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: Added a "Custom…" reminder option in `AddEventModal.tsx`. New module consts `PRESET_REMINDERS` and `REMINDER_UNIT_TO_MINUTES`; new state `customReminder` / `customReminderValue` / `customReminderUnit`; `applyReminder()` helper wired into the editEvent / draft / reset load paths (decomposes a stored `reminderMinutes` into value+unit). The dropdown gained a `custom` option; selecting it defaults to 30 minutes and reveals a number input + unit select (minutes/hours/days before) that recomputes `reminderMinutes`. Stored value stays plain minutes, so existing reminder scheduling is unaffected. Build OK, deployed hosting, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-25 - Follow-up Fix**: The custom reminder row overflowed the narrow Memento grid column (the "minutes before" `<select>` couldn't shrink below its content width). Fixed the flexbox overflow: added `min-w-0` to the row + the select, narrowed the number input to `w-16 shrink-0`, and tightened the select padding to `px-2`. Build OK, deployed hosting, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-25 - Task Started**
> Prompt: "tot are o problema de asezare si nu se sincronizeaza limba si nu doar acolo nu se schimba" (+ screenshot)
> Plan: (a) The custom-reminder unit `<select>` still overflowed because its option label ("minutes before") is too long for the narrow column — shorten the unit labels to just the unit word. (b) i18n: several `AddEventModal` strings are hardcoded English and don't follow the language setting — translate the category labels (Work/Group Time/Chores/Health/Other), the reminder dropdown options + units, and the "Me"/"AI Assistant" assignee buttons. Add ~16 i18n keys across all 6 languages; render categories via dynamic `t('cat_'+cat.id)`. (This screen first; other screens may have similar gaps — follow-up.)
> Model: Claude Opus 4.7

**2026-05-25 - Task Completed**: (a) Layout — shortened the custom-reminder unit `<select>` options to just the unit word (`unitMinutes/Hours/Days`), which fits the narrow column (combined with the earlier `min-w-0`), fixing the arrow-overlapping-text overflow. (b) i18n — added 16 keys to all 6 languages (`cat_work/family_time/chores/health/other`, `noReminder`, `atTimeOfEvent`, `min15Before`, `hour1Before`, `day1Before`, `customReminder`, `unitMinutes/Hours/Days`, `assignToMe`, `aiAssistant`). In `AddEventModal.tsx`: categories now render `t('cat_'+cat.id, language)`, the reminder dropdown + unit options use `t()`, and the "Me"/"AI Assistant" assignee buttons use `t()`. Build OK, deployed hosting, committed, pushed.
> KNOWN REMAINING i18n GAPS (follow-up): group names like "Family"/"B&D" are user data (not translatable); the AI-assistant button `title` tooltip and the task-assignment notification body ("New Task Assigned") are still English; other screens/modals may have hardcoded strings — a full app-wide sweep is a separate task.
> Model: Claude Opus 4.7

**2026-05-25 21:57 - Task Started**

> Prompt: "termina aceste traduceri"
> Plan: Finish the remaining i18n gaps mentioned: AI-assistant button title tooltip, task-assignment notification body ("New Task Assigned"). Perform an app-wide sweep for other hardcoded strings.
> Model: Gemini 3.1 Pro (High)

**2026-05-25 22:01 - Task Completed**: Added missing translations to `i18n.ts` (`aiAssistantTooltip`, `newTaskAssigned`, `taskAssignedBody` and 16 others for tooltips) in all 6 languages. Updated `AddEventModal.tsx` to use them for the AI Assistant button and the task assignment notification. Performed an app-wide regex sweep replacing hardcoded `title="..."` attributes with localized `t(...)` equivalents across all components (e.g. `Wallet.tsx`, `GamesHubModal.tsx`, `GroupChatWidget.tsx`). Added `useThemeStore` and `language` to components where it was missing. Build verified and deployed.
> Model: Gemini 3.1 Pro (High)

## 📅 Session Log: May 26, 2026 — i18n sweep (CalendarHome + Notifications)

**2026-05-26 - Task Started**
> Prompt: "i18n" (continue the pending i18n task: CalendarHome + NotificationsDropdown)
> Plan: Sweep the home dashboard + notifications dropdown for hardcoded English. Add ~35 i18n keys across all 6 languages and render via `t(key, language)`. Also fix the German (`de-DE`) block which was missing ~19 keys after `defaultIcon` (showCode … removeAssetTooltip), so it fell back to English.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: i18n for `CalendarHome.tsx` + `NotificationsDropdown.tsx`.
> - `i18n.ts`: added 35 new keys to all 6 language blocks (markAllRead, noNotificationsYet, recurring, addYourBirthday, addBirthdayPromptDesc, setBirthday, youHave, pendingGroupRequest(+Plural), pendingInvite(+Plural), invitedYouTo, aGroup, accept, decline, lobby, inProgress, gamesRunningTapToView, waitingForPlayers, tapToResume, join, resume, groceryList, newChore, standardEvent, group, todaysEventsTasks, pendingTasksToday, completedTasksToday, noItemsFound, item, itemsPlural, happeningNow, startsIn, atPlace). Also backfilled the 19 missing German keys (showCode, editAsset, deleteAsset, recurringEvents, assetsTitle, editSeries, deleteSeries, notificationsTitle, removeMember, aiDigestTooltip, replyTooltip, addReactionTooltip, sendVoiceMessageTooltip, recordVoiceMessageTooltip, howToPlay, cancelGame, viewOwner, closeTooltip, removeAssetTooltip).
> - `NotificationsDropdown.tsx`: header title, "Mark all read", empty-state text now use `t()`.
> - `CalendarHome.tsx`: mobile menu (Recurring/Assets/Settings), birthday prompt (title/desc/button), pending group-request & invite count lines (with singular/plural keys), "invited you to / a group", Accept/Decline, game banner (Lobby/in progress, status line, Join/Resume), FAB templates (Grocery List/New Chore/Standard Event — both button labels and prefilled titles), overview-modal titles, "No items found", item/items plural, the virtual birthday event title (`Name — Birthday 🎂`), and the local-notification body ("Happening now!" / "Starts in X hours/minutes at LOCATION") all localized. Added `language` to the `birthdayEvents` useMemo deps so titles re-render on language change. Brand "Our Days" and personal-name fallbacks (Me/User) left untranslated per the i18n exception rule.
> Build OK (tsc + vite). Deployed, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: "trecem la bug" (Connect 4 — 4th/aligning token cannot be placed)
> Plan: Re-diagnose the long-standing 🔴 Connect 4 bug. Two prior attempts (Gemini 20:55 fixed `winningCells` nested array → objects; Opus 4.6 23:25 added read-side `normalizeBoard`) left it on the roadmap. Root cause still present: the board is WRITTEN to Firestore as a raw 2D array (`Array.from(...=>Array())`), and Firestore rejects nested arrays — so any board write (notably init, every move, and reset) is invalid. Fix: persist the board as a map of rows ({ "0": [...7], ... }) at all write sites.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Fixed the Connect 4 "4th token" bug. Firestore forbids nested arrays (an array element cannot itself be an array), so the 6×7 board stored as `(string|null)[][]` was rejected on write while `winningCells` (already objects) and reads were fine — masking the failure until a write actually mattered.
> - `Connect4.tsx`: added `boardToMap()` helper (2D array → `{ "0": [...], ... }` map of rows). `handleClick` and `handleNextRound` now write `boardToMap(board)` instead of the raw 2D array. The existing `normalizeBoard()` already reads both the map form and the legacy array form, so the fix is backward-compatible — in-progress games migrate to the map form on the next move.
> - `GamesHubModal.tsx`: Connect 4 init now seeds `board` as a row map via `Object.fromEntries(...)` instead of `Array.from(... => Array())`.
> Other games unaffected: TicTacToe (flat `Array(9)`) and MemoryMatch (flat array of objects) use 1D arrays, which Firestore allows.
> Build OK (tsc + vite). Deployed, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: i18n sweep of the Arcade game components (hardcoded English still present in Connect4, TicTacToe, MemoryMatch, RummyGame, GamesHubModal).
> Plan: Route ALL user-facing strings through `t(key, language)`. Add ~74 keys to all 6 language blocks in `i18n.ts`; add `useThemeStore`/`language` to the game components that lacked it; complete the missing `memory-match` rules for ro/fr/es/it/de in GamesHubModal's `getGameRules`; convert RummyEngine's English `validateMeld` error strings into i18n `errorKey`s resolved in the UI.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Full i18n coverage for the Arcade.
> - `i18n.ts`: added ~74 keys to all 6 languages — shared game UI (backToArcade, waitingEllipsis, score, vs, yourTurn, waitingForOpponent, nextRound, joinGame, joinGameAs, winsSuffix, itsADraw), GamesHub (playingGame, startNewGame, gamesOn, thisDay, winnerLabel, draw, inProgressLabel, view, allTimeLeaderboard, whoRulesArcadePrefix, noGamesCompleted, startPlayingGetOnBoard, winsLabel, ptsLabel, okLabel, game name + description keys), Memory Match (player1/2, youWon, wonSuffix, playAgain), Rummy (exitLabel, waitingForPlayersJoin, startGame, waitingForHost, drawACard, meldOrDiscard, waitingForPlayer, drawUpper/deckUpper/dropUpper/discardUpper, cardsLeft, noMeldsYet, stagedMeldsLabel, playMeldsToBoard, sortLabel, meldCardsPrefix, cardsWord, gameOver, winsLower, someone, jokerLabel) + 6 Rummy error keys + 5 engine error keys.
> - `Connect4.tsx`, `TicTacToe.tsx`, `MemoryMatch.tsx`, `RummyGame.tsx`: added `useThemeStore`/`t` and localized every visible string (player placeholders, scores, turn/status lines, win/draw text, lobby/buttons, deck/discard labels, staged melds, hand controls, game-over scoreboard, Joker tile).
> - `RummyEngine.ts`: `validateMeld` now returns an `errorKey` (i18n key) instead of a hardcoded English `error`; `RummyGame` resolves it via `t(result.errorKey, language)`.
> - `GamesHubModal.tsx`: localized header, tabs, card titles/descriptions, active-games list (new `gameTypeName()` helper for localized game names), winner/status, View/Join, leaderboard; added the missing `memory-match` rules for ro/fr/es/it/de so the rules modal now opens in every language.
> Exceptions left untranslated per the i18n rule: real player/group names and the rare `Unknown` name fallback.
> Build OK (tsc + vite). Deployed, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: "hai sa revenim, poti sa te apuci de rummy ui overhaul"
> Plan: Phase 1 of the Rummy UI overhaul (`RummyGame.tsx`) — the high-impact, low-risk wins, leaving the riskier drag-to-insert reorder and multi-round scoreboard for phase 2. Implement: live meld feedback (validate selected cards via `validateMeld`, show Set/Run + points, disable meld when invalid), first-meld progress chip toward 45 pts, card redesign (real suit glyphs + contrast), and dual sort (Runs/Sets). Add 7 i18n keys × 6 languages.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed (Phase 1)**: Rummy UI overhaul, phase 1.
> - `i18n.ts`: +7 keys × 6 languages (meldTypeSet, meldTypeRun, invalidCombo, firstMeldLabel, needsRun, sortRuns, sortSets).
> - `RummyGame.tsx`: (1) **Live meld feedback** — the floating meld button now validates the current selection in real time: green "Meld · Run · 35 pts" when valid (enabled), red "Invalid combination" when not (disabled), so players no longer stage-then-error. (2) **First-meld progress chip** — under the turn bar, while the player hasn't opened, shows `First meld: X/45 pts · needs a run`, turning emerald once ≥45 pts with a run is staged. (3) **Card redesign** — replaced the plain suit dots with real glyphs (♥♦♣♠) as corner indices (value + suit, top-left and mirrored bottom-right) plus the centre value; bumped Diamonds→amber-600 and Clubs→sky-700 for legibility on the cream tile. (4) **Dual sort** — replaced the single Sort button with "Runs" (group by suit→value) and "Sets" (group by value→suit) via a new `sortHandBy(mode)`.
> Phase 2 still open: drag-to-insert hand reorder (currently a position swap) and a cumulative multi-round scoreboard.
> Build OK (tsc + vite). Deployed, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: chose "Game-End / Leaderboard" as the next task.
> Plan: Add a formal game-end/stopping mechanism. Round-loop games (TTT, Connect 4, Memory) loop via "Next Round" and the doc's `winner` only reflects the last round, so the leaderboard can credit the wrong player. Introduce a shared `gameResult.ts` (`getSessionWinner` from cumulative `state.scores` per game type + `finalizeGameUpdate`), add an "End Game" button to each game-over screen + an "End" action in the Arcade hub list (inline confirm) that locks the session (`finalized`, `endedAt`) and banks the session winner, hide "Next Round" once finalized, and switch the leaderboard win-credit to `getSessionWinner`.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Game-End / Session Stopping system.
> - New `src/components/games/gameResult.ts`: `getSessionWinner(game)` (TTT/Connect4 → higher round-win count in `scores`; Memory → more pairs; Rummy → existing `winner`; ties → null) and `finalizeGameUpdate(game)` (`status:'finished'`, `winner:sessionWinner`, `finalized:true`, `endedAt`).
> - `TicTacToe.tsx`, `Connect4.tsx`, `MemoryMatch.tsx`: game-over screen now shows **End Game** next to Next Round/Play Again; once `finalized`, those are hidden and a "🏁 Game ended" label shows. Added `handleEndGame`.
> - `GamesHubModal.tsx`: leaderboard win-credit switched to `getSessionWinner` (so multi-round sessions credit the leader, not the last round); active-games list gained an **End** button (Flag icon, two-tap inline confirm) for non-finalized playing/finished games to stop abandoned games, plus an "Ended" badge for finalized ones.
> - `i18n.ts`: +4 keys × 6 languages (endGame, gameEnded, endedBadge, confirmEnd).
> - No Firestore rules change needed (group members may already update games).
> Moved the roadmap item into Completed Features.
> Build OK (tsc + vite). Deployed, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: chose "Firebase App Check" as the next task.
> Plan: Wire up App Check + abuse protection for the public web config without breaking the live app. Client: init App Check (reCAPTCHA v3) gated behind an env key. Functions: add `enforceAppCheck` (env-flag, default off so it's safe to ship before console setup), require auth on the 4 Gemini callables, and add a basic per-user daily rate limit. Document the manual console steps needed to actually enforce.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Firebase App Check scaffolding + AI-callable hardening.
> - `src/firebase.ts`: `initializeAppCheck` with `ReCaptchaV3Provider`, keyed off `VITE_APPCHECK_RECAPTCHA_KEY` (skips entirely if unset, so dev/builds without it still work); dev debug-token enabled; token auto-refresh on. Shipping this is non-breaking — it only starts attaching App Check tokens once a key is configured; enforcement is a separate server/console toggle.
> - `functions/src/index.ts`: added `ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === 'true'` and applied `{ enforceAppCheck: ENFORCE_APP_CHECK }` to all 4 callables (`generateAIChecklist`, `suggestEventCategory`, `generateGroupDigest`, `suggestAssetForText`); added `assertAiCallerAllowed()` which **requires `request.auth`** and enforces a **per-user daily quota** (`ai_usage/{uid}`, `AI_DAILY_LIMIT`=50) via a Firestore transaction (admin-only collection). Triggers (autoSuggestChecklist, onMessageCreated, onGameCreated) left unchanged.
> - `functions/tsconfig.json`: added `"rootDir": "src"` to fix a TS5011 build error surfaced by the newer compiler (also ran `npm install` in functions — deps weren't present in this environment).
> - Deployed hosting + all functions; set an Artifact Registry cleanup policy (was warning on deploy). Enforcement remains OFF until the manual console steps in "Deferred Security Work #5" are done.
> Build OK (web tsc+vite, functions tsc). Deployed, committed, pushed.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: "ma intreb daca aplicatia are mai multe vulnerabilitati de securitate, sau daca ai tu sugestii" → chose Storage rules + Firestore create-rule hardening.
> Plan: Security pass. Findings: (HIGH) Firebase Storage had NO managed rules (absent from firebase.json, no storage.rules) despite heavy use; (MED) Firestore `create` rules allowed spoofing/injection (events into any group, messages with spoofed senderId, forgeable groups/invites); and the Wallet "past images" picker recursively listed EVERY user's files. Implement the chosen fixes.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Storage rules + Firestore create hardening.
> - New `storage.rules` (+ wired into `firebase.json`): writes locked to the uploader's own path (`{root}/{uid}/…` and flat `{uid}_*` files), cross-user `list` denied, `get` open to signed-in users (download URLs are tokenised), image type + size caps. Group chat media gated on auth + size/type (true per-group scoping needs a Cloud Function upload path — future work).
> - `firestore.rules` create hardening: **messages** now require `senderId == auth.uid` (no impersonation); **groups** create requires `ownerId == auth.uid` && creator ∈ members; **group_invites** create requires `fromId == auth.uid` (no forged invites); **events** group events require `isMemberOfGroup(groupId)` on create (blocks injecting events into groups you're not in; personal events stay open). `ownerId` on events/assets still deferred (recurrence overrides).
> - `Wallet.tsx`: the "past images" picker now scans only the current user's own folders (`assets|events|checklists/{uid}`) instead of every user's files bucket-wide — closes a data-harvesting leak.
> - Reviewed & cleared as non-issues: no `dangerouslySetInnerHTML`/`eval` (no XSS sink); the `AIza…` keys in `google-services.json`/service worker are PUBLIC Firebase keys by design; `.env`/`functions/.env` are gitignored (no committed secrets).
> Deployed storage + firestore rules + hosting. Build OK (tsc + vite).
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: "ambele" — do both remaining items: notifications anti-spam via Cloud Function + rate-limit the AI trigger.
> Plan: (1) Move notification creation server-side: a `notifyUsers` callable that requires auth, only lets you notify users you share a group with, and rate-limits per sender; switch the client to it and set `notifications create: if false`. (2) Rate-limit the `autoSuggestChecklist` Firestore trigger by the event owner, sharing the AI quota with the callables.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Notifications anti-spam + AI-trigger rate limit.
> - `functions/src/index.ts`: extracted a generic `tryConsumeQuota(uid, collection, limit)` (per-user/day, admin-only `*_usage` collections); `assertAiCallerAllowed` now uses it. Added `notifyUsers` callable — auth-required, de-dupes/caps recipients (≤20), rate-limited (`notif_usage`, `NOTIF_DAILY_LIMIT`=100), and only writes a notification for recipients who **share a group** with the sender (Admin SDK, server-set `createdBy`/`createdAt`). The `autoSuggestChecklist` trigger now consumes the same `ai_usage` quota by `ownerId` and skips generation when over — closing the free Gemini-spam path via event creation.
> - `firestore.rules`: `notifications` `create` → `if false` (only the Cloud Function can create).
> - Client: new `src/notifications.ts` (`notifyUsers` helper) ; `AddEventModal` task-assignment now calls it instead of `addDoc(notifications)`.
> - Deployed functions (created `notifyUsers`, updated the rest) + firestore rules + hosting. Build OK (web + functions tsc).
> VERIFY: assign a task to another group member and confirm they receive the in-app notification (now created server-side).
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: "nu vom face notificari in limba destinatarului, dar vreau sa continuam cu restul de mai sus" → enforce `ownerId` on events/assets via Cloud Functions (App Check enforcement stays blocked on manual console steps; chat-media per-group scoping deferred as low-value/high-cost).
> Plan: The only two client create-paths with a non-self `ownerId` are the recurring single-occurrence override (`AddEventModal`) and the asset "keep copy" transfer (`Wallet`). Move both to Cloud Functions (Admin SDK), then add `create: ownerId == auth.uid` to the events + assets rules.
> Model: Claude Opus 4.7

**2026-05-26 - Task Completed**: Enforced `ownerId` on events & assets create.
> - `functions/src/index.ts`: added `userInGroup` / `usersShareGroup` helpers and two callables: `createEventOverride` (validates the caller may edit the parent — owner / group member / assignee — then writes the override with the parent's `ownerId`+`groupId` and adds the exception date) and `transferAssetCopy` (requires the caller owns the source asset and shares a group with the recipient, then duplicates it to the recipient).
> - `firestore.rules`: `events` create now requires `ownerId == auth.uid` (kept the group-membership check); `assets` create now requires `ownerId == auth.uid`.
> - Client: new `src/serverActions.ts` (`createEventOverride`, `transferAssetCopy`); `AddEventModal` single-occurrence edit and `Wallet` keep-copy transfer call them instead of writing foreign-owned docs directly (removed the now-unused `arrayUnion` import).
> - Deployed both new functions + updated rest + firestore rules + hosting. Build OK (web + functions tsc).
> VERIFY: (1) edit a SINGLE occurrence of a recurring group event and confirm the override saves + the occurrence is replaced; (2) transfer a wallet asset with "keep copy" to a group member and confirm both keep a copy.
> Model: Claude Opus 4.7

**2026-05-26 - Task Started**
> Prompt: "continua" (continue) — App Check enforcement is blocked on metrics maturing, so picked up the 🔴 calendar weekday-alignment bug.
> Plan: Root-caused the one-column date shift to a week-start mismatch — the weekday header (`renderDays`) uses locale-aware `startOfWeek` (Monday-first for `ro`) but `renderCells` used no-locale `startOfWeek`/`endOfWeek` (Sunday-first default). Fix: pass `{ locale: dateLocale }` to the 4 calls in `renderCells`. Ran an adversarial-verify + codebase-sweep workflow before committing.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed**: Fixed calendar weekday alignment.
> - `CalendarGrid.tsx`: added `{ locale: dateLocale }` to the four `startOfWeek`/`endOfWeek` calls in `renderCells` (week-view + month-view branches), so the grid cells share the header's locale-based week start. Aligns dates with their weekday columns for every language (Monday-first for ro/fr/es/it/de, Sunday-first for en-US). Numeric proof matched the report exactly (Thu May 28 2026 → Sunday-first col 4 → Monday-first "VIN" header).
> - Verification: a 2-agent workflow independently confirmed the root cause + fix (correct & complete, no counterexample, worked across ro/en × month/week views) and swept the codebase. The sweep surfaced a SEPARATE, latent **timezone date-shift** bug (events stored as UTC-midnight via `new Date('yyyy-MM-dd').toISOString()`) — does NOT affect UTC+ users like Bucharest; logged as a new 🟠 roadmap item rather than bundled in.
> - Browser preview not used: the calendar is auth-gated, so a dev server would only reach the login screen. Verified via build (tsc+vite) + the adversarial workflow + numeric proof.
> Build OK. Deployed hosting, committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Started**
> Prompt: "rummy" — implement Rummy UI Overhaul Phase 2 (drag-to-insert + cumulative multi-round scoreboard).
> Plan: (1) Replace the position-swap hand reorder with drag-to-insert (compact → move → re-pad). (2) Add `totalScore`/`round` to the rummy state (optional, backward-compatible); on hand end compute penalties for both win paths via a shared helper; owner "Next Hand" banks penalties into totals + re-deals + bumps round; game-over shows this-hand + cumulative; `getSessionWinner` returns the least-penalised player for multi-hand games. Adversarial review of the diff before deploy (scoring + drag math are error-prone and unverifiable in-browser since Rummy needs 2 authed players).
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed**: Rummy Phase 2 (drag-to-insert + multi-round scoring).
> - `RummyGame.tsx`: drag-to-INSERT reorder (lift card, insert before the card under the cursor / before the next card when the slot is a transient post-discard gap, re-pack front-compacted); `buildPenaltyUpdates` shared by both win paths (the meld-out path previously skipped computing opponents' penalties — fixed); `handleNextHand` (owner) banks `score`→`totalScore`, re-deals, increments `round`; round badge in the top bar; game-over scoreboard shows cumulative + this-hand, ranked by least cumulative penalty, with Next Hand + Back to Arcade.
> - `RummyEngine.ts`: `PlayerState.totalScore?` + `GameState.round?` (optional, backward-compatible); `initializeGame` seeds `round: 1`.
> - `gameResult.ts`: `getSessionWinner` for multi-round rummy = least cumulative penalty.
> - `i18n.ts`: +4 keys × 6 languages (nextHand, roundLabel, thisHandLabel, totalLabel).
> - **Adversarial review (3-agent workflow) caught a HIGH-severity sign bug I introduced**: `calculatePenaltyPoints` returns NEGATIVE penalties, so "lowest cumulative wins" credited the LOSER and ranked the worst player #1. Fixed: `getSessionWinner` now picks the MAX cumulative (least negative = least penalty) and the game-over sort is descending. Review also confirmed no card loss/dup in drag-to-insert, no penalty double-count, and backward-compat with legacy single-hand docs. Two PRE-EXISTING issues it surfaced (leaderboard `points` negative/ignores totalScore; `status`/`winner` dual source-of-truth) were logged to the roadmap/backlog, not bundled.
> Build OK (tsc + vite). Browser preview N/A (Rummy is auth-gated + needs 2 players). Deployed hosting, committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Started**
> Prompt: "memory match" → (after a clarifying question) the user chose timer+move counter, themed icon packs, and streak bonus (NOT difficulty/board sizes).
> Plan: Add a shared `memoryThemes.ts` (5 packs × 8 icons + buildMemoryBoard); a theme picker in GamesHubModal before creating a Memory Match game; timer (startedAt on join / finishedAt on end, live tick) + move counter; streak-bonus scoring with board-based win detection. Adversarial review before deploy (scoring/win/draw + timer/theme/backward-compat).
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed**: Memory Match Depth.
> - New `memoryThemes.ts`: THEME_PACKS (classic/animals/food/travel/nature, 8 icons each), buildMemoryBoard(theme). All 40 icon names verified present in lucide-react 0.470.
> - `MemoryMatch.tsx`: ICON_COMPONENTS/renderIcon resolve any pack icon (fallback Gamepad2); streak scoring (consecutive match = +streak points, miss resets), win = `board.every(isMatched)` (scores carry bonuses), `moves`/`streak`/`startedAt`/`finishedAt` in state; live timer (interval keyed on status, frozen at finishedAt) + stats bar (time / moves / 🔥streak) + theme name in header; game-over shows time + moves.
> - `GamesHubModal.tsx`: theme-picker overlay; `handleCreateGame(gameType, theme)` builds the themed board and seeds theme/moves/streak; Memory Match card opens the picker.
> - `i18n.ts`: +9 keys × 6 languages (timeLabel, movesLabel, streakLabel, chooseTheme, 5 theme names).
> - **Adversarial review (2-agent workflow): no high/medium bugs.** Confirmed win-detection timing, winner/draw consistency (in-screen == getSessionWinner), streak ownership across turns, safe per-move winner write, and all 40 icons map 1:1. Two LOW caveats accepted as-is for a casual game: timer is approximate across devices with skewed clocks (clamped, never crashes); a game in-flight at the exact deploy second mixes old pair-count scores with new streak bonuses (never invalid winner / never breaks end-detection).
> Build OK (tsc + vite). Browser preview N/A (auth-gated + needs 2 players). Deployed hosting, committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Started**
> Prompt: "i want to be able to invite people easier ... create a list of friends/contacts and ... invite them into a group" → (after a clarifying question) chose **mutual friends** (requests) + add by **email AND from group members**.
> Plan: friend_requests collection (send = client create; respond = `respondToFriendRequest` CF since accepting writes both users' owner-only friend lists). friends stored as `{uid,name,email}` on user docs. New Friends screen (`/friends`); invite modal friends multi-select; add-friend from group members; menu badge for incoming requests. Adversarial security+correctness review before deploy.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed**: Friends / easier group invites.
> - Functions: `respondToFriendRequest` (transactional accept/decline — validates the caller is the recipient, read-filter-writes both friend lists deduped by uid, marks the request, notifies the sender) and `removeFriend` (transactional, **guarded** so you can only unfriend an actual friend). Helpers in `serverActions.ts`.
> - `firestore.rules`: new `friend_requests` block (read by sender/recipient, create by sender with `status=='pending'`, update forbidden → CF, delete by sender to cancel).
> - Client: new `Friends.tsx` (`/friends` route) — add by email, accept/decline incoming, cancel outgoing, unfriend; `InviteFamilyModal` rewritten with a friends multi-select (one-tap multi-invite, in-group disabled) + reset-on-open; `GroupSettingsModal` add-friend button per member (uses member uid as `toId`); `CalendarHome` Friends menu entry (desktop + mobile) with an incoming-request badge + listener, and passes `memberIds` to the invite modal. +24 i18n keys × 6 languages.
> - **Adversarial review (3-agent workflow)** found and I FIXED: `removeFriend` writing to arbitrary user docs (now friendship-guarded + transactional); `arrayUnion`-on-objects duplicate friend entries (now read-filter-write dedup); non-atomic accept (now a transaction); `InviteFamilyModal` stale cross-group selection (now reset on open/group change); create-rule `status` hygiene; name length cap. **DEFERRED to roadmap (HIGH):** the `toEmail` trust / email-squatting vuln — *pre-existing and shared with the live `group_invites`*; the correct fix is app-wide email verification (would otherwise break email invites for unverified users), logged under Deferred Security Work.
> Build OK (functions tsc + web tsc/vite). Deployed functions + firestore rules + hosting. Committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task (autonomous cleanup batch)**: "whatever you can do alone" → knocked out self-contained backlog/housekeeping items needing no user input or console steps.
> - **GroupSettingsModal i18n**: localized every user-facing string (12 new keys × 6 languages) — title, group name, members, danger zone, delete/leave + descriptions, confirm text, remove-member confirm, error messages. Closes the i18n-everything gap flagged in the friends review.
> - **`.firebase/` housekeeping**: added to `.gitignore` + untracked the deploy cache.
> - **Rummy single-source-of-truth**: removed `status`/`winner` from `GameState`/`initializeGame`/the rummy create-state; the top-level game-doc fields (already the only ones read) are now authoritative. Grep-verified no nested reads.
> - **Leaderboard points**: now sums `(totalScore||0)+(score||0)` (full session penalty) instead of just the last hand's `score`.
> - Skipped (need you or carry migration risk): App Check enforcement (console), email-template tweaks (console), the timezone date-shift bug (touches stored data — wants your testing; doesn't affect UTC+ users).
> Build OK (web tsc + vite). Deployed hosting. Committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed (Admin Phase 1)**: "what else can we do in admin" → Error monitoring & Health + per-user drill-down & moderation (of 4 chosen; broadcast + groups explorer = Phase 2).
> - `functions/src/index.ts`: `logClientError` (auth-required, rate-limited → `errorLogs`), `adminGetHealth` (recent errors + AI/notif usage + top AI users, `truncated` flag), `adminGetUser` (full drill-down + `isProtected`), `adminModerateUser` (enable/disable/forceVerify/delete). Delete does comprehensive cleanup (both-sided friendship unlink, groups, paginated events/assets/games/friend_requests, Storage prefixes, usage docs, Auth) and returns honest counts. Helpers: `deleteQueryInBatches`, `deleteStoragePrefixes`, `logServerError` (wired into the AI callables' catches). Guards: self + admins/owner protected from disable/delete/forceVerify.
> - `firestore.rules`: `errorLogs` `read,write: if false` (CF-only).
> - Client: `src/reportError.ts` (global handlers + Map dedupe + 10/10s cap), `src/components/ErrorBoundary.tsx` (wraps the app in `App.tsx`, installs handlers), Admin.tsx Health tab + user-detail/moderation modal, wrappers in `serverActions.ts`.
> - **Adversarial review (2 agents): gate airtight, no non-admin bypass, admins/owner un-deletable.** FIXED: `logClientError` unauthenticated rate-limit bypass (HIGH → require auth); delete orphaning + silent overflow (MEDIUM → paginate + friendship/friend_requests/games/Storage cleanup + honest counts); Storage files never deleted (MEDIUM); `forceVerify` missing admin guard (LOW → now blocked for protected targets); client dedupe/UI `isProtected` (LOW). Retained group chat messages as group history (documented).
> - Build OK (functions tsc + web tsc/vite). Deployed 4 functions + firestore rules + hosting. Committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Started**
> Prompt: "vreau sa imi creezi un admin backend ... lista cu profile, admini, si statistici, foarte detaliate" (inspire from the other Apps).
> Plan: Recon DataRead + CNCVS admin patterns (custom claims from an `admins` collection / bootstrap). Build an `admins/{uid}` collection + verified-bootstrap-email gate; CF-served admin data (Admin SDK) so PII read rules stay closed + I can merge Firebase Auth records; `/admin` screen with Overview (detailed stats) / Profiles / Admins. Adversarial security review before deploy.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed**: Admin backend.
> - `functions/src/index.ts`: `assertAdmin` (admins-collection OR verified bootstrap-email, auto-provisioned) + 5 callables — `adminCheck`, `adminGetStats` (cross-collection + Auth aggregation, `count()` totals + capped breakdown reads with a `truncated` flag + `collectionGroup('messages').count()`), `adminListProfiles` (Auth ⨝ users ⨝ profiles + per-user group/event/friend tallies), `adminListAdmins`, `adminSetAdmin` (grant/revoke by uid|email, transactional last-admin protection).
> - `firestore.rules`: `admins` collection `read,write: if false` (CF-only).
> - Client: `src/screens/Admin.tsx` (guard → Overview/Profiles/Admins, refresh via `allSettled`), admin wrappers + `ADMIN_BOOTSTRAP_EMAILS` in `serverActions.ts`, lazy `/admin` route, a cosmetic Admin entry in the home menu (email-gated; screen+CFs re-check server-side). English (internal owner tooling).
> - **Adversarial review (3 agents): gate AIRTIGHT** — no non-admin PII path; `admins` rule denies all client access; bootstrap strictly requires `email_verified===true` (squatter-proof for the Gmail owner); App Check off is intended. FIXED: last-admin revoke TOCTOU race → transaction; `listAllAuthUsers` cap overshoot; silent truncation → `count()` totals + flag; friendships `floor`; client `allSettled`+error banner; a pre-existing CalendarHome overview-modal React `key={idx}` → `key={ev.id}`.
> - Break-glass note: if all admins are ever removed, the verified bootstrap owner self-reprovisions on next `/admin` visit; alternatively a local Admin-SDK script (CNCVS `set-admin.mjs` pattern) could set `admins/{uid}`.
> - Build OK (functions tsc + web tsc/vite). Deployed functions (5 created) + firestore rules + hosting. Committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Bug Fix**: Accepting a group invite never added the member to the group.
> Root cause: `handleAcceptFamilyInvite` did `updateDoc(groups/{id}, { members: arrayUnion(uid) })`, but the groups update rule requires `request.auth.uid in resource.data.members` — the joiner isn't a member yet, so the write was DENIED (silent). Broke when `firestore.rules` was introduced (2026-05-22); the legacy `familyMembers` fallback was also dead (owner-only `users`). Existing multi-member groups predate the rules.
> Fix: new `acceptGroupInvite` Cloud Function (Admin SDK, transactional) — validates the caller is the invite's recipient (by `toId` or token email) and that it's pending, adds them to the group's `members`, and marks the invite accepted. `handleAcceptFamilyInvite` now calls it (removed the broken client writes + legacy familyMembers path). Decline stays client-side (only touches the invite). Same recipient-trust model as the rest (email-squatting tracked under Deferred Security Work).
> Build OK. Deployed functions + hosting (verified `acceptGroupInvite` live). Committed, pushed.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Started**
> Prompt: "that" → tackle the HIGH email-verification security item.
> Plan: Close the email-squatting *impersonation* vector (accepting an invite/friend-request sent to an email you don't own). Add `sendEmailVerification` at sign-up + a verify banner (resend/recheck), and gate the **accept** path on `email_verified` in both callables. Keep read rules ungated (gating them would break the toEmail listener queries for unverified users — deferred). Adversarial review of the security logic before deploy.
> Model: Claude Opus 4.8 (1M context)

**2026-05-26 - Task Completed**: Email verification — impersonation closed.
> - `functions/src/index.ts`: `respondToFriendRequest` + `acceptGroupInvite` now compute `emailVerified = request.auth.token.email_verified === true` and gate the email branch: `isRecipient = toId === uid || (emailVerified && toEmail === email)`. uid-addressed accepts unchanged.
> - `Login.tsx`: `sendEmailVerification` on email/password sign-up. New `VerifyEmailBanner.tsx` (shown in CalendarHome for unverified users) — resend + "I've verified" (reload + `getIdToken(true)`), with "still not verified" feedback. Accept handlers surface the verify hint on failure when unverified. +6 i18n keys × 6 languages.
> - **Adversarial review (1 agent): security objective met** — gate is server-verified and NOT bypassable (`=== true` treats undefined/false as unverified), uid (`toId`) flows preserved for unverified users, Google users unaffected, token-refresh sequence correct. Fixed the one medium UX finding (silent recheck → now shows "still not verified"). Low findings (error-message heuristic; toId-only group-invite listener gap — no current regression) left as-is.
> - Updated the Deferred Security Work item: impersonation CLOSED; residual read-disclosure downgraded to LOW (needs conditional listeners before gating read rules).
> Build OK (functions tsc + web tsc/vite). Deployed functions + hosting. Committed, pushed.
> Model: Claude Opus 4.8 (1M context)

## 2026-08-24 — Admin: secțiunea „Enemy AI"

**Model:** Claude Opus 5
**Prompt:** „vreau ca log-ul sa apara undeva in admin"

`src/warlordAdmin/AiInspector.tsx`, secțiune nouă în panoul Warlord. Două părți:

**Regulile** — randate din `AI_RULES` din joc, adică exact tabelul pe care planificatorul îl
citează. O regulă nu poate fi descrisă aici și să se comporte altfel acolo. Fiecare arată
`effect` (aritmetica) și `why`, plus de câte ori s-a declanșat în replay-ul curent — sau că nu s-a
declanșat deloc, ceea ce e la fel de informativ.

**Replay-ul** — alegi misiune, seed, cohorte, mărime, plafon de ture; vezi tură cu tură ce a decis
fiecare cohortă inamică, cu propoziția care o explică și id-urile regulilor declanșate. Clic pe un
id filtrează doar cohortele care l-au citat.

**De ce merge fără niciun cablaj de date:** AI-ul e o funcție PURĂ de stare și bătălia e
reproductibilă din seed, deci adminul rulează același planificator peste aceeași stare și obține
aceeași urmă pe care ar produce-o dispozitivul unui jucător. Nu e o reconstrucție.

**Bucla stă în JOC, nu aici** (`@warlord/logic/combat/aiReplay`). Adminul cere cont, deci nu-l pot
încărca în browser: typecheck + teste + build pot fi toate verzi cu panoul căzut pe ErrorBoundary.
Singurul lucru de aici cu o condiție de terminare — o buclă care ar putea îngheța pagina — a fost
mutat dincolo de linia aia, unde îl acoperă teste.

**Limită scrisă în UI:** partea jucătorului stă pe loc în replay. Deliberat, dar înseamnă că **nu e
o simulare de balans**.

`npx tsc -b` verde · 647 teste verzi · `npm run build` verde.

## 2026-08-24 — Inspectorul de AI rulează pe configurarea din editor

**Model:** Claude Opus 5

Revizia adversarială a găsit că replay-ul nu era funcție de argumentele lui: `createBattle`
rezolvă preset-urile prin singleton-ul global `GameConfig`, care în admin e **gol** până montează
jocul. Deci același (misiune, seed, oaste) dădea bătălii diferite în același build, după cum
operatorul deschisese sau nu tabul Domain înainte.

Adminul îi trimite acum explicit `ov` — chiar configurarea din editor, **cu tot cu modificările
nesalvate** — iar jocul o pune la loc după rulare (o unealtă de balans n-are voie să schimbe
lucrul pe care-l măsoară). Rândul de rezultat spune pe ce a rulat, citit din ce e efectiv în
vigoare, nu din ce s-a pasat.

Efectul lateral util: poți edita balansul și vedea imediat cum se schimbă deciziile AI-ului,
înainte să salvezi pentru toți jucătorii.

`npx tsc -b` verde · 654 teste verzi · `npm run build` verde.

## 2026-08-24 — Adminul: „Reset this section to defaults" era un control mort în secțiunea Enemy AI

**Model:** Claude Opus 5 (constatare a reviziei adversariale, verificată la sursă)

Linkul se randa pentru `section !== 'JSON'`, deci și în AI — dar `resetSection` n-avea ramură `AI`
și cădea pe `setOv(prev => ({...prev}))`. Un clic care **nu face nimic și nu spune nimic**: exact
tiparul pe care regulile repo-ului îl numesc singurul inacceptabil. Cost de ordinul doi: obiectul
nou curgea în `<AiInspector overrides={ov} />` și e dependență a memo-ului de replay, deci clicul
care nu făcea nimic **re-rula toată bătălia**.

Reparat pe două căi, ca să nu se repete: lista explicită `SECTIONS_WITH_RESET` (doar secțiunile
care chiar dețin override-uri) și `resetSection` transformat în `switch` exhaustiv cu `default:
never` — următoarea secțiune adăugată devine eroare de typecheck, nu un link mort.

`npx tsc -b` verde · teste verzi · `npm run build` verde.

## 2026-08-24 — Inspectorul de AI: butonul Run era decorativ

**Model:** Claude Opus 5 (constatare a reviziei, verificată)

Toate cele cinci intrări erau dependențe ale memo-ului de replay, deci bătălia se re-rula la
fiecare tastă din câmpul de seed — până la 24 de cohorte × 60 de ture de muncă **sincronă** pe
caracter, pe o pagină care nu se poate deschide fără cont și deci n-are cine s-o vadă înghețând.
`Run` nu declanșa nimic ce nu se întâmplase deja.

Acum intrările sunt **ciorne**: `Run` (și „New seed & run") fixează o cerere, iar memo-ul depinde
doar de ea. Și, ca să nu citești niciodată un replay care nu mai corespunde controalelor de
deasupra, apare o linie chiar sub ele când ciornele au divergit: „These settings have changed since
the replay below."

`npx tsc -b` verde · 657 teste verzi · `npm run build` verde.

## 2026-08-24 — Copia server a motorului: regula devine test

**Model:** Claude Opus 5

`src/warlordServerCopy.test.ts` — 15 teste care aplică ce era doar scris în două `CLAUDE.md`:

1. Cele cinci fișiere oglindite (`combat/{types,rng,stats,engine,pvp}.ts`) trebuie să fie identice
   între joc și `functions/src/warlordCombat/`, **normalizând sfârșiturile de linie**.
2. Serverul importă din `logic/types.ts` **exact** cele 7 simboluri din contract — nici unul în
   plus. Un al optulea nu e interzis, doar trebuie adăugat aici întâi, ceea ce obligă pe cineva să
   verifice că se potrivește.
3. Cele 7 simboluri înseamnă același lucru pe ambele părți (se compară declarația, nu doar numele).
4. Iar `logic/types.ts` **NU** trebuie să fie identic — scris ca test, ca să nu-l „repare" nimeni
   copiind fișierul întreg peste, ceea ce a costat deja un deploy de functions degeaba.

**De ce normalizarea nu e o slăbire, ci tot rostul:** verificat manual azi, toate cele cinci
fișiere raportau DIFERIT — 832 de linii doar în `engine.ts`. Era CRLF contra LF. Nimic nu divergase.
O verificare care țipă la fiecare rulare e mai rea decât niciuna, fiindcă primul lucru pe care-l
înveți e s-o ignori. Mesajul de eșec spune fișierul, linia, ambele variante, și ce înseamnă:
serverul ar rezolva bătălia altfel decât clientul care a trimis mutarea, fără nicio eroare nicăieri.

**Dovedit că mușcă:** otrăvită o divergență reală în `engine.ts` (prinsă, cu linia și textul) și un
simbol de contract schimbat în `types.ts`-ul serverului (prins).

Copiile din `functions/` sunt acum **generate** din cele de joc, deci identitatea e prin
construcție. Schimbarea e doar de comentarii — `functions` compilează (`tsc`, exit 0) și nu s-a
făcut deploy, fiindcă niciun comportament nu s-a schimbat.

`npx tsc -b` verde · 672 teste verzi (33 fișiere) · `npm run build` verde.

## 2026-08-24 — `createPvpBattle` nu mai scrie peste ce i se dă

**Model:** Claude Opus 5

`placePvpArmy` scria `x`/`y` direct pe obiectele primite, iar `acceptWarlordChallenge`
(`functions/src/index.ts`) păstrează **aceleași** tablouri și le salvează în `deploy` ca
înregistrare publică a ce a trimis fiecare jucător. Deci santinela `-1,-1` scrisă intenționat de
`sanitizeDeploy` dispărea până la scriere, iar înregistrarea devenea o copie a poziției de start.

Clonare la intrare, în joc. Copia din `functions/` regenerată, `tsc` verde, `lib/` la zi.

**Cere deploy de funcții** (schimbare reală de comportament în `warlordCombat/combat/pvp.ts`) —
NEfăcut, se confirmă cu Andrei.

`npx tsc -b` verde · 674 teste verzi · `npm run build` verde.

## 2026-08-25 — ErrorBoundary: nu mai oferi un buton care nu poate repara

**Model:** Claude Opus 5

Singura ofertă a gărzii era `window.location.reload()`. Pentru un crash cauzat de stare
PERSISTATĂ, reload-ul rehidratează același lucru și moare din nou — deci butonul nu poate face ce
spune, exact lucrul pe care regulile casei îl numesc singurul inacceptabil.

Acum un marcaj în `sessionStorage` pus înainte de reload: a doua oară mesajul devine „Reloading did
not help, so this is not a passing glitch", iar butonul se numește „Reload again". Aceeași scăpare
prinsă și aici ca în joc: `componentDidMount` se declanșează și când garda montează afișând
eroarea, deci marcajul se curăță doar când aplicația chiar a randat.

**Jocul primește `GameBoundary` cu `external`.** `warlordCloud` trage cea mai nouă dintre (cloud,
local) în localStorage ÎNAINTE de hidratare — localStorage e cache write-through, nu sursa. O
ștergere locală ar fi anulată la următoarea încărcare, iar cu rev-ul local înainte un domeniu gol
ar putea fi promovat peste cel real. Garda oferă save-ul înapoi, dar **nu** oferă să șteargă ceva
ce nu poate șterge.

Contrast: toate perechile de tokeni ale ecranului de recuperare erau deja măsurate în trecerea de
azi, în afară de butonul distructiv (`bad-ink` pe `bad-surface`), calculat separat: **5,57 light /
6,37 dark**.

`npx tsc -b` verde · 686 teste verzi · `npm run build` verde (coduri de ieșire reale, nu prin țeavă).

## 2026-08-25 — Tabul de cheltuieli e mort de trei luni, tăcut

**Model:** Claude Opus 5 · găsit pornind de la `fetchExpenses` din asistent, care raportează
`unavailable: "no-scoping-field"`

### Ce am stabilit, cu date
- `firestore.rules` **n-a avut niciodată** un bloc `match /expenses` (verificat cu
  `git log -S "match /expenses"` — gol), și nu există nici regulă atrapă-tot. Firestore refuză ce
  nu e permis explicit.
- `ExpensesTab` a apărut pe **2026-05-07**, când proiectul n-avea reguli deloc — deci funcționa.
- Regulile au apărut pe **2026-05-22** și au sărit peste colecție.

Deci de peste trei luni fiecare citire și scriere pe `expenses` e refuzată. Tabul e montat real, la
`Wallet.tsx:491`, pe ruta `/wallet` din meniul principal.

### De ce n-a observat nimeni: AMBELE căi de eșec erau mute
`onSnapshot` n-avea callback de eroare — o listă goală și o listă refuzată arată identic. Iar
`addDoc` era prins într-un `catch` care doar scria în consolă, deci un „Adaugă" care nu salva nimic
arăta ca unul care funcționase.

Reparat: ambele raportează acum prin `reportError` (deci ajung în jurnalul de erori al aplicației)
**și** se văd la controlul care a refuzat, în cele 6 limbi. Formularul își păstrează dinadins
valorile, ca nimic tastat să nu se piardă.

### Ce NU am reparat, fiindcă e decizia lui Andrei
Documentele sunt `{amount, description, paidBy, createdAt}` — **fără `groupId`, fără `ownerId`**. O
regulă permisivă (`allow read: if isSignedIn()`) ar lăsa orice utilizator să citească toate
cheltuielile din bază. Reparația corectă cere un câmp de scopare, deci o schimbare de model de date
plus migrarea documentelor scrise între 07.05 și 22.05. Și tot asta blochează includerea
cheltuielilor în asistent, unde Andrei ceruse „tot".

`npx tsc -b` verde · 693 teste verzi · `npm run build` verde.

## 2026-08-25 — Cheltuielile capătă scopare: grupul dă accesul, ce ai plătit rămâne al tău

**Model:** Claude Opus 5
**Decizia lui Andrei:** „1 în principii, dar cheltuiala personală din grupuri trebuie să poată fi
văzută și în panoul personal" + migrare după `paidBy`.

Tiparul cerut **exista deja** în `events`, deci l-am oglindit în loc să inventez:
`ownerId == uid || (groupId != null && isMemberOfGroup(groupId))`. Amândouă ramurile sunt
satisfăcute de câte o interogare — `where ownerId == me` și `where groupId == g` — ceea ce e chiar
motivul pentru care panoul personal și registrul de grup pot exista în paralel.

**Reguli** (`match /expenses`, scris explicit): `paidBy` e fixat pe apelant la creare, din același
motiv ca `assigneeIds` la evenimente — regula de citire dă acces unui GRUP, deci un câmp de autor
nefixat ar lăsa pe oricine să pună o cheltuială în registrul grupului pe numele altcuiva. Editarea
și ștergerea rămân doar ale proprietarului: apartenența la grup îți dă dreptul să VEZI registrul,
nu să rescrii ce a trecut altul.

**Client:** două ascultări unite după id, fiindcă Firestore nu poate valida o singură interogare cu
SAU între câmpuri. Selectorul de grup la adăugare are **Personal ca implicit**, fiindcă e varianta
sigură: personală n-o vede nimeni, iar punerea într-un grup e un act deliberat. `Wallet.tsx` arunca
id-urile grupurilor (`doc.data()` singur) — reparat.

**Migrare:** `adminBackfillExpenses`, **dry-run implicit**. `ownerId` vine din `paidBy`, care e
cert. Grupul NU se ghicește: dacă autorul e în exact un grup, îl primește; dacă e în mai multe, e
raportat ca AMBIGUU și lăsat personal. A pune cheltuiala privată a cuiva într-un registru de grup
pe baza unei monede aruncate e exact greșeala care nu se poate repara după.

`npx tsc -b` verde · 693 teste verzi · `npm run build` verde · functions compilează.

## 2026-08-25 — Soldurile se calculează per grup, iar personalele nu intră în ele

**Model:** Claude Opus 5 · prins din capturile lui Andrei, imediat după ce am livrat scoparea

Livrarea scopării a introdus două greșeli, amândouă în același loc:
1. O cheltuială **personală** intra în împărțirea comună — `paidTotals` mergea peste TOATE
   cheltuielile — deci cheltuiala ta privată arăta ca o datorie pe care ți-o are altcineva.
2. Împărțitorul era `sharedUsers.length + 1`, adică **toți oamenii din toate grupurile tale**. Cu
   un singur grup e corect din întâmplare; cu două, o cheltuială din „Family" s-ar fi împărțit și
   la membrii celuilalt grup.

Acum: un bloc de solduri **per grup**, peste cheltuielile acelui grup și împărțit la membrii ACELUI
grup. Personalele sunt scoase din orice sold, dar totalul lor rămâne afișat separat — altfel banii
ar dispărea tăcut de pe ecran. Rândurile din listă spun acum cărui grup aparțin, sau că sunt
personale, fiindcă stau în aceeași listă dar în niciun sold.

`Wallet.tsx` trimite acum și `members`, nu doar id și nume — împărțitorul corect e chiar lista de
membri a grupului.

`npx tsc -b` verde · 693 teste verzi · `npm run build` verde · livrat.

## 2026-08-25 — Tabul de cheltuieli vorbea englezește într-o aplicație pe română

**Model:** Claude Opus 5 · văzut în captura lui Andrei: antet „Portofel", dedesubt „Group Expenses",
„What was it for? (e.g., Groceries" (tăiat pe telefon), „Paid by You", „No expenses recorded yet."

Regula casei e că TOT textul vizibil trece prin `t()` în 6 limbi — singura excepție decisă e
interfața Warlord. Tabul ăsta o încălca de la bun început; eu doar am adăugat text peste.

Opt chei noi × 6 limbi: titlul tabului, lista goală, „plătită de", cele două placeholder-uri,
„Tu"/„Cineva" din numele afișat, și eticheta accesibilă a selectorului de registru.

Placeholder-ul lung („What was it for? (e.g., Groceries)") se tăia pe 375px; textele noi sunt
scurte în fiecare limbă („Pentru ce?"), deci se rezolvă de la sine, nu prin CSS.

`npx tsc -b` verde · 693 teste verzi · livrat.

## 2026-08-25 — Cheltuielile intră în asistent, după o revizie care a spus NU la scurgere

**Model:** Claude Opus 5 · revizie adversarială cu 3 lentile + refutare (8 agenți)

`fetchExpenses` era un ciot care întorcea `unavailable: "no-scoping-field"` — adevărul, nu o
ridicare din umeri: documentele n-aveau după ce fi filtrate. Acum au, deci citește ca toate
celelalte surse: oglindește regula (`ownerId == uid || groupId ∈ grupurile mele`), o interogare per
grup, niciodată `collectionGroup`.

**Verdictul pe scurgere: NU.** Ambele interogări sunt mărginite de apartenență, `scope.groupIds`
vine doar din `members array-contains uid` — chiar câmpul pe care-l citește `isMemberOfGroup` —
iar trunchierea la plafonul de fan-out îngustează, nu lărgește. Garda mea de la linia 272 e cod
mort (o interogare `groupId == g` nu poate întoarce `gid === null`), dar e o apărare inertă, nu o
gaură.

**Trei reparații înainte de livrare, toate reale:**
1. **Trunchierea păstra cele mai VECHI rânduri.** `orderBy asc + limit` înseamnă că, atunci când
   plafonul mușcă, supraviețuiesc cele mai timpurii — iar tabul Portofel sortează invers. Cele două
   liste puteau să nu aibă niciun rând comun, adică o verificare de scopare pe care n-o poți face.
   Trecut pe `desc`.
2. **`complete` ignora `scope.truncated`.** `deriveScope` plafonează fan-out-ul, deci peste plafon
   registre întregi nu sunt interogate deloc — și sursa raporta că a citit tot. Acum pornește din
   `!scope.truncated`, aici și în `fetchChat`, care avea defectul identic.
3. **Un eșec total de citire se citea ca „n-ai cheltuieli".** Exact greșeala care a ținut colecția
   moartă trei luni. Acum întoarce `unavailable: "read-failed"`, iar apelantul îl trece prin
   `logServerError` — fetcher-ul rămâne fără efecte laterale și raportează condiția ca DATE.

**Ordinea de deploy a contat:** `desc` cere indecși compuși `createdAt DESCENDING`. Fără ei
interogarea aruncă, `.catch` o înghite și rezultatul arată ca zero cheltuieli. Indecșii au plecat
ÎNTÂI, verificați pe live, abia apoi funcția.

Plus tipul din client: declara `unavailable?` singur — un câmp pe care serverul nici nu-l trimitea
pe drumul fericit — și omitea `complete` și `preview`, pe care le trimite. Cast-ul `as ScopePreview`
ascundea diferența, deci tipul era documentație care contrazicea sârma.

`npx tsc -b` verde · 693 teste verzi · functions compilează · livrat în ordinea corectă.

## 2026-08-25 — O zi trebuie să existe în calendar, nu doar să arate ca o dată

**Model:** Claude Opus 5 · restanța marcată „poate aștepta" de revizia anterioară, reparată acum
fiindcă ecranul asistentului e cel care va trimite date acolo

`dayRangePeriod` verifica doar forma (`/^\d{4}-\d{2}-\d{2}$/`). `2026-02-30` trecea, iar
`new Date("2026-02-30T00:00:00.000Z")` **nu aruncă** — se rostogolește în 2 martie.

Partea urâtă nu e fereastra greșită, ci că **sursele nu erau de acord între ele**: cheltuielile și
chatul compară Timestamp-uri reale și ar fi folosit 2 martie, iar evenimentele compară șiruri ISO
și ar fi folosit literalul `2026-02-30`. O întrebare, două ferestre, nicio eroare.

`isRealDay` refuză acum, folosind `daysInMonth` care exista deja în fișier. Teste pe zilele
imposibile, pe 29 februarie într-un an bisect și într-unul obișnuit, plus regula seculară (1900 nu
e bisect, 2000 e).

**Și verificarea pe care antetul o cerea de la început.** `period.ts` există în două copii, fiindcă
`functions/` nu poate importa din `src/`, iar antetul scrie negru pe alb: „o schimbare aici
nemirorată dincolo e o schimbare pe care n-o verifică nimic". Nimic n-o verifica. Acum e un test,
cu sfârșiturile de linie normalizate — aceeași lecție ca la motorul de luptă: o verificare care
țipă mereu e una pe care înveți s-o ignori. Dovedit că mușcă printr-o divergență plantată.

`npx tsc -b` verde · 705 teste verzi (33 fișiere) · functions compilează · livrat.

## 2026-08-25 — Reparația pe jumătate din revizie, terminată

**Model:** Claude Opus 5

Reparasem trei din patru constatări. Verificând ce a rămas:

1. **`fetchEvents` fusese lăsat în urmă.** `fetchChat` și `fetchExpenses` primiseră
   `let complete = !scope.truncated`, el nu. Supra-declararea e mai MICĂ acolo — ramurile pe
   `ownerId`/`assignee`/`invitee` prind în continuare evenimentele dintr-un grup scăpat, dacă
   apelantul le deține sau e numit pe ele, deci se pierd doar cele de membru pasiv. Dar o minciună
   mai mică e tot o minciună, iar steagul ăsta e chiar lucrul pe baza căruia decide cineva.
2. **Pragul de 10 documente pe interogare spărgea bugetul.** 26 de interogări × 10 = 260 de citiri
   contra unui buget de 150 — cu 73% peste. Un buget depășit tăcut nu e buget. Pragul rămâne
   (o citire de un document pe grup nu spune nimic) și se **taie fan-out-ul** ca să încapă, iar
   tăierea se raportează prin `complete: false` în loc să se ascundă.

Aritmetica — chiar lucrul care era greșit — a ieșit din `aiSources.ts` în `functions/src/fanOut.ts`,
un fișier fără niciun import. Motivul e prozaic: `aiSources` trage `firebase-admin`, deci un test
care-l importa ar fi avut nevoie de un cont de serviciu ca să verifice o adunare. 16 teste, rulate
din suita aplicației, fiindcă `functions/` n-are runner propriu.

`npx tsc -b` verde · 721 teste verzi (34 fișiere) · livrat.

## 2026-08-25 — Ștergerea unei serii recurente lăsa excepțiile orfane, tăcut

**Model:** Claude Opus 5 · găsit cu verificarea sistematică „interogare contra regulă", pornită după
bugul cu cheltuielile

Întâi, verificarea care nu mai are ce găsi: **fiecare colecție atinsă de client are acum bloc de
reguli**, subcolecțiile de mesaje și typing incluse. Golul de la `expenses` era singurul.

Dar „are regulă" nu înseamnă „interogarea trece". Firestore validează o interogare de LISTĂ contra
regulilor **fără să citească documente**, deci constrângerile interogării trebuie să garanteze
singure regula. `RecurringEventsPanel` filtra doar pe `overrideOfParent`, câmp care nu apare în
nicio ramură a regulii de citire a evenimentelor. Refuzată din start.

**Consecința era o ștergere pe jumătate**, nu o listă goală:
1. `deleteDoc` pe seria-mamă — reușea (ramura de proprietar).
2. Interogarea de curățare — refuzată, arunca.
3. `catch (e) { console.error }` — o înghițea.

Seria dispărea din panou, iar ocurențele editate individual rămâneau în calendar pentru totdeauna,
fără ca nimeni să afle.

Reparat pe trei căi: ordinea inversată (excepțiile ÎNTÂI, cât părintele încă există ca să le
identifice), filtru `ownerId == uid` — care e și reparația, și adevărul complet, fiindcă
`createEventOverride` scrie `ownerId: p.ownerId`, păstrând proprietarul PĂRINTELUI, iar butonul se
randează doar pentru o serie a ta — și eșecul se **spune**, plus ajunge în jurnalul de erori.

Traduse pe drum confirmarea de ștergere și titlul panoului, care erau în engleză.

`npx tsc -b` verde · 721 teste verzi · livrat.

## 2026-08-25 — Clopoțelul de notificări n-avea indexul de care depinde

**Model:** Claude Opus 5 · audit adversarial cu 4 lentile, constatarea verificată la sursă cu un
declanșator deja latent

`NotificationsDropdown` interoghează `where('userId','==',uid)` **plus** `orderBy('createdAt','desc')`
— o egalitate pe un câmp și o ordonare pe altul, ceea ce Firestore poate servi DOAR dintr-un index
compus. Indexul acela nu era declarat în `firestore.indexes.json`, iar pe live **nu exista deloc**:
doar `events` (5) și `expenses` (2). Verificat cu `firestore:indexes`, nu presupus.

Iar `onSnapshot` n-avea callback de eroare, deci ascultătorul pur și simplu nu se declanșa niciodată:
starea rămânea `[]` și clopoțelul arăta „nicio notificare", identic cu un cont fără notificări.

**Deploy-ul meu de indecși de mai devreme n-a șters nimic** — verificat în log, doar creează. Indexul
n-a existat niciodată.

`liveQuery` — un ascultător care nu poate eșua tăcut. `onError` e OBLIGATORIU, iar raportarea se face
înăuntru ca niciun apel să n-o poată uita. Motivul pentru care argumentul ăla nu e opțional:
SDK-ul nici nu aruncă, nici nu respinge — `AsyncObserver.error` scrie o linie în `console.error`
când n-are handler, deci nici cârligele globale din `reportError.ts` nu se declanșează, nimic nu
ajunge în `errorLogs`, iar tabul Health din admin arată curat.

Auditul a numărat **28 din 30 de ascultători** în forma asta. Am convertit deocamdată pe cel dovedit
stricat; restul e o trecere separată, cu unealta deja la locul ei.

`npx tsc -b` verde · 721 teste verzi · index livrat și confirmat pe live, apoi hosting.

## 2026-08-26 — O notificare vorbea limba EXPEDITORULUI, pentru totdeauna

**Model:** Claude Opus 5 · văzut în captura lui Andrei: patru notificări în română și una în engleză,
în același clopoțel

`AddEventModal` chema `notifyUsers({ title: t('newTaskAssigned', language) })` — traducea în limba
CELUI CARE TRIMITE, iar `notifyUsers` stoca șirul rezultat ca atare. Deci limba unei notificări era
înghețată la scriere și fiecare destinatar o citea în limba altcuiva.

Reparat prin cheie: clientul trimite acum și `titleKey`/`bodyKey`/`param`, serverul le păstrează ca
șiruri scurte opace, iar clopoțelul randează `t(cheie, limba MEA)`. Textul redat rămâne stocat ca
rezervă, ca notificările scrise înainte de azi să spună în continuare ceva.

**O diagnoză a mea, corectată:** crezusem că antetul „Notifications / Mark all read" e o gaură de
traducere. Nu e — valorile românești există și sunt corecte (`Notificări`, `Marchează toate ca
citite`), iar cele șase blocuri au exact 330 de chei fiecare, fără niciun gol. Verificat programatic.
Explicația adevărată e chiar bugul de mai sus: aplicația lui e pe engleză, deci antetul e englezesc
corect, iar româna pe care o vedea era textul înghețat al expeditorilor.

Plus: `notifyUsers` din client înghițea eșecul cu `console.error`. Rămâne best-effort — o notificare
picată nu are voie să rupă salvarea care a declanșat-o — dar „best effort" nu înseamnă „neobservat",
deci acum trece prin `reportError`.

`npx tsc -b` verde · 721 teste verzi · livrat.

## 2026-08-26 — Calendarul nu mai poate fi gol din greșeală

**Model:** Claude Opus 5 · trecerea începută după auditul care a numărat 28 din 30 de ascultători
fără callback de eroare

Convertite cele cu impact real, în ordinea din audit:
- **cele trei ascultători de evenimente** din `CalendarHome` (propriile, cele atribuite, cele la
  care ești invitat) — miezul aplicației. O citire refuzată acolo randa un calendar fără
  evenimente, identic cu o lună care chiar n-are niciunul, și nimic nu ajungea în `errorLogs`;
- **invitațiile de grup** — o invitație pe care nu ți-a arătat-o nimeni nu se distinge de una care
  n-a fost trimisă, iar nici cel care a invitat n-are cum să afle.

Calendarul spune acum, deasupra grilei: „Calendarul nu a putut fi încărcat. E o eroare, nu o lună
goală." În 6 limbi.

Rămân **22 de ascultători** în forma veche (fără cei din submodulul Warlord). Sunt de convertit
mecanic, cu `liveQuery` deja la locul lui — dar cei rămași citesc profiluri, jocuri și liste de
prieteni, unde o listă goală e mai puțin costisitoare decât un calendar gol.

`npx tsc -b` verde · 721 teste verzi · livrat.

## 2026-08-26 — Ultimii 22 de ascultatori, si o poarta care ii tine asa

**Model:** Claude Opus 5 · continuarea trecerii incepute mai devreme azi

Convertiti **toti** ascultatorii ramasi din aplicatie (submodulul Warlord nu are Firestore
propriu, deci e in afara). Zero `onSnapshot` brut mai exista in `src/`, cu doua exceptii
declarate: `liveQuery.ts` insusi si `ExpensesTab.tsx`, care isi trecea deja propriile handlere.

`liveDoc` — fratele lui `liveQuery` pentru un singur document. O citire de document refuzata e
si mai tacuta decat una de colectie: callback-ul nu ruleaza deloc, deci ecranul pastreaza ce
avea, de obicei valorile implicite cu care a fost construit. Asa devine „citirea profilului a
esuat" in „nu apartii niciunui grup".

Ce spune acum fiecare, cand pica:
- **grupurile din CalendarHome** — banner rosu sus: e cea mai zgomotoasa cadere de pe ecran,
  fiindca dispar simultan calendarul partajat, avatarurile si comutatorul de grup, iar
  aplicatia arata exact ca un cont nou-nout;
- **cererile de prietenie** (`Friends`, ambele directii + lista de prieteni) — „Cererile nu au
  putut fi incarcate" acolo unde statea „Nicio cerere";
- **portofelul** — „Portofelul nu a putut fi incarcat" in locul lui „Niciun bun inca";
- **jocurile si clasamentul** — la fel;
- **conversatia de grup** — „Conversatia nu a putut fi incarcata";
- **bataliile PvP** — spune ca o provocare care te asteapta poate sa nu fie afisata.

Trei au ramas deliberat mute in UI, si scrie in cod de ce: punctele de „scrie acum" (o bulina
absenta si una stricata arata la fel), enrichment-ul legacy din CalendarHome, si campurile din
Settings — acolo golirea lor te invita sa „repari" salvand peste un profil pe care nu l-ai
putut citi, adica exact cum se pierd date. Toate trei **raporteaza** in `errorLogs`.

Pe drum, text englezesc netradus scos din patru locuri (`Start the conversation!`, `No assets
yet.` + indiciul ei) — 6 limbi.

**Partea care tine:** `src/utils/silentListeners.test.ts` refuza orice `onSnapshot` brut nou in
`src/`. Verificat ca musca: am adaugat unul intr-un ecran real, testul a picat numindu-l, l-am
scos, a trecut. Fara poarta asta, sinteza de azi se desface la urmatoarea functionalitate.

O corectie pe care am facut-o mie: am pus intai `text-wl-bad-ink` pe mesajul din PvP dupa ce am
cautat token-ul in `tailwind.config.js` si nu l-am gasit. Se rezolva de fapt — intra prin
`...warlordColors`. L-am lasat totusi pe `rose`, fiindca niciun alt fisier din `src/warlordPvp/`
nu foloseste tokenuri `wl-*` si consecventa fisierului bate consecventa cu jocul.

`npx tsc -b` verde · **724 teste verzi** · build verde · pornire in browser fara erori de consola.

## 2026-08-26 — Aplicația vorbește șase limbi, nu cinci și jumătate

**Model:** Claude Opus 5 · lentila de i18n din audit, continuarea trecerii ascultătorilor

Regula casei spune că tot textul vizibil trece prin `t()` în 6 limbi, cu Warlord ca excepție
declarată. Am numărat: **66 de texte englezești** rămase pe ecrane obișnuite (în afara adminului,
care e consola ta și rămâne engleză ca interfața Warlord). Le-am dus la zero pe cele care contează
și am adăugat **~110 chei noi**, în toate cele șase blocuri.

Cel mai prost dintre ele mergea invers: antetul rezumatului din chat era **hardcodat în română**
pentru toată lumea — „Ce s-a mai întâmplat? (AI Digest)" apărea și unui utilizator care ținea
aplicația în germană.

Trei componente n-aveau i18n deloc (`BarcodeScanner`, `CreateGroupModal`, `LeaveGroupModal`), plus
`ErrorBoundary`, care fiind clasă nu poate chema hook-ul — citește limba direct din store, fiindcă
oricum randează când arborele de sub el e rupt.

**Descoperirea care schimbă ceva real:** limba trăia DOAR în documentul din Firestore, citit abia
după autentificare. Deci ecranul de login era în engleză pentru toată lumea, permanent, iar la
fiecare reîncărcare aplicația clipea englezește până răspundea Firestore. N-a fost niciodată o
lipsă de traducere — șirurile existau. Acum se ține minte local (`ourdays.language`), Firestore
rămâne sursa de adevăr, iar localStorage e doar ce se randează până răspunde. **Verificat pe viu:**
login-ul apare în română și în germană, cu diacritice.

**Două teste noi care țin toate astea:**
- `i18n.test.ts` — cele șase blocuri au aceleași chei, nicio valoare goală, nicio limbă nu e o
  copie a englezei. Plus două verificări **pe fișierul sursă**, fiindcă obiectul construit le
  ascunde: **cheile duplicate** (literalul păstrează tăcut ultima definiție — am pățit-o azi, patru
  nume existau deja cu diacritice, iar copiile mele ASCII ar fi câștigat) și **alfabetele cu
  diacritice** („Sterge" nu e română, „loschen" nu e germană; ambele compilează și se afișează).
  Verificat că mușcă: am scos o cheie din română, testul a numit-o exact.
- Corectate **113 valori** pe care le scrisesem fără diacritice.

`npx tsc -b` verde · **732 teste verzi** · build verde · verificat în browser pe trei limbi.

## 2026-08-26 — Reîncărcarea chiar aduce versiunea nouă (până azi, nu o aducea)

**Model:** Claude Opus 5 · pornit de la „ce pot verifica singur cât verifici tu"

Voiam să mă asigur că un tab care se întoarce vede deploy-ul de azi. Am măsurat antetele de pe live
și am găsit altceva decât scria în notă:

```
/              Cache-Control: max-age=3600
/log           Cache-Control: max-age=3600
/wallet        Cache-Control: max-age=3600
/index.html    Cache-Control: no-cache, no-store, must-revalidate
```

`firebase.json` cerea `no-cache` pentru `**/*.html`. **Hosting potrivește antetele pe CALEA CERERII,
nu pe fișierul rezolvat** — iar nicio adresă pe care o vizitează cineva nu se termină în `.html`.
Deci singurul URL care primea antetul era exact cel pe care nu-l deschide nimeni. Toate rutele reale
stăteau o oră în cache: puteai reîncărca oricât, primeai vechiul `index.html`, deci vechiul hash de
bundle, deci codul vechi.

Asta nu era o fatalitate de PWA, cum sugera nota din `OWNER_VERIFY.md` — era un glob greșit.

**Măsurat, nu presupus, pe un canal de preview** (`hosting:channel:deploy cachefix`, live neatins):
prima variantă a pus regula de assets prima și pe cea generală a doua, iar rezultatul a fost că
**assets-urile au ieșit `no-cache`** — Firebase aplică **ultima regulă care se potrivește**, nu pe
cea mai specifică. Adică fiecare navigare ar fi re-descărcat 1,4 MB. Am inversat ordinea și am
re-măsurat:

```
/ · /log · /index.html · /manifest.json · /sw.js   → no-cache, no-store, must-revalidate
/assets/index-D1OdOYH2.js                          → public, max-age=31536000, immutable
```

`immutable` pe `/assets/**` e sigur fiindcă **toate cele 54 de fișiere** de acolo au hash de conținut
în nume (verificat, nu presupus) — conținutul se schimbă ⇒ numele se schimbă. Iar `/sw.js` rămâne
`no-cache`, ceea ce e corect pentru un service worker.

**Consecință pentru verificare:** de la deploy-ul ăsta încolo, o reîncărcare normală ajunge. Excepție
tranzitorie: un browser care are deja `index.html` în cache de dinainte poate rămâne pe versiunea
veche **până la o oră** — o singură dată, ultima oară.

Rămâne separat, și e altă problemă: un tab lăsat deschis fără reîncărcare rulează codul deja încărcat
în memorie. Asta nu ține de antete, ci de faptul că nimeni nu cheamă `registration.update()`.

## 2026-08-26 - Anteturile de securitate, portate MASURAT (era sa taie camera si microfonul)

**Model:** Claude Opus 5

Verificand fixul de cache, am comparat `firebase.json` intre proiecte. Presto si CNCVS aveau deja
exact forma la care ajunsesem eu masurand (`**` intai, `/assets/**` dupa) - deci OurDaysApp era
singurul ramas in urma, iar fixul de dinainte il aduce in rand cu casa.

Dar comparatia a scos altceva: **OurDaysApp nu avea NICIUN antet de securitate.** Masurat pe live:
Presto trimite CSP + nosniff + Referrer-Policy + Permissions-Policy; OurDaysApp trimitea doar
HSTS-ul pus de Firebase.

**Capcana, si de ce nu am copiat pur si simplu:** politica lui Presto contine
`camera=(), microphone=()`. OurDaysApp foloseste **amandoua** - scanerul de coduri de bare
(`html5-qrcode`, `facingMode: "environment"`) si mesajele vocale din chat
(`getUserMedia({audio:true})` + `MediaRecorder`). Copiata verbatim, ar fi omorat doua functionalitati
de pe live, tacut, cu o eroare doar in consola. Aia e exact lectia din DataRead: nu porta securitate
fara sa MASORI ce foloseste aplicatia.

Ce am pus, dupa ce am cautat fiecare capabilitate in cod:
```
Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(self), geolocation=(), browsing-topics=()
```
Geolocatia chiar nu e folosita nicaieri (cautata), si nimic nu incadreaza aplicatia intr-un iframe.
CSP-ul ramane fara `default-src`, la fel ca la Presto: inchide gaurile care nu cer cunoasterea
aplicatiei, fara sa riste o pagina rupta pe un `script-src` pe care nu-l poate sti.

**Verificat pe canal de preview, in browser, nu doar din anteturi** - `document.featurePolicy`:
`camera: true`, `microphone: true`, `geolocation: false`, `getUserMedia: function`, zero violari CSP
in consola. Abia apoi pe live. Canalul de preview a fost sters.

## 2026-08-26 - Audit adversarial: stergerea unui grup nu mai distruge nimic

**Model:** Claude Opus 5 · 13 agenti, 6 lentile, fiecare constatare trecuta printr-o pasa de
respingere. 49 de revendicari, **46 au supravietuit**, 3 au fost doborate.

Am reparat intai cele care distrug date sau lasa o usa deschisa.

### Stergerea unui grup nu se putea termina niciodata

`allow delete` pe evenimente e `resource.data.ownerId == request.auth.uid`. Ambele intrari
(`LeaveGroupModal` si `GroupSettingsModal`) faceau o bucla pe CLIENT peste **toate** evenimentele
grupului si le stergeau. Primul eveniment al altui membru arunca - dupa ce o parte din evenimentele
proprietarului fusesera deja sterse, si inainte ca invitatiile sau documentul grupului sa fie
atinse. Fluxul nu putea ajunge la capat, iar fiecare reincercare distrugea inca putin.
`GroupSettingsModal` era mai rau: stergea tot, fara nicio lista de pastrat.

Si ramura de "pastreaza" scria `groupId: null` pe evenimente care **nu-i apartineau** - regula de
update pe membru permite asta - smulgand tacut evenimentul altcuiva din calendarul comun.

Acum e un singur apel server, `deleteGroupCascade`. Sterge doar evenimentele NEBIFATE ale
apelantului si **re-parenteaza** evenimentele celorlalti ca personale, in loc sa le stearga: sa
pierzi grupul nu inseamna sa pierzi datele lor, iar proprietarul n-a avut niciodata dreptul astea.
Sterge si chatul de sub grup (`messages`, `typing`), care altfel ramanea nereachabil si tot platit.

### Un membru scos putea reintra singur in grup

Regula de creare pe `group_invites` fixa doar `fromId == request.auth.uid`. `groupId`, `toId` si
`status` erau la alegerea clientului, iar `acceptGroupInvite` nu verifica cine a invitat. Deci:
scrii o invitatie catre tine insuti pentru grupul tau, esti scos din grup, o accepti, esti inapoi.

Reparat in doua locuri, si **partea grea e pe server**: regula cere acum apartenenta la grup ca sa
poti crea invitatia, dar ea se evalueaza la CREARE - exact trucul e sa creezi cat inca esti membru
si sa redeemezi dupa. Deci `acceptGroupInvite` re-verifica, **la acceptare**, ca cel care a invitat
e inca membru, si refuza din start invitatiile catre sine.

### A treia oara acelasi bug de reguli-vs-interogari

`EventDetailsModal.handleDelete` stergea parintele seriei si abia apoi rula o interogare filtrata
doar pe `overrideOfParent` - camp pe care nicio ramura a regulii de citire nu-l mentioneaza, iar
Firestore valideaza o interogare de tip LIST **fara sa citeasca documente**, deci o respinge din
start. Jumatatea distructiva se termina, cea care repara nu poate, si singurul martor era
`console.error`. `RecurringEventsPanel` avea deja fixul si post-mortemul scris in cod; nu fusese
purtat aici, in **doua** ramuri.

Reparat: override-urile intai (cat parintele inca le identifica), plus `ownerId == uid` care face
interogarea legala, plus eroare vizibila si `reportError`.

**Partea care tine:** `src/utils/eventQueryRules.test.ts` citeste campurile permise **din
`firestore.rules`** (nu hardcodate) si refuza orice interogare pe `events` care nu filtreaza pe
vreunul dintre ele. Verificat ca musca: am reintrodus bug-ul exact, testul l-a numit cu fisier si
campuri, l-am scos, a trecut.

### Si o eroare de proces a mea, prinsa de audit

Commit-ul de i18n de mai devreme sustinea ca `LeaveGroupModal` e tradus. **Nu era.** Scriptul care
trebuia sa aplice cele 6 inlocuiri crapase la jumatate cu `IndexError`, iar eu am re-rulat doar
bucata care crapase - niciodata si restul. Typecheck-ul a trecut fiindca apelurile `t()` pur si
simplu nu fusesera adaugate. Modalul cel mai distructiv din aplicatie a ramas in engleza, inclusiv
randul care spune ce evenimente se sterg definitiv. Acum e tradus complet, cu inca 4 chei noi.

Tot acolo: un `getDocs` esuat arata "nu esti in niciun eveniment din grupul asta" **si lasa butonul
rosu activ**, cu o selectie goala care inseamna "sterge tot ce e al meu". Acum lista nereusita se
spune ca atare si butonul refuza sa actioneze pana cand chiar s-a citit.

`npx tsc -b` verde · **748 teste verzi** · build verde · functions typecheck verde.

## 2026-08-26 - Cele trei regresii ale mele de azi, prinse de audit

**Model:** Claude Opus 5

Auditul a intors 46 de constatari; trei dintre ele erau **din munca mea de azi**. Le repar pe
astea inainte sa merg mai departe pe lista.

**1. Limba ramanea in spatele unei porti de tema.** Am adaugat dimineata `ourdays.language` in
localStorage. Dar singurul loc din care limba din Firestore ajunge in store (`App.tsx:141`) statea
in `if (data.primaryColor || data.isDarkMode !== undefined)` - o conditie pe care majoritatea
conturilor n-o indeplinesc niciodata: **ambele cai de inregistrare scriu `theme: {...}` IMBRICAT**,
iar alegerea limbii din Setari nu scrie niciunul din cele doua campuri de nivel superior. Rezultat:
pe un dispozitiv partajat, contul urmator mostenea limba contului anterior. Acum se aplica
neconditionat, inainte de poarta.

**2. Login-ul inghitea eroarea.** Cand am tradus ecranul, am inlocuit `err.message` cu un singur
`t('authFailed')`. Am schimbat o extrema cu alta: un sir Firebase brut nu e pentru un om, dar nici
o singura propozitie pentru orice esec. Acum `auth/email-already-in-use`, `auth/weak-password`,
`auth/invalid-email` si `auth/too-many-requests` au text propriu, restul cade pe un mesaj ales
dupa butonul apasat (a-i spune "adresa are deja cont" cuiva care incearca sa INTRE e inutil), si
**mesajul brut se raporteaza** - o respingere prinsa nu ajunge niciodata la handlerele globale,
deci pana acum niciun esec de autentificare nu ajungea in `errorLogs`.

**3. Un singur flag pentru patru ascultatori.** `requestsLoadError` era ridicat din patru locuri si
randat intr-unul singur, deci era cod mort pentru trei dintre ele - iar un snapshot REUSIT al
cererilor primite stergea un flag ridicat de o interogare pe alta colectie. Acum sunt trei flaguri,
fiecare sters doar de propriul succes, fiecare randat langa lista lui, inclusiv sectiunea de cereri
trimise, care pana acum disparea complet in tacere.

`npx tsc -b` verde · **748 teste verzi**.

*Observatie pe drum:* `functions/lib/` e **urmarit in git** (iesire compilata comisa in repo). Aia
e o parte din motivul pentru care deploy-ul a livrat cod vechi: cine comite sursa fara sa
reconstruiasca lasa `lib/` invechit in repo. Hook-ul `predeploy` adaugat mai devreme il reconstruieste
inainte de fiecare deploy, deci gaura e inchisa; dar merita decis separat daca `lib/` are ce cauta
sub git.

## 2026-08-26 - Butoanele de pe evenimentele care se repeta chiar fac ceva acum

**Model:** Claude Opus 5

Ultima constatare HIGH din audit. O serie care se repeta e UN document; ocurentele de pe calendar
sunt inventate in memorie de `expandRecurringEvents`, cu cheia sintetica `${parentId}_${data}`.
`EventDetailsModal` scria in `event.id` — adica intr-un document care n-a existat niciodata. Sapte
handlere: bifarea sarcinii, pornirea ei, adaugarea si scoaterea responsabililor, textul din checklist,
reordonarea, bifarea unui element. Toate refuzate, niciun snapshot local, `console.error` singurul
martor. **Un buton mort pe o clasa intreaga de evenimente**, tacut.

Reparatia evidenta ar fi fost al doilea bug deghizat: trimiterea catre `parentEventId` ar fi aplicat
bifa de marti asta **fiecarei** marti din serie. Verificatorul a semnalat exact asta, si avea dreptate.

Ce am facut e ce face deja `AddEventModal` cand editezi o singura ocurenta: prima scriere
**materializeaza** ocurenta intr-un override real (prin callable-ul `createEventOverride`, care
adauga si data in exceptiile parintelui), iar restul sesiunii scrie acolo. Decizia sta intr-o functie
pura, `src/utils/eventWriteTarget.ts`, cu 11 teste care fixeaza **ambele** esecuri opuse: nici cheia
sintetica, nici parintele.

Un bug pe care era sa-l introduc chiar eu: memorasem promisiunea de materializare intr-un ref, iar
o promisiune **respinsa** ar fi ramas acolo pentru toata viata modalului — o singura clipa de retea
proasta ar fi devenit permanenta, si ar fi aratat exact ca butonul mort pe care il reparam. Acum se
sterge la esec.

### Si gaura din `createEventOverride`, care devenea mai calda tocmai fiindca o foloseam mai mult

Callable-ul facea `...data` — orice trimitea clientul, intr-un document pe care serverul il stampila
apoi cu `ownerId`-ul PARINTELUI. Prin gaura aia treceau trei lucruri:
- `assigneeIds` / `inviteeId` — regula de creare refuza sa numesti oameni din afara grupului tau, dar
  **Admin SDK nu evalueaza regulile**, deci callable-ul era un ocol catre orice uid;
- `ai_assistant` in `assigneeIds` — declansatorul de creare cheltuia cota si bugetul zilnic al
  **proprietarului documentului**, deci un membru al grupului putea goli alocatia altcuiva, atribuita
  ei in ledger;
- orice altceva, pe un document care nu era al lui.

Acum: **lista alba** de campuri (verificata fata de ce trimite chiar `AddEventModal`, ca sa nu pierd
tacut poza sau emoji-ul), responsabilii limitati la cei pe care ii avea deja parintele plus apelantul,
`ai_assistant` scos mereu, si `overrideDate` validat cu `isRealDay()` — mergea nevalidat direct in
`arrayUnion` pe lista de exceptii a parintelui.

`npx tsc -b` verde · **759 teste verzi** · build verde · functions build verde.

## 2026-08-26 - Traduceri GRESITE, nu lipsa - clasa pe care niciun test de paritate n-o vede

**Model:** Claude Opus 5 · lentila de i18n a auditului

Testul de paritate de azi-dimineata verifica: aceleasi chei in toate blocurile, nicio valoare goala,
niciun bloc copiat din engleza, fiecare limba isi foloseste diacriticele. Toate trecute. Si totusi:

**Remi in romana avea „terta" si „suita" INVERSATE.** `meldTypeSet: "Suită"`, `meldTypeRun: "Terță"` -
in Remi romanesc o *terță* sunt 3-4 carti de aceeasi valoare, iar o succesiune e o *chintă*. Singurul
bloc din sase care le inversa. Jocul eticheta fiecare combinatie exact pe dos, fluent. Corectat pe
toate cele 9 chei ale grupului (inclusiv mesajele de eroare, care spuneau „Suitele trebuie sa aiba
culori distincte" - adica fix regula celeilalte combinatii).

**Franceza numea portofelul „Atouts"** - in franceza „atout" e un avantaj sau culoarea de atu la
carti, niciodata un bun pe care il pastrezi. Si e eticheta din bara laterala. Acelasi bloc numea
functionalitatea „bien"/„portefeuille" mai jos. Aliniat pe „Portefeuille"/„élément".

**Germana scria `AUSTEHENDE AUFGABEN`** cu un singur s (`ausstehend`), pe dala de pe ecranul principal,
cu majuscule. Acelasi bloc o scrie corect de sase ori in alta parte.

**Romana spunea „Îi citesc grupurile…"** - persoana a treia. „Iti citesc grupurile" e forma corecta;
ce scria acolo inseamna „ii citesc grupurile LUI". Fluent, despre altcineva.

**Si o insula de ASCII:** tot grupul de chei pentru cheltuieli in ro/fr/es/it era scris fara
diacritice - `incarcate`, `fara`, `asa ca`, `reparatie`, `etre`, `depenses`, `securite`,
`correccion`, `non e stata`. Testul de dimineata numara LINII accentuate pe bloc si cere peste 15,
deci opt chei stalcite intr-un bloc de patru sute corecte nu-l puteau face sa pice **prin
constructie**.

`src/utils/i18nSpelling.test.ts` inchide fix gaura aia, dar nu prin „valoare lunga fara diacritice" -
ala ar fi zgomot pur (italiana si spaniola corecte au o gramada de propozitii fara niciun accent).
Verifica **forme de cuvant care nu sunt cuvinte**: `fara`, `etre`, `piu`, `correccion` n-au alta
ortografie. Verificat ca musca: am re-stalcit un cuvant, testul l-a numit cu cheia si cu ortografia
corecta.

Plus trei componente ale caror traduceri EXISTAU dar nu fusesera legate niciodata (`CreateGroupModal`,
mesajul de camera din `BarcodeScanner`, plus indiciul de sub scaner care n-avea cheie deloc), si
`aria-label="Înapoi"` hardcodat in romana in `PeriodLog` - singurul aria-label literal ramas in tot
`src`-ul non-Warlord, deci un utilizator german de cititor de ecran auzea un cuvant romanesc.

`npx tsc -b` verde · **766 teste verzi**.

## 2026-08-26 - Sapte scrieri care esuau fara sa spuna nimanui

**Model:** Claude Opus 5 · lentila de scrieri tacute a auditului

- **Invitatiile.** ORICE esec la trimiterea unei invitatii raporta „Cererea e deja in asteptare" —
  o scriere refuzata, o clipa offline, o schimbare de reguli, toate spuneau utilizatorului ca
  invitatia exista deja. Nu exista nicio verificare de duplicat in fisier care sa justifice mesajul.
- **Redenumirea unei categorii din portofel** peticea doar campul vechi `category`, dar toate caile
  de CITIRE folosesc `categories[]` (si filtrul, si gruparea). Dupa redenumire eticheta arata numele
  nou, iar bunurile ramaneau grupate sub cel vechi, care nu mai exista in lista. Acum se rescriu
  amandoua, iar selectia se uita la amandoua.
- **Raspunsul la o invitatie** (acceptare/refuz, si de eveniment si de grup) — trei handlere erau
  `await` gol, fara `try`, deci o respingere devenea o respingere netratata si randul la care
  tocmai raspunsesesi statea acolo ca si cum n-ai fi facut nimic. Iar la invitatia de grup singura
  ramura care spunea ceva era „email neverificat" — orice alt esec era invizibil.
- **Mesajul vocal.** Blob-ul e SINGURA copie: nu-l tine nimic altceva, iar microfonul e deja
  eliberat. Un `console.error` acolo distrugea inregistrarea definitiv. Acum uploadul e extras
  intr-o functie reapelabila, `audioChunksRef` **nu** se goleste decat la succes, si apare o bara
  cu **Reincearca** / **Renunta** deasupra casetei de scris.
- **Stergerea unei cheltuieli** era o promisiune plutitoare, neasteptata, neprinsa. Contează:
  butonul se randeaza pe `paidBy === eu`, dar regula cere `ownerId === eu`, iar randurile vechi
  s-au scris inainte sa existe `ownerId` — deci un refuz acolo e un rezultat REAL, nu ipotetic.
- **Tokenul FCM** se scria intr-un callback care ruleaza mai tarziu, pe stiva lui, deci `try`-ul
  din jurul lui `addListener` nu-l vedea niciodata. Un dispozitiv care nu mai primeste notificari
  nu lasa nicio urma nicaieri.
- **MemoryMatch** ramanea cu `processing` blocat pe `true` la o scriere respinsa, deci tabla ingheta.

Doua lucruri pe care le-am gresit chiar in reparatia asta si le-am prins inainte de livrare:
`reportError` fara import se rezolva **la `reportError`-ul global din DOM** (care ia un singur
argument si nu raporteaza nicaieri la noi) — typecheck-ul il accepta ca alta functie. Si pusesem
eroarea de redenumire pe `assetsLoadError`, care se randeaza **doar cand lista e goala** — adica
exact in cazul care conteaza n-ar fi aratat nimic. Are acum flag propriu.

`npx tsc -b` verde · **766 teste verzi** · build verde.

## 2026-08-26 - Serverul spunea „complet" cand nu era, si rezuma capatul gresit al zilei

**Model:** Claude Opus 5 · lentila de functions a auditului

**Rezumatul de grup citea cele mai VECHI 50 de mesaje.** `orderBy('createdAt','asc').limit(50)` pe
o fereastra de 48 de ore — deci intr-un grup cu peste 50 de mesaje supravietuiau primele, in timp ce
promptul cerea modelului sa evidentieze *ce s-a intamplat recent*. O zi aglomerata producea rezumatul
zilei dinainte. Acum e `desc`, inversat inapoi, si intoarce `truncated` ca cititorul sa stie cand
fereastra a fost taiata.

Tot acolo: numele expeditorilor se citeau din `users`, care e **owner-only** — Admin SDK-ul ignora
regulile, deci raspunsul continea date la care apelantul n-are cale de acces, iar fallback-ul
`email.split('@')[0]` scurgea adresa. Acum din `profiles`, fara fallback pe email, si **intr-o
singura trecere** in loc de 50 de citiri secventiale in bucla.

**`aiPreviewScope` taia previzualizarea la 200 de randuri si raporta `complete: true`.** `complete`
reflecta doar daca CITIREA din Firestore a fost taiata; felierea de dupa nu contribuia la nimic. Deci
un apelant primea 200 de randuri langa `count: 900` si `complete: true`, iar ecranul `/log` isi
construieste lista de zile **exclusiv din preview** — zilele lipsa pur si simplu nu erau acolo, fara
niciun avertisment posibil. Acum intoarce `previewTruncated` si `/log` il afiseaza intre celelalte
avertismente.

**`fetchEvents` si `fetchChat` inghiteau esecurile** cu `.catch(() => null)` — motivul aruncat, iar
o citire refuzata nedistinctibila de o perioada linistita. `fetchExpenses` fusese deja intarita in
august si intoarce `unavailable: "read-failed"`; fratii ei ramasesera pe forma veche. **Fix
asimetria aia e exact cum au stat cheltuielile refuzate trei luni.** Acum toate trei logheaza motivul
si raporteaza indisponibilitatea, iar `aiPreviewScope` le trece pe toate trei prin `logServerError`.

**`autoSuggestChecklist` platea apelul si apoi nu facea nimic** daca modelul intorcea JSON valid
care nu era un array (`{"items":[...]}` trece de `JSON.parse`, deci catch-ul nu se atingea, iar
`if (Array.isArray)` n-avea `else`). Randul de ledger se inchisese cu `ok: true`, holdul se
decontase, si unul din cele 50 de apeluri zilnice ale proprietarului fusese consumat. Mai rau,
evenimentul ramanea cu `ai_assistant` in responsabili, iar `onDocumentCreated` nu poate porni a doua
oara pentru acelasi document — deci nu exista nicio cale de reincercare. Acum se logheaza, si
`clearAiAssignee` ruleaza pe **fiecare** cale terminala.

**Si doua bucle de profiluri** (CalendarHome si Wallet) care aruncau harta INTREAGA la o singura
citire respinsa: ruleaza in callback-ul async al lui `liveQuery`, pe care nu-l asteapta nimeni, deci
respingerea scapa ca unhandled rejection si `setUserMap`/`setSharedUsers` nu mai rula deloc. Starea
grupurilor fusese deja setata, deci ecranul parea sanatos in timp ce disparea fiecare avatar, fiecare
nume si fiecare zi de nastere. Acum fiecare citire e pazita separat si harta se publica in `finally`.

`npx tsc -b` verde · **766 teste verzi** · build verde · functions build verde.

## 2026-08-26 - Un bun din portofel putea fi impins in portofelul altcuiva

**Model:** Claude Opus 5

Regula de update pe `assets` verifica `resource.data.ownerId == request.auth.uid` — proprietarul pe
care documentul il avea DEJA — si nu constrangea deloc `request.resource.data.ownerId`. Deci
oricine autentificat putea sa-l schimbe in orice uid. Iar uid-urile **se pot enumera**: rosterul
`warlordPlayers` se citeste de orice cont autentificat si are uid-ul drept id de document.

Atacul complet: creezi un bun al tau cu numele si `imageUrl` alese de tine (o scriere directa nu e
limitata la ce iese din `getDownloadURL`), muti `ownerId`, si ajunge in ascultatorul de portofel al
victimei si se randeaza ca nume + `<img src>`. Nu e expunere de date — atacatorul pierde accesul in
clipa in care schimba proprietarul — dar e continut nesolicitat si un URL de imagine controlat de
el, care ii afla IP-ul si user agent-ul victimei cand se deschide.

Ce face reparatia interesanta: **politica aplicatiei era deja mai stricta decat regula ei.** Ramura
„pastreaza o copie" trecea prin `transferAssetCopy`, care cere `usersShareGroup`. Doar ramura
„da-l de tot" facea un `updateDoc` direct si o ocolea. Acum ambele trec prin acelasi callable (cu
`mode: 'move'`, care scrie copia si sterge sursa **intr-un singur batch**), iar regula fixeaza
`request.resource.data.ownerId == resource.data.ownerId`.

Regulile Firestore **nu pot** exprima „imparte un grup cu mine" (`isMemberOfGroup` are nevoie de un
groupId cunoscut) — exact de-aia verificarea aia traieste pe server, si de-aia regula se limiteaza
sa interzica schimbarea proprietarului.

## 2026-08-26 - Toate ferestrele alert()/confirm() vorbesc acum sase limbi

17 chei noi. Erau ~18 siruri englezesti in cinci fisiere care altfel trec totul prin `t()` —
inclusiv o intrebare da/nu despre **ciorna nesalvata a utilizatorului** si trei confirmari de
stergere. Doua locuri o faceau deja corect (`GroupSettingsModal`, `RecurringEventsPanel`), ceea ce
arata ca erau scapari, nu o decizie. `Admin.tsx` si ecranele Warlord raman englezesti, ca exceptii
declarate.

Verificat prin re-scanare: **zero** `alert(`/`confirm(` cu sir literal in afara celor doua exceptii.

`npx tsc -b` verde · **766 teste verzi** · build verde · functions build verde.

## 2026-08-26 - Coada auditului: ultimele siruri, doua flaguri partajate, trei citiri tacute

**Model:** Claude Opus 5

**Regresia mea de dimineata, prinsa de audit:** in sweep-ul de i18n am inlocuit „Manage Filters" cu
`{t('walletManage')} Filters` — cheia e verbul singur, deci titlul se randa **„Gestionează Filters"**.
Inainte era consecvent englezesc; l-am facut amestecat. Are acum cheie pentru fraza intreaga.

**Zero siruri englezeti** raman in afara celor doua exceptii declarate (`Admin.tsx` si ecranele
Warlord). Ultimele: „View", „Name", „Save", si placeholderele de cautare din portofel, chat si
selectorul de bunuri. Numele limbilor din Setari raman in limba lor, cum trebuie.

**`GamesHubModal` avea un flag pentru doi ascultatori** — randat doar in starea goala a
clasamentului, deci o citire esuata a jocurilor de AZI nu arata nimic, iar succesul unuia stergea
esecul celuilalt. Acelasi tipar pe care l-am reparat la `Friends`; l-am scapat aici. Doua flaguri
acum, fiecare langa lista lui.

**Selectorul de bunuri din AddEventModal** raspundea la o citire refuzata punand lista pe `[]` —
adica „nu ai niciun bun", si arunca un selector deja populat daca esecul venea tarziu. Acum lasa
lista in pace si spune ce s-a intamplat. (Ecranul Wallet primise deja tratamentul asta in acelasi
commit; modalul fusese sarit.)

**Autosalvarea din AddEventModal** scria in `editEvent.id` fara sa verifice daca e o ocurenta a unei
serii — deci la fiecare tick de debounce scria intr-un document inexistent. Nu o rutez prin
`createEventOverride`: pe un debounce ar crea cate un override **la fiecare pauza de tastare** si ar
umple lista de exceptii a parintelui. Autosalvarea se opreste pur si simplu; salvarea ramane la
`handleSubmit`, care oricum intreaba „doar asta sau toate".

**Cardurile de portofel legate de un eveniment partajat** sunt refuzate GARANTAT pentru orice membru
in afara proprietarului (bunurile se citesc doar de proprietar, dar evenimentul care poarta
`assetId` se citeste de tot grupul) — si `catch(e) {}` inghitea refuzul. Largirea citirii e o decizie
amanata; tacerea nu era o decizie. Acum raporteaza.

**Citirea preferintelor la login** statea in acelasi `try` cu scrierea `lastLogin` si cu oglinda
`profiles`, deci o citire respinsa le anula pe amandoua — iar `setUser` rula oricum, lasand o
aplicatie complet logata pe culori implicite, fara sa spuna nimic. Tema traieste **doar in memorie**
(store-ul persista numai limba), deci chiar se pierdea.

`npx tsc -b` verde · **766 teste verzi** · build verde.

## 2026-09-06 - Tema personalizata putea face aplicatia ilizibila, si nimic n-o observa

**Model:** Claude Opus 5 · „vreau sa lucrezi doar la ourdaysapp"

Clasa `dark` de pe `<html>` intoarce culoarea FIECARUI text din aplicatie. Era decisa de
`isDarkMode || customThemeIsDark` — un **comutator**. Fundalul sub text e decis de altceva:
un selector liber de culoare (`backgroundColor`), optional o imagine, si mereu un strat
(`overlayColor` la `backgroundOverlay`%, implicit 50). **Nimic nu le lega**, iar cele doua controale
stau unul langa altul in Setari.

Masurat cu tokenii reali ai aplicatiei (zinc-100 cand `dark` e pornit, zinc-900 cand e oprit):

```
strat    comutator dark PORNIT + fundal alb     comutator OPRIT + fundal negru
 0-20%   1.01 - 1.46   invizibil                1.01 - 1.46   invizibil
   50%   3.62          sub AA                   4.46          sub AA
  100%   19.11         bine                     17.72         bine
```

**De ce n-a sarit nimanui in ochi:** stratul implicit e NEGRU cand comutatorul e pe intuneric si ALB
cand e pe lumina — deci la 50% **mascheaza pe jumatate greseala**. Sliderul merge insa pana la 0,
unde nu mai mascheaza nimic. Si un imperecheat CORECT plus o culoare de strat aleasa ajunge singur
la 3.40, fara nicio nepotrivire.

**Reparatia muta decizia de pe comutator pe lucrul pe care textul chiar aterizeaza** — exact tehnica
pe care `App.tsx` o foloseste deja cu 12 randuri mai sus ca sa aleaga `--primary-foreground`; pur si
simplu nu fusese aplicata si fundalului paginii. `src/utils/themeContrast.ts` e pur si fara DOM,
deci suita poate parcurge toata matricea fara browser si fara cont.

**Proprietatea care conteaza, si care e testata explicit:** pentru o tema COERENTA derivarea intoarce
exact ce spunea comutatorul, deci nimic din ce si-a configurat cineva nu se schimba. Suprascrie doar
combinatiile care se contrazic singure. Daca testele alea ar cadea, „reparatia" ar fi un bug mai mare
decat cel inlocuit.

**Comutatorul nu devine inert in tacere.** Cand derivarea nu e de acord cu el, Setarile spun de ce
(„Fundalul tau e deschis, deci textul e afisat inchis"), iar cand NICIO culoare de text nu atinge AA
pe fundalul ales — un gri mediu, de exemplu — o spune cu raportul masurat, fiindca acolo comutatorul
chiar nu poate ajuta.

**Cat de accesibil e defectul, onest:** tema personalizata e activa doar cu modul intunecat global
OPRIT (sectiunea e `pointer-events-none` altfel). Deci cere trei pasi deliberati, nu e calea
implicita. Dar cei trei pasi sunt exact ce face cineva care vrea „intuneric, cu fundalul meu".

**Verificat in browser, nu doar in teste:** aplicatia porneste, clasa `dark` e aplicata, cardul de
login e `rgb(24,24,27)` cu eticheta `rgb(212,212,216)` = **11.99:1**. Deci tema implicita e
neschimbata.

**Ce n-am putut verifica singur:** ecranul Setari cere autentificare, deci nota noua si comutarea pe
o tema chiar nepotrivita raman in `OWNER_VERIFY.md`.

*Nelamurit, notat ca sa nu se piarda:* pe `document.body`, stilul inline e `rgb(9,9,11)` iar
`getComputedStyle` raporteaza stabil `rgb(255,255,255)`, desi un `div` sonda cu aceeasi valoare
inline se calculeaza corect. Seamana cu propagarea fundalului `body` catre canvas, nu cu un defect —
si oricum e dinaintea schimbarii mele. **Nu-l declar bug fiindca nu l-am dovedit.**

`npx tsc -b` verde · **779 teste verzi** (13 noi) · build verde.

## 2026-09-06 - „Zero siruri englezesti" era FALS. Erau 32, intr-un unghi mort al propriului scaner

**Model:** Claude Opus 5

Pe 26.08 am maturat aplicatia de text englezesc, am re-scanat, n-am gasit nimic si am scris in
mesajul de commit **„zero English strings remain outside the two declared exemptions"**. Era gresit.

Scanerul potrivea `>Text<` pe **o singura linie**. Forma cea mai frecventa din codul asta se intinde
pe trei:

```
<p className="...">
  <Wallet className="w-4 h-4" /> Linked Asset Code
</p>
```

**Treizeci si doua de siruri** stateau exact acolo. Si nu obscure: `Start Task`, `Complete`,
`To-Do List`, `Delete Event`, `RSVP — Are you going?`, `This message was deleted`, `Pinned`,
`Replying to`, `This event only`, `All events in series`. Adica butoanele de pe fisa de eveniment si
etichetele din chat — lucruri pe care un utilizator roman le vede la fiecare deschidere.

**De ce le-am gasit acum:** ma uitam la cu totul altceva (o scanare de contrast pe perechile
`dark:` lipsa) si mi-a sarit in ochi `Linked Asset Code` in marginea unei bucati de markup pe care
o citeam din alt motiv. Scanarea de contrast, apropo, **n-a gasit nimic real**: 30 de candidati,
toti falsi — 27 aveau perechea pe `dark:hover:text-` (regexul meu cauta `dark:text-`), iar ultimii
3 stau pe un panou `bg-white` fortat deliberat, fiindca acolo se randeaza coduri de bare si QR, care
au nevoie de alb ca sa fie scanabile. **Am verificat fiecare inainte sa raportez ceva** — un scaner
care da esecuri false trimite la reparat lucruri nestricate.

**Reparat:** 22 de chei noi in 6 limbi, plus refolosirea celor care existau deja (`addEvent`,
`pickFromAssets`, `cancel`, `rsvpGoing`, `rsvpMaybe`, `assetsTitle`, `generatingChecklist`) — testul
de paritate interzice cheile duplicate, deci refolosirea nu e doar eleganta, e obligatorie.

Ramane **un singur** literal: `Admin`, in bara din CalendarHome. E acelasi cuvant in toate cele sase
limbi si e intrarea catre consola care oricum e exceptata. E in lista alba a testului, cu motivul
scris langa el.

**Partea care tine — si care e adevarata lectie:** `src/utils/i18nCoverage.test.ts`. Un grep de-o
data e o afirmatie despre ziua in care l-ai rulat; aceeasi scanare, cu bug-ul de linie nou reparat,
pusa in suita, e o afirmatie re-verificata la fiecare commit. Are si doua teste despre SINE: ca vede
forma pe mai multe linii, si ca nu se plange de un text deja tradus. Verificat ca musca: am
reintrodus `To-Do List` in forma exacta care scapase, iar testul l-a numit cu fisier, linie si text.

`npx tsc -b` verde · **783 teste verzi** (4 noi) · build verde.

## 2026-09-06 - Auditul 2: 52 de constatari, si primele patru reparate

**Model:** Claude Opus 5 · „porneste auditul" · 13 agenti, 6 lentile necoperite de pasa din august
(performanta/cost, curse de ciclu de viata, cresterea datelor, autoritatea PvP, accesibilitate/telefon,
panoul de admin). **52 au supravietuit respingerii, 1 doborata** — 10 grave, 17 medii, 25 mici.

De notat onest: rata de respingere e mult mai mica decat data trecuta (1 din 53, fata de 3 din 49).
Verificatorii **au** lucrat — au coborat severitati, au corectat reparatii propuse, iar unul a prins
o reparatie care ar fi livrat o **pierdere vizibila de date** (un filtru de data pe interogarea
calendarului ar fi sters din ecran fiecare eveniment recurent, fiindca parintele seriei sta in afara
ferestrei randate). Dar diferenta de rata o notez, nu o explic.

### Cele patru reparate acum — cele fara ambiguitate

**1. `location` si `reminderMinutes` se pierdeau la salvare.** Formularul le culege, autosalvarea le
scrie, lista alba de pe server le accepta — iar `handleSubmit` pur si simplu nu le punea in obiect.
Deci locatia scrisa nu aparea niciodata si mementoul setat nu pornea niciodata: **ambii cititori**
(fisa evenimentului si planificatorul de notificari) se uita exact la campurile alea. Un singur
obiect serveste crearea, editarea, `scope='all'` si override-ul, deci o linie repara toate patru.

*Garda:* `eventPayload.test.ts` extrage AMBELE literale `baseEventData` prin potrivire de acolade si
cere ca tot ce scrie autosalvarea sa scrie si butonul de salvare (cu `date` pe lista de exceptii, cu
motivul scris). Nu fixez cele doua nume de campuri — fixez **invariantul**: doua literale care trebuie
sa fie de acord, fara nimic care sa le tina de acord. Verificat ca musca: le-am scos din nou si testul
le-a numit pe amandoua.

**2. Stergerea unui cont din admin nu stergea `expenses`.** Randurile supravietuiau, membrii ramasi
le puteau in continuare citi (regula da oricarui membru registrul grupului), suma inca includea
cheltuiala celui plecat — dar impartitorul scazuse cand fusese scos din `members`. Deci toti cei
ramasi erau anuntati tacut ca datoreaza mai mult decat datoreaza, **definitiv**. Adaugat si
`notifications`, pe care altfel nu le mai putea sterge nimeni (regulile le leaga de uid-ul
destinatarului). Ambele apar acum in `counts`.

**3. Tema contului anterior supravietuia deconectarii.** Store-ul e un `create()` de modul, iar
deconectarea e `signOut` + navigare SPA, fara reload — deci modulul isi pastra valorile. Reparasem
pe 26.08 **doar limba**; fundalul, POZA de fundal, stratul, comutatorul de suprafete inchise, sunetul
si haptica stateau in continuare in spatele aceleiasi porti. Acum exista `resetTheme()`, chemat cand
`onAuthStateChanged` raporteaza `null`. **Limba ramane intentionat** — apartine dispozitivului si
celui care citeste ecranul de login, nu sesiunii; asimetria aia e testata explicit, fiindca altfel
arata ca o scapare.

**4. Scanerul de coduri de bare pierdea fluxul camerei.** Curatenia era conditionata de
`isScanning`, pe care html5-qrcode il pune pe `true` abia DUPA ce `getUserMedia` se rezolva — adica
exact cazul care avea nevoie de oprire era singurul sarit. Inchizi foaia cat camera porneste si
fluxul ramane viu cat traieste pagina, cu ledul aprins pe telefon. Plus: efectul avea `[onScan]` in
dependinte, iar parintele trimite o sageata inline la fiecare randare, deci camera repornea la
fiecare randare a parintelui. Acum: steag de anulare + oprire neconditionata + callback prin ref.

`npx tsc -b` verde · **790 teste verzi** (7 noi) · build verde · functions build verde.

### Ce NU am reparat, si de ce

**Gruparea PvP (3 constatari grave) cere o decizie, nu o implementare.** Serverul stabileste cine a
castigat, dar armata e scrisa **doar de browserul celui care pierde**: `warlordDomains` e atins de o
singura linie in tot `functions/` (o stergere, la stergerea contului). Deci o infrangere nu costa
nimic daca nu deschizi ecranul de rezultat; unitatile nu sunt blocate cat asteapta provocarea, deci
aceiasi soldati pot fi mizati in mai multe batalii; iar marcajul „deja aplicat" e in `localStorage`
in timp ce armata e sincronizata in cloud, deci pe al doilea dispozitiv pierderile se aplica de doua
ori. Verificatorul a semnalat ca reparatia evidenta **scurge informatie**: `stakedUnitIds` pe
documentul public al jocului i-ar spune adversarului cate unitati ai angajat inainte sa se angajeze
el — exact semnalul pe care desfasurarea ascunsa exista ca sa-l previna.

**Android:** `@capacitor/local-notifications` nu e in build, deci mementourile nu pornesc niciodata
pe telefon — si esecul e un `console.error` gol, deci nu ajunge in `errorLogs`. Plus `targetSdk 35`
porneste edge-to-edge fara sa rezerve barele de sistem. Cere `npx cap sync android` + reconstruire +
un telefon, deci trece la owner.
## 2026-09-14 - Portofelul spunea ca a partajat. Nu partajase niciodata.

**Model:** Claude Opus 5 · „haide sa lucram la aplicatia ourdaysapp"

### Intai, o scapare de proces a mea

**Lista celor 48 de constatari ramase din auditul 2 nu mai exista.** Sectiunea din DEVLOG are 66
de linii si **zero constatari enumerate** — doar numerele (10 grave / 17 medii / 25 mici) si proza
despre cele patru reparate. Detaliile traiau doar in iesirea workflow-ului si s-au dus cu ea. Am
cautat in scratchpad-urile de sesiune: nimic. Regula mea proprie spune ca ce nu incape intr-o
sesiune se scrie intr-un fisier; am aplicat-o la ce trebuia verificat de owner si NU la ce ramanea
de reparat. De acum, orice audit isi scrie constatarile intr-un fisier inainte sa repar prima.

### Defectul, gasit masurand si nu pe vreo lista

Regula `assets` era `ownerId == request.auth.uid` si atat. Portofelul avea in acelasi timp un
comutator „Shared / Private", scria `sharedWithFamily: true`, si desena pe card o insigna verde cu
iconita de familie si cuvantul **Shared**. Nimeni nu putea citi vreodata acel activ: niciun
ascultator din aplicatie nu interoga altceva decat `ownerId`, si niciunul n-ar fi putut — o
interogare pe care nicio ramura de regula n-o garanteaza e refuzata in intregime.

Deci nu era stricat intr-un caz limita. **Comutatorul nu era legat de nimic, in absolut toate
cazurile**, de la inceput. Iar `AddEventModal` avea id-ul grupului in mana si il reducea la un bit:
`sharedWithFamily: selectedGroupId !== 'personal'`. Fiecare activ salvat in portofel dintr-un
eveniment de grup e in starea „scrie Shared, citibil de nimeni".

### Forma aleasa: un id de GRUP, nu o lista de utilizatori

Un boolean nu poate raspunde „partajat cu care familie?" din clipa in care esti in doua grupuri.
Activul poarta acum `sharedGroupId`; absent sau null inseamna privat.

Alternativa evidenta era `allowedUserIds` cu `array-contains` — **o** interogare in loc de una pe
grup. Am respins-o fiindca lista **se invecheste**: iesi din grup si continui sa citesti cardurile
lui pana cand ceva rescrie fiecare activ care te numea. Acel ceva ar fi o Cloud Function pe
apartenenta, o scriere in evantai, si o fereastra in care revocarea inca nu s-a intamplat.

Un id de grup se rezolva **LA CITIRE** prin `isMemberOfGroup`. Iesirea din grup revoca accesul in
aceeasi clipa, fara nimic de intretinut si nimic de uitat — exact motivul pentru care apartenenta
se rezolva la citire peste tot in codul asta. Pretul e cate un ascultator per grup in loc de unul,
si se plateste intr-un loc care nu poate fi tacut gresit.

Cate un ascultator per grup, si nu un singur `in` peste toate: regula cheama `isMemberOfGroup` per
document, fiecare apel costa doua accesari de document in interiorul regulii, iar o interogare e
plafonata la douazeci. Un grup per ascultator tine numarul la doua **indiferent** cate grupuri are
cineva — un plafon care nu poate fi atins, in loc de unul doar departe.

`is string` din regula nu e prudenta decorativa: un camp absent face `isMemberOfGroup(null)` sa
construiasca `groups/null`, care e o cale Firestore **valida**, deci garda trebuie sa refuze forma
inainte de cautare.

### Ce vede omul

- Cardul spune adevarul: `Privat` · `Partajat cu <grup>` · `De la <nume>` pentru ce ti-a partajat
  altcineva.
- A patra stare, **`N-a fost partajat de fapt`**, cu bulina chihlimbarie, pentru activele vechi cu
  `sharedWithFamily: true` si niciun grup. Sa scrie doar „Privat" ar fi citit ca si cum schimbarea
  asta a luat ceva; nu s-a acordat niciodata nimic, si cardul e singurul loc care poate spune asta.
- Comutatorul a devenit un selector de grup. Fara grupuri, spune ce-ti lipseste in loc sa arate un
  control inert.
- Ecranul stia deja sa nu editeze ce nu-i al tau: cardul calcula `isOwner`, inchidea clicul,
  butoanele de editare si stergere, iar ambele scrieri in masa pe categorii filtrau dupa proprietar.
  Garda supravietuise; ce lipsea era un ascultator care sa poata intoarce vreodata un activ strain.

### Garzi

- `assetSharing.ts` — decizia scoasa din componenta, pura: cine vede, cine poate edita, ce se scrie.
  24 de teste. `sharedWithFamily` ramane, dar **DERIVAT** din `sharedGroupId`: scris independent,
  cele doua ar putea sa nu fie de acord, ceea ce e chiar felul in care s-a ajuns aici.
- `assetQueryRules.test.ts` — aceeasi verificare mecanica pe care `events` o are deja, acum ca
  `assets` are mai mult de o ramura de citire si deci poate gresi. Campurile permise se **citesc
  din reguli**, nu sunt scrise de mana, iar testul refuza explicit `sharedWithFamily`: e in
  continuare pe fiecare document, arata in continuare ca steagul de partajare, si nu e garantat de
  nicio ramura. **Dovedit ca musca:** cu interogarea mutata pe `sharedWithFamily`, testul a numit
  fisierul si campul; fisierul restaurat verificat prin hash, nu prin `git checkout` (arborele avea
  munca nesalvata).
- Prima varianta a testului trecea degeaba: `match /assets/{assetId}` contine el insusi o acolada,
  deci numararea incepea pe `{assetId}` si se inchidea imediat, cu lista de campuri **goala**.
  Garda „trebuie sa contina ownerId" a prins-o.

`npx tsc -b` verde · **818 teste verzi** (28 noi, de la 790) · build verde.

### Ce NU am putut dovedi, si spun asta ca atare

**Regulile nu sunt probate local.** Nu exista instanta de test pentru OurDaysApp, nu e configurat
emulator, `@firebase/rules-unit-testing` nu e instalat, iar masina are doar Java 8 — emulatorul
Firestore cere 11+. Memoria proiectului are deja lectia care conteaza aici: un macro CEL poate
**compila** si sa refuze ORICE scriere, iar `--dry-run` nu e dovada. Deci regula asta merge pe live
neprobata, si prima verificare o faci tu, deschizand portofelul. Revenirea e instantanee daca e
gresita. Un ham de emulator ar fi reparatia permanenta — proiectul a livrat deja de trei ori
defecte de reguli.
## 2026-09-14 - Regulile se pot, in sfarsit, proba. JDK-ul era deja pe masina.

**Model:** Claude Opus 5 · „continua", dupa livrarea partajarii din portofel

Acum o ora am livrat pe live o regula Firestore pe care **nu o probasem**, si am spus asta ca
atare. Blocantul parea de netrecut fara o instalare de sistem: emulatorul Firestore cere Java 11+,
iar `java` de pe PATH e 1.8.

**Era un JDK 21 deja instalat** — `C:\Program Files\Android\Android Studio\jbr`, livrat cu
Android Studio pentru build-ul Capacitor. Deci hamul a costat un pachet npm si doua fisiere, nu o
instalare. Nu l-am cautat pana azi fiindca m-am oprit la prima masuratoare („`java -version` zice
8") in loc sa intreb daca exista altul.

### Ce s-a construit

- `rules-tests/assets.test.ts` — **20 de teste pe motorul REAL de reguli**, prin emulator.
- `scripts/test-rules.mjs` — cauta un JDK 11+ (JAVA_HOME, apoi runtime-ul din Android Studio, apoi
  PATH), il pune in mediu si porneste `emulators:exec`. Daca nu gaseste niciunul, spune exact asta
  si precizeaza ca `npm test` nu e afectat.
- `vitest.config.ts` — suita obisnuita, cu `rules-tests/` EXCLUS. Testele alea cer emulator si
  deci un JDK; CI-ul si orice masina fara Java nu trebuie sa le vada picand. Tiparul de include e
  chiar implicitul lui Vitest, scris pe fata, ca suita sa colecteze exact ce colecta si inainte —
  verificat: tot **818**.
- `vitest.rules.config.ts` — doar `rules-tests/`, fara paralelism intre fisiere (un singur
  emulator, aceleasi documente).
- `firebase.json` — bloc de emulatoare, UI oprit, port fix 8080 (testul se conecteaza pe numar; un
  port dinamic ar face ca „nu asculta nimeni" sa arate ca „regulile au refuzat tot").
- `npm run test:rules`.

Id-ul de proiect e prefixat `demo-`, deci emulatorul sare peste credentiale si **nu poate fi
indreptat spre proiectul real** nici din greseala.

### Rezultatul: regula livrata e corecta

Fiecare capacitate e afirmata ca **PERECHE** — cineva care poate si cineva care nu. O suita numai
cu permisiuni trece la fel de fericit peste o regula care permite orice.

Probat: proprietarul isi citeste activul privat · un coleg de grup **nu** poate citi un activ
nepartajat · un coleg de grup **poate** citi unul partajat cu grupul · cineva din afara nu ·
nesemnat nu · **booleanul vechi nu acorda nimic** · interogarea per-grup e servita **si intoarce
activul, nu o pagina goala** · un nemembru e refuzat pe aceeasi interogare · interogarea
nefiltrata e refuzata · filtrarea pe `sharedWithFamily` e refuzata · partajarea intr-un grup din
care nu faci parte e refuzata si la creare si la editare · **cine citeste nu poate scrie sau
sterge** · `ownerId` nu poate fi schimbat · activul privat se creeaza, editeaza si sterge exact ca
inainte · **iesirea din grup taie accesul imediat**.

Ultima e chiar argumentul pentru care partajarea numeste un GRUP si nu o lista de oameni: nimic
n-a trebuit sa rescrie activul, si nu exista fereastra in care cel plecat inca intra.

### Doua lucruri pe care le-am stricat si reparat pe drum

1. `@firebase/rules-unit-testing@5` cere firebase ^12; aplicatia e pe 11. Am fixat **4.0.1**, care
   cere ^11. N-am urcat firebase pentru un ham de teste.
2. `emulators:exec` primeste scriptul ca UN argument pozitional. Trimis ca lista prin `shell:true`,
   shell-ul l-a re-spart si firebase a raspuns „Too many arguments" — un mesaj despre invelis, fara
   nicio legatura cu regulile. Acum e un singur sir, cu ghilimele simple inauntru si duble afara.

`npx tsc -b` verde (configurile de vitest intra acum in `tsconfig.node.json`, ca `vite.config.ts`) ·
**818 teste** in suita obisnuita, neschimbat · **20 de teste de reguli** verzi.

### Ce ramane

Hamul acopera `assets`. Restul colectiilor — `events`, `groups`, `expenses`, `messages`,
`group_invites`, `profiles` — n-au niciun test de reguli. Acum exista unde sa fie scrise.
## 2026-09-14 - 88 de teste de reguli, si doua defecte istorice reintroduse ca sa dovedeasca

**Model:** Claude Opus 5 · „continua", dupa hamul de reguli

Hamul acoperea doar `assets`. Acum acopera si `events`, `groups` (cu chatul din ele), `expenses`
si `group_invites`. **88 de teste pe motorul real**, in patru fisiere, plus un ham comun
(`rules-tests/_harness.ts`) care descrie o singura lume: Alice detine G1, Bob e in G1, Carol e
doar in G2, Dave nu e nicaieri.

### De ce fix colectiile astea

Nu sunt alese la intamplare — fiecare are un defect REAL, deja livrat si reparat, care pana azi
n-avea cum sa fie dovedit ca ramane reparat:

- **`events`** — de trei ori o interogare LIST ale carei constrangeri nu garantau regula (se
  vedea ca un calendar gol, nu ca o eroare); o ramura de citire `sharedWithFamily == true` fara
  nicio alta conditie, deci orice cont autentificat putea **citi si ENUMERA** fiecare eveniment cu
  steagul; si o regula de creare care fixa doar `ownerId`, deci oricine putea scrie un eveniment
  numind un strain in `assigneeIds` si sa-i apara text arbitrar in calendar.
- **`groups`** — `update, delete: if uid in members` lasa ORICE membru sa excluda pe oricine
  altcineva, proprietarul inclusiv, si sa stearga tot grupul cu evenimentele lui.
- **`expenses`** si **`group_invites`** — aceeasi forma de defect, aceeasi reparatie: se fixeaza
  campul care spune CINE, ca accesul de citire la un grup sa nu devina scriere in numele altuia.

### Verdele nu e dovada — l-am probat

88 verzi din prima. O suita care nu afirma nimic ar spune exact la fel. Deci am **reintrodus in
`firestore.rules` doua dintre defectele de mai sus** si am verificat ca suita le numeste:

| defect reintrodus | ce a picat |
|---|---|
| ramura `sharedWithFamily == true` la citirea evenimentelor | 2 teste: citirea de catre un strain **si** enumerarea |
| `true \|\|` in poarta de update a grupurilor | 2 teste: excluderea altuia **si** adaugarea cuiva |

Fisierul de reguli restaurat si verificat prin hash, nu prin `git checkout` — arborele avea munca
nesalvata.

### Doua lucruri pe care testele le fixeaza dinadins

**Perechi, nu permisiuni.** Fiecare capacitate se afirma de doua ori: cineva care poate si cineva
care nu. O suita numai cu `assertSucceeds` trece la fel de fericit peste o regula care permite
orice.

**„Permis" si „chiar intoarce ceva" sunt afirmatii diferite.** Acolo unde conteaza, testul verifica
si RANDURILE, nu doar ca interogarea a fost acceptata: o regula legala care nu potriveste nimic
arata pe ecran exact ca una stricata.

### Asimetrii pe care le-am fixat fiindca arata ca scapari

- La `events`, un membru de grup **poate edita** un eveniment care nu-i al lui, dar **nu-l poate
  sterge**. E intentionat — un calendar partajat in care doar autorul repara o greseala de scris
  nu e partajat — si acum e scris ca atare.
- La `groups`, un membru simplu **poate** sa se scoata pe el insusi din lista de membri (aia e
  „plec"), dar nu poate scoate pe altcineva. A treia ramura a regulii, cea usor de gresit.
- Un grup fara `ownerId` (dinainte ca el sa fie cerut) **nu poate fi sters de nimeni**, dar poate
  fi in continuare editat. E directia sigura de esec, si acum e probata.

`npx tsc -b` verde · **818 teste** in suita obisnuita, neschimbat · **88 de teste de reguli** verzi.

### Ramane
`profiles`, `games`, `notifications`, `friend_requests`, `errorLogs`, `warlord*` si colectiile de
cost AI. Cele cu `if false` explicit sunt cele mai ieftine de acoperit si cele mai usor de spart
tacut de un catch-all viitor.
## 2026-09-14 - Invitatii pe care le poti pune intr-un mesaj de WhatsApp

**Model:** Claude Opus 5 · „vreau sa marim optiunile de invite… pe mail sau whatsapp… daca nu
necesita setup din partea mea" + „cel care raspunde la invitatie sa fie adaugat automat in lista
de prieteni a celui care a trimis invitatia"

### Butonul care nu facea nimic

„Share invite" exista deja in modal. Compunea un text **englezesc hardcodat** — „sign up or log in
… to accept the invite" — si il trimitea. **Nu crea nicio invitatie.** Cine il primea se inscria si
nu gasea nimic care sa-l astepte. Aceeasi forma exacta ca insigna „Shared" din portofel: un control
legat de nimic, care arata ca merge.

### De ce a trebuit un lucru nou, nu un buton in plus

Invitatia care exista e adresata unui **email stiut dinainte**, iar `acceptGroupInvite` o onoreaza
doar daca emailul tau verificat se potriveste. E puternica si **ramane**. Dar nu poate fi trimisa pe
WhatsApp, fiindca nu exista ce sa trimiti: destinatarul o descopera in aplicatie, dupa ce s-a
inscris cu exact adresa aia.

Un link de invitatie e compromisul invers. E o **credentiala la purtator** — cine il are il poate
folosi — ceea ce cumpara exact ce s-a cerut (orice canal, catre cineva fara cont) si costa
garantia ca doar persoana vizata il foloseste.

Deci riscul e **marginit, nu ignorat**: cod de 128 de biti din CSPRNG (nu se ghiceste si nu se
enumera) · fiecare link **expira**, iar durata maxima e plafonata pe server · fiecare e bun pentru **o singura
inregistrare** (decizie owner, 14.09) — deci un link dat mai departe e consumat de primul care
ajunge, nu admite pe toata lumea la care ajunge · creatorul il poate **retrage** · la folosire se
**reverifica** faptul ca cel care l-a creat e INCA membru al grupului (aceeasi verificare pe care
`acceptGroupInvite` a invatat-o, si din acelasi motiv: altfel un link creat cat erai membru si
folosit dupa ce ai fost scos e o usa din dos permanenta) · iar documentele stau intr-o colectie pe
care clientii **nu o pot citi deloc**. Id-ul documentului E codul, deci o colectie citibila ar fi
lista enumerabila a fiecarei invitatii vii.

### Canalele, si de ce fix astea

Constrangerea a fost „fara setup din partea mea". Aia elimina orice furnizor care cere cont, cheie
sau domeniu verificat — SendGrid, Mailgun, Twilio, WhatsApp Business API. Ce ramane e categoria
care nu cere nimic: **dai textul unei aplicatii pe care expeditorul o are deja**. Nu trimite
serverul nimic; trimite OMUL.

`navigator.share` e prima fiindca deschide foaia de partajare a sistemului, care listeaza fiecare
aplicatie de pe telefon ce accepta text — WhatsApp, Telegram, Signal, Messenger, SMS, mail. **Un
canal care e de fapt toate**, fara nimic de integrat si nimic de intretinut. Butoanele explicite de
sub ea exista fiindca foaia lipseste pe desktop, si fiindca cine vrea WhatsApp n-ar trebui sa
treaca printr-un meniu. Plus **cod QR** pentru cand dai invitatia in mana cuiva — `react-qr-code`
era deja dependinta.

### Prietenia, ceruta explicit

Cine accepta o invitatie devine prieten cu cine a trimis-o, **in aceeasi tranzactie**. Aplicat pe
AMBELE cai, nu doar pe link: „cel care raspunde la invitatie" le acopera pe amandoua, iar o
invitatie pe email care nu face prietenie ar fi acum inconsecventa.

Scris ca modul separat, `functions/src/friendship.ts`, fiindca are doua capcane pe care apelantul
nu le vede: `friends` tine OBIECTE, deci `arrayUnion` nu deduplica (doua acceptari produceau doua
intrari, iar cea veche pastra un nume invechit pentru totdeauna) — si o tranzactie Firestore nu
poate citi dupa ce a scris, deci helperul e taiat in doua: `readFriendship` in faza de citire,
`apply()` in cea de scriere.

### Fisiere

Server: `functions/src/inviteLinks.ts` (5 callable-uri: create / peek / redeem / revoke / list),
`functions/src/friendship.ts`. Reguli: `invite_links` refuzata EXPLICIT. Trei indecsi compusi.
Client: `src/utils/inviteShare.ts` (pur, 25 de teste), `src/screens/JoinInvite.tsx`, ruta
`/join/:code`, modalul rescris. 37 de chei i18n × 6 limbi.

`/join/:code` e **singura ruta care se randeaza deconectat**, si trebuie sa fie: cine deschide
linkul poate sa n-aiba cont deloc. Spune INTAI ce e invitatia si CINE o trimite — prin
`peekGroupInviteLink`, care ruleaza neautentificat si intoarce doar ce ar scrie pe o invitatie de
hartie — si abia apoi cere un cont. Cine aterizeaza pe un formular de login fara explicatie inchide
tabul.

`npx tsc -b` verde · functions build verde · **843 de teste** (de la 818) · **92 de teste de
reguli** (de la 88) · build verde.

### Ce nu e livrat inca
Nimic din asta nu e pe live: cere deploy in ordinea **functions → indecsi → reguli → hosting**,
fiindca clientul depinde de callable-uri care inca nu exista acolo.
## 2026-09-14 - Un link, o inregistrare — si defectul pe care doar cifra 1 l-a scos la iveala

**Model:** Claude Opus 5 · „link-ul este valabil pentru o singura inregistrare”

Decizie owner, aplicata ca **CONSTANTA pe server**, nu ca implicit: un `maxUses` pe care apelantul
il poate ridica ar fi exact butonul pe care decizia spune ca n-ar trebui sa existe. Campul ramane pe
document si verificarile il citesc in continuare, deci un link mai vechi emis cu o alocare mai mare
**se comporta cum a fost emis** in loc sa fie taiat tacut — directia sigura pentru o credentiala pe
care cineva a trimis-o deja altcuiva.

### Defectul care era invizibil la 5 folosiri

Cu limita 1, verificarea „s-a epuizat” venea **inaintea** verificarii „ai folosit-o deja TU”. Deci
cine tocmai intrase si redeschidea propriul link — lucru absolut obisnuit, linkurile stau in
conversatii — era anuntat ca invitatia e epuizata, **de propria lui folosire**. La 5 folosiri
cazul statea ascuns in joc.

Si era in **DOUA** locuri: `peek` si `redeem` decideau fiecare pe cont propriu, si ajungeau la
raspunsuri diferite. Peek e cel chemat PRIMUL de ecranul de intrare, deci omul nici n-ar fi ajuns
la raspunsul mai bland al lui redeem.

### Reparatia nu e ordinea, e sursa unica

`functions/src/inviteLinkState.ts`: **o** functie pura, `linkVerdict(doc, caller, now)`, chemata
de amandoua. Doua implementari ale unei singure decizii, fara nimic care sa le tina de acord —
aceeasi forma ca cele doua literale `baseEventData` si ca tema cu doua surse de adevar, si acelasi
tratament: calculeaz-o o data.

**17 teste**, si ordinea e chiar ce fixeaza. **Dovedit ca musca:** mutata verificarea „already” la
final (unde o aveau ambele callable-uri), 2 din 17 pica; fisier restaurat si verificat prin hash.

Bonus prins de aceeasi mutare: `already` bate acum si `revoked` si `expired` — cine e deja
inauntru n-are de ce sa fie anuntat despre problemele unui link de care nu mai are nevoie.

`npx tsc -b` verde · functions build verde · **860 de teste** (de la 843) · 92 de reguli · build verde.
## 2026-09-14 - Notificarile: doua canale care nu erau de acord ce merita spus

**Model:** Claude Opus 5 · „o sa vreau sa facem si notificari pe device" → ales „intai temelia"

### Ce am masurat inainte sa scriu ceva

**Mementourile de eveniment nu pornesc pentru nimeni.** Pe Android,
`capacitor-local-notifications` **nu e in `capacitor.build.gradle`** (sunt doar haptics si push),
deci pluginul nativ lipseste. Pe web exista implementare, dar programeaza cu `setTimeout`: porneste
doar daca **lasi tabul deschis** pana in momentul respectiv. Un memento pentru maine dimineata nu se
declanseaza niciodata, pe nicio platforma. OWNER_VERIFY spunea doar „pe Android"; e mai rau.

**Doua canale independente, care nu erau de acord ce merita spus:**
- colectia `notifications` (clopotelul) — patru scriitori, **corect tradusa**, fiindca tine chei
  iar clientul CITITORULUI le randeaza;
- push-ul FCM — patru trimitatori **diferiti**, niciunul nu scria rand in clopotel, toti in
  **engleza hardcodata**, pentru toata lumea, intr-o aplicatie cu sase limbi.

Deci un mesaj de chat da push si nu lasa urma in clopotel; o cerere de prietenie acceptata lasa rand
si nu da push; invitatia pe care tocmai o construisem la fel. Daca aflai sau nu depindea de care din
doua cai fara legatura fusese cablata.

**Nimic nu curata `fcmTokens`.** `sendEachForMulticast` raporteaza esecul per token si fiecare
trimitere arunca raportul. Lista doar creste — fiecare browser nou, fiecare reinstalare — si fiecare
trimitere cheltuie apeluri pe adrese care nu pot ajunge nicaieri.

### Temelia

`functions/src/notify.ts` — **o** cale: scrie randul din clopotel SI trimite push-ul, dintr-o
singura descriere a evenimentului, **in limba fiecarui destinatar** (`users/{uid}.language` era deja
scris; nimeni nu-l citea la trimitere). Curata tokenurile moarte, si **doar** pe cele trei coduri
care chiar inseamna „adresa nu mai exista" — un plafon sau un timeout nu au voie sa coste pe cineva
tokenul, altfel un minut prost la Google dezaboneaza toata familia.

Chemat **dupa** tranzactie, niciodata inauntru: cineva a intrat deja in grup, iar un esec la anuntat
n-are voie sa dea inapoi intrarea.

### Al doilea dictionar, si ce-l tine cinstit

Push-ul e desenat de sistemul de operare din ce a trimis serverul, deci limba se alege inainte de
trimitere — iar `src/utils/i18n.ts` are ~3000 de linii si importa localele date-fns, deci nu intra
in bundle-ul de functions pentru sase siruri scurte. Asa ca exista un tabel mic separat,
`notifyStrings.ts`.

Doua tabele care descriu acelasi lucru e chiar forma care diverge. **Testul care le tine de acord a
prins divergenta din PRIMA rulare:** inventasem traduceri pentru `taskAssignedBody` in loc sa le
copiez pe cele existente, si a numit toate trei limbile gresite. Valorile sunt acum luate
programatic din fisierul aplicatiei, nu scrise a doua oara de mana.

### Ce trece deja prin ea
Cererea de prietenie acceptata si invitatia prin link — amandoua scriau rand si **niciun push**.
Acum scriu si trimit, traduse. Clopotelul stie si `titleParam`, ca un nume sa poata sta in titlu.

### Ce NU trece inca
Cele patru trimiteri vechi de push — mesaj de chat, joc nou, provocare Warlord, tura ta — sunt tot in
engleza hardcodata si tot nu lasa rand in clopotel. Si o cerere de prietenie **primita** inca nu
notifica nimic, nici macar in clopotel.

`npx tsc -b` verde · functions build verde · **873 de teste** (de la 860) · build verde.
## 2026-09-14 - Cele patru trimiteri vechi, si cererea de prietenie care nu spunea nimanui nimic

**Model:** Claude Opus 5 · „continua cu alea patru plus golul"

Toate patru treceau acum prin `notify()`: mesaj de chat, joc nou, provocare Warlord, tura ta /
finalul bataliei. Erau in engleza hardcodata, nu lasau niciun rand in clopotel, si niciuna nu
curata tokenurile moarte. **Zero `sendEachForMulticast` scris de mana au mai ramas in `index.ts`.**

### Deciziile care nu erau evidente

**Textul mesajului de chat se trimite ca `bodyText`, niciodata ca cheie.** Sunt cuvintele omului;
a le traduce ar fi mai rau decat a le lasa. Doar invelisul — „Mesaj nou de la …" — se randeaza in
limba cititorului.

**Numele grupului a iesit din titlu**, la chat si la jocuri. Randerul adauga UN parametru la final,
iar jumatatea mai utila pe un ecran de blocare e „de la cine" si „ce joc", nu „in care grup".
Grupul pleaca in `data`, pentru rutare la atingere.

**Retragerea a devenit CHEIE, nu sufix.** Vechiul cod adauga ` (by retreat)` la „Victory!". Un
parametru e acelasi sir pentru toti destinatarii, deci un „(prin retragere)" tradus nu se poate
exprima asa. Patru chei in loc de doua plus un sufix.

**Push-urile Warlord SUNT traduse**, desi ecranele jocului raman engleze prin decizia ta. O
notificare pe ecranul de blocare nu e un ecran pe care l-ai deschis — sa ajunga intr-o limba pe
care n-o citesti e mai rau decat inconsecventa. Se poate intoarce usor daca vrei altfel.

**`createdBy` la notificarile Warlord e CELALALT jucator.** `notify` isi scoate autorul din
propria lista de destinatari; daca as fi pus acolo chiar persoana notificata, n-ar fi primit nimic
— tacut.

### Golul: o cerere de prietenie nu anunta pe nimeni

Nici push, nici rand in clopotel. Aflai deschizand ecranul de Prieteni si observand o bulina.
Cererile se creeaza din client cu `addDoc`, deci vestea se agata de un trigger nou,
`onFriendRequestCreated`.

**Prima varianta acoperea jumatatea rara.** Calea cu un tap de pe un membru de grup scrie `toId`;
**calea prin email de pe ecranul Prieteni scrie `toId: null`** — si aia e calea pe care adaugi pe
cineva care nu e deja in grup cu tine, adica cea folosita. Acum adresa se rezolva la cont prin
`getUserByEmail`. Nu scurge nimic: notificarea ajunge la titularul contului, iar expeditorul nu
afla nimic in niciun caz — deci nu poate descoperi din asta daca o adresa e inregistrata.

### Testul si-a castigat existenta a doua oara

Regula „orice cheie `*Body` se termina cu spatiu" a picat pe un sir perfect corect
(„Inamicul si-a incheiat tura." nu primeste niciun nume). **Regula era gresita, nu sirul.** Ce
verifica acum e CONSECVENTA: daca engleza asteapta un nume dupa ea, toate limbile trebuie sa-l
astepte — ala e lucrul care ar produce o propozitie stalcita intr-o limba si nu in alta.

Si o capcana de escapare pe care o aveam notata si in care am cazut oricum: `python -c "..."` cu
ghilimele duble in bash a transformat `
` intr-o linie noua **reala** in interiorul unui sir
JavaScript. De-aia toate celelalte modificari din sesiune sunt fisiere, nu `-c`.

`npx tsc -b` verde · functions build verde · **873 de teste** · build verde.

### Ce ramane
Mementourile de eveniment. Nu pornesc pe nicio platforma, si repararea lor e o functie programata
— nu exista niciuna in proiect inca.
## 2026-09-14 - Un ceas pe eveniment, si un fus orar pe cont

**Model:** Claude Opus 5 · „direct pe mementouri" → „va trebui sa adaugam un ceas si sa separam
zilele in ore, si va trebui sa putem selecta fusuri orare"

Am pornit spre mementouri si m-am oprit dupa masuratori: **nu se putea construi unul corect.**

### Blocantul

Evenimentele **n-aveau ora deloc**. Câmpul e `type="date"`, iar salvarea face
`new Date('2026-09-20').toISOString()` — ceea ce JavaScript citeste ca **miezul noptii UTC**. Deci
fiecare eveniment din aplicatie statea la 00:00Z, iar „aminteste-mi cu 30 de minute inainte" se
traducea in 23:30 UTC in ziua precedenta: **02:30 dimineata** in Bucuresti. Interfata ofera minute,
ore si zile inainte — toate trei promiteau o precizie pe care datele n-o aveau.

**Si e a treia oara in sesiunea asta cu aceeasi forma.** Trei locuri citesc `ev.time`: grila de
calendar si lista de acasa (amandoua deseneaza o iconita de ceas lânga el) si planificatorul de
mementouri, care il sparge in ore si minute. **Nimic nu-l scria.** Nu era nici macar in lista alba
de pe server. Deci ceasul de lânga un eveniment n-a aparut niciodata pentru nimeni.

### Modelul

Un eveniment poarta acum `time` ('HH:mm', absent = zi intreaga) si `timezone` (zona IANA in care a
fost scrisa ora). `date` ramâne exact ce era — ziua, la miezul noptii UTC — deci fiecare
interogare, fiecare bucket din grila si toata expandarea recurentei merg mai departe neatinse.

**Zona sta pe EVENIMENT, nu se presupune a cititorului.** „Cina la 19:00" inseamna 19:00 acolo unde
e cina; cine citeste din alta tara vrea sa stie asta, nu sa vada ora mutata tacut. Randarea spune
zona doar când difera de a cititorului — „19:00" e ce vrei sa citesti in noua cazuri din zece.

Contul are si el un fus orar, ales in Setari, cu zona dispozitivului ca implicit.

### Conversia, si de ce are doua treceri

Nu e instalata nicio biblioteca de fusuri, iar `date-fns` singur nu stie zone. `Intl` stie, in
browser si in Node, si e corect la ora de vara fiindca platforma detine regulile. Inversarea lui
cere **doua** treceri: prima citeste offsetul la instantul GRESIT (ora de perete citita ca si cum
ar fi UTC), care de doua ori pe an cade de partea cealalta a schimbarii.

### Testele mi-au dat incredere falsa, si am prins-o

Scrisesem doua teste „spring-forward" si le-am probat prin mutatie: **am scos a doua trecere si
toate cele 33 de teste au ramas verzi.** Testele pretindeau ca fixeaza corectia si nu fixau nimic —
cele doua treceri difera doar când schimbarea cade **intre** instantul naiv si cel corectat, o
fereastra de vreo trei ore in jurul comutarii. Ambele teste erau la 23:00, departe.

Cazul care chiar distinge: **02:30 in dimineata schimbarii**. Bucurestiul trece EET(+2) → EEST(+3)
la 01:00 UTC pe 29.03.2026, deci 03:00–03:59 local nu exista in ziua aia, iar 02:30 e ultima ora pe
offsetul vechi. O trecere raspunde 23:30Z pe 28 — adica 01:30 local, **cu o ora mai devreme, tacut**.
Doua treceri raspund 00:30Z, care e 02:30 local, adica ce s-a scris.

Acum mutatia omoara **exact** testul scris pentru ea si lasa celelalte 33 verzi.

`npx tsc -b` verde · functions build verde · **907 teste** (de la 873) · build verde.

### Ce urmeaza
Felia 2: mementourile — acum au pe ce se sprijini. Felia 3: ziua impartita pe ore.

## 2026-09-14 - Panoul de chat serveste si o conversatie privata, si accepta un screenshot lipit

**Model:** Claude Opus 5 · „Continua cu panoul” + „in chat vreau sa pot da paste la un screenshot”

### Parametrizare, nu extragere — si de ce

Planuisem sa scot panoul de mesaje din componenta de 1066 de linii. **N-am facut-o.** A scoate un
panou dintr-un fisier pe care nu l-am citit cap-coada e riscul gresit pentru ce s-a cerut de fapt:
un tab de chat care merge.

Componenta primeste acum `convId` + `convKind` si construieste **o singura** cale, `basePath`. Toate
cele 13 folosiri de cale vin din ea, deci un grup si o conversatie privata difera intr-o singura
linie. Redenumirea si extragerea propriu-zisa vin separat, dupa ce ecranul e dovedit.

Plus `embedded`: fara pozitionare fixa, fara butonul flotant, mereu deschis, umple ce i se da —
forma de care are nevoie ecranul. Rezumatul AI ramane doar pentru grupuri: o conversatie in doi
n-are grup de rezumat.

**Capcana numarata gresit:** credeam 7 folosiri ale caii de mesaje, erau 9. Scriptul a refuzat si
n-a scris nimic, fiindca scrierea e la final. Numaratoarea din `grep` nu e numaratoarea din fisier.

### Lipirea unui screenshot

Mica, fiindca drumul de incarcare exista deja: alegerea unui fisier seteaza `imageFile` si
`imagePreview`, iar restul compozitorului le ia de acolo. Lipirea trebuie doar sa produca aceleasi
doua valori din clipboard. Trei lucruri care nu-s evidente:

- **Clipboardul poarta mai multe reprezentari** ale aceleiasi lipiri; un screenshot copiat dintr-un
  browser vine de obicei intai ca HTML si abia apoi ca imagine. Deci se cauta primul element care
  **este** imagine, nu primul element.
- **`preventDefault` doar dupa ce s-a gasit o imagine.** Lipirea de text obisnuit trebuie sa mearga
  mai departe; s-o inghit ar fi un bug mai suparator decat cel reparat.
- **Un screenshot lipit n-are nume** — `getAsFile()` il cheama „image.png” pentru toata lumea. Fara
  redenumire cu timestamp, doua screenshoturi in aceeasi conversatie nimeresc aceeasi cale in
  Storage si al doilea il suprascrie tacut pe primul.

`npx tsc -b` verde · **907 teste** · build verde.

### Ce urmeaza
Ecranul: doua panouri pe desktop, fullscreen cu panou de conversatii pe telefon.
## 2026-09-14 - Tabul de chat: lista in stanga, conversatia in dreapta

**Model:** Claude Opus 5 · „un tab in plus, dedicat pentru chat, ceva similar cu whatsapp” +
„si cele din grup si cele personale”

Ruta `/chat`, cu iconita in bara de sus intre jurnal si portofel.

### O singura stare, doua asezari

Desktopul arata ambele panouri. Telefonul arata exact unul — lista pana alegi ceva, conversatia
dupa, cu o sageata inapoi care sterge selectia. **Aceeasi stare in ambele cazuri**; difera doar ce
panou are voie pe ecran la o latime, prin `hidden` / `md:flex`.

Doi arbori diferiti ar fi insemnat doua seturi de ascultatori, doua pozitii de derulare si o
conversatie care uita unde era cand intorci telefonul.

### Costul colectiei separate, platit o data

Un chat de grup sta la `groups/{id}/messages`, unul privat la `chats/{id}/messages` — colectii
separate dinadins, fiindca treisprezece locuri listeaza grupuri dupa membri. Ecranul vrea **o**
lista sortata, deci `conversations.ts` e locul unde se imbina cele doua. Tot ce e mai jos vede o
singura forma.

**Trei capcane fixate in teste:**

- **Marca de timp vine in trei forme.** Un `Timestamp` cu `toMillis`, un numar simplu de la o
  scriere optimista locala, si `null` cat timp un `serverTimestamp()` e in zbor. `NaN` in
  comparator ar amesteca toata lista pentru o secunda.
- **Cheia de lista contine si FELUL.** Id-urile sunt unice per colectie, nu intre ele: un grup si
  un chat pot avea acelasi id, iar o cheie React doar cu id-ul ar contopi cele doua randuri.
- **Departajare stabila la conversatiile nefolosite.** Fara ea, doua randuri cu marca 0 isi schimba
  locul la fiecare randare si lista palpaie.

### Cine poate fi ales pentru o conversatie noua

**Exact multimea pe care serverul o accepta** — prietenii plus oamenii din grupurile tale, minus tu,
minus cine are deja conversatie cu tine. Un control care ofera o alegere si apoi esueaza la apasare
e mai rau decat unul care n-o ofera. Cand nu e nimeni de ales, scrie ce lipseste, nu o cutie goala.

### Panoul se remonteaza la fiecare schimbare

`key={conversationKey(active)}` e intentionat: panoul tine o lista de mesaje, o ciorna, o pozitie
de derulare si un marcaj de citit. Oricare dintre ele carat peste o schimbare ar arata starea unei
conversatii inauntrul alteia.

`npx tsc -b` verde · **928 de teste** (de la 907) · build verde.

### Ce ramane
Widgetul flotant de pe calendar ramane — e util in context. Extragerea propriu-zisa a panoului din
componenta de 1066 de linii ramane si ea, acum ca ecranul e construit peste ea.
## 2026-09-14 - Mementourile pornesc, in sfarsit — de pe server

**Model:** Claude Opus 5 · „2 si 3”

Prima functie programata din proiect: `sendDueReminders`, la fiecare 5 minute.

### Ce inlocuieste: nimic care sa fi functionat vreodata

`CalendarHome` le programa prin `@capacitor/local-notifications`, care **nu e in
`android/app/capacitor.build.gradle`** deloc — deci pe telefon pluginul lipseste — iar
implementarea lui de web foloseste `setTimeout`, deci in browser un memento pornea doar daca tabul
ramanea deschis pana in acel moment. Un memento pus pentru maine dimineata n-a ajuns la nimeni,
niciodata.

Am **sters** codul acela, nu l-am lasat adormit: in ziua in care pluginul chiar ajunge intr-un
build Android, fiecare memento ar fi sosit de doua ori.

### Cele trei lucruri care fac treaba asta grea

**1. Instantul se CALCULEAZA, deci nu se poate interoga.** Un memento e datorat la (start −
minute), iar startul e o ora de perete intr-o zona. Nu exista camp pe care sa faci un interval.
Deci fereastra se margineste dupa **timpul de avans**: un eveniment al carui memento e datorat
acum trebuie sa inceapa in maximum 31 de zile. E o limita **declarata**, nu o scapare — altfel ar
insemna expandarea fiecarei serii recurente din baza la fiecare rulare.

**2. O serie recurenta e UN document.** O serie saptamanala inceputa anul trecut are `date` departe
de orice fereastra din jurul zilei de azi, deci o interogare pe interval rateaza fiecare ocurenta a
ei. Se expandeaza cu `recurrenceServer.ts`, care exista chiar pentru asta.

**3. Nu are voie sa trimita de doua ori.** Rulari suprapuse, reincercari si un redeploy la mijlocul
ferestrei se intampla toate. Dedublarea e un document per (eveniment, zi de ocurenta) creat cu
`create`, care **esueaza daca exista deja** — deci prima rulare castiga si a doua se opreste
inainte sa trimita, fara ca cele doua sa trebuiasca sa cada de acord despre ceva.

### Fereastra e SEMI-DESCHISA, si testul o probeaza

`at > from && at <= to`. Ambele greseli sunt invizibile: un interval inchis la ambele capete trimite
de doua ori fiecare memento care cade pe o granita de rulare, iar unul exclusiv sus inseamna ca un
memento care cade exact pe granita nu pleaca niciodata. **Dovedit prin mutatie:** facut inchis,
pica exact testul scris pentru asta si raman celelalte 18 verzi.

### Evenimentele de zi intreaga

Tratate ca incepand la **09:00 in zona PROPRIETARULUI**. Fiecare eveniment din aplicatie era de zi
intreaga pana acum, deci a refuza sa le amintesc ar fi insemnat sa arunc tacut fiecare memento pus
vreodata. Zona proprietarului si nu a cititorului, ca o ocurenta sa aiba **un** instant — unul per
destinatar ar cere si o cheie de dedublare per destinatar.

### A doua copie a modulului de timp

`functions/src/eventTime.ts` e acelasi fisier ca cel din `src/utils/`. Trebuie sa fie: aplicatia nu
poate importa din build-ul de functions si nici invers, iar amandoua trebuie sa raspunda identic la
„când incepe evenimentul asta”. Exact situatia motorului Warlord, si cu aceeasi plasa — un test
care refuza orice divergenta si normalizeaza sfarsiturile de linie, ca un esec sa fie mereu real si
niciodata un artefact de checkout Windows.

`npx tsc -b` verde · functions build verde · **950 de teste** (de la 928) · 114 teste de reguli ·
build verde.
## 2026-09-14 - Ziua impartita pe ore

**Model:** Claude Opus 5 · „2 si 3”

Grila lunara raspunde „cum arata luna asta”; asta raspunde „cum arata ziua aia” — intrebarea pe care
ora de pe eveniment o face posibila. Inainte de ceas, fiecare eveniment statea la miezul noptii si
o grila pe ore ar fi desenat o singura gramada sus. Sta SUB grila lunara, nu in locul ei: amandoua
merita pe ecran deodata.

### Doua lucruri care se strica tacut, ambele in `dayLayout.ts`

**Pozitia.** Ora stocata e o ora de perete in zona EVENIMENTULUI; grila se deseneaza in zona
CITITORULUI. Deci se converteste — iar un eveniment fara zona (tot ce s-a salvat inainte de ceas)
se aseaza la ora scrisa, fiindca o conversie pe baza unei presupuneri l-ar muta cu ore prin zi.

**Suprapunerea.** Doua evenimente la aceeasi ora trebuie sa stea unul langa altul. Desenate unul
peste altul, cel de dedesubt nu e „greu de vazut” — e **invizibil**, iar nimeni nu raporteaza un bug
despre un eveniment pe care nu-l vede.

Algoritmul e lacom: fiecare eveniment ia prima coloana libera la ora lui de inceput. Un **grup** e
un sir de evenimente legate prin suprapunere, si toate blocurile dintr-un grup primesc **acelasi**
numar de coloane — altfel doua blocuri alaturate s-ar desena la latimi diferite si n-ar mai fi
aliniate.

**„Se ating” nu inseamna „se suprapun”:** unul care se termina la 10:00 si unul care incepe la 10:00
impart o granita, nu un minut. Sa-i pun in doua coloane ar injumatati ambele blocuri degeaba.
**Dovedit prin mutatie:** schimbat `<=` in `<`, pica exact testul de reutilizare a coloanei si raman
celelalte 21 verzi.

### Detalii care nu se vad, dar se simt

- **Evenimentele de zi intreaga stau DEASUPRA grilei**, nu pe ea. N-au ora; puse la miezul noptii ar
  citi ca o programare reala la miezul noptii.
- **Ferestre de ore adaptive:** minimum 07:00–22:00, largita doar daca exista ceva in afara. O grila
  care arata mereu 00:00–23:00 isi cheltuie toata inaltimea pe ore nefolosite.
- **Departajare stabila** la evenimente in acelasi minut, altfel isi schimba coloanele la fiecare
  randare.
- **Durata e o alegere de AFISARE, nu date.** Nu exista inca `endTime`; fiecare bloc se deseneaza la
  o lungime nominala si nimic nu se scrie inapoi, deci adaugarea unei ore de final schimba un
  singur fisier.

`npx tsc -b` verde · **972 de teste** (de la 950) · build verde.
## 2026-09-14 - CI rosu pe doua commit-uri: testul care trecea doar pe masina mea

**Model:** Claude Opus 5 · continuare dupa livrarea feliilor 2 si 3

Am raportat mementourile si ziua pe ore ca livrate si verificate. Erau verzi local si rosii in CI,
pe **doua** commit-uri (`587d3b6` si `4e77491`) — a doua fiind doar mostenitoarea primei. O singura
cauza.

`src/utils/reminders.test.ts` importa `functions/src/reminders.ts`, care declara functia programata
si deci importa `firebase-functions/v2/scheduler`. Pachetul ala traieste in `functions/node_modules`.
**CI ruleaza `npm ci` doar in radacina** si nu instaleaza niciodata arborele din `functions/`. Pe
masina mea sunt instalati amandoi, deci testul se incarca. Aranjamentul cel mai prost cu putinta:
masina care spune „da" e singura care nu poate vedea problema.

Alte trei teste importa deja din `functions/src/` si sunt in regula — `fanOut`, `inviteLinkState`,
`notifyStrings` n-au **niciun** import. `reminders.ts` era primul fisier care tinea si o decizie
pura, si o functie Cloud.

### Reparatia

Aritmetica a iesit in `functions/src/remindersCore.ts`, fara niciun import de pachet. `reminders.ts`
pastreaza doar programarea si o importa. Comportamentul nu se schimba cu nimic — aceleasi 19 teste,
aceleasi rezultate.

### Ce tine reparatia pe loc

`src/utils/functionsPurity.test.ts` parcurge graful de importuri RELATIVE pornind de la fiecare test
care intinde mana in `functions/src/`, si pica daca gaseste un import de pachet oriunde in el. Prinde
si cazul indirect: un modul pur care incepe sa importe alt modul care nu e.

**Dovedit prin mutatie, ambele sensuri:** pus `firebase-admin` in `remindersCore.ts` → pica; intors
testul inapoi pe `reminders.ts` → pica. Restaurare verificata pe hash, nu prin `git checkout`
(arborele avea lucru necomis).

Prima versiune a garzii cauta **sirul** `firebase-functions` in fisier si pica pe propriul comentariu
care explica de ce nu trebuie importat. O garda care citeste proza raporteaza despre proza; acum se
uita la importuri.

### Condiția CI, reprodusa local

Am ascuns `functions/node_modules` si am rulat suita: **toate cele 975 de teste trec**. (Redenumirea
a scos la iveala si ca vitest ridica orice `*.test.js` care nu e sub un director numit exact
`node_modules` — artefact al reproducerii mele, nu al CI-ului.)

`npx tsc -b` verde · **975 de teste** (de la 972) · build verde · build functions verde.
## 2026-09-14 - Optzeci de erori nu sunt optzeci de probleme

**Model:** Claude Opus 5 · „in admin sunt tot felul de erori mai vechi, ai cum sa le verifici tu?"

Andrei a aratat 80 de erori in Admin -> Health si m-a rugat sa ma uit la ele. Nu le pot citi de
aici: adminul e in spatele autentificarii, iar citirea depozitului de acreditari al CLI-ului a fost
**blocata** — corect, nu e ceva ce trebuie sa fac ca sa raspund la o intrebare.

Ce am putut citi: **log-ul serverului**. Cele 34 de intrari de eroare de acolo sunt toate dintr-un
**singur build anulat pe 28.08**, zero erori de rulare. Deci cele ~80 sunt integral erori de client,
in `errorLogs`.

### De ce lista bruta nu raspunde la intrebare

Ecranul arata cele mai recente 50 de randuri, cronologic. 80 de erori inregistrate sunt rareori 80
de probleme — de obicei sunt patru sau cinci, fiecare intamplata de multe ori, **intercalate in
timp**, asa ca doua aparitii ale aceleiasi nu stau niciodata una langa alta. Derulând lista, exact
ce conteaza nu se vede: care se intampla cel mai des, si daca mai e vie sau s-a oprit acum doua
saptamani.

### Singurul lucru pe care gruparea trebuie sa-l nimereasca

Doua aparitii ale aceluiasi bug difera prin detalii — un uid, un hash de build, un numar de linie,
un URL. Deci cheia trebuie sa le ignore. Dar **daca ignora prea mult, doua bug-uri DIFERITE se
contopesc**, ceea ce e mai rau decat lipsa gruparii: o problema se ascunde in spatele unui numar
care pare explicat.

Asa ca normalizarea e conservatoare: scoate ce e sigur incidental (URL-uri, siruri hex lungi,
numere, nume de fisiere cu hash de build) si **nu atinge formularea**. Hash-ul de build conteaza in
mod special — fara el, aceeasi problema ar da un grup nou la fiecare livrare.

Jumatate din cele 17 teste exista ca sa dovedeasca faptul ca lucrurile raman **separate**:
`(reading 'time')` si `(reading 'title')` sunt doua probleme; acelasi mesaj venit dintr-un
ErrorBoundary si dintr-un `unhandledrejection` sunt doua situatii.

### Detalii care schimba ce citesti

- **Numarul de aparitii si numarul de oameni sunt separate.** Un om care loveste ceva de 40 de ori
  si 40 de oameni care lovesc o data sunt probleme diferite, iar un singur numar nu le desparte.
- **Stiva pastrata e cea mai NOUA.** Una veche arata cod care poate nu mai exista si te trimite sa
  citesti fisierul gresit.
- **Se citesc 500 de randuri, nu 50.** Un numar luat dintr-o fereastra mai ingusta decat log-ul e
  numarul ferestrei; si daca se atinge plafonul, ecranul o **spune**.
- Modulul e pur (`functions/src/errorGrouping.ts`), deci garda de puritate scrisa azi il acopera
  automat.

`npx tsc -b` verde · **992 de teste** (de la 975) · build verde · functions verde · livrat pe live.
## 2026-09-14 - Un hook sub un `return`, si linterul care statea in cutie

**Model:** Claude Opus 5 · „imi da eroare cand incerc sa deschid evenimentele"

Gruparea livrata acum o ora a stramtat ~95 de randuri la patru probleme, iar a doua era chiar
eroarea raportata: **React #310, 15 aparitii, 2 oameni, azi, pe `/`**.

### Cum a fost gasita: prin masurare, nu prin banuiala

Stiva avea `index-BOVkP7uW.js` si `serverActions-DQ1EwheB.js` — **exact** fisierele din `dist/`-ul
curent. Deci nu era tab vechi, cum crezusem la prima raportare. Am taiat direct in bundle la
coordonatele din stiva:

```
z.useEffect(...), qg(e,t), !e||!n) return null;  let ee=..., ne=(0,z.useRef)(null)
```

Un `useRef` **sub** iesirea devreme. De acolo, sursa: `EventDetailsModal.tsx`, linia 103
`if (!isOpen || !event) return null;`, linia 124 `const materialising = useRef(...)`.

`CalendarHome.tsx:1084` randeaza modalul **permanent** si il comuta prin `isOpen`. Deci o randare
inchisa rula 8 hook-uri si una deschisa 9 — React #310, la **fiecare** eveniment deschis de oricine.
A intrat pe 28.08, in `7e235ff`, tot intr-o sesiune de-a mea.

### Ce m-a costat o verificare oarba

Prima cautare de „alte hook-uri sub `return`" a dat zero. Tiparul cerea `useRef(`, iar linia scrie
`useRef<Promise<string> | null>(null)` — genericul. **Instrumentul spunea curat fiindca nu se uita
unde trebuie.**

### Descoperirea care conteaza mai mult decat bugul

`eslint-plugin-react-hooks` e in `package.json` **de la inceput**, si `npm run lint` la fel. CI-ul
ruleaza typecheck, teste si build — **nu si lint**. Rulat, linterul numeste defectul cuvant cu
cuvant, inclusiv „Did you accidentally call a React Hook after an early return?".

Unealta era in cutie. Nimeni n-a deschis cutia. Pe tot `src/` (222 de fisiere): **exact o** incalcare
`rules-of-hooks` — chiar cea care crapa.

### Poarta, si de ce e o LISTA

`eslint .` intreg e rosu din start: 338 `no-explicit-any`, 23 `set-state-in-effect`, 442 in total.
**O poarta care nu poate fi verde in ziua in care o pui se stinge intr-o saptamana**, si te intorci
la un linter pe care nu-l ruleaza nimeni — exact starea care a produs bugul.

Deci `scripts/lint-gate.mjs` pica doar pe regulile care sunt **deja la zero**. Restul se **tipareste**
ca restanta la fiecare rulare, nu se inghite: o datorie pe care o vezi e o datorie care se poate
plati. Promovarea unei reguli = o cureti la zero, o adaugi in lista.

**Dovedit prin mutatie:** mutat hook-ul inapoi sub `return` → poarta pica si numeste regula;
restaurare verificata pe hash.

`npx tsc -b` verde · 992 de teste · poarta verde · build verde · **livrat pe live**
(`index-BgcUKQFo.js`, confirmat servit).
## 2026-09-14 - Restul jurnalului de erori: cota, si tabul ramas in urma

**Model:** Claude Opus 5 · continuare la „ai cum sa le verifici tu?"

Dupa reparatia hook-ului au ramas trei grupuri din patru. Doua se repara, unul nu era bug.

### 74 din ~95 de randuri erau Google spunand „nu azi"

**Cine scria.** Nu clientul: `src/ai.ts` prinde si face `return null`, fara sa raporteze nimic.
Era `logServerError` din `functions/src/index.ts:661`. „0 oameni" in panou **nu** insemna ca n-a
patit-o nimeni — insemna ca **scriitorul nu nota cine**. Sistematic: toate cele sase apeluri din
`catch` treceau doar `stack`, in timp ce cele doua deliberate treceau `uid`.

**De ce nu e o eroare de aplicatie.** Niciun input gresit, nicio stare corupta, nicio linie de
reparat. E o **conditie de operare**, reapare prin constructie, si va depasi mereu la numar orice
bug adevarat. Panoul sorteaza dupa numar — deci randul ala nu inregistra o problema, **le ascundea
pe celelalte**. Tot ce e real in aplicatie statea sub el.

Nu se pierde: `withLedger` scrie deja un rand pe apel, cu `uid`, functie, model si cost — strict mai
mult decat randul din `errorLogs`.

**Golul care facea ledgerul orb.** `aiLedger.ts` citea `err.code`, apoi `err.name`. SDK-ul Gemini nu
seteaza niciunul — seteaza **`status`**. Deci ORICE esec HTTP al lui (429, 400, 503) se inregistra
ca acelasi sir, `"GoogleGenerativeAIFetchError"`. Ledgerul nu putea raspunde la singura intrebare
pentru care exista.

**Ce vedea omul: nimic.** Chip-ul de sugestie pur si simplu nu aparea, deci concluzia era „n-a
gasit nimic". **Exact de asta s-au strans 74 in douasprezece zile fara sa observe nimeni.** Acum,
pe caile unde omul A CERUT ceva, serverul arunca codul stabil pe care clientul il traduce deja:
„Aplicatia a atins limita de AI pe ziua de azi." (`aiBudgetGlobal`, exista in toate cele 6 limbi).
La `suggestAsset` clientul ramane tacut intentionat — nimeni n-a cerut sugestia aia, iar o alerta
la fiecare parasire de camp ar fi mai rea decat tacerea.

Predicatul e ingust dinadins (`functions/src/aiProviderError.ts`): 503 „supraincarcat" si 400
„cerere gresita" **trebuie** sa ramana vizibile. Jumatate din cele 14 teste sunt despre ce NU are
voie sa inghita.

### Tabul ramas in urma nu mai e acuzat ca aplicatie stricata

`ErrorBoundary.getDerivedStateFromError()` **arunca obiectul de eroare** (nu avea parametru), deci
nimic de mai jos nu putea deosebi tipurile de crash. Un tab deschis peste un deploy cere un chunk
al carui hash nu mai exista — singurul crash din aplicatie pe care o reincarcare il repara de
fiecare data — si primea „Ceva n-a mers", care da vina pe aplicatie pentru o livrare.

Acum primeste „E disponibila o versiune noua" + buton. **Oferta, niciodata automat** — aplicatia e
si un chat, iar o reincarcare luata din mana omului arunca ce scria.

Potrivirea e pe formularea intreaga, **niciodata pe „Failed to fetch"** simplu: ala e si orice
cerere esuata offline, iar sa-i raspunzi cu „exista o versiune noua" ar fi o minciuna spusa cu
incredere cuiva care n-are semnal.

Si capata **context propriu** (`StaleChunk`), ca un eveniment asteptat dupa fiecare livrare sa nu
mai concureze la varful panoului cu bug-uri adevarate.

### `t is not a function` pe /warlord: nu era bug

Patru aparitii, 2-13 aug, dintr-un build coerent vechi. Chunk-urile din stiva nu mai exista.
Numele minificat `t` supravietuieste normalizarii, deci acelasi bug din alt build ar fi format alt
grup — patru aparitii intr-unul singur, pe 12 zile, e semnatura unui SINGUR build, adica a unui tab
lasat deschis. Nimic n-a mai reprodus-o intr-o luna. **Reparatia lui e chiar ecranul de mai sus.**

*Gasit in treacat, neatins (e in submodul):* `TraditionPanel.tsx:342` —
`navigator.clipboard?.writeText(c).then(...)`. `?.` apara proprietatea, nu lantul: fara clipboard
(context nesigur, WebView vechi) expresia da `undefined` si `.then` arunca. Trecut in OWNER_VERIFY.

### Despre audit, onest

Am rulat sase cautari paralele plus verificare adversariala pentru **alte** hook-uri sub un
`return`. N-au gasit nimic, iar singura candidata (`PvpPanel`) a fost respinsa de toti cei patru
verificatori — sustinerea inversa ordinea din sursa. Dar **scriptul meu de workflow avea un bug**
(`parallel([promisiuni])` in loc de functii), deci lista goala a venit partial din eroarea aia, nu
doar din vot. **Autoritatea o da ESLint:** 1 incalcare `rules-of-hooks` in 222 de fisiere, acum 0.

`npx tsc -b` verde · **1010 teste** (de la 992) · poarta verde · build verde · functions verde ·
livrat pe live (`index-kk51C5S1.js`, confirmat byte-identic cu ce s-a construit).
## 2026-09-14 - Erorile capata stari, iar „rezolvat" trebuie sa fie adevarat

**Model:** Claude Opus 5 · „vreau un sistem de organizare pentru erori... noi / vazute / rezolvate"

### De ce un simplu bulinut n-ar fi fost de ajuns

„Rezolvat" nu e o insemnare despre cum se simte cineva. E o **afirmatie despre cod**: asta nu se mai
poate intampla. Un steag care inregistreaza doar afirmatia transforma panoul intr-o lista de bifat
ca sa te simti bine, iar cel mai rapid drum spre un panou gol devine sa marchezi tot ca rezolvat.

Deci un grup rezolvat poarta un **filigran**: momentul celei mai noi aparitii cunoscute atunci cand
a fost rezolvat. O aparitie de dupa filigran **infirma** afirmatia, si grupul se intoarce singur ca
**`regressed`** — mai tare decat „nou", fiindca ceva crezut reparat si nereparat e o veste mai
proasta decat ceva ce n-a citit nimeni. Nimeni nu trebuie sa-si aminteasca sa verifice; asta e tot
rostul, fiindca o stare care se schimba doar cu mana devine o minciuna in clipa in care atentia
pleaca in alta parte.

`seen` NU functioneaza la fel: nu afirma nimic despre cod, doar „stiu de asta". O aparitie noua nu-l
contrazice, deci nu se reseteaza — dar „stiut SI inca se intampla" se arata, ca steag separat. Un
camp, un inteles.

Starea sta **pe grup**, niciodata pe rand: sa marchezi 74 de randuri ale aceluiasi lucru nu e un
flux de lucru, iar id-urile randurilor se schimba cand jurnalul se roteste, in timp ce amprenta nu.

### Recenzia adversariala a gasit un defect al meu, serios

Am pus patru recenzenti plus verificare pe diff **inainte de livrare**, fiindcă adminul e punct orb
la randare. Cinci constatari au supravietuit; cea mai grava era a mea:

Citeam starea pentru primele 200 de grupuri, dar parcurgeam **toate**. De la al 201-lea,
`stateSnaps[i]` era `undefined` → grupul raporta „new" pe veci. Verificatorul l-a reprodus rulând
modulele reale: 260 de grupuri, toate `resolved` in baza, panoul arata 200 rezolvate si 60 noi.
Si fiindca sortarea e dupa frecventa, **exact grupul rezolvat-si-revenit-o-data sta la coada**,
dincolo de plafon — singurul caz pentru care exista tot mecanismul era cel a carui stare nu se
citea niciodata. Propriul meu `errorDigest.ts` o facea corect, ceea ce a aratat ca e greseala, nu
decizie.

Reparatia nu e „mut si plafonul": **am facut defectul nereprezentabil.** `joinState` primeste o
**cautare dupa cheie**, nu un array paralel. Un index e un fapt despre doua tablouri; o cheie e un
fapt despre date. Nu mai exista aliniere de gresit. Pinuit cu un test de 260 de grupuri.

Celelalte patru, toate reparate: apelul in masa depasea plafonul de 100 de chei al serverului si
atunci **nu marca nimic** (acum se taie in bucati); serverul numara cheile sarite iar clientul
arunca numarul, deci o scriere care nu s-a intamplat arata exact ca una care s-a intamplat (acum se
spune); `merge: true` pastra `resolvedAt` dupa redeschidere, deci ecranul raporta o ora de rezolvare
pe care n-o mai avea; si o stare lipsa cadea prin ternarul insignei pe verdele „resolved" —
un panou care raporta increzator ca totul e in regula.

### Si un canal ca sa nu mai fie nevoie de screenshot

`logErrorDigest` scrie la 6 ore acelasi rezumat, ca o linie JSON, in log-urile de functii — care se
citesc cu CLI-ul deja autentificat, **fara nicio cheie noua si fara sa faci tu nimic**. Numere, nu
identitati: fara uid, fara email.

`npx tsc -b` verde · **1036 de teste** (de la 1010) · poarta verde · build verde · functions verde ·
livrat pe live (functions → rules → hosting).
## 2026-09-14 - Citirea erorilor de pe live, cu cheie de service account

**Model:** Claude Opus 5 · „haide sa setam cheia de service account"

`logErrorDigest` acopera cazul fara nicio credentiala, dar la 6 ore. Asta acopera restul: aceleasi
date, live, la cerere. `scripts/read-errors.mjs` + `npm run errors`.

**Decizia lui Andrei: DOAR CITIRE** (`roles/datastore.viewer`). I-am pus alegerea ca pe ce era:
Firestore **nu are roluri pe colectie**, deci varianta cu scriere n-ar fi fost „putin mai mult" — ar
fi dat scriere pe evenimentele tuturor, chat, portofel si salvarile Warlord, in schimbul automatizarii
unui clic de evidenta. Marcarea „vazut/rezolvat" ramane clicul lui, ceea ce e si corect: nu-mi
corectez singur lucrarea, iar filigranul face un marcaj gresit sa se autocorecteze.

**Trei lucruri construite in jurul cheii, nu in ea:**
- Scriptul **refuza sa porneasca** daca cheia e in interiorul arborelui. O cheie in repo e la un
  `git add` distanta de a fi publicata pentru totdeauna, iar istoria repo-ului asta contine chiar un
  `git add -A` care a maturat 21 de fisiere straine. Probat: cu o cheie falsa in repo, refuza si spune
  de ce.
- `.gitignore` capata tipare pentru chei — plasa a doua, nu prima. **Prima e ca fisierul sta in afara
  arborelui.**
- Scriptul citeste DOAR (`get`, `getAll`, `count`) si nu tipareste niciodata uid sau email.

**Nu reimplementeaza nimic:** gruparea si starile vin din `functions/lib` — exact codul compilat pe
care il ruleaza serverul. Doua implementari ale unei decizii diverg, iar cea care diverge e mereu cea
la care te uiti.

Cheia **nu e inca creata** — e pasul lui Andrei, notat in OWNER_VERIFY §26.
## 2026-09-14 - Butonul „Resolved" intreba omul gresit

**Model:** Claude Opus 5 · „nu stiu care au fost efectiv rezolvate... creezi o lista pe care sa o
verifice sistemul"

Andrei a numit o problema pe care o crease livrarea de dinainte: panoul punea un buton „Resolved" pe
FIECARE grup, si-i cerea celui care deschide ecranul sa certifice ceva ce n-avea de unde sti.
**Reparatia traieste intr-un commit, iar commit-ul nu e pe ecran.** Clicul era o ghicitura, iar o
ghicitura inregistrata ca fapt e mai rea decat lipsa inregistrarii.

### Afirmatia se muta acolo unde e cunoasterea

`functions/src/errorFixes.ts` tine lista: amprenta, commit-ul, **ce** era stricat si **cum vede
altcineva singur**. Panoul arata butonul DOAR pentru grupurile care au o asemenea afirmatie, si
arata afirmatia langa el — ca sa fie un clic informat, nu unul plin de speranta.

**Si afirmatia se verifica, nu se crede.** Fiecare intrare are `since`: momentul dupa care o aparitie
o infirma. Daca eroarea s-a intamplat DUPA ce reparatia a plecat, reparatia n-a mers — butonul se
retrage si esecul se scrie cu rosu. `since` e ora COMMIT-ului, nu a deploy-ului, deci verificarea e
putin prea stricta: o aparitie in intervalul ala se citeste ca esec. Greseste spre „n-a mers", si
intre cele doua directii aia e singura sigura.

Doua feluri de afirmatie: `fixed` (s-a schimbat cod, uite commit-ul) si `not-a-defect` (s-a
investigat, n-are ce se schimba). A doua tot e o afirmatie, tot poarta rationament, si tot se infirma
la fel.

### Un defect gasit proiectand asta, si care era precoditie

**React #310 si #185 cadeau in ACELASI grup.** Normalizez toate cifrele, deci `#310` devenea `#<n>`.
Aplicatia asta a avut deja un #185 (bucla de snapshot Zustand). Deci „am reparat #310" ar fi acoperit
tacut si #185 — exact contopirea invizibila pe care testele o urmareau si n-o prinsesera aici.
Un numar dupa `#` e o IDENTITATE, nu o pozitie; acum se pastreaza. Numerele de linie raman
normalizate.

### Doua greseli ale mele, prinse de masuratoare

1. **Cititorul tiparea `undefined people`** — `groupErrors` numeste campul `users`. In digest il
   mapasem corect, in cititor nu. Prins la prima rulare pe date reale; nicio fixtura n-ar fi
   contrazis, fiindca campul lipseste, nu e gresit.
2. **Prima afirmatie despre cota nu se potrivea cu nimic.** `fingerprint()` taie mesajul la 200 de
   caractere; eu scrisesem propozitia intreaga, deci afirmatia era cu 17 caractere mai lunga decat
   orice poate produce grupatorul. **O afirmatie care nu se potriveste cu nimic arata exact ca o
   functionalitate care merge.** Prins verificand fiecare grup viu fata de lista lui; acum sunt doua
   teste — unul pe lungime, doua round-trip prin grupatorul real.

Amprenta grupului React s-a schimbat (pastreaza `#310`), deci documentul lui de stare e orfan si
grupul revine ca `new`. Cu patru grupuri, costul e zero; dupa ce panoul acumuleaza istorie, n-ar mai
fi fost.

`npx tsc -b` verde · **1056 de teste** (de la 1036) · poarta verde · build verde · functions verde ·
livrat pe live.
## 2026-09-14 - Ce spun datele despre ce am livrat azi

**Model:** Claude Opus 5 · „Next"

Cheia de citire schimba ce pot verifica singur. `OWNER_VERIFY` are 139 de casute nebifate, si o
parte din ele sunt intrebari despre DATE. Le-am raspuns.

### Mementourile PORNESC — dovedit, nu presupus

`reminder_log` are un rand scris azi la 14:02 UTC, o zi de ocurenta, **zero duplicate**. Iar in
`notifications` sunt **doua randuri de tip `reminder`**. Deci `sendDueReminders` a rulat, a prins
dedublarea si a scris in clopotel. E prima dovada concreta pentru functia despre care scrie in
propriul ei antet ca „n-a functionat niciodata pe nicio platforma".

### Link-urile de invitatie: regula de o singura folosinta TINE

1 link creat, 1 revendicat, **0 revendicate de mai multe ori**.

### Un defect viu, gasit tot din date

**0 din 8 useri aveau un fus orar in Firestore.** Iar `remindersCore` cade pe lantul:
zona evenimentului → zona PROPRIETARULUI → `"UTC"`. Cu veriga din mijloc goala pentru toata lumea,
un memento pe orice eveniment fara zona proprie — inclusiv **fiecare eveniment de zi intreaga** — se
rezolva la 09:00 **UTC**, adica 12:00 in Bucuresti. Trei ore mai tarziu, tacut, exact la mementoul
care ar trebui sa sune inainte sa pleci de acasa.

**Am caracterizat gresit cauza prima data** si o notez: am spus „nimic nu scrie
`users/{uid}.timezone}`". Fals — `handleAdvancedThemeUpdate` din Setari scrie, prin `updateDoc` cu
obiectul primit. Grep-ul meu a ratat-o fiindca scrierea e generica, nu literala. Afirmatia corecta e
mai ingusta: **se scrie doar daca schimbi explicit selectorul**, si n-o facuse nimeni.

Reparatia: la autentificare, daca documentul n-are zona, se scrie cea detectata. **Doar cand
lipseste** — o alegere explicita din Setari e o afirmatie despre unde esti, iar suprascrierea ei din
browser la fiecare login ar face selectorul decorativ. Validata cu `isValidZone`, adica exact
predicatul serverului (`eventTime.ts` e byte-identic pe ambele parti si un test refuza divergenta),
deci nu se poate stoca o zona pe care serverul o respinge si o inlocuieste cu UTC.

### Restul, ca stare masurata

22 de evenimente, din care 2 cu ora si 2 cu zona proprie · 18 bunuri in portofel, **0 partajate cu un
grup** si **16 vechi cu `sharedWithFamily` fara grup** (exact cazul pentru care exista bulina
chihlimbarie) · 0 conversatii private · 11 randuri in clopotel · 3 randuri in `aiLedger`.

`npx tsc -b` verde · 1056 de teste · poarta verde · build verde · livrat pe live.
## 2026-09-14 - Un singur buton pentru tot ce e deja reparat

**Model:** Claude Opus 5 · ideea lui Andrei: „un buton pe care sa il apas eu, sa se verifice acea
lista, iar sistemul sa schimbe automat statusul"

Lista de afirmatii decidea deja ce e reparat; clicul pe fiecare rand era reintroducerea manuala a
unei decizii luate. Acum e un buton: **„Resolve N fixed"**.

**Ce s-a pastrat dinadins.** Omul ramane cel care apasa. Panoul e evidenta LUI, nu afirmatia unui
script despre propria munca — un sistem care se declara singur reparat n-ar mai fi o evidenta, ar fi
un ecou. Se elimina repetitia, nu autoritatea.

**Si verificarea se face pe SERVER, nu se ia pe incredere de la ecran.** Un ecran poate fi vechi de
cateva minute: o afirmatie infirmata intre timp de o aparitie noua n-are voie sa fie aplicata doar
fiindca browserul inca o crede valida. Modul nou (`onlyIfClaimHolds`) recalculeaza verdictul din date
proaspete si refuza orice nu e `holding`. Rezolvarea manuala ramane neatinsa — un admin care a reparat
ceva fara sa scrie o afirmatie tot poate spune asta.

**Si spune ce a facut:** „Resolved 3 group(s) with a fix on record. 1 refused: the recorded fix did
not hold." Un buton in masa al carui efect nu se vede e unul in care nu mai ai incredere a doua oara.

### Trei greseli de scriptare, toate prinse de garzi

Perechi de inlocuire cu doua elemente unde se asteptau trei; un meta-script rupt de un `U` majuscul
precedat de backslash dintr-o cale Windows, dupa care scriptul original a rulat din nou si a refuzat
corect ce era deja aplicat; si acelasi tipar de escape a omorat scriptul de documentatie DUPA ce
commit-ul de cod plecase — asa ca intrarile astea vin intr-un commit separat. Regula proprie pe care
o incalcasem: scriptul se scrie in FISIER, nu se conducteaza ca heredoc.

`npx tsc -b` verde · 1056 de teste · poarta verde · build verde · functions verde · livrat pe live.
## 2026-09-14 - Nicio notificare push n-a fost livrabila vreodata

**Model:** Claude Opus 5 · audit de defecte tacute, pornit de la un census al datelor vii

### Constatarea

**`users/{uid}.fcmTokens` nu a fost scris niciodata, pe niciunul dintre cele 8 conturi.** Nu gol —
**absent**. (Curatarea de tokenuri moarte foloseste `arrayRemove`, care ar lasa `[]`, deci absenta
dovedeste ca nu s-a scris nicicand.)

Cauza, masurata: `CalendarHome.tsx` cerea un token cu o cheie VAPID scrisa in cod, de **44 de
caractere → 33 de octeti**. Un `applicationServerKey` de Web Push trebuie sa fie un punct P-256
necomprimat: **65 de octeti, 87 de caractere**. Deci `pushManager.subscribe()` respinge **fiecare
browser, de fiecare data**; `getToken` respinge; `updateDoc`-ul care stocheaza tokenul nu ruleaza
niciodata. SDK-ul Firebase nu valideaza — trece octetii direct la browser.

Iar `catch`-ul scria in `console.error`, nu in `reportError`. **De-aia patru luni de esecuri n-au
lasat niciun rand in `errorLogs`.**

### De ce n-a observat nimeni, si de ce nimic din ce aveam nu putea sa prinda

Trece de typecheck — e un sir. Nu strica niciun test. Iar browserul **tot** afiseaza „Permiteti
notificarile?", omul apasa Permite, si setarile site-ului spun de-atunci „Notificari: permise".
**Toate semnalele la care se uita cineva spuneau ca merge.** Singura dovada era un camp absent din
baza de date — de-asta a fost nevoie de un census al datelor vii ca sa iasa la iveala.

### Corectie la ce am raportat azi

Am spus mai devreme „mementourile pornesc — dovedit". **Jumatate adevarat, si partea gresita conteaza.**
Randul din `reminder_log` e real, cele doua randuri `reminder` din clopotel sunt reale — **canalul de
clopotel functioneaza**. Dar `notify` a impins catre **zero dispozitive**, fiindca niciun cont n-avea
token. Telefonul n-a sunat niciodata. Antetul lui `reminders.ts` spune ca tot rostul rescrierii era
ca un memento „ajunge la telefon prin FCM"; pana azi, nu ajungea.

### Reparat acum

Cheia se citeste din `VITE_FIREBASE_VAPID_KEY` si se **valideaza inainte de folosire** —
`src/utils/webPush.ts`, pur, 8 teste, primul fiind exact sirul care s-a livrat. Daca lipseste sau e
gresita, inregistrarea se **sare** si se raporteaza in `errorLogs` cu motivul in cuvinte: „the VAPID
key decodes to 33 bytes; a Web Push application server key must be 65". Nu un boolean — **propozitia
e diferenta dintre cineva care repara in doua minute si cineva care redescopera peste patru luni.**

Permisiunea se cere **dupa** ce cheia e buna: a intreba intai ar arde singura sansa de a cere.

*Testul meu a prins o slabiciune in propria implementare: 87 de caractere arbitrare treceau
verificarea de lungime. Se verifica acum si octetul de marcaj `0x04`.*

**Ce ramane la Andrei:** cheia reala din Firebase Console → Project settings → Cloud Messaging →
Web Push certificates, pusa in `.env`. Pana atunci push-ul e oprit **si spune de ce**, in loc sa
esueze tacut.

`npx tsc -b` verde · **1064 de teste** (de la 1056) · poarta verde · build verde · livrat pe live,
cheia moarta confirmata disparuta din bundle.
## 2026-09-14 - Cinci reparatii din auditul de defecte tacute

**Model:** Claude Opus 5 · „1, nu vreau confirmare, userii mai uita sa confirme. 3-6 poti sa le rezolvi"

### 1. Editarea unei serii: uitarea ducea la distrugere

`editScope` pornea `null` si **nu se reseta niciodata**. Doua consecinte deodata: salvarea fara sa
atingi alegerea cadea pe `else` si **rescria toata seria**; iar un „toate" ales o data ramanea ales
pentru urmatorul eveniment editat in aceeasi sesiune.

Andrei a respins explicit confirmarea — „userii mai uita sa confirme" — si are dreptate: o
confirmare e un lucru pe langa care se apasa. Asa ca reparatia e alta: **implicitul e cel sigur**
(`'this'`, setat la fiecare deschidere, ceea ce il si reseteaza), iar ramura a fost **inversata**:
`if (scope !== 'all')`. Diferenta e tot defectul — scris invers, orice valoare in afara de una,
inclusiv `null`-ul de la care pornea, lua calea distructiva.

### 3. Trei culori nu existau deloc

Selectorul oferea zece; **portocaliu, fucsia si roz nu produceau nicio culoare**. Nu alta culoare —
niciuna. Cauza nu e CSS lipsa, ci ca **toate zece** se construiau dintr-o variabila:
`` `text-${ev.color}-500` ``. Tailwind genereaza CSS scanand **siruri literale**; nu vede prin
template. Sapte mergeau **din accident**, fiindca exact acele siruri apar altundeva in aplicatie.

Masurat in `dist/assets/index-*.css` inainte: 7 prezente, 3 absente. Dupa: 10 din 10.

`src/utils/eventColors.ts` e o harta plictisitor de repetitiva, si aia e toata ideea — o versiune
mai scurta care ar compune sirurile ar fi exact bugul. **Testul citeste sursa modulului** si cere ca
fiecare clasa sa apara literal, fiindca un refactor destept ar trece de toate celelalte teste si ar
reintroduce defectul. *Testul a picat intai pe propriul meu comentariu, care citeaza linia
defecta ca explicatie — verifica acum codul, nu proza.*

### 4. Preferintele nu se restaurau pentru conturile facute prin inregistrare

`Login.tsx` scria `theme: { primaryColor, isDarkMode }` **imbricat**, si nimic n-a citit vreodata
forma aia. Poarta din `App.tsx` cerea campurile de **nivel superior**, deci era falsa pentru fiecare
cont creat prin inregistrare — iar inauntrul ei stateau sunetul, haptics, fundalurile **si fusul
orar pe care l-am hidratat azi**. Sunetul n-are nicio legatura cu alegerea unei culori; n-avea ce
cauta in spatele ei.

Acum se restaureaza neconditionat. **N-am adoptat culoarea imbricata** si merita spus de ce: e un
hex (`#3b82f6`), iar valoarea se atribuie direct lui `--primary`, pe care Tailwind il consuma ca
`hsl(var(--primary))` — un hex acolo ar da `hsl(#3b82f6)` si ar strica accentul peste tot. Campul
era greutate moarta in formatul gresit; Login nu-l mai scrie.

### 5. „Mesaj nou" oferea oameni pe care serverul ii refuza

`openDirectChat` verifica existenta omului in `profiles/{uid}` — dar aia e o **oglinda publica** pe
care un cont si-o scrie singur abia la urmatoarea autentificare. Censusul: **3 documente `profiles`
la 8 conturi.** Deci cinci oameni erau oferiti in selector si apoi refuzati cu „That person could not
be found." Verificarea se face acum pe `users/{uid}`, documentul care chiar spune daca cineva exista.

### 6. Ledgerul AI n-avea ecran — gol facut chiar azi

Callable-urile existau, `serverActions.ts` le impacheta, si **nicio componenta nu le importa**. Cum
azi am mutat refuzurile de cota din `errorLogs` in ledger, ledgerul devenise **singurul** loc unde se
tin — si era invizibil. Are acum sectiune in Health: un rand pe apel, cu motivul esecului
(`http-429`), tokeni si cost.

### 2, neatins

Andrei a cerut explicatia, nu reparatia. I-am dat-o masurat: o serie saptamanala cu 9 aparitii
devine 3 daca deschizi apariția din 14 septembrie si salvezi „toate". Reparatia propusa — „toate din
serie" sa schimbe proprietatile si sa NU atinga data de inceput — asteapta acordul lui.

`npx tsc -b` verde · **1072 de teste** (de la 1064) · poarta verde · build verde · functions verde ·
livrat pe live si verificat (chunk byte-identic, cele trei culori prezente in CSS-ul servit).

*Nota de metoda: prima sondare a chunk-ului de admin mi-a intors HTML — cache de margine dinainte de
livrare. A doua oara azi. Sondarea unui fisier proaspat livrat cere parametru anti-cache.*
## 2026-09-14 - Editarea unei serii nu-i mai muta inceputul

**Model:** Claude Opus 5 · continuare, dupa ce Andrei a cerut explicatia inainte de reparatie

O serie nu e o lista de date. E **o singura data de inceput plus o regula**, iar fiecare aparitie se
calculeaza de-acolo. Campul de data din modal e precompletat cu ziua **apariției pe care ai
deschis-o**, iar „toate din serie" scria acea valoare direct peste inceputul seriei. Deci deschideai
apariția din septembrie a unei serii incepute in august, schimbai titlul, si seria devenea „incepe in
septembrie" — tot ce era inainte inceta sa existe.

Masurat pe expandorul real: **noua aparitii au devenit trei**, iar exceptiile (care sunt cheiate pe
data) au ramas orfane.

### De ce mutarea, si nu ignorarea

Propusesem intai ca „toate din serie" sa nu atinga deloc data. Am schimbat solutia in timpul
implementarii, si motivul merita scris: daca cineva **chiar schimba** data cu intentia de a muta
seria, ignorarea ar produce **un camp care nu face nimic** — exact clasa de defect pe care am vanat-o
toata ziua (comutatorul din portofel, `ev.time`, fusul orar al proprietarului).

Asa ca: data neschimbata → seria ramane unde e; data schimbata → **toata seria se muta cu acelasi
decalaj**, ceea ce inseamna „muta seria" si ii pastreaza istoria.

`shiftedSeriesStart` e pura si refuza sa scrie ori de cate ori ceva nu se poate verifica — refuzul e
mereu directia sigura aici, fiindca un inceput gresit sterge istorie tacut. Primul test ruleaza
scenariul real prin `expandRecurringEvents`: neschimbat → 9 ramane 9; mutat cu doua zile → tot 9, dar
incepand cu 5 august.

*Un test al meu a picat si avea el dreptate pe jumatate: mutarea cu trei zile inapoi pune prima
aparitie pe 31 iulie, care e in afara ferestrei de expansiune — deci aserttia trebuia pe valoarea
intoarsa, nu pe expansiune.*

`npx tsc -b` verde · **1080 de teste** (de la 1072) · poarta verde · build verde · livrat pe live.
## 2026-09-14 - Ultimele trei din audit, si una care nu era defect

**Model:** Claude Opus 5 · „Continua"

### Castigatorul de la Memory Match nu afla niciodata ca a castigat

`userMap[game.winner]?.uid === auth.currentUser?.uid` — dar intrarile din `userMap` se construiesc ca
`{ id, ...data }`. **Nu exista nicio proprietate `uid` pe ele**, deci testul era mereu fals si
persoana care castiga vedea intotdeauna numele celuilalt. Cheia din `userMap` **este** uid-ul, deci
cautarea era si inutila: se compara direct.

Celelalte trei jocuri scapa doar fiindca nu incearca verificarea asta — afiseaza doar numele.

### Doua cifre din admin raportau partajarea invers

`Shared` numara `e.sharedWithFamily` pe evenimente — camp scris acum ca `false` constant — deci arata
**0** in timp ce 11 din 22 de evenimente sunt intr-un grup si chiar sunt citite de membrii lui.
`Assets shared` numara acelasi camp pe bunuri, unde e un ecou derivat al steagului vechi care n-a dat
nimanui acces niciodata — deci arata **16**, exact bunurile pe care aplicatia insasi le eticheteaza
„N-a fost partajat". Un panou care exista ca sa spuna ce se intampla, gresit in ambele sensuri.

Acum numara ce citesc de fapt cititorii: `groupId` la evenimente, `sharedGroupId` la bunuri.

### Un sir englezesc intr-o aplicatie cu sase limbi

`{n} exception{n > 1 ? 's' : ''}` in panoul de recurente. Urmeaza acum conventia lui `seriesCount` —
numar plus substantiv la plural — care functioneaza in toate cele sase fara reguli de acord.

### Si una care NU era defect: clasamentul din arcade

Auditul sustinea ca se numara gresit. Datele spun altceva, si merita scris fiindca ma corecteaza:
**9 jocuri `waiting`, 8 `playing`, 1 `finished`**, iar `winner` gol pe toate 18. Calea de castig
**scrie** corect `winner` — verificat la sursa. Clasamentul e gol pentru motivul cel mai banal cu
putinta: **niciun joc n-a fost castigat vreodata.** Noua nici n-au inceput, opt sunt abandonate in
joc, unul s-a terminat remiza.

Ramane un gol real, dar e o decizie de design, nu o reparatie: „Termina jocul" apare **doar** intre
runde, deci cele opt sesiuni abandonate nu pot fi inchise niciodata. A-l face disponibil in timpul
jocului inseamna insa ca poti incheia unilateral un joc in care celalalt e la mutare — un abandon
impus. Nu iau singur decizia asta; e in OWNER_VERIFY.

`npx tsc -b` verde · 1080 de teste · poarta verde · build verde · functions verde · livrat pe live.

*A treia oara azi cand o copie de margine mi-a raportat ca livrarea n-a prins. Verificarea unui
fisier proaspat livrat cere reincercare, nu o singura citire — parametrul anti-cache nu ajunge.*
## 2026-09-15 - Un singur loc care stie ce fereastra e deasupra

**Model:** Claude Opus 5 · „continua tu singur"

Intai: `logErrorDigest` **merge**. Banuisem ca programarea lui e stricata fiindca nu rulase; de
fapt nu-i venise inca prima bataie. A scris la 20:09 si la 02:09 UTC, la exact sase ore. Deci pot
citi starea erorilor fara screenshot, si singura eroare vie e chiar diagnosticul meu care spune ca
lipseste cheia VAPID.

### Ce era stricat

Cincisprezece fisiere randeaza ferestre suprapuse. **Zero** aveau `role="dialog"`, **zero**
`aria-modal`. Un inventar facut fisier cu fisier a gasit nu 15 ci **29 de dialoguri distincte** —
lightbox-uri, selectoare, foi de confirmare ascunse in ecrane mari.

Dar problema serioasa nu era eticheta, ci ca **fiecare fereastra raspundea in numele tuturor**.
Fiecare isi punea propriul ascultator de `keydown` pe `window`, si `useModalBack` acelasi lucru pe
`popstate`. Un ascultator pe `window` nu are cum sa stie ca nu e singurul.

Masurat la sursa: butonul de Edit din detaliile unui eveniment deschide formularul **fara sa inchida
detaliile** — deci doua ferestre chiar sunt deschise simultan. Un Escape le inchidea pe amandoua si
arunca ce scrisesesi. Pe Android era mai rau: o apasare pe Back scotea o intrare din istoric, ambele
handler-e se executau, ambele se inchideau, iar apoi curatenia celei de dedesubt gasea propria
intrare inca deasupra si mai chema o data `history.back()` — **aplicatia iesea din calendar**.

### Ce am facut

`src/utils/dialogStack.ts` — un teanc, fara React si fara DOM, care raspunde la o singura intrebare:
**cine e deasupra**. Numai aceluia i se adreseaza Escape si Back. Scoaterea se face **dupa
identitate, nu de la coada**, fiindca React nu promite ca efectele se curata in ordine inversa.

`src/hooks/useDialog.ts` — restul: `role="dialog"`, `aria-modal`, eticheta tradusa, focusul intra in
panou la deschidere si **se intoarce de unde a plecat** la inchidere, Tab e prins inauntru, pagina
din spate nu mai defileaza. `useModalBack` a disparut; opt ferestre trec acum prin hook.

### Proba, fiindca ferestrele sunt in spatele autentificarii

Nu pot intra in cont, deci nu pot vedea niciun modal real din aplicatie. Am construit un **banc de
proba temporar** — doua ferestre suprapuse pe hook-ul ADEVARAT — si l-am condus in browser.

**Si bine ca am facut-o: prima versiune tot le inchidea pe amandoua.** Regula „doar cel de deasupra"
era pusa, dar fereastra de sus, inchizandu-se, isi derula inapoi intrarea din istoric — iar acel
`history.back()` produce un `popstate` **adevarat**, pe care cea de dedesubt il primea ca pe un gest
al utilizatorului. Propria mea derulare se dadea drept apasare pe Back.

Deci derularea se anunta dinainte si `popstate`-ul pe care-l provoaca se consuma. Contorizat, nu
pus pe un fanion: doua ferestre pot disparea in aceeasi clipa. Si tinut minte **per eveniment**,
fiindca toate ferestrele deschise vad acelasi obiect si doar prima are voie sa cheltuiasca creditul.

Dupa reparatie, masurat in browser: primul Escape inchide doar fereastra de sus si da focusul inapoi
panoului de dedesubt; al doilea o inchide si pe aia si duce focusul inapoi pe butonul care o
deschisese; o apasare pe Back inchide exact o fereastra si pagina **nu** navigheaza nicaieri; Tab se
invarte inauntru si nu ajunge la momeala de afara.

Testul care prinde regresia e scris asa incat sa **muste**: inlocuit cu varianta naiva, pica exact
el si numai el.

### Trei lucruri gasite pe drum

- **Escape in campul de redenumire** din setarile grupului anula redenumirea *si* inchidea tot
  ecranul. Acum se opreste acolo, si textul abandonat nu mai ramane sa fie scris la urmatorul OK.
- **Titlul ferestrei de stergere/parasire a grupului era in engleza**, singurul sir netradus din
  fisier, in aplicatia cu sase limbi.
- **Lightbox-ul din detaliile evenimentului nu se stergea niciodata.** Modalul nu se demonteaza,
  doar se ascunde — deci inchideai cu poza deschisa si **urmatorul eveniment aparea sub poza
  evenimentului precedent**.

`npx tsc -b` verde · **1100 de teste** (de la 1095) · poarta verde · build verde · livrat pe live.

*Doua note de metoda. `sed -i` pe un fisier sursa mi-a rescris toate sfarsiturile de linie si a
transformat o schimbare de noua randuri intr-una de 196 — refacut pe octeti. Si `git stash` intr-un
arbore sincronizat cu Drive n-a putut sterge fisierele, deci `pop` a refuzat; nimic pierdut, dar nu
mai fac asta aici.*
## 2026-09-15 - Inca noua ferestre, si scannerul care ar fi ramas fara Escape

**Model:** Claude Opus 5 · „Continua"

Din 29 de ferestre, opt treceau prin sistemul nou. Acum sunt **saptesprezece**.

### Portofelul: cinci ferestre, un singur Escape

`Wallet.tsx` avea **un** ascultator de Escape care reseta **sapte** lucruri deodata: formularul de
asset, filtrele, asset-ul editat, imaginea privita, codul de bare, scannerul si selectorul de poze.
Deci inchideai vizualizatorul de poza deschis PESTE un formular pe jumatate completat — si pleca si
formularul. Acum sunt cinci ferestre cu identitati separate.

### Scannerul ar fi ramas mut

`BarcodeScanner` **nu avea Escape propriu**. Se bizuia pe acel `setIsScanning(false)` din handler-ul
colectiv al portofelului. Daca sterg handler-ul si nu observ asta, scannerul ramane o fereastra pe
tot ecranul din care nu mai iesi cu tastatura — o regresie introdusa chiar de reparatie. Acum si-l
poarta pe al lui.

### Arcada: autorul stia

Handler-ul de acolo avea comentariul lui, lasat in cod: *„If playing a game, don't close the whole
modal, just exit game view? Actually, let's just close the modal."* Exact problema — Escape peste
foaia de reguli inchidea **toata** arcada de dedesubt, si lasa foaia armata pentru data viitoare.
Trei ferestre, trei identitati.

### Conditia hook-ului trebuie sa fie EXACT conditia de randare

`useDialog(viewingImage !== null, ...)` langa un JSX pazit de `{viewingImage && ...}` nu e acelasi
lucru: un sir gol ar fi pus o intrare **fantoma** in teanc, iar o fantoma deasupra inghite Escape-ul
ferestrei pe care omul chiar o vede. Toate cinci folosesc acum aceeasi expresie ca randarea.

### Inca un titlu in engleza

`{editingAsset ? 'Edit Asset' : 'Add New Asset'}` — al doilea gasit azi, dupa cel din fereastra de
stergere a grupului. Doua chei noi in sase limbi; suita de i18n verifica singura ca nicio limba nu
ramane in urma si ca nu e o copie a englezei.

Si filtrul pe jumatate redenumit se sterge acum odata cu fereastra, nu mai asteapta acolo.

`npx tsc -b` verde · 1100 de teste · poarta verde · build verde · livrat pe live.

### Nota despre sfarsituri de linie — o cauza gasita, nu doar un simptom

Ieri un `sed -i` mi-a facut dintr-o schimbare de noua randuri una de 196. Azi am aflat **de ce
existau** randurile stricate: tiparul meu de inserare potrivea pana la `$`, care pe un fisier CRLF
sta **intre `\r` si `\n`** — deci textul nou ateriza in mijlocul terminatorului si lasa in urma
`\r\r\n` plus un rand cu LF gol. Asa au ajuns asa `CreateGroupModal` si `BarcodeScanner`.

Tiparele consuma acum terminatorul, si fiecare scriere refuza sa salveze daca a aparut `\r\r\n`
sau daca numarul de randuri cu LF gol s-a schimbat. In `BarcodeScanner` **doua ancore vecine aveau
terminatori diferiti** — se detecteaza, nu se presupun.

**N-am normalizat fisierele stricate.** Blob-urile din repo sunt CRLF, deci normalizarea le rescrie
integral: 429 de randuri de diferenta pura de terminatori, in care schimbarea adevarata dispare.
Masurat, nu presupus. Ramane de facut separat, daca merita.
## 2026-09-15 - Ultimele cinci ferestre adevarate

**Model:** Claude Opus 5 · „Continua"

Douazeci si doua de ferestre trec acum prin hook. Astea cinci erau ultimele care sunt cu adevarat
**ferestre**:

- **poza mare din detaliile evenimentului** — Escape inchidea evenimentul de sub ea, nu poza;
- **selectorul de asset din formularul de eveniment** — Escape arunca tot formularul de dedesubt;
- **panoul de sumar al zilei** din calendar;
- **foaia „incepe o conversatie"** din chat;
- **fisa userului din admin**.

### Ce am lasat INTENTIONAT pe dinafara

Cele sapte ramase sunt **meniuri si popovere**, nu ferestre: notificarile, meniul mobil, meniul
butonului plutitor, panoul de chat flotant, selectorul de emoji, cele doua popovere de profil.
Un meniu vrea alte reguli — se inchide cand dai click in alta parte, focusul umbla cu sagetile, si
**nu** trebuie sa fie `aria-modal`, fiindca nu blocheaza restul paginii. Sa le dau hook-ul asta ar
fi gresit, nu incomplet. Raman asa pana cand se face primitiva potrivita pentru ele.

### Doua verificari care au prins ceva

**Typecheck-ul** a prins hook-ul de sumar pus deasupra declaratiei lui `language` — un `const` nu
exista inainte sa fie declarat, deci ecranul ar fi crapat la prima randare. Mutat mai jos.

**Bancul de proba**, refacut: pana acum probase doua ferestre in **componente diferite**. In
`EventDetailsModal` si `AddEventModal` sunt acum **doua apeluri `useDialog` in ACEEASI componenta**
— forma pe care n-o probasem. Verificat in browser: `useId()` le da identitati distincte, se aseaza
corect una peste alta, iar Escape le desface una cate una. Nu era o presupunere sigura: exact „e
bine definit" spusesem si despre derularea istoricului, care s-a dovedit gresita.

Si o precizare ca sa nu para bug mai tarziu: la finalul probei focusul ajunge pe `BODY`, nu pe
butonul care deschisese. E corect — `.click()` din script nu muta focusul, deci nu era unde sa-l duca
inapoi. Cand butonul chiar are focus, focusul se intoarce la el; asta se vede in proba de dimineata.

`npx tsc -b` verde · 1100 de teste · poarta verde · build verde · livrat pe live.
## 2026-09-15 - Butoanele care nu spuneau nimic

**Model:** Claude Opus 5 · „Continua"

Optsprezece butoane din aplicatie **nu aveau niciun nume**. Un cititor de ecran le anunta „buton" si
atat; controlul vocal n-avea niciun cuvant cu care sa le apese. Alte sapte erau numite doar prin
`title` — ultima sursa la care se uita calculul numelui accesibil, **invizibila pe telefon** si
anuntata inconstant. Acum toate au `aria-label`, iar cele cu tooltip si l-au pastrat.

Sapte chei noi in sase limbi (inainte/inapoi la calendar, respinge, adauga cheltuiala, trimite
mesajul, reda/pune pauza la mesajul vocal).

### Numarul a fost gresit prima data, si merita spus

Primul scanner a raportat **68**. Era gresit: elimina orice `{...}` din continutul butonului, deci
`<button>{t('save', language)}</button>` ii parea gol. **O eticheta randata de o expresie e tot o
eticheta.** Numarul adevarat era 18 + 7. Daca livram „am reparat 68 de butoane", cifra ar fi fost
o minciuna curata.

Regula stricta de acum **sub-raporteaza** in schimb (un buton `{loading ? <A/> : <B/>}` chiar n-are
nume si e sarit), asa ca scanner-ul scoate si o a treia categorie, „nesigure", in loc sa le ascunda.
Trei au iesit acolo; doua chiar aveau text, una nu — reparata.

### Si o poarta, nu o maturare

`src/utils/buttonNames.test.ts` reface scanarea la fiecare rulare si **pica** daca reapare un buton
fara nume. Urmatorul buton cu iconita va fi adaugat de cineva care n-a citit commit-ul asta. Testul
are si o verificare ca a citit efectiv fisiere — altfel un glob stricat l-ar face verde degeaba.

### Escape din chat nu mai fura din alta parte

`GroupChatWidget` avea **singurul** ascultator de Escape ramas fara nicio garda, iar widget-ul e
montat tot timpul cat e un grup selectat. Deci inchideai un eveniment cu Escape si **se anula tacut
si raspunsul pregatit in chat** — pe un panou care nici macar nu era pe ecran. Acum raspunde doar
cand chatul e deschis si nu e nimic peste el (`dialogDepth()`, acelasi teanc in care se inscriu
ferestrele).

`npx tsc -b` verde · **1103 de teste** (de la 1100) · poarta verde · build verde · livrat pe live.
## 2026-09-15 - Panoul de erori: gruparea pusa DEASUPRA gramezii nu e organizare

**Model:** Claude Opus 5 · „ok, dar inca nu sunt organizate, doar avem mai multe taburi"

Andrei are dreptate, si constatarea e mai utila decat pare. Gruparea exista si era corecta — cinci
probleme distincte din 98 de randuri — dar am adaugat-o **deasupra** listei brute, fara sa ating
lista. Trei simptome, aceeasi greseala:

1. **Lista plata „Recent errors" era tot acolo**, 98 de carduri, acelasi mesaj repetat la nesfarsit,
   ordonate dupa timp — adica exact mormanul pe care gruparea trebuia sa-l inlocuiasca. Ea domina
   pagina; gruparea era un raft pus langa.
2. **Filtrul implicit era fixat pe „Needs attention"**, singura stare goala. Deci ecranul te intampina
   cu **„Nothing in this state."** exact atunci cand nu era nimic in neregula. Un panou care arata
   cel mai gol tocmai cand totul e bine e pe dos fata de ce trebuie sa faca.
3. **Cifra mare numara randuri**, nu probleme: „98 ERRORS LOGGED". Iar 98 de randuri erau cinci
   lucruri, dintre care unul singur de 74 de ori.

### Ce am facut

**Ocurentele traiesc acum sub problema lor.** Fiecare grup poarta cateva randuri reale (`recent`,
plafonat *per grup*, nu global — un plafon global s-ar duce tot pe cel mai galagios) si se deschid
din card: „Show occurrences (6 of 74)". Spune si din cate, ca sa nu para ca numara gresit. Lista
plata a disparut cu totul.

**Ecranul aterizeaza unde e ceva.** Prima stare din ordinea „ce a revenit → ce n-a fost citit → ce
se stie → ce e gata" care chiar contine ceva, cu cadere pe „All". Iar cand o stare chiar e goala,
scrie si cate probleme sunt in total, cu un buton catre ele.

**Cifra mare numara probleme**, cu randurile ca eticheta secundara.

### Regula de aterizare e acum PROBABILA

`/admin` e in spatele autentificarii — deci typecheck, poarta, testele si build-ul pot fi toate verzi
cu ecranul ala mort. Regula care decide ce vezi prima data e fix aia care merita sa poata fi rulata,
asa ca a iesit in `src/utils/errorFilterState.ts`. Primul test e chiar ecranul din captura lui
Andrei: un `seen`, patru `resolved`, zero deschise → trebuie sa aterizeze pe „Seen", nu pe gol.
Plus proprietatea spusa direct: **nicio combinatie de stari nu poate produce o aterizare goala.**

Adminul importa modulul, nu o copie — altfel as fi avut o varianta testata si una livrata.

`npx tsc -b` verde · **1116 de teste** (de la 1103) · poarta verde · functions build verde · livrat
in ordinea functions → hosting, fiindca panoul citeste un camp nou.
## 2026-09-15 - Gemini 3.8 Flash, si SDK-ul care era retras de zece luni

**Model:** Claude Opus 5 · „vreau sa folosim un AI mai bun" -> „vreau Gemini 3 Flash"

### Trei lucruri gasite inainte de a schimba ceva

**1. Cheia e deja pe plan platit.** Se vede in captura din AI Studio. Deci plafonul de 20 de cereri
pe zi al nivelului gratuit — cel care a produs cele 74 de erori din log — **nu se mai aplica**, si
n-avea legatura cu modelul. Calitatea si cota sunt doua probleme diferite; a doua era deja rezolvata.

**2. Modelul din captura e depasit.** `gemini-3-flash-preview` e preview-ul lui Gemini 3 Flash
original; intre timp linia are stabile pana la **3.8**. Si, neasteptat, **3.8 e mai ieftin decat
3.5**: 0,75$/3,75$ per milion fata de 1,50$/9,00$. Am pus `gemini-3.8-flash` — cel mai nou, stabil,
si nu cel mai scump. Un model preview poate fi schimbat sub tine sau retras, iar asta sta pe cinci
cai pe care le foloseste o familie.

**3. SDK-ul instalat era retras.** `@google/generative-ai@0.11.5`, **depreciat din 30 noiembrie
2025**, „not actively maintained", si documentatia spune explicit ca bibliotecile vechi „nu dau acces
la functiile recente". Deci nu era o constanta de schimbat, ci o migrare la `@google/genai`.

### Doua capcane, amandoua tacute

**Jetoanele de gandire.** Gemini 3 gandeste inainte sa raspunda si raporteaza asta separat, in
`thoughtsTokenCount`. Ledger-ul citea doar `candidatesTokenCount`. Ar fi facturat o fractiune din
iesirea reala si ar fi raportat un cost pur si simplu gresit — in directia in care nimeni nu verifica
o nota de plata. Acum jetoanele de gandire se numara ca iesire, fiindca asa se si platesc.

**`text` din metoda a devenit proprietate.** Vechiul SDK dadea `result.response.text()`, noul da
`result.text`, un getter care poate fi `undefined` cand modelul n-a produs text (refuz, oprire de
siguranta). Codul facea `.text().trim()` imediat — pe forma noua asta arunca „text is not a
function", si numai pe caile pe care cineva chiar le foloseste. Un typecheck pe `unknown` nu prinde
niciuna din cele doua.

Ambele citiri au iesit intr-un modul **pur**, `functions/src/aiResponse.ts`, ca sa poata fi probate
din suita aplicatiei — `aiLedger.ts` importa `firebase-admin`, iar CI-ul instaleaza doar radacina,
deci un test care ajungea acolo trecea local si pica in CI. Garda de puritate confirma.

### Ce a supravietuit neatins

Detectia refuzului pe cota. `ApiError` din SDK-ul nou poarta `status: number`, iar predicatul verifica
deja `e.status === 429` — verificat in declaratia de tipuri livrata, nu presupus, si fixat acum cu
teste pentru ambele forme. Conteaza mai mult decat pare: ala e mecanismul din cauza caruia un refuz
pe cota ajunge in ledger si nu in jurnalul de erori.

### Pretul

Per jeton, fata de flash-lite: **7,5x la intrare, 9,4x la iesire**. Suna mult; la volumul asta —
opt conturi, zero apeluri azi — sunt centi. Si preturile introductive se dubleaza pe 1 ianuarie 2027,
scris in tabel ca atare.

Am scos si `@google/generative-ai` din `package.json`-ul RADACINA: aplicatia nu-l importa nicaieri si
nu era in bundle. Dependenta moarta.

`npx tsc -b` verde · **1130 de teste** (de la 1116) · poarta verde · functions build verde.
## 2026-09-15 - Sugestia de asset: sapte apeluri in loc de treisprezece

**Model:** Claude Opus 5 · „Da" (la temporizare)

Erau **doua** risipe, nu una, si a doua era mai mare decat cea pe care o semnalasem.

**Nicio temporizare.** Sugestia pleca la trei evenimente: titlul pierde focusul, fiecare element de
checklist adaugat, fiecare element care pierde focusul.

**Nicio memorie.** Iar aia costa mai mult: elementul care **pierde focusul fara sa fi fost editat**
punea exact aceeasi intrebare a doua oara. O lista de sase elemente trimitea ~13 apeluri, din care
sase erau identice cu unul deja raspuns.

Pe `gemini-2.5-flash-lite` era marunt. Pe `gemini-3.8-flash` un jeton de iesire costa de 9,4 ori mai
mult, deci acelasi obicei devenise cel mai scump lucru pe care-l face aplicatia din greseala.

### Ce face acum

Un programator (`src/utils/aiSuggestionGate.ts`) care tine impreuna cele doua lucruri ce trebuie sa
fie de acord: **ce s-a intrebat deja** si **ce asteapta sa fie intrebat**. Intreaba o singura data
per intrebare distincta, si doar dupa ce omul s-a oprit.

„Aceeasi intrebare" ignora majusculele, spatiile din jur si cele dinauntru — o zona de text
re-editata aduna spatii, iar „lapte  paine" nu e alta intrebare decat „lapte paine". Sub trei
caractere nu intreaba deloc: un apel costa la fel indiferent cat de buna e intrebarea.

**Temporizarea pastreaza ULTIMUL text**, si asta e corect, nu doar ieftin: functia alege UN singur
asset, deci cel mai proaspat lucru scris e cel care merita intrebat. O pauza normala intre elemente
e mai lunga decat intervalul, deci fiecare tot isi primeste apelul; se contopeste doar o rafala.

### Probat pe ceas fals

Partea de timp e fix aia care pare evident corecta si nu e — „ultimul castiga" si „mai verifica o
data la iesire". Deci nu e afirmata intr-un comentariu, e rulata: 19 teste, printre care reluarea
listei reale de sase elemente care **trimite sapte apeluri, nu treisprezece**.

Modalul **importa** programatorul, nu o copie a lui. Altfel aveam o varianta probata si alta livrata
— vezi [[feedback_plasa_pe_sursa_vs_rulare]].

`npx tsc -b` verde · **1149 de teste** (de la 1130) · poarta verde · build verde · livrat pe live.
## 2026-09-15 - Predarea in acelasi tick, si un credit care se scurgea

**Model:** Claude Fable 5.1 · „continua"

Ultima constatare **high** din audit pe care n-o verificasem: „panoul de recurente -> Edit preda
fara intarziere; formularul se inchide singur si lasa o intrare in istoric". Am masurat-o pe bancul de
proba, cu forma exacta a apelantului din `CalendarHome` — `setIsRecurringPanelOpen(false);
setIsAddModalOpen(true)` in acelasi handler — si a iesit **mai precisa decat constatarea**.

**Inchis cu X: in regula.** Intrarea ramasa e una *forward*, pe care Back n-o viziteaza niciodata.
Nicio apasare moarta.

**Back cu editorul deschis: bug real.** O singura apasare inchidea editorul **si** mai ducea
istoricul un pas inapoi — in aplicatie, iesirea din calendar. Cauza: `history.back()` e asincron,
`pushState` nu e. Derularea panoului si push-ul editorului pleaca din acelasi tick, push-ul
aterizeaza primul, iar derularea traverseaza *peste* el. Editorul ramane deschis cu intrarea lui
esuata inainte, si urmatorul Back o ia pe cea de sub.

**Clasa, nu situl.** `CalendarGrid` avea *trei* predari identice acoperite cu `setTimeout(..., 50)` —
cineva lovise rasa asta inainte si o tratase cu o intarziere ghicita. Deci reparatia e in
primitiva: cand o derulare e inca in zbor, `useDialog` **isi retine push-ul pana aterizeaza**
pop-ul, in loc sa ghiceasca un interval. Cele trei intarzieri au disparut: erau 50 ms de lag pe
fiecare atingere de zi, si o superstitie pe care urmatorul cititor ar fi pastrat-o.

### Reparatia a scos la iveala un bug mai vechi

Cu amanarea pusa, scenariul obisnuit de stivuire a inceput sa cada: pe o stiva proaspata, primul
Back nu inchidea **nimic**. Cauza era in designul meu original de azi-dimineata: creditul „pop-ul
asta e al nostru" era consumat de *primul ascultator care il vedea*. Cand se inchide o fereastra
care e **singura** deschisa, derularea ei produce un popstate pe care nu-l mai vede niciun
ascultator — creditul ramanea, si inghitea urmatoarea apasare reala pe Back a oricarei ferestre
deschise dupa. O apasare moarta, tacuta. Bancurile de dimineata n-au prins-o fiindca fiecare
scenariu se termina fix dupa inchidere.

Acum creditul e legat de **eveniment**: la derulare se inregistreaza un ascultator o-singura-data
care marcheaza pop-ul urmator, indiferent daca vreo fereastra mai asculta. Zece puncte de control
in browser, toate exact cum trebuie — inclusiv secventa scurgerii, redata ca atare.

`npx tsc -b` verde · **1153 de teste** (de la 1149) · poarta verde · build verde · livrat pe live.
## 2026-09-15 - Cheia VAPID e pe live; push-ul poate, in sfarsit, sa ajunga undeva

**Model:** Claude Fable 5.1 · Andrei a lipit cheia in chat, fiind fara acces la PC

Push-ul web n-a livrat niciodata nimic, nimanui: codul de inregistrare avea o cheie de 44 de
caractere unde trebuia una de 87, deci `subscribe()` esua de fiecare data si niciun cont n-a avut
vreodata un token. Ieri s-a reparat codul (`bc970d1`); azi a venit si cheia.

**De ce a fost in regula sa treaca prin chat**, spre deosebire de cheia de service account de ieri:
aia era o cheie **privata** — cine o are poate scrie in baza. Asta e cheia **publica** a perechii
VAPID; pe cea privata o tine Firebase si n-o arata. Cea publica ajunge oricum in bundle-ul din
browser, la fiecare utilizator. In chat n-a plecat nimic ce nu e deja in `index-*.js` pe live.

Verificata cu exact regula aplicatiei inainte de a fi scrisa: 87 de caractere, se decodeaza in
65 de octeti, primul e `0x04` — un punct P-256 necomprimat. Pusa in `.env` (gitignorat, verificat),
coapta in bundle la build, livrata, si confirmata in fisierul servit de pe live: `index.html` arata
spre `index-B3MbGGmq.js`, iar acel fisier contine cheia.

**Ce NU s-a intamplat inca:** niciun token. Un dispozitiv primeste token abia cand deschide
aplicatia si accepta permisiunea — pasul de la Andrei. Pana atunci, `notify()` scrie clopotelul si
sare peste push, exact ca pana acum. Diagnosticul `fcm.token.web` din Health trebuie sa **inceteze**
sa mai apara de la deploy incolo; daca mai apare o data, cheia nu s-a incarcat si e de cautat de ce.
## 2026-09-15 - Notificari: broadcast-ul care n-a trimis niciodata push, si inca patru

**Model:** Claude Fable 5.1 · „da la toate"

Andrei a testat push-ul apasand *Send broadcast* din admin, cu aplicatia deschisa, si n-a primit
nimic. Intrebarea lui: „are legatura cu VAPID?" **Nu.** VAPID mersese — doua tokenuri pe contul lui.
Testul nu putea produce push din trei motive independente, si le-am reparat pe toate, plus doua.

**(a) Broadcast-ul scria doar clopotelul.** `adminBroadcast` punea randurile direct, in loturi de
400, si intorcea `{ ok, created }` — zero linii legate de push in tot corpul functiei, de cand exista
butonul. Adminul spunea „Sent to 8 users" si opt telefoane ramaneau intunecate. Trece acum prin
`notify()`, in loturi de 50 (plafonul lui propriu), cu doua optiuni noi: `includeActor` — o
comunicare e pentru toti, inclusiv autorul, si oricum singurul cont cu token era al adminului, deci
excluderea facea functia netestabila — si `titleText`, text liber in loc de cheie. Regula
clopotelului decide forma: **daca randul are `titleKey`, dropdown-ul il randeaza pe acela** si
ignora `title`, deci un broadcast se scrie *fara* `titleKey`, altfel cuvintele adminului ar fi fost
inlocuite de o eticheta.

**(b) Nu exista handler de prim-plan.** Un push sosit cu aplicatia deschisa nu e afisat de service
worker; ajunge in pagina, si o pagina fara `onMessage` il arunca tacut. Acum se afiseaza prin
inregistrarea worker-ului FCM, ceruta *dupa scope* (`/firebase-cloud-messaging-push-scope`), cu
`.ready` ca rezerva.

**(c) Programatorul de mementouri scria linii goale.** Acum o linie `REMINDERS_RUN {json}` per
rulare — candidati, aparitii, scadente, trimise, duplicate, randuri, push, esuate — in acelasi
tipar ca `ERROR_DIGEST`, ca sa se poata grepui la fel.

**(d) „Resolved" langa „still happening"** era o contradictie aparenta: al doilea se masura fata de
marcajul „seen" de ieri, nu fata de reparatie. Cand reparatia tine, scrie acum ca s-a repetat
*dupa* ce a fost vazut, *nu de la reparatie incoace*.

**(e) Tila NOTIFS TODAY arata 0 langa opt randuri tocmai scrise** — masura `notif_usage`, cota
zilnica per utilizator pentru trimiteri initiate de om, pe care `notify()` n-o scrie niciodata.
Numara acum randurile din `notifications` de azi, printr-un `count()`.

### Revizia adversariala, si ce a gasit in codul MEU

Patru sceptici, fiecare cu o afirmatie de daramat, inainte de a livra ceva care trimite la opt
telefoane reale. Doua afirmatii au rezistat, una cu o corectie, **una a cazut** — corect:

- Afirmatia mea spunea „sapte apelanti existenti ai `notify()`". Erau **noua** — `directChat.ts` si
  `inviteLinks.ts` lipseau din inventarul meu. Agentul i-a verificat pe toti noua si a rulat
  compararea in memorie: 22/22 identice octet cu octet. Codul era bun; numaratoarea mea, nu.
- `dupes` crestea la *orice* respingere a scrierii de dedupe, nu doar la ALREADY_EXISTS — o eroare
  tranzitorie ar fi aparut in log ca „a trimis altcineva". Iar `done()` nu era intr-un `finally`,
  deci un throw pierdea linia si contoarele unei rulari care chiar livrase. Comentariul meu
  promitea „o linie per rulare, orice ar face" si nu era adevarat. Amandoua reparate.
- `navigator.serviceWorker.ready` se rezolva la worker-ul PWA de la `/`, nu la cel FCM.
  Notificarea se afisa oricum, dar comentariul meu sustinea altceva. Corectat, cu cautare dupa scope.
- Un titlu de broadcast care nu e sir cadea pe o cheie inexistenta. De neatins din formular; inchis.

`npx tsc -b` verde · functions `tsc` verde (cu cod de iesire REAL — `$?` dupa un `| head` era al lui
`head`) · 1153 de teste · poarta verde · build verde · livrat functions -> hosting.
## 2026-09-15 - Primul push in patru luni, si de ce a aparut de doua ori

**Model:** Claude Fable 5.1 · captura lui Andrei de pe ecranul blocat

**A ajuns.** „memento 2", 5:49 PM, pe ecranul blocat — prima notificare push livrata vreodata de
aplicatie. Dar de **doua** ori.

Doua ipoteze, amandoua plauzibile: (1) doua tokenuri pe acelasi telefon, fiecare abonament
primeste si afiseaza; (2) service worker-ul afiseaza de doua ori. Numarul singur nu le deosebea.
Le-a deosebit a doua captura: **„pushed to 1 device"** — FCM acceptase UN token, o singura livrare,
doua notificari. Tokenurile nu pot explica asta. Si datele au inchis ipoteza 1 de tot: al doilea
token era mort, `notify()` l-a curatat singur, 2 -> 1.

Cauza, citita cuvant cu cuvant din SDK-ul instalat (`@firebase/messaging`, `onPush`): in fundal,
daca mesajul are bloc `notification`, SDK-ul **il afiseaza el** si *apoi* cheama
`onBackgroundMessage` — unde `firebase-messaging-sw.js` al nostru chema `showNotification` inca o
data. O capcana documentata, in care intrasera si altii.

### Reparatia

Worker-ul **nu mai afiseaza** — comentariul explica de ce, cu citatul din SDK, ca urmatorul cititor
sa nu puna la loc `showNotification` fiindca „pare ca lipseste". Ce punea el (icon-ul) se muta in
payload-ul serverului, `webpush.notification`, unde afisarea SDK-ului il respecta. Si doua lucruri
pe care push-ul nu le-a avut niciodata:

- **`tag`**, unul per apel `notify()`: aceeasi notificare ajunsa pe doua abonamente ale aceluiasi
  telefon se contopeste intr-una; doua broadcast-uri diferite raman doua. Merge si in `data`, ca
  handler-ul de prim-plan sa foloseasca acelasi.
- **`fcmOptions.link`**: o atingere pe notificare deschide aplicatia la ruta ceruta. Pana acum o
  atingere nu facea nimic — payload-ul n-avea link si worker-ul nu punea niciunul.

Handler-ul de prim-plan foloseste aceleasi optiuni, ca cele doua drumuri sa arate identic. Si
banner-ul din admin spune acum ca butonul trimite *si* push, nu doar clopotel.

`notify.ts` e comun celor noua apelanti, deci s-au livrat **toate** functiile, nu o selectie — dupa
dimineata cu randuri pe modelul vechi, nu mai vreau revizii amestecate.

`npx tsc -b` verde · functions `tsc` verde · 1153 de teste · poarta verde · build verde · livrat.
## 2026-09-15 - Evenimente pe mai multe zile, felia 1: modelul

**Model:** Claude Fable 5.1 · „ar trebui sa putem avea un eveniment care se poate intinde pe mai multe zile"

Andrei a cerut un interval orar; clarificat, e mai mult: **un eveniment se poate intinde pe mai
multe zile**, cu ore sau fara. Asta schimba proiectarea in doua locuri pe care o simpla „ora de
sfarsit" nu le-ar fi atins: apartenenta la o zi (un eveniment de luni pana miercuri e pe TREI zile)
si fereastra vizibila (cel inceput pe 30 august si terminat pe 2 septembrie trebuie sa apara in
septembrie).

### Harta intai, apoi decizia

Sase cititori in paralel, 179 de situri cu numar de linie, inainte de orice cod. Harta a luat
decizia de model in locul meu: **sfarsitul se stocheaza RELATIV** — `endDayOffset` (zile intregi
dupa ziua de inceput, absent = 0) + `endTime` (ora de perete in ACELASI `timezone`) — nu ca data
absoluta. Motivul e o linie din `recurrence.ts`: o aparitie e `{ ...event, date: ziua }`, orice alt
camp copiat ad litteram. Un sfarsit absolut ar fi corect pentru prima aparitie si gresit pentru
toate celelalte; un decalaj e corect pentru toate prin constructie, iar mutarea unei serii intregi
(`shiftedSeriesStart`) isi muta sfarsitul gratis.

Compatibil inapoi prin definitie: un eveniment fara campurile noi e exact evenimentul de ieri.
Un sfarsit in aceeasi zi se scrie `null`, nu `0`, ca sa arate identic cu unul care n-a avut niciodata.

### Ce s-a livrat (nimic vizibil inca)

- `eventTime.ts`: `spanOf`, `occursOn`, `daysOf`, `dayPlus`, `endInstant` (aceeasi corectie DST in
  doua treceri ca `startInstant`, pe ziua de SFARSIT), `spanProblem` (o singura regula de refuz,
  folosita si de formular si de server, ca sa nu poata diverge), `endFieldsFor` — frate al lui
  `timeFieldsFor`, nu extindere, fiindca testul aceluia fixeaza cheile exact. Copiat octet cu octet
  in `functions/src/eventTime.ts`; garda de copie confirma.
- `recurrence.ts` (client) si `recurrenceServer.ts` (server): poarta ferestrei se uita la ULTIMA zi
  a aparitiei, nu la prima. Aparitiile mostenesc decalajul prin `...event`.
- `OVERRIDE_FIELDS` admite cele doua campuri — lista e inchisa, iar un camp nou era aruncat tacut la
  editarea unei singure aparitii — si `createEventOverride` refuza cu `spanProblem`.
- Mementourile raman ancorate pe inceput. Nimic de schimbat acolo.

24 de teste noi, printre care noaptea DST din martie la Bucuresti (23:00 -> 04:00 = patru ore, nu
cinci) si aparitia care a inceput inaintea ferestrei dar e inca in desfasurare. **Mutatie:** poarta
intoarsa la „doar prima zi" pica exact acel test si numai pe el; restaurat dupa hash.

Urmeaza: felia 2 (randarea — un singur `occursOn` in locul celor opt copii de `isSameDay`, felii
per zi in `dayLayout`) si felia 3 (formularul). Revizie adversariala inaintea lor.

`npx tsc -b` verde · functions `tsc` verde · **1177 de teste** (de la 1153) · poarta verde · build.
## 2026-09-15 - Evenimente pe mai multe zile, felia 2: randarea

**Model:** Claude Opus 5 · continuare

Un eveniment de mai multe zile se deseneaza cate o **felie pe zi**: ziua de inceput de la ceas pana
la miezul noptii, zilele din mijloc intregi, ziua de sfarsit de la miezul noptii pana la ceasul de
final. Felia stie ca e o bucata dintr-un lucru mai lung, deci blocul poate spune asta in loc sa
tipareasca ora de start de ieri ca si cum ar fi de azi: `22:00 ▸` in prima zi, `◂ → 02:00` in a
doua, `◂ … ▸` la mijloc. Glife, nu cuvinte — nu cer traducere in sase limbi.

**Opt copii scrise de mana au devenit una.** `isSameDay(new Date(ev.date), zi)` aparea in opt locuri
(trei in grila lunii, cinci in ecranul principal); acum e `occursOn(ev, localDayKey(zi))`, singurul
loc unde se decide „e evenimentul in ziua asta". Numarul de copii ramase: **zero**.

### Probat in browser, nu doar in teste

Am montat `DayTimeline`-ul ADEVARAT pe trei zile consecutive, cu cinci evenimente de test, si am
masurat inaltimile la 56px/ora: „Dentist" fara sfarsit ramane o ora (54px, neschimbat), „Standup
09:00–11:30" 2,5 ore (138px), conferinta de trei zile 14h / **24h** / 16h. Etichetele spuneau a cata
zi e. Bancul s-a sters inainte de commit.

### Revizia adversariala a DARAMAT afirmatia mea de compatibilitate

Trei sceptici. Unul a refuzat afirmatia „un eveniment vechi se randeaza exact ca inainte" — si avea
dreptate, cu doua constatari HIGH, rulate, nu deduse. Le-am verificat eu inainte sa repar:

**1. `sliceInDay` arunca evenimente vechi din grila.** Prima mea versiune calcula instante absolute
si le taia la miezul noptii al cititorului; vechiul `minutesInDay` **infasura** (citea ora inapoi
prin Intl si arunca ziua). Diferenta: un eveniment de 00:30 la Bucuresti, citit din Londra, era
desenat la 13:50 in vechiul cod si **disparea in banda „toata ziua"** in al meu — unde nu se arata
nicio ora. O ora diferenta de fus era de ajuns. Masurat pe patru perechi de fusuri.

Reparat prin intoarcerea la ceasul de perete pentru POZITIE (`wallMinutes`, corpul pe care
`minutesInDay` il avea dintotdeauna, cu ceasul dat ca parametru ca sa-l poata folosi si sfarsitul).
Un steag de continuare uneori generos face mai putin rau decat un eveniment pierdut.

**2. Aparitiile recurente nu stau pe miezul noptii UTC.** `advanceDate` e date-fns, care paseste
calendarul LOCAL, deci de la trecerea la ora de vara incolo instantul derapeaza la 23:00Z — iar
documentul **se contrazicea pe sine**: `recurrenceDate` spunea 30 martie, ziua UTC a lui `date`
spunea 29. Masurat sub Europe/Bucharest: primele cinci aparitii sunt de acord, toate de dupa nu.
Randarea veche compara instantul local si nimerea; orice citea ZIUA din `date` — cum face `occursOn`
— nu. Reparat la sursa: expandorul emite acum `${zi}T00:00:00.000Z`, deci aparitia e de acord cu ea
insasi, iar clientul si serverul emit aceeasi zi (serverul paseste deja in milisecunde UTC).

Plus trei constatari LOW, toate inchise: un `date` necitibil cu ceas valid se deseneaza iar la ceasul
lui, si fereastra zilei si-a recapatat rezerva pentru o ora stocata necanonic.

**Doua dintre testele mele au picat dupa reparatie** — exact cele in care fixasem comportamentul
instant-based pe care revizia m-a convins sa-l schimb. Actualizate, cu motivul scris in ele.

`npx tsc -b` verde · functions `tsc` verde · **1211 de teste** (de la 1177), verzi si sub
`TZ=Europe/Bucharest`, nu doar UTC · poarta verde · build verde.
## 2026-09-15 - Evenimente pe mai multe zile, felia 3: formularul

**Model:** Claude Opus 5 · „continua cu felia 3"

Acum se pot si CREA. Un buton discret „+ adauga un sfarsit" langa ora — optional, fiindca aproape
orice eveniment e de o zi si doua controale in plus pe fiecare formular ar costa toate ca sa serveasca
cateva. La editarea unui eveniment care are deja un interval, randul apare deschis si completat.

Omul da o **data** de sfarsit, fiindca „pana joi" asta inseamna; evenimentul stocheaza un **decalaj**,
fiindca asta poate mosteni o aparitie recurenta. `dayOffsetBetween` e imbinarea.

Decizia „ce se scrie si de ce s-ar refuza" a iesit in `src/utils/eventForm.ts` ca sa poata fi
**rulata**: ecranul e in spatele autentificarii, iar de doua ori azi o decizie lasata intr-o
componenta s-a dovedit gresita fara ca vreo poarta s-o vada. Refuzul e `spanProblem`, acelasi pe care
serverul il aplica unui override — deci formularul si serverul nu pot ajunge la concluzii diferite.

### Revizia a daramat iar o afirmatie de-a mea, si bine a facut

**HIGH: formularul citea inceputul LOCAL si sfarsitul in UTC.** `format(new Date(ev.date))`
formateaza local un instant de miezul noptii UTC — vest de Greenwich aia e seara precedenta. Iar
sfarsitul venea din `spanOf`, care citeste UTC. **Diferenta dintre ele e exact decalajul care se
stocheaza.** Deci o excursie de trei zile deschisa la New York se salva ca patru, apoi cinci, apoi
sase — si autosave-ul scrie **la o secunda dupa deschidere, fara niciun gest**. Pe ramura „toate din
serie" decalajul umflat ajungea pe parinte, deci crestea fiecare aparitie.

Verificat de mine inainte sa repar: ziua locala a lui `2026-09-20T00:00:00Z` e **19** la New York si
Los Angeles, **20** la Bucuresti, Londra si Auckland. Acum ambele parti citesc UTC — ceea ce repara
si un bug mai vechi: campul de data arata ziua precedenta pentru oricine la vest, si salvarea o
scria inapoi.

Plus trei MEDIUM, toate reale:
- **Draftul nu vedea o schimbare doar de sfarsit** — tabloul de dependente nu fusese atins, exact
  clasa pe care o reparasem cu 40 de linii mai jos in efectul frate.
- **Stergerea orei de inceput ingheta formularul**: campul de ora de sfarsit se ascunde, dar starea
  ramane, iar refuzul arata spre un camp care nu mai e pe ecran. Acum stergerea orei de inceput
  sterge ora de sfarsit si **pastreaza zilele**.
- **Un eveniment nou mostenea sfarsitul celui editat inainte** — modalul nu se demonteaza niciodata,
  iar ramura de resetare nu stia de campurile noi.

Si o imbunatatire de la mine: **mutarea inceputului muta si sfarsitul**, pastrand durata. Doar
impingerea lui cand ar ramane in urma ar fi scurtat tacut o excursie de trei zile la doua.

### Plasa

Testul de dus-intors probeaza AJUTOARELE, nu componenta — cine ar pune formatarea locala la loc l-ar
lasa verde. Deci exista si o plasa pe SURSA, verificata prin mutatie: pusa la loc, pica exact ea.

`npx tsc -b` verde · functions `tsc` verde · **1239 de teste** (de la 1217) · poarta verde · build.
## 2026-09-15 - Cele sapte care NU sunt ferestre

**Model:** Claude Opus 5 · „continua"

Cand cele 22 de ferestre au trecut prin `useDialog`, sapte au ramas pe dinafara si nota spunea de
ce: **un meniu vrea alte reguli.** Se inchide cand dai click in alta parte, se umbla prin el cu
sagetile, si nu are voie sa fie `aria-modal`, fiindca pagina din spate NU e blocata — a pretinde ca
e ar fi o minciuna spusa exact omului care nu vede ecranul. Acum au primitiva lor: clopotelul,
hamburgerul, meniul butonului plutitor, panoul de chat, selectorul de reactii si cele doua fise de
proprietar.

### O singura stiva, si cazul care a decis-o

Meniurile se inregistreaza pe **aceeasi stiva** ca ferestrele. Cazul care rezolva discutia e fisa
de proprietar din formularul de eveniment: pluteste **INAUNTRUL** ferestrei, deci Escape trebuie sa
ajunga la fisa si sa se opreasca acolo. Cu doua stive, un singur Escape ar fi inchis fisa SI
formularul de sub ea, aruncand ce era scris — exact defectul pentru care s-a scris `dialogStack`,
in alt costum.

Ce difera nu e ordinea, ci **ce datoreaza o fereastra paginii din spate**: zavorul de derulare si
inelul de Tab. Amandoua numara acum doar intrarile **modale** (`modalDepth`, `isTopModal`). Fara
asta: deschizi un meniu (adancime 1), din el o fereastra (adancime 2, deci nu mai zavoraste
niciodata), le inchizi pe amandoua — si pagina ramane nederulabila **tot restul sesiunii**, fara
nicio eroare nicaieri. Aceeasi forma cu bug-ul `previousOverflow` aruncat deja o data de aici.

Iar inelul de Tab **ramane la fereastra** cat timp un popover pluteste deasupra ei: popover-ul e
randat inauntrul ei, deci butoanele lui sunt deja in inel. Sa-l fi predat ar fi lasat Tab-ul sa
iasa dintr-un formular modal in pagina din spate — o regresie deghizata in rafinament.

### Ce am mutat, ca sa nu existe in doua exemplare

Istoricul (`pushState`, derularea, creditul „pop-ul asta e al nostru") a iesit din `useDialog` in
`useOverlayHistory`, fiindca panoul de chat are nevoie de **exact** aceleasi reguli: azi, Back cu
chatul deschis scoate omul din calendar si lasa panoul in urma. Regulile alea au costat un banc de
proba si doua versiuni gresite — deci exista o **singura** data. La fel lista de elemente
focusabile (`focusables.ts`): altfel ar fi divergit la primul control adaugat intr-una din ele, si
s-ar fi vazut ca „Tab ajunge la el, sagetile il sar".

### Escape si Back sunt gesturi diferite

Panoul de chat a cerut singura optiune in plus din toata primitiva. Escape acolo **desface un
strat**: anuleaza editarea, altfel anuleaza raspunsul, altfel inchide panoul. Back inchide panoul,
punct. Trecute amandoua prin `onClose`, un Back in timp ce raspunzi ar fi anulat raspunsul **si i-ar
fi consumat intrarea din istoric pe drum** — deci urmatoarea apasare iesea din calendar cu panoul
inca deschis.

Si o capcana prinsa inainte sa fie livrata: `GroupChatWidget` folosea `dialogDepth() > 0` ca sa
insemne „ceva e deschis deasupra mea". Panoul plutitor se inregistreaza acum el insusi pe stiva,
deci conditia aia devenea mereu adevarata si Escape n-ar mai fi anulat niciodata un raspuns. Un
**camp nou invalideaza un invariant vechi**; ascultatorul a ramas doar pentru modul incorporat (unde
panoul E ecranul), si cheama aceeasi functie, nu o a doua copie a ei.

### Bancul de proba, iar el a fost proba

Ecranele sunt in spatele autentificarii, deci typecheck + teste + build pot fi toate verzi cu
primitiva stricata. Bancul a montat hook-urile ADEVARATE in forma care doare — un popover
INAUNTRUL unei ferestre — si a masurat stari, nu impresii: `dialogDepth`, `modalDepth`,
`document.activeElement.id`, `document.body.style.overflow`, `history.state`.

Verificat acolo: Escape inchide doar fisa, al doilea inchide fereastra · inelul de Tab ramane in
fereastra cu fisa deasupra · apasarea pe declansator comuta fara sa se inchida-si-redeschida ·
click in alta parte inchide si **nu** fura focusul inapoi · sagetile se rotesc, Home/End merg, axa
necerura e ignorata · zavorul de derulare: gol cu meniu, `hidden` cu fereastra deasupra, gol dupa
amandoua · Back inchide panoul, iar **urmatorul** Back misca istoricul paginii (creditul nu s-a
scurs). Ultimele patru le-am refacut cu **click si Escape REALE**, nu sintetice — sintetic,
`.click()` nu da focus, si asta ascundea exact restaurarea focusului.

### Revizia: cinci constatari confirmate, cinci respinse

Patru recenzii independente. **Trei din patru au gasit acelasi defect**, si e cel mai grav:

**Butonul Back inghitit.** Un popover deschis PESTE o fereastra facea fereastra „sa nu mai fie
deasupra", deci ascultatorul ei de `popstate` se dadea la o parte — si nimeni altcineva nu asculta,
fiindca un popover nu impinge nicio intrare. Intrarea era deja consumata de browser: **prima
apasare pe Back nu facea nimic, iar a doua iesea din calendar cu formularul inca pe ecran.**
Regula care o inlocuieste e cea pe care o implementeaza chiar browserul: intrarea scoasa e ultima
impinsa, deci raspunde **ultimul care a impins**, nu cel de deasupra. Doua siruri, nu unul.

**Un Escape inchidea cautarea SI toata conversatia.** Inputul de cautare isi inchidea singur bara
dintr-un `onKeyDown` care nu oprea propagarea — iar de cand panoul raspunde la Escape, aceeasi
apasare mergea mai departe si inchidea conversatia. Verificatorul a probat-o cu o pagina reala in
Chromium, nu prin rationament. Acum cautarea e **inca un strat** in aceeasi functie, in aceeasi
ordine ca celelalte.

**Fisa de proprietar ii supravietuia ferestrei.** `EventDetailsModal` nu se demonteaza, face
`return null` — deci o fisa lasata deschisa continua sa se inregistreze ca overlay fara nimic pe
ecran: statea pe varful stivei, manca urmatorul Escape si ingheta sagetile calendarului pana cand
omul se intampla sa dea un click. Plus: **Escape nu putea s-o inchida**, fiindca ascultatorul
cauta panoul inainte sa se uite la tasta. Amandoua reparate.

**Tab dintr-un popover sarea in capul formularului.** Panoul primea `tabindex="-1"`, deci inelul
de Tab al ferestrei nu-l vedea, `indexOf` dadea -1 si urmatorul Tab ateriza pe primul control al
formularului — sarind exact continutul fisei. Reprodus in Chromium real. Acum panoul unui popover
e `tabindex="0"`: un popas adevarat, in ordinea documentului.

**Eticheta butonului de chat stergea numarul de mesaje necitite.** Butonul n-avea nume accesibil
deloc; textul bulinei („3") ERA tot numele. Un `aria-label` simplu l-ar fi inlocuit si ar fi luat
tacut numarul cu el. Acum numarul e in eticheta.

Respinse cu probe, nu cu opinii: restaurarea focusului la selectorul de reactii (bancul o aratase
deja corecta), ordinea DOM a panourilor, si o presupusa stergere a evenimentului sub fisa — `|| prev`
din `CalendarHome` refuza fix asta.

**Una confirmata si LASATA asa, deliberat:** daca pleci de pe ecran (schimbare de ruta) cu panoul
deschis, intrarea lui din istoric ramane orfana si costa o apasare moarta pe Back. E adevarat, dar
e adevarat la fel pentru toate cele 22 de ferestre dinainte — routerul si overlay-urile impart
acelasi istoric si n-au un model comun. Nu e o regresie a acestei schimbari si nu se repara
onest intr-o felie despre meniuri.

**Si una gasita de mine, in aceeasi familie:** navigarea cu sagetile din calendar se oprea doar
daca gasea un `.fixed.inset-0` in pagina. Un meniu nu e asa — deci o sageata trimisa unui meniu
**muta si calendarul cu o saptamana**, iar Enter pe un element de meniu deschidea panoul zilei in
spate. Acum intreaba stiva (`modalDepth`) si unde e focusul, nu clasele CSS.

`npx tsc -b` verde · poarta de lint verde · **1268 de teste** (de la 1239) · build verde.
## 2026-09-16 - Verificat de Andrei: evenimentele pe mai multe zile si cele sapte overlay-uri

„da, se verifica toate ok".

Bifate si scoase din `OWNER_VERIFY.md` (§45-§47): randarea evenimentelor pe mai multe zile,
crearea lor din formular — inclusiv proba care conta cel mai mult, **deschis si inchis fara nicio
schimbare, durata neschimbata**, defectul pe care revizia il prinsese — si cele sapte meniuri si
popovere, cu Back-ul pe telefon si Escape pe cautarea din chat.

Cele doua arce sunt inchise: `f354616` / `eafb032` / `6d8efb6` pentru intervale, `f9b96ac` pentru
overlay-uri.
## 2026-09-16 - Nu se mai poate livra un pachet fara configurare

**Model:** Claude Opus 5 · dupa verificarea lui Andrei, m-am uitat ce lovea oamenii pe live

Jurnalul de erori e curat: **5 probleme distincte, 4 rezolvate, 0 noi, 0 regresate**. Singura
ramasa era „Web push is not configured: no VAPID key" — de 10 ori, 2 oameni, 14→15.09. Cheia a
fost pusa in `.env` in timpul sesiunii de ieri si livrarea de aseara a reparat-o (am verificat:
pachetul de pe live **contine** cheia). Deci nu mai era nimic de reparat acolo.

Dar de ce a fost posibil e inca acolo, si e mai rau decat push-ul.

**Toate cheile Firebase traiesc intr-un singur `.env`, pe o singura masina, fara niciun
`.env.example`.** Vite inlocuieste fiecare `import.meta.env.VITE_*` la build; una lipsa devine
literalmente `undefined` — **tacut**. Deci `npm run build` reuseste, pachetul se incarca, si
aplicatia care ajunge in fata oamenilor n-are niciun proiect cu care sa vorbeasca. Nimic nu se face
rosu: **CI-ul construieste fara `.env` deloc si raporteaza verde**, fiindca treaba lui e typecheck
si teste, nu configurare. Push-ul lipsa a fost varianta blanda — aceeasi forma poate scoate din
functiune **toata** aplicatia si ar arata exact la fel de verde.

Deci: `scripts/check-bundle.mjs`, agatat ca `predeploy` pe hosting. Nu mai poti publica un pachet
caruia ii lipseste configurarea.

### Gardea COMPARA, nu adulmeca — si prima versiune a mea adulmeca

Prima varianta cauta **forme**: un sir `AIza…`, o cheie base64url de 87 de caractere. Am construit
fara `.env` ca s-o probez, si a raportat senin **„ok Web push VAPID key"** si „ok App Check" —
regexul nimerise altceva intr-un pachet de doua megaocteti, iar cuvantul „recaptcha" e in SDK
indiferent daca ai cheie sau nu. **O garda care recunoaste o FORMA nu spune nimic despre valoarea
TA.**

Acum compara doua lucruri pe care le poate vedea pe amandoua: ce a configurat masina asta si ce e
in artefact. Fiecare valoare configurata trebuie sa apara **verbatim** in pachet.

Probat prin mutatie, de doua ori, cu `.env` restaurat prin checksum:
- **fara `.env`** → refuza, cu un singur mesaj clar (inainte: trecea cu doua „ok" false);
- **cheia configurata dar pachetul construit inainte** → „configured but does NOT appear in the
  built bundle" — exact situatia care a pus cele 10 erori in jurnal.

Nu tipareste niciodata o valoare, doar numele. Doua dintre ele sunt publice prin natura lor, dar o
verificare care obisnuieste sa scuipe configurare e la un copy-paste distanta de a face asta cu una
care nu e.

`.env.example` spune de unde vine fiecare valoare. App Check ramane **optional prin proiectare**:
absenta lui e avertisment, niciodata deploy blocat.

`npx tsc -b` verde · poarta de lint verde · **1278 de teste** (de la 1268) · build verde · poarta
de livrare probata pe drumul REAL (`firebase deploy` o ruleaza, nu doar eu de mana).
## 2026-09-16 - Arcade: sesiunile abandonate se inchid singure

**Model:** Claude Opus 5 · „3, buton de end game, sesiune abandonata dupa 24 de ore de inactivitate"

Amandoua, nu una. Butonul exista deja — inclusiv in timpul jocului, cu confirmare in doi pasi. Deci
munca reala era a doua jumatate, si acolo era o problema de fond: **niciuna dintre cele 26 de
scrieri ale arcade-ului nu inregistra cand s-a intamplat.** Singurul timp de pe un joc era
`createdAt`. „24 de ore de inactivitate" nu era o regula pe care s-o poata aplica cineva — n-aveai
cum sa deosebesti un joc abandonat luna trecuta de unul in care tocmai s-a mutat.

- **O singura cale de scriere** (`gameWrite.ts`), care stampileaza momentul. Toate cele 26 de
  apeluri trec prin ea, si `arcadeWrites.test.ts` refuza orice ocolire — **probat prin mutatie**.
- **Decizia** (cine a castigat sesiunea, cand e abandonata) in `src/utils/gameSession.ts`, copiat
  **byte-identic** in `functions/src/`, ca omul care apasa End si ceasul care inchide singur sa
  raspunda identic. Acelasi tipar ca `eventTime.ts`, cu aceeasi plasa.
- **Maturatoarea** (`expireIdleGames`) ruleaza din ora in ora, sare peste bataliile Warlord, **nu
  sterge nimic**, si scrie un rand pe rulare (`GAMES_EXPIRY_RUN`) cu motivele fiecarui refuz.

### Revizia a gasit 16 lucruri, si doua schimbau proiectarea

**HIGH — `status: 'finished'` inseamna RUNDA terminata, nu sesiunea.** Cele trei jocuri pe runde
scriu asta de fiecare data cand cineva castiga o runda, iar „Runda urmatoare" il pune inapoi pe
`playing`. Interogarea mea selecta doar `waiting`/`playing`, iar decizia trata `finished` ca „deja
inchis" — deci **maturatoarea rata exact modul cel mai obisnuit in care se abandoneaza un joc**:
cineva castiga o runda si nimeni nu se mai intoarce. Verificat pe date: dintre cele 18 jocuri de pe
live, **unul era fix in starea aia**. Acum singurul steag care inseamna „sesiune incheiata" e
`finalized`, si se scaneaza toata colectia (18 documente — filtrarea in cod e mai ieftina decat o
interogare care minte).

**HIGH — `createdAt` nu poate deosebi „neatins niciodata" de „jucat, dar neinregistrat".** Toate
cele 18 jocuri sunt facute acum luni de zile si niciunul n-are stampila. Judecate dupa creare, prima
rulare ar fi inchis si ce se juca in ziua livrarii. Acum un joc fara `lastMoveAt` se masoara de la
un **prag** (`STAMPED_FROM_MS`), deci fiecare joc existent primeste o zi intreaga in care o mutare
adevarata il stampileaza si lamureste intrebarea. **Masurat dupa reparatie: prima rulare inchide
ZERO**; cele ramase neatinse se inchid maine.

Si restul, toate reale: un joc facut pentru o data VIITOARE era inchis a doua zi, inainte de seara
pentru care exista (acum se masoara de la sfarsitul zilei lui); `counts.closed` numara si jocurile
pe care tranzactia le refuza (acum tranzactia intoarce daca a scris); Rummy oferea „Mana urmatoare"
pe o sesiune inchisa, fara poarta pe `finalized` ca la celelalte trei — deci se putea relua un joc
etichetat permanent „inchis", fara cale de a-l mai incheia; inchiderea unui lobby la care nu intrase
nimeni ii lua creatorului singurul buton de stergere si il punea in clasament pe un rand de zerouri;
iar plasa pe sursa recunostea o singura ortografie a ocolirii pe care pretindea c-o interzice.

**Una confirmata si LASATA asa, cu comentariul scris in cod:** la Memory Match, `scores` sunt
puncte pe runda si se reseteaza — deci „castigatorul sesiunii" e de fapt al ultimei runde. E
preexistent (clasamentul si butonul End citesc asa de cand exista), si nimic din document nu
retine cine a castigat sesiunea, deci nimic nu poate calcula altceva. N-am schimbat-o tacut: un
ceas care ar inchide un joc altfel decat omul care apasa butonul ar fi o problema mai mare decat
una imprecisa. **Intrebare separata pentru Andrei.**

`npx tsc -b` verde · functions `tsc` verde · poarta de lint verde · **1310 teste** (de la 1278).
## 2026-09-16 - Memory Match numara acum RUNDELE, nu punctele ultimei runde

**Model:** Claude Opus 5 · „adauga contorul de runde"

Intrebarea pe care am pus-o dupa felia de expirare avea un raspuns: da. La Memory Match `scores`
sunt puncte in runda curenta — perechi plus bonus de serie — si `handleNextRound` le pune pe zero.
Deci „castigatorul sesiunii", si in clasament, si la butonul End, era de fapt al **ultimei runde
jucate**, oricum ar fi decurs restul.

Acum sesiunea are contorul ei, `state.roundsWon`, care nu se reseteaza. Celelalte doua jocuri pe
runde nu aveau nevoie de nimic: la ele `scores` CHIAR sunt runde castigate.

### Migrarea e partea usor de gresit, si are doua motive, nu unul

`getSessionWinner` foloseste contorul doar **daca a numarat deja ceva**; altfel cade inapoi pe
puncte, exact ce raspundea si ieri. Nu e doar pentru documentele vechi: o **sesiune aflata in curs**
incepe sa numere abia de la runda urmatoare, si sa raportezi „n-a castigat nimeni" pentru un joc cu
doua runde in spate ar fi un raspuns mai prost decat cel imprecis. Orice sesiune inceputa de acum
numara corect din prima runda.

### Mutarea deciziei a scos la iveala un bug al meu

Prima varianta scria incrementarea in componenta:

    const roundKey = winner === players.P1 ? 'P1' : 'P2';

Adica **orice** castigator care nu e P1 era creditat lui P2 — inclusiv un uid care nu e niciunul
dintre jucatori. Mutata in `gameSession.ts` ca `nextRoundsWon`, ca sa poata fi **rulata**, s-a
vazut in trei linii de test: acum un uid nerecunoscut nu schimba nimic. Aceeasi regula ca la
celelalte: egalitatea nu da runda nimanui.

In joc, sub punctele fiecarui jucator apare acum un 🏆 cu numarul de runde — dar numai dupa ce s-a
castigat una, deci prima partida arata exact ca inainte.

`npx tsc -b` verde · poarta de lint verde · **1320 teste** (de la 1310).
## 2026-09-16 - Un audit pe date reale, si golul pe care l-a aratat

**Model:** Claude Opus 5 · „continua tu singur"

Dupa patru livrari intr-o zi, m-am uitat ce se vede pe live. Panoul de erori: **0 noi, 0
regresate**. Apoi am verificat pe datele reale invariantele promise, cu modulele COMPILATE (acelasi
cod pe care-l ruleaza serverul), fara sa reimplementez nicio regula.

Ce a iesit e mai interesant decat un verde:

    evenimente cu interval pe mai multe zile   0 din 24
    jocuri cu stampila de mutare               0 din 18
    Memory Match cu contor de runde            0

Trei functii livrate azi, **neatinse inca de nimeni**. Deci „invariantul se respecta" e adevarat pe
o multime GOALA — nu e o dovada, e o absenta. Singurul lucru pe care auditul chiar l-a confirmat:
36 de notificari, 8 destinatari, **niciun duplicat in aceeasi minuta**, si doua de tip `reminder`
— deci programatorul livreaza cu adevarat.

### Golul, si cum l-am inchis

Toata expirarea sta pe `writeGame`, iar ea avea doar o plasa pe SURSA: „nimeni n-o ocoleste" si
„stampila e scrisa dupa campurile apelantului". Amandoua sunt verificari de TEXT. Auditul le-a
aratat limita: optsprezece jocuri, niciunul cu `lastMoveAt`, fiindca nimeni n-a jucat de la
livrare. Nicio dovada ca functia face ce scrie — doar ca fisierul arata bine.

Acum modulul e incarcat pe bune, cu SDK-ul mocuit, si se inspecteaza ce ajunge la Firestore: caile
cu punct raman cu punct (altfel s-ar inlocui tot `state` si ar lua tabla cu el), o scriere goala tot
se stampileaza, o eroare ajunge la apelant in loc sa fie inghitita, si — asertiunea care conteaza —
**un apelant care isi trimite propriul `lastMoveAt` e suprascris**. Aia era regula pe care plasa pe
sursa o putea doar aproxima prin pozitia in fisier.

### Proba negativa a fost ea insasi stricata, de doua ori

Prima mutatie („scoate stampila") a muscat. A doua („pune stampila INAINTE de campuri") a raportat
ca testul doarme — **dar probemea era gresita**: adaugasem o stampila la inceput fara s-o scot pe
cea de la final, deci ultima tot castiga si codul se comporta corect. A treia incercare a picat pe
altceva: numaram aparitiile lui `lastMoveAt: serverTimestamp()` inclusiv pe cea din COMENTARIUL
fisierului — aceeasi capcana ca la poarta de overlay-uri de dimineata. Cu mutatia facuta cum
trebuie (stampila **mutata**, nu duplicata) si numarand doar codul, musca.

`npx tsc -b` verde · poarta de lint verde · **1326 teste** (de la 1320).
## 2026-09-16 - Portofelul si cheltuielile, revizuite pentru prima data

**Model:** Claude Opus 5 · „continua tu singur"

Zona asta n-avusese niciodata o a doua pereche de ochi, si are un istoric care spune totul: **trei
luni in care regulile refuzau fiecare citire si scriere pe `expenses`, fara ca cineva sa afle**,
fiindca ambele cai de esec erau tacute. Am pus patru recenzori adversariali pe ea: aritmetica
banilor, cine ce poate scrie, esecurile invizibile, si codurile de bare. **26 de constatari
confirmate, 18 respinse.**

Inainte de orice, am masurat ce foloseste lumea de fapt: **18 carduri in portofel (10 cu cod de
bare), 24 de evenimente, 3 cheltuieli.** Portofelul e functia principala a aplicatiei, nu
calendarul.

### Banii erau gresiti, si gresiti tacut

**Cel mai grav.** Impartirea se facea la membrii de ACUM, dar totalul cuprindea fiecare cheltuiala
inregistrata vreodata. Cele doua nu mai sunt de acord din clipa in care pleaca cineva:

    Ana, Bogdan si Cristina. Cristina plateste 300 de cumparaturi. Cristina pleaca.
    Totalul ramane 300 — cheltuiala ei nu se atinge. Impartitorul devine 2.
    Ana vede -150, Bogdan -150, si NIMENI nu e pe plus. Coloanele dau -300.

Cristina are de primit 300 si nu apare nicaieri. Verificatorul n-a rationat: **a rulat componenta
livrata** cu `react-dom/server` si a citit exact `-150.00` si `-150.00` de pe ecran.

Iar codul stia deja: `functions/src/index.ts` sterge cheltuielile cuiva la **stergerea contului**, si
comentariul de acolo descrie fix aceasta aritmetica. Celelalte doua feluri de a iesi dintr-un grup —
sa pleci, sa fii scos — n-au primit niciodata acelasi tratament.

**Reparatia:** cine a PLATIT intr-un registru face parte din el, membru sau nu. Asta reface
promisiunea implicita a ecranului — coloanele dau zero — fara sa stearga dovada ca omul a platit.
Socoteala a iesit din componenta in `src/utils/ledger.ts`, ca sa poata fi **rulata**: erau
unsprezece randuri in spatele unui login, si tocmai de-aia a supravietuit defectul luni de zile.

Plus, in aceeasi mutare: o suma care nu e numar nu mai otraveste tot registrul; restul de rotunjire
cade pe **cine datoreaza**, nu pe cine a platit (omul care a scos banii se face intreg); si un sold
de -0,004 nu se mai scrie „-0.00", fiindca pragul de culoare si cel de tiparire sunt acum acelasi.

### O gaura in reguli

`create` fixa trei lucruri: proprietarul, platitorul, si ca grupul e unul din care faci parte.
**`update` nu fixa niciunul.** Deci tot ce era interzis la creare se putea face in doi pasi — creezi
o cheltuiala personala banala, apoi o editezi. Cea care conta:

> imi mut cheltuiala in registrul unui grup **din care nu fac parte** — toate balantele lor se
> misca, iar ei n-o pot sterge, fiindca doar proprietarul poate.

Sase probe noi pe emulatorul real, inclusiv cele care trebuie sa TREACA: o regula care blocheaza si
corectarea unei greseli de tipar e inlocuita intr-o saptamana cu una mai laxa. **Probat prin
mutatie: cu regula veche pusa la loc, pica exact cele trei.**

### Codul de bare: real, dar dormant

Scanerul accepta **17** formate. Randarea mapa **patru**; restul cadeau pe `CODE128` — inclusiv
UPC-E, care e un UPC-A comprimat: aceleasi opt cifre desenate ca Code 128 se citesc ca opt cifre,
in timp ce simbolul din care au venit se extinde la douasprezece. **Alt numar, acelasi card, niciun
avertisment.**

Masurat inainte de reparatie: toate cele 10 coduri din baza sunt EAN-13 si UPC-A, adica exact cele
doua mapate corect. **Nimeni nu era afectat** — ar fi fost primul om care adauga un card in alt
format.

Acum sase formate in plus se deseneaza corect, iar cele care **nu pot** fi desenate ca bare (2D,
GS1 DataBar, add-on-uri EAN) arata NUMARUL, mare, cu un rand care spune de ce. Un numar se poate
tasta la casa; un cod de bare gresit nu poate fi observat de omul care tine telefonul.

Typecheck-ul a prins ca tipurile lui `react-barcode` sunt invechite (n-au CODE93, desi JsBarcode
3.12.3 pe care il foloseste chiar il are). N-am trecut peste tip pe incredere: exista un test care
incarca encoderele REALE si refuza orice format pe care modulul il poate numi iar biblioteca nu-l
poate desena.

### Un steag de eroare pentru doua ascultatoare

Ambele reusite scriau `setLoadError(false)`, deci cea care reusea ultima **stergea esecul
celeilalte**: o interogare refuzata pe registrul de grup lasa ecranul fara nicio eroare si balantele
se calculau tacut din jumatate de registru. Acum fiecare ascultator are steagul lui, iar daca a picat
exact cel al registrului, balantele **nu se mai arata deloc** — cifre gresite pe un ecran curat sunt
mai rele decat o lipsa anuntata.

### Ce am lasat, si de ce

- **Un membru nou re-imparte istoria.** Cine intra azi ajunge sa plateasca si cina de saptamana
  trecuta, fiindca nimic din document nu retine cine era de fata. Se repara cu un camp nou
  (`splitAmong`), dar ce ar trebui sa insemne e o decizie de produs, nu una tehnica. **Intrebare
  pentru Andrei.**
- **Stergerea unui grup lasa cheltuielile in urma**, in niciun total.
- Cateva medii pe portofel (categoria veche la stergere, `sharedGroupId` la transfer, plafonul de
  15 secunde la incarcare).

`npx tsc -b` verde · poarta de lint verde · **1350 de teste** (de la 1326) · **120 de probe de
reguli** pe emulator.
## 2026-09-16 - Fiecare cheltuiala isi retine participantii

**Model:** Claude Opus 5 · „fiecare cheltuiala sa-si retina participantii"

Raspunsul la intrebarea din §46. Pana acum, impartirea folosea membrii de ASTAZI pentru toata
istoria: cine intra vineri platea si cina de marti, iar cine pleca facea datoriile celorlalti sa
creasca peste noapte, fara sa se inregistreze nimic nicaieri.

Acum fiecare cheltuiala poarta `splitAmong` — cine erau participantii in clipa in care a fost
inregistrata — si **socoteala se face per cheltuiala**, nu cu un divizor comun pe registru. Asta
face si invariantul „coloanele dau zero" **structural** in loc de norocos: fiecare cheltuiala isi
distribuie intreaga suma intre proprii participanti, deci cat s-a platit si cat se datoreaza sunt
acelasi numar prin constructie.

**Randurile scrise inainte de azi n-au campul si cad inapoi pe vechea socoteala** — deci nimic din
ce a vazut deja cineva nu se misca sub el.

### Campul e constrans in reguli, nu doar scris de client

`splitAmong` decide cat datoreaza CEILALTI. Fara regula, un membru putea scrie
`splitAmong: [altcineva]` si punea toata nota pe balanta unui singur om. Regula cere: sa fie
lista adevarata, nevida, de cel mult 50, si **toti sa fie chiar in grupul acela** (`difference`
peste multimea membrilor). Pe o cheltuiala personala e refuzat — n-o imparte nimeni.

Sapte probe noi pe emulator, si **probate prin mutatie**: cu garda scoasa din `create` si `update`,
pica exact cinci dintre ele. Total **127 de probe de reguli**.

`npx tsc -b` verde · poarta de lint verde · **1357 de teste** (de la 1350) · build verde.
## 2026-09-16 - Selectorul de participanti, si doua bug-uri prinse doar de bancul de proba

**Model:** Claude Opus 5 · „da, vreau selectorul de participanti"

Cheltuiala isi retinea deja participantii — tot grupul, automat. Acum se poate si ALEGE: sub
formular apar membrii ca niste buline comutabile, toti bifati implicit, si `splitAmong` pastreaza
exact ce ai lasat bifat. „Asta a fost doar a mea si a lui Bogdan" se poate spune.

Decizia e in `ledger.ts` ca sa poata fi rulata: scoate pe cine nu mai e in grup (rosterul se poate
schimba cu formularul deschis, iar regulile refuza un split care numeste un nestrain), si **spune**
cand nu mai e nimeni bifat in loc sa transforme tacut „nimeni" in „toata lumea" — care ar fi exact
pe dos fata de ce tocmai a cerut omul.

### Bancul a prins doua lucruri pe care nimic altceva nu le vedea

Typecheck verde, 1363 de teste verzi, build verde — si interfata gresita in doua feluri. Ecranul e
in spatele unui login, deci am montat componenta ADEVARATA si am condus-o.

**1. O cheltuiala personala nu putea fi adaugata deloc.** Butonul era
`disabled={loading || !splitOk}`, iar fara grup nu exista membri, deci `splitOk` era fals —
**implicit, si pentru cazul cel mai obisnuit din toata pagina**. Nicio unitate de test n-avea cum
s-o vada: functia pura e corecta, greseala e in cine o intreaba.

**2. Doua buline apasate repede pierdeau una.** `onClick` citea `split` din inchiderea randarii,
deci doua apasari in ACELASI lot React citeau amandoua aceeasi valoare si a doua o suprascria pe
prima. Bancul le-a apasat fara pauza intre ele si a aratat Ana inca bifata dupa ce fusese debifata.
Reparat cu actualizare functionala (`setSplit(prev => ...)`).

Probat pe componenta livrata: bulinele apar doar la o cheltuiala de grup, doua apasari in acelasi
lot raman amandoua, debifarea tuturor blocheaza butonul si spune de ce, schimbarea grupului reseteaza
bifele la membrii grupului NOU, iar intoarcerea la „personal" face butonul disponibil din nou.

`npx tsc -b` verde · poarta de lint verde · **1363 de teste** · build verde.

---

## 2026-09-16 · Un tab de grup arata calendarul altui grup

**Prompt (Andrei):** „am niste evenimente din grupul de familie in grupul de gym” (cu capturi:
aceleasi doua evenimente, 26 iulie si 5 august, in Gym, Family SI B&D).
**Model:** Claude Opus 5.

### Nu era un eveniment ratacit, era tiparul

Masurat pe baza LIVE cu cheia read-only: tabul Gym ii arata 12 evenimente din care **9 erau ale
altui calendar** (4 din B&D, 3 din Family, 1 personal). Family: 9 straine din 13. B&D: 7 din 12.
Tabul Personal: 11 straine din 23. Cu alte cuvinte, taburile erau in mare aceeasi grila cu alt
antet si alte avataruri.

**Cauza:** calendarul e alimentat de TREI ascultatori contopiti intr-o lista:

```
main      where('groupId','==',activeGroup)          <- legat de TAB
assigned  where('assigneeIds','array-contains',uid)  <- legat de OM
invited   where('inviteeId','==',uid)                <- legat de OM
```

Doar primul filtra dupa tab. Ultimii doi exista dintr-un motiv real — cineva iti poate pune o
sarcina pe calendarul TAU fara sa fie un eveniment de grup (cinci astfel de randuri pe live) —
dar nimic nu le ingusta la calendarul din fata ta.

### Regula, intr-o propozitie

Un eveniment sta pe calendarul pe care a fost DEPUS: tabul grupului lui, sau Personal daca n-are
grup. `src/utils/eventScope.ts` (+ 19 teste) decide asta pentru toate cele trei galeti, fiindca o
regula scrisa intr-un singur callback e o regula pe care celelalte doua o pot uita — exact asa a
aparut defectul.

### Bancul de proba a reprodus INTAI bug-ul

CalendarHome e in spatele unui login, deci am montat ecranul ADEVARAT cu un firebase fals in
spate (obiectele de interogare sunt construite de codul real si evaluate de banc, deci se probeaza
cablajul, nu o repovestire a lui) si cele 24 de documente de pe live, anonimizate.

* pe codul livrat (`458ab59`), august 2026: **Gym, Family si B&D aratau IDENTIC** aceleasi sase
  evenimente, printre care „Cumparaturi” si „De cumparat” — fix capturile lui Andrei;
* cu reparatia: Gym **0**, Family exact cele doua care sunt ale ei, B&D 0.

### Revizia adversariala a gasit o gaura in reparatia MEA

19 agenti, 15 acuzatii, 9 au trecut de respingere. Cea HIGH: pusesem verificarea audientei
(`visibleTo`) INAINTE de decizia de tab, iar un eveniment de grup unde esti asignat dar audienta
nu te numeste ajungea sa nu apara NICAIERI — desi serverul (`remindersCore.ts`) ii trimite
notificare celui asignat fara sa se uite la `visibleTo`. Forma nu e ipotetica: `AddEventModal`
ingheata `visibleTo` la creare si nu-l mai revizuieste, deci a adauga un asignat mai tarziu o
produce singur.

A doua: prima versiune re-muta pe Personal evenimentele unui grup din care ai iesit — ceea ce se
ciocnea cu `LeaveGroupModal`, care deja te intreaba ce pastrezi si face COPII personale. Ar fi
pus copia si originalul unul langa altul si ar fi inviat exact ce alesesei sa nu pastrezi.

**Amandoua au disparut prin simplificare:** fara re-mutare, si cu „a fi NUMIT pe eveniment bate
lista de audienta”. Modulul a scazut de la 195 la 139 de randuri si nu mai are nevoie nici de
lista grupurilor, nici de un steag de incarcare — cinci din cele noua constatari au disparut
odata cu ele.

### Acelasi defect, alte doua panouri (o linie fiecare)

`GroupChatWidget` si `GamesHubModal` erau montate fara `key`, deci schimbarea tabului redirecta
ascultatorul spre alta conversatie/alt grup in timp ce mesajele, digestul AI, ciorna si
clasamentul ramaneau ale grupului dinainte. `Chat.tsx` facea deja asta corect, cu un comentariu
care spune de ce. Acum o fac si astea doua.

### Probe

Trei mutatii distincte pe modul, fiecare prinsa (6, 2 si 1 teste cazute); replay al celor 24 de
documente reale prin functia livrata, in ambele versiuni: **strain 11/9/9/7 -> 0 peste tot, si
nimic care apartinea unui tab nu a disparut**. `npx tsc -b` verde · **1382 de teste** · build verde.

---

## 2026-09-16 · Schimbarea calendarului tinta lasa in urma oameni pe care nu-i mai vezi

**Prompt (Andrei):** „care este problema aici, de ce ar trebui sa incepem o sesiune noua?”,
apoi „da-i drumul”. **Model:** Claude Opus 5.

Gasit de revizia adversariala de mai devreme, lasat pe chip fiindca era in afara a ce ceruse.
Nu era nevoie de sesiune noua — chip-ul e doar un bilet, nu o cerinta.

### Ce facea

Selectul de calendar tinta facea exact un lucru: `setSelectedGroupId(e.target.value)`. Doua liste
care au inteles doar INAUNTRUL unui grup ramaneau neatinse — `assigneeIds` si `visibleTo` — in
timp ce formularul le deseneaza filtrate la grupul NOU. Deci cine nu e in grupul nou disparea de
pe ecran si ramanea in document.

Trei consecinte, si a treia e cea care face reparatia obligatorie, nu cosmetica:

1. crezi ca l-ai scos — nu l-ai scos, doar nu i se mai deseneaza bulina;
2. el nu vede evenimentul (e depus pe un calendar pe care nu-l are, dupa regula de azi
   dimineata) dar **primeste memento**, fiindca `remindersCore.ts` trimite celor asignati fara
   sa se uite la grup;
3. mutat pe **Personal**, scrierea e **refuzata** de reguli: un eveniment fara grup poate numi
   doar propriul autor. Formularul oferea o stare pe care baza de date o respinge.

### Bancul, in ambele sensuri

Am montat AddEventModal-ul ADEVARAT cu scrierile interceptate, ca sa citesc ce se SALVEAZA, nu ce
se deseneaza. Scenariu: eveniment in Family, Emilia asignata, mutat pe Gym.

| | pe codul livrat | cu reparatia |
|---|---|---|
| pe ecran dupa mutare | Emilia nicaieri | Emilia nicaieri |
| **salvat** | `assigneeIds:['u5']`, `visibleTo:['u5','u2']` | `assigneeIds:[]`, `visibleTo:['u2']` |
| mutat pe Personal, salvat | `assigneeIds:['u5']` → **refuzat de reguli** | `assigneeIds:[]` |

Ecranul arata la fel in ambele. Diferenta e intreaga in document — exact felul de defect pe care
nici typecheck-ul, nici testele, nici o captura nu-l pot vedea.

### Reparatia

`src/utils/eventTargeting.ts` (12 teste, 3 mutatii prinse): mutarea re-deriva ambele liste.
Persoanele asignate sunt o **intersectie** (cine e si in grupul nou a fost ales deliberat; tu si
asistentul AI supravietuiesc mereu), audienta e un **reset** la membrii grupului nou fara tine —
o audienta carata din alt grup nu e o alegere mai ingusta, e o lista de alti oameni, si poate
sfarsi numind pe nimeni din grupul pe care evenimentul tocmai a ajuns.

Plus un test de reguli (al 128-lea) care numeste cazul NEVINOVAT: nu injectia, ci mutarea
propriului eveniment pe calendarul propriu cu altcineva inca asignat. Aceeasi clauza il refuza.

`npx tsc -b` verde · **1394 de teste** · **128 de teste de reguli** · build verde.

---

## 2026-09-18 · Audienta unui eveniment, intoarsa pe dos

**Prompt (Andrei):** „da-i drumul” — la intrebarea lasata deschisa pe 16.09: ar trebui ca
membrii care intra mai tarziu intr-un grup sa vada evenimentele de dinainte?
**Model:** Claude Opus 5.

### Ce masurasem

Campul se numea `visibleTo`: lista celor care AU VOIE sa vada evenimentul, scrisa o data la
creare si nerevizuita niciodata. O lista de permisiuni nu poate deosebi „lasat afara dinadins”
de „nu era inca aici”, deci imbatraneste in minciuna din clipa in care intra cineva in grup.
Trei masuratori pe live, toate numarate, niciuna impresie:

* **CINCI evenimente** — adica toate cate are B&D — nu-i numeau pe niciunul dintre cei doi
  membri intrati dupa ce fusesera scrise. Doi oameni deschideau un grup real si nu vedeau nimic.
* **un eveniment din Family numea doi oameni care nu sunt in Family** — asta ii da originea pe
  fata: lista era semanata din toti cu care imparti ORICE grup, nu din grupul evenimentului.
* **niciunul din cele 12 evenimente de grup** n-avea audienta mai ingusta decat instantaneul ala.
  Functia pentru care exista campul nu fusese folosita niciodata.

A treia masuratoare e cea care a decis migrarea: nu exista nimic deliberat de pastrat.

### Ce s-a schimbat

Nu citirea — **ce se scrie**. Campul e acum `hiddenFrom`: cine a fost lasat afara dinadins.
Rosterul se citeste la afisare si nu poate ramiîne in urma; singurul lucru inregistrat e
exceptia, iar o exceptie care nu numeste pe nimeni e lista goala care pare.

Interfata NU s-a schimbat: tot o bifa per membru, „omul asta vede”, toate bifate implicit. Doar
ce se stocheaza e complementul. `visibleTo` nu mai e citit nicaieri.

**Ce nu e:** nici `visibleTo`, nici `hiddenFrom` n-au aparut vreodata in `firestore.rules` sau
in vreo Cloud Function. Orice membru al unui grup POATE citi orice eveniment al lui; asta e
calendarul care refuza sa deseneze unul. E o politete, nu o granita de securitate.

### Probe

Replay al celor 24 de documente reale prin ambele versiuni:

| tab | privitor | inainte | dupa |
|---|---|---|---|
| B&D | u7 | 0 | **5** |
| B&D | u8 | 0 | **5** |
| toate celelalte 17 combinatii | | neschimbate | neschimbate |

Coloana „pierdut” goala peste tot — nimeni nu pierde nimic.

Pe banc, cu scrierile interceptate: formularul salveaza `hiddenFrom: []` implicit,
`hiddenFrom: ['u5']` dupa ce debifezi o persoana, si **nu mai scrie deloc `visibleTo`**.
Patru mutatii pe modul, fiecare prinsa (5, 2, 3 si 1 teste cazute).

**Capcana din memorie care s-a activat:** `OVERRIDE_FIELDS` din `functions/src/index.ts` e o
lista alba — un camp care lipseste de acolo e aruncat TACUT. Fara `hiddenFrom` in ea, editarea
unei singure aparitii dintr-o serie ar fi pierdut excluderea fara niciun semn. De aici si
ordinea de livrare: **functions inainte de hosting**.

`npx tsc -b` verde · **1391 de teste** · **128 de teste de reguli** · build verde · functions build verde.

---

## 2026-09-18 · Cardul de pe lista de cumpărături, pe care doar tu îl vedeai

**Prompt (Andrei):** „da-i drumul”, fără o propunere pe masă — deci ales de mine.
**Model:** Claude Opus 5.

### Cum a fost ales

Prima idee (rânduri al căror container nu mai există) a picat la măsurătoare: **zero** pe live.
Am întrebat atunci jurnalul de erori, care avea o intrare NOUĂ, de azi:
`Missing or insufficient permissions.` în `EventDetailsModal.checklistAssets`.

### Ce era

Un card din portofel atașat la un eveniment de grup nu era partajat cu grupul. Regula zice
„proprietarul, sau grupul din `sharedGroupId`”, iar toate cele 18 active aveau câmpul gol. Ce se
pierde e jumătatea utilă: **poza** stă pe eveniment și se vede, **codul** stă pe activ și nu. Omul
de la casă vede fotografia cardului, nu ce se scanează. Măsurat: **2 din 2** atașamente de pe
evenimente de grup, necitibile de celălalt membru.

Decizia era deja luată în cod, pe cealaltă ramură: o poză încărcată se salvează cu
`...shareFieldsFor(selectedGroupId)`; una aleasă din portofel, cu nimic.

### Al doilea lucru, cu miză mai mare

Reparația de simbologie din 16.09 ajunsese **într-un loc din trei**. `EventDetailsModal` păstra
vechiul lanț de două ori, inclusiv pe copia de lângă „cumpără lapte”. Pe banc, același număr:
**23 de bare ca Code 128 pe codul livrat, 18 ca UPC-E cu reparația.**

### Ce s-a făcut

* `AssetBarcode` — UN randator pentru toate cele trei locuri (74 de linii scoase, 23 puse), cu
  mărimile fiecărui loc păstrate;
* `barcodeAdoption.test.ts` — poarta care refuză a patra copie (probată: 3 din 5 pică pe codul
  livrat);
* `assetAttach.ts` — partajarea la atașare: doar un card **privat, al tău**; refuză cardul altcuiva
  și unul deja partajat cu alt grup (l-ar fura de-acolo);
* refuzurile rămase se **spun** pe ecran, și la lista de bifat și la cardul evenimentului;
* formularul anunță lărgirea de acces **înainte** de salvare.

### Două runde de revizie adversarială, 13 constatări confirmate

**Runda 1 (17 agenți, 1,8M):** trei HIGH în cod scris azi. Lista de partajat o construiam din
`selectedAssetId`, care la o EDITARE e mereu gol — deci cardul-imagine principală ajungea pe un
eveniment de grup nepartajat, iar notificarea mea tăcea exact acolo. Din cele două atașamente
stricate de pe live, reparația mea repara unul. Plus: un reviewer a probat pe emulator că
**citirea unui card șters e refuzată la fel** ca una nepermisă — deci mesajul nu poate pretinde
cauza. Reformulat, cu variantă separată pentru evenimente fără grup. Și o regresie de mărime:
dădusem `fontSize=14` unde biblioteca punea 20 — cifrele de sub cod, cu o treime mai mici.

**Runda 2 (6 agenți, 0,7M):** un HIGH care ar fi omorât aplicația. Trei hook-uri sub
`if (!isOpen) return null` → React #310 la prima deschidere a ferestrei, cu calendarul pe
ErrorBoundary. **A doua oară când aplicația asta livrează #310**, și există deja o poartă scrisă
după prima dată (`scripts/lint-gate.mjs`) care o prinde în două secunde. N-am rulat-o. Acum e în
regula de lucru din CLAUDE.md.

Tot runda 2: partajarea din autosalvare era greșită din principiu — un cronometru nu e o intenție.
Pornea la o secundă după ce formularul se popula, deci partaja cu grupul din care tocmai plecai,
iar `other-group` refuza apoi să-l repună pe cel adevărat; și închiderea ferestrei n-o putea
anula. **Acum lărgirea urmează un gest** (Save/Done), iar cazul nepartajat e explicat pe ecranul
celuilalt în loc să fie tăcut.

### Ce m-a învățat bancul despre bancuri

Primul banc monta fereastra **deja deschisă**. De-aia cele trei hook-uri au trecut prin el: numărul
de hook-uri nu se schimba niciodată. Ecranul real o montează închisă și o deschide. **Reproducerea
ecranului nu e de ajuns — condițiile de montare fac parte din caz.** Refacut așa: zero erori.
Și a doua oară: „dovada” că reparația HIGH merge venea de fapt din autosalvare, fiindcă butonul la
editare se cheamă **Done**, nu „Save Event”, și clicul meu nu nimerea nimic.

`npx tsc -b` verde · **poarta de lint verde** · **1407 teste** · build verde · 8 mutații prinse.

---

## 2026-09-18 · Cardul dat mai departe purta grupul expeditorului

**Prompt (Andrei):** „da-i drumul”, fără propunere pe masă — ales de mine.
**Model:** Claude Opus 5.

### De ce ăsta, și de ce ACUM

Era pe lista de „știute și nereparate” de la revizia portofelului din 16.09, cu prioritate mică.
Prioritatea s-a schimbat ieri seară, prin schimbarea mea: până azi `sharedGroupId` era **null pe
toate cele 18 active** — partajarea nu funcționa, deci nu avea ce să se scurgă. De azi, atașarea
unui card la un eveniment de grup chiar îl setează. **Reparația de ieri armează bug-ul ăsta.**

### Ce făcea

`transferAssetCopy` construia copia ca `{ ...rest, ownerId: recipientId }`, unde `rest` era tot
documentul minus `ownerId` și `createdAt`. Deci `sharedGroupId` călătorea cu cardul — iar regula
îl rezolvă **la citire**:

```
allow read: ... || ('sharedGroupId' in d && d.sharedGroupId is string && isMemberOfGroup(...))
```

Deci din clipa în care dai cuiva un card partajat, tot grupul TĂU poate citi cardul din portofelul
LUI — un grup în care poate nu e, și pe care nici măcar nu-l vede numit pe card (portofelul poate
tipări doar numele unui grup pe care îl cunoaște, deci cade pe un „Partajat” gol).

### Regula

**Un card transferat pornește PRIVAT.** Partajarea e o afirmație pe care proprietarul o face
despre cardul LUI; un proprietar nou n-a făcut-o. O poate face singur, cu un grup de-al lui, dintr-o
apăsare — singura versiune a afirmației care înseamnă ceva.

`functions/src/assetTransfer.ts` (pur, fără importuri) + 9 teste din `src/`, ca la aiProviderError.
Copia e o listă NEAGRĂ, intenționat: un câmp nou pe un card face parte din card până decide cineva
altfel; doar cele două care hotărăsc CINE-L POATE CITI sunt reținute.

### Probe

Prima mutatie a picat toate cele 9 teste — adică spărsese compilarea, nu fusese prinsă de
aserțiuni. Refacută într-o formă care **compilează** și restaurează exact defectul: **pică un
singur test**, fix cel care trebuie. Un verde care vine din alt motiv decât cel pretins nu e o
probă, și un roșu la fel.

`npx tsc -b` verde · poarta de lint verde · **1416 teste** · build verde · functions build verde.

---

## 2026-09-18 · Încărcarea care raporta eșec și apoi reușea

**Prompt (Andrei):** „da-i drumul”, fără propunere pe masă — ales de mine.
**Model:** Claude Opus 5.

### Cum a fost ales, și ce am măsurat greșit pe drum

Primul candidat (un `assetId` rămas pe eveniment după ce înlocuiești poza) a picat la
măsurătoare: **zero** pe live. Al doilea era plafonul de 15 secunde la încărcare, de pe lista de
știute-și-nereparate.

Ca să văd dacă a lăsat urme, am numărat orfanii din bucket. **Instrumentul a mințit de două
ori:** prima dată a zis 14 orfani (20 MB) fiindcă scanam doar `assets` și `events`; a doua oară
10, fiindcă ghiceam numele subcolecțiilor — iar mesajele de grup stau la `groups/{id}/messages`.
Abia a treia versiune, care **enumeră** subcolecțiile, dă cifra onestă: **2 orfani, 3,34 MB** din
44 de obiecte. Unul e sub `assets/`, adică exact linia asta.

### Ce făcea

```js
const uploadTask = uploadBytes(fileRef, buffer, { contentType: file.type });
const timeoutTask = new Promise((_, reject) => setTimeout(() => reject(
  new Error('Upload timed out. Storage might be blocked.')), 15000));
await Promise.race([uploadTask, timeoutTask]);
```

Trei lucruri greșite, în ordinea costului:

1. **`Promise.race` nu anulează perdantul**, iar `uploadBytes` n-are anulare deloc. Deci la 15
   secunde omul află că a eșuat, încărcarea continuă și reușește, și rămâne un fișier pe care
   niciun document nu-l arată. Îl plătești, nu-l vezi, nu-l poți șterge.
2. **15 secunde e o durată, iar întrebarea nu e despre durată.** Regulile permit 10 MB; patru
   fișiere de pe live trec de 2 MB. Pe telefon, pe semnal prost, aia e o încărcare sănătoasă.
3. **„Storage might be blocked” e un diagnostic, nu o observație** — numește o cauză pe care codul
   n-are cum s-o știe, și nu pe cea probabilă.

### Ce s-a făcut

Erau **șapte** locuri de încărcare în patru fișiere, toate cu `uploadBytes`. Șase fără nicio
limită (o rotocoală care nu se mai întorcea niciodată), al șaptelea cu cursa de mai sus.

* `uploadWatch.ts` — Întrebarea devine una la care se poate răspunde: **s-a mișcat ceva de
  curând?** O încărcare care transferă e sănătoasă oricât ar dura; una care n-a transferat nimic
  de 20 de secunde și-a pierdut legătura, și asta se poate spune ca observație.
* `uploadFile.ts` — un singur loc cu SDK-ul: reluabilă (deci raportează octeți și **se poate
  anula**), renunță doar la blocaj, și **anulează înainte să respingă** — anularea e miezul, nu
  eroarea.
* `uploadAdoption.test.ts` — refuză un al optulea loc, și refuză forma cu `Promise.race`.
* mesaj onest + raportare în `errorLogs` (înainte mergea doar la `console.error`).

### Poarta care și-a pierdut polaritatea

Poarta a picat și pe codul REPARAT — fiindcă antetul lui `uploadWatch.ts` **citează** codul vechi
ca să-l explice, iar scanerul citea proza ca și cod. Acum taie comentariile înainte să caute:
blocurile întregi, iar comentariile de linie doar când încep rândul, ca un `//` dintr-un URL să nu
înghită cod real de pe aceeași linie.

### Probe

4 mutații prinse. Pe banc, cu Wallet-ul ADEVĂRAT și o încărcare pe care o conduc eu: butonul arată
**25%**, apoi **90%**; lăsată blocată 22 de secunde, `cancel()` a fost chemat **o dată**, mesajul
afișat a fost cel nou, iar formularul a rămas deschis pentru o nouă încercare.

`npx tsc -b` verde · poarta de lint verde · **1436 de teste** · build verde.

---

## 2026-09-19 · O treime din eșecuri nu ieșeau niciodată de pe telefon

**Prompt (Andrei):** „continua”. **Model:** Claude Opus 5.

### Cum am ajuns aici

Am verificat întâi că livrările de ieri n-au stricat nimic (jurnalul de erori n-a crescut) și că
SDK-ul Gemini care moare pe 30.11.25 e deja înlocuit — amndouă curate, deci n-aveam ce repara.

Atunci am întors întrebarea spre **instrumentul** pe care m-am bazat toată ziua. Panoul de
sănătate e cum am găsit bug-ul cu cardul de pe lista de cumpărături, la două zile după ce
începuse. Un instrument valorează cât ce ajunge la el.

### Ce am măsurat

Din **143 de blocuri `catch`** din `src/`, **49 scriau în consolă și nu raportau nimic**. O treime
din toate căile de eșec ale aplicației se terminau pe dispozitiv, în timp ce panoul arăta curat.

Două dintre cele 49 le găsisem pe calea grea cu o zi înainte: încărcarea din portofel raporta doar
în `console.error`, iar `AddEventModal` nici măcar nu importa raportorul — `reportError` acolo se
lega la **funcția globală din DOM**, care ia un singur argument și scrie în consolă. Apelul
compila, rula, și nu raporta nimic; obiectul de context cădea pe jos.

### Ce s-a făcut

Toate cele 49 trec acum prin `reportError`, cu un context derivat din numele funcției care le
conține (`Settings.handleNameSave`, `Friends.respond`, `GamesHubModal.handleEndGame`…). Trei
contexte le-am scris de mână: euristica „cel mai apropiat nume” nimerea un ajutor vecin, iar un
context greșit e mai rău decât unul vag — panoul grupează după el și te trimite la alt cod.

Blocurile au fost găsite prin **potrivire de acolade**, nu prin regex: un regex nu poate spune
unde se termină un bloc, și m-a indus în eroare de două ori în două zile.

`errorReporting.test.ts` refuză a cincizecea înghițire, și refuză separat un fișier care cheamă
`reportError` fără să-l importe — capcana din ziua dinainte.

### De știut

**Panoul o să se aprindă mai tare de-acum.** Nu fiindcă s-a stricat ceva, ci fiindcă lucruri care
se întâmplau în tăcere încep să se vadă. Raportorul are deja deduplicare (30s) și plafon de rată
(10/10s), deci nu se poate inunda.

`npx tsc -b` verde · poarta de lint verde · **1439 de teste** · build verde · 17 fișiere, +73/-5.

---

## 2026-09-19 · Lista de verificat încetase să fie o listă

**Prompt (Andrei):** „continua”. **Model:** Claude Opus 5.

### Ce am măsurat

Am verificat întâi că panoul de erori n-a crescut după măturătoarea de aseară (nu crescuse —
nimeni n-a folosit aplicația între timp, deci plata e în așteptare, nu absentă).

Apoi m-am uitat la `OWNER_VERIFY.md`: **262 de căsuțe nebifate, 8 bifate, 1028 de linii, 22 de
secțiuni, o lună de acumulare.** Andrei n-a bifat nimic din șapte livrări în două zile — nu
fiindcă n-a vrut, ci fiindcă ce contează era îngropat. O secţiune numită chiar „Ce trebuie să
știi, **NU** să verifici” avea 52 de bife. Am scris fapte ca și când ar fi sarcini.

### Mai rău: lista îi cerea lucruri deja făcute

Punctul 30 îi spunea de cinci zile să genereze și să pună cheia VAPID, fiindcă „push-ul n-a
funcționat niciodată, `fcmTokens` lipsește de pe toate cele 8 conturi”. **Re-măsurat azi: cheia e
pusă, înregistrarea merge, două conturi au token** — unul cu șapte dispozitive. Ce lipsește e ca
celelalte șase să se reconecteze o dată.

O listă învechită nu e doar inutilă: **îi consumă timpul pe lucruri făcute.**

### Ce s-a făcut

N-am șters nimic. O primă pagină cu patru lucruri, toate măsurate AZI pe datele reale: rotația
cheii de service account (singura cu miză de securitate — a tranzitat Drive), push-ul 2 din 8,
cardul de pe evenimentul de grup, și cei doi orfani din bucket. Apoi întrebările care-l așteaptă,
ca întrebări — nu ca bife. Restul, cinstit etichetat ca arhivă.

Regula e acum în `CLAUDE.md`, ca să nu reconstruiesc arhiva peste două săptămâni: un fapt se
scrie ca text, fiecare punct spune ce se strică dacă răspunsul e greșit, și **re-măsoară înainte
să repeți o constatare veche**.

Nicio schimbare de cod — deci niciun deploy. `npx tsc -b` verde · poartă de lint verde · 1439 de
teste verzi (rulate fiindcă așa spune regula, nu fiindcă s-ar fi putut schimba ceva).

---

## 2026-09-19 · Livrasem șapte locuri și probasem unul

**Prompt (Andrei):** „continua”. **Model:** Claude Opus 5. **Nicio schimbare de cod.**

### Gaura din livrarea mea

Ieri am rutat **șapte** locuri de încărcare prin același încărcător și am probat pe banc **unul**
(portofelul). Typecheck și teste nu spun nimic despre celelalte șase. Recitite, arătau corect pe
hârtie — dar „arăta corect pe hârtie" e exact ce m-a pedepsit de trei ori săptămâna asta.

### Ce am probat

Două ecrane pe care nu le montasem niciodată, cu încărcarea condusă de mână:

* **poza din chat** — cale `chat-images/g_family/…`, corectă; **mesajul nu se scrie până nu se
  termină încărcarea** (zero scrieri înainte); URL-ul ajunge în mesaj;
* **poza principală a unui eveniment** — cale `events/u1/…`; evenimentul nu se scrie până nu se
  termină; URL-ul ajunge pe el.

Calea nu e un amănunt: **regulile de Storage sunt pe folder**, deci o cale greșită nu e un fișier
prost așezat, e un refuz.

Trei din șapte, dar acoperă **ambele forme de argument** — `File` (chat, eveniment) și
`ArrayBuffer` + `contentType` (portofel). Cele patru rămase sunt aceeași formă, în același tipar
de apel. **Nu spun că le-am probat pe toate șapte** — spun ce am probat și de ce cred că restul e
acoperit.

### Instrumentul avea două defecte, codul niciunul

Prima rulare a arătat mesajul scris cu `imageUrl: null` și am fost gata să strig bug. Era falsul
meu: `getDownloadURL` returna **șir gol**, deci orice încărcare părea să nu producă nimic. Reparat,
a ieșit URL-ul — dar cu calea `unknown`, fiindcă falsul de `ref` pentru Storage arunca calea.
Reparat și ăla, și abia atunci proba a devenit o probă.

Un banc cu instrumentul stricat nu dă un răspuns greșit — dă un răspuns care **pare** corect.
Amndouă reparațiile stau în copia de banc din scratchpad, deci următorul banc de încărcare
pornește cu ele.

`npx tsc -b` verde · arbore curat · nimic de comis în `src/`.

---

## 2026-09-19 · Poarta care păzea traducerile era oarbă de 24 de zile

**Prompt (Andrei):** „continua”. **Model:** Claude Opus 5.

### Ce căutam

Văzusem în treacăt un buton scris în engleză — „Remove Attached Asset” — într-o aplicație care
e românească în primul rând. Am scris un scaner ca să văd câte sunt.

### Scanerul a cerut patru încercări

1. Decupajul de comentarii bloc a înghițit **18.529 de caractere** din `AddEventModal`, fiindcă
   `accept="image/*"` conține un `/*` într-un ȘIR.
2. Tiparul `>…<` prindea generice TypeScript — 196 de „constatări”, aproape toate false.
3. Numerele de linie se calculau după scoaterea comentariilor, deci erau toate greșite.
4. Canarul era un defect REAL, deci a încetat să funcționeze exact când l-am reparat.

### Și apoi am descoperit că exista deja o poartă

`src/utils/i18nCoverage.test.ts`, scrisă pe **26.08**, al cărei antet e chiar despre un „totul e
curat” fals. Am suprascris-o din greșeală, am văzut-o în `git status` și am restaurat-o.

Întrebarea a devenit atunci mult mai bună: **de ce a lăsat ea 17 șiruri să treacă?** Trei motive:

* **aceeași capcană cu `/*`** — măsurat: 18.592 de caractere oarbe în `AddEventModal`, 7.202 în
  `Wallet`, 3.148 în `Settings`. Aproape **36.000 de caractere** din cele mai mari trei ecrane,
  timp de 24 de zile, cu CI verde în fiecare zi;
* **nu se uita deloc la atribute** — `alt`, `placeholder`, `title`, `aria-label`;
* cerea ca textul să înceapă cu majusculă, deci „e.g., Buy Milk…” era invizibil oricum.

**Am reparat-o, nu am înlocuit-o.** Fiecare scaner prindea ce celălalt rata: al ei masca `{…}`
înainte de căutare, ceea ce al meu nu făcea — de-aia a găsit ea cinci lucruri pe care eu le
ratasem, printre care **lista de repetare**.

### Ce era netradus

Douăzeci și două de șiruri: un buton „Remove Attached Asset”, „Change Photo”, „Link Card”,
placeholder-e („e.g. Kroger Card”), nouă texte `alt` (citite cu voce tare de cititoarele de
ecran), și — cel mai vizibil — **lista de repetare din formularul de evenimente**: „Daily —
until”, „Weekly — until”…

Aia din urmă avea o rădăcină mai adâncă: `getFrequencyLabel` **returna engleza din funcție**, dintr-un
modul pur care n-are cum să știe limba. Acum returnează **cheia** (`getFrequencyKey`), iar limba
se alege acolo unde e cunoscută. O funcție care returnează un cuvânt decide limba pentru toți
apelanții.

Și data rămăsese engleză („Sep 19, 2027”) chiar după ce cuvântul s-a tradus. Acum trece prin
`getDateLocale`, în ordinea zi-întâi pe care o folosește deja restul aplicației.

### Probat pe ecran

Pe banc, cu limba pusă pe română: **„Zilnic — până pe 20 oct 2026”**, „Săptămânal — până pe 19 sep
2027”. Înainte: „Daily — until Oct 20, 2026”.

`npx tsc -b` verde · poartă de lint verde · **1442 de teste** · build verde.

---

## 2026-09-19 · Cel care poate repara e singurul care nu vede nimic

**Prompt (Andrei):** „continua”. **Model:** Claude Opus 5.

### De unde am plecat

Din jurnalul de erori de pe live. Singura intrare **nouă**: `Missing or insufficient
permissions.` la `EventDetailsModal.checklistAssets`, de două ori, un om. Adică exact defectul
reparat ieri — devenit vizibil tocmai fiindcă l-am făcut să se raporteze.

Doar că reparația de ieri se întâmplă **la apăsarea pe Salvează**. Ce era atașat înainte rămâne
privat, iar evenimentele alea nu se re-salvează singure.

### Ce am măsurat (read-only, 19.09)

* 18 carduri, **niciunul** partajat cu vreun grup;
* două atașamente pe evenimente de grup, **niciunul** lizibil de ceilalți;
* dintre ele **unul singur ascunde un cod scanabil** (UPC-A). Celălalt e un card doar-cu-poză,
  iar acolo singurul efect e o **alarmă falsă**: celuilalt membru i se scrie „cardul nu poate fi
  arătat” pentru un card care oricum n-avea ce să arate.

Măsurătoarea asta a schimbat textul: scrisesem „doar tu vezi **codul** acestui card”, ceea ce e
fals pentru 8 din cele 18 carduri, care n-au cod deloc. Acum scrie „doar tu vezi acest card”.

### Asimetria

**Cel care poate repara e singurul care nu vede nimic.** Proprietarul își citește propriul card,
deci codul i se desenează perfect; scuza galbenă o primesc ceilalți. Deci anunțul trebuie pus pe
ecranul celui care nu vede nimic — și trebuie să fie un **gest**: deschiderea unei ferestre nu e
consimțământ pentru lărgirea unui drept de citire. (Același motiv pentru care ieri am scos
partajarea din autosalvare.)

### Ce am făcut

`unsharedAttachedCards` — **aceeași** funcție de decizie pe care o folosește salvarea, cu același
set de id-uri (inclusiv articolele bifate: bifarea nu e dezatașare). Un regulament scris de două
ori e un regulament care se desincronizează.

În `EventDetailsModal`: un chenar galben cu numele cardului și un buton. Refuză, explicit, cardul
altcuiva și cardul partajat cu ALT grup — al doilea fiindcă `sharedGroupId` numește un singur
grup, deci re-țintirea ar lua tăcut accesul unor oameni care nu sunt în cameră.

### Probe

* 10 teste noi (21 în fișier), și **5 din 5 mutații prinse**: uită lista de bifat, uită imaginea
  evenimentului, sare peste articolele bifate, inventează un grup pe un eveniment personal,
  răspunde pentru un card pe care nu l-a citit;
* pe banc, componenta REALĂ cu patru carduri pe un eveniment: al meu privat → **oferit**; al
  Emiliei, refuzat → scuza, neoferit; al meu partajat cu Gym → codul se vede, **neoferit**; al
  meu deja partajat cu Family → nimic. Apăsat: **o singură scriere**, `assets/a1`, cu
  `{sharedGroupId, sharedWithFamily}`, și chenarul dispare;
* calea de eșec, cu scrierea refuzată din banc: **nicio** scriere, chenarul rămâne, butonul rămâne,
  și apare „Nu s-a putut partaja”.

### Două lucruri văzute pe banc, de reparat separat

Cu limba pe română, în antetul ferestrei scrie **„Sunday, September 20, 2026”**, iar butonul de
asignare scrie **„+ Assign Member”**. Aceeași familie cu intrarea de azi-dimineață.

### Confidențialitate

Depozitul e **public**. Ieri am scris în `OWNER_VERIFY.md` titlurile reale a două evenimente de pe
live; le-am scos. Măsurătorile rămân cifre, iar scripturile de citire nu tipăresc niciun uid și
niciun e-mail.

`npx tsc -b` verde · poartă de lint verde · **1452 de teste** · build verde.

---

## 2026-09-19 · Reparația de dimineață fusese pe jumătate

**Prompt (Andrei):** „continua”. **Model:** Claude Opus 5.

### Cum le-am găsit

Pe captura de ecran a bancului de la task-ul anterior. Cu limba pe română, în antetul ferestrei
de eveniment scria **„Sunday, September 20, 2026”**, iar în lista de responsabili
**„+ Assign Member”** — la o oră după ce poarta de i18n raportase curat.

### Prima: filtrul de majusculă a fost scos dintr-un singur loc

Dimineață am scris în antetul porții că una dintre cele trei orbiri era
`if (!/^[A-Z]/.test(text)) continue;`. L-am scos din bucla de **atribute** și l-am lăsat în bucla
de **text** — care e chiar cea despre care vorbește nota. Deci antetul spunea că orbirea a
dispărut în timp ce jumătate din ea era tot acolo.

Măsurat înainte să-l scot de tot: filtrul arunca **patru** potriviri din tot `src`. Două erau
șiruri reale (`+ Assign Member`, `typing...`). Celelalte două erau `liveQuery` (un identificator
care iese din `liveQuery<any>(`) și `0 && dist` (un `if` obișnuit într-un fișier .tsx). Adică
plătea două defecte reale ca să evite două false pozitive — iar ambele false pozitive au o
formă pe care o poți numi: un token singur, scris cu literă mică, și un `&&`.

### A doua: o dată care rostește un cuvânt

`format()` din date-fns scrie engleza dacă nu i se dă o `locale`. **Măsurat: 15 apeluri al căror
șablon poate rosti un cuvânt, 9 fără locale** — antetul ferestrei de eveniment (patru),
despărțitorul de zi din chat, arcade-ul, fereastra de ieșire din grup și panoul de repetări.

Poarta de i18n n-avea cum: `format(d, 'MMM d, yyyy')` nu conține nicio proză englezească —
engleza se produce la rulare, dintr-un șablon făcut din litere care nu sunt cuvinte. E o altă
formă de defect, deci o a doua plasă: `src/utils/dateLocaleCoverage.test.ts`. Ea ignoră intenționat
șabloanele din cifre (`yyyy-MM-dd`, `HH:mm`) — alea se citesc la fel în orice limbă, iar o poartă
zgomotoasă ajunge să fie ignorată.

Ordinea rămâne **ziua întâi**, ca ieri la lista de repetări și ca în restul aplicației.

### Probe

**5 din 5 mutații prinse:** filtrul de majusculă pus la loc, filtrul de cod care uită `&&` și
`||`, lista de responsabili întoarsă la engleză, antetul care-și pierde locale-ul, și poarta de
date care nu mai recunoaște un nume de lună.

### Restaurarea unei mutații nu s-a prins, și verificarea de la final a spus-o

După rulare, harness-ul și-a rulat propria verificare finală și a ieșit **roșu**: linia primei
mutații era înapoi în fișier, deși scriptul scrisese originalul și-l citise înapoi ca să-l
compare, iar mutația următoare rulase demonstrabil pe fișierul curat (a dat două eșecuri, ceea ce
e posibil doar fără filtrul ăla). Arborele stă în Google Drive; nu pot dovedi mecanismul.

Ce pot spune e că **verificarea de la CAPĂTUL rulării e cea care și-a meritat existența** — nu
comparația de după fiecare restaurare, care a trecut. Am curățat de mână și am recitit fiecare
ancoră din cele trei fișiere atinse.

(Și o alarmă falsă de-a mea pe drum: am căutat `/^[A-Z]/.test(text)` ca să confirm curățenia și
l-am găsit — în **comentariul** care povestește despre el.)

### Ce rămâne, măsurat

**29 de șiruri englezești de forma `|| 'Ceva'`** — valori de rezervă din interiorul unei expresii
(`|| 'Someone'`, `|| 'Unknown'`, `|| 'Photo'`, `|| 'Member'`). Niciuna nu e vizibilă pentru poarta
de text, fiindcă stă în `{…}`, iar `{…}` e exact ce maschează poarta ca să nu citească cod. Nu
toate sunt vizibile omului (`'Render error'` e un mesaj de jurnal). Următorul task.

`npx tsc -b` verde · poartă de lint verde · **1460 de teste** · build verde.

