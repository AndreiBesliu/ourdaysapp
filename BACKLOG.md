# Backlog — OurDaysApp

> **Ce e și ce NU e fișierul ăsta.** O **evidență**, nu o coadă de lucru. Nimic de aici nu se
> începe fără ca Andrei să-l aleagă. O listă de „mai târziu” citită de o sesiune viitoare devine
> ușor o instrucțiune pe care n-a dat-o nimeni — de aceea fiecare punct spune **de ce așteaptă**.
>
> Nu e nici `OWNER_VERIFY.md` (ce verifică Andrei cu ochii lui și deciziile lui), nici `DEVLOG.md`
> (istoria, append-only). Sursa: auditul read-only din 24.09.2026 (pe `3d74d7c`), secțiunile B, C, D,
> plus ce a rămas deschis din felii. Un punct închis se **șterge de aici**, cu commit-ul care l-a
> închis menționat în DEVLOG.

## 1. Așteaptă reconstruirea APK-ului

APK-ul instalat rulează bundle-ul din 9 mai (măsurat 24.09) și vorbește cu aceleași reguli. Orice
regulă care refuză ce trimite el îl strică până la un APK nou. `rules-tests/apk-compat.test.ts`
pică exact când se ajunge aici.

- **Felia de reconstruire însăși:**
  - `android/app/google-services.json` **lipsește** — build-ul scrie „Push Notifications won't work”,
    deci push-ul pe APK n-a mers, după toate probabilitățile, niciodată;
  - permisiunile CAMERA și RECORD_AUDIO;
  - `versionCode` 2;
  - handler pentru tap pe push și afișarea push-urilor în prim-plan;
  - `npx cap sync`.

  **Decizia (a) bundle local vs (b) `server.url` e a lui Andrei** (`OWNER_VERIFY.md`).
- Regula temporară din Storage pentru numele vechi de fișier (`chat-images`, `chat-audio`) — se scoate
  a doua ramură.
- Reacțiile din chat: se pot rescrie de oricine din conversație. Se pot asigura pe forma de azi, cu o
  paletă și fără duplicate, dar numai împreună cu schimbarea clientului — vezi DEVLOG 23.09.
  **APK-ul rescrie toată harta**, deci orice variantă îl refuză.
- Regula care refuză `fromName` / `fromEmail` / `groupName` pe cereri. Ecranul nu le mai citește
  (`725993e`). **Corectat 24.09 de recenzia dinaintea deploy-ului:** nu APK-ul o ține pe loc —
  telefoanele nu ajung să trimită nicio invitație (căutarea după email e refuzată din 25 mai) — ci
  **clientul web**, care încă scrie câmpurile. Așteaptă o schimbare de client web, nu reconstruirea.
- Scoaterea token-ului de push la delogare pe APK: codul e gata (`a556640`), ajunge cu reconstruirea.
  La fel ordinea ascultătorilor de push nativ (`src/utils/nativePush.ts`, 24.09): pe un telefon cu
  mai multe logări token-ul ajungea la contul de dinainte.
- **Pe telefoane și CITIRILE sunt refuzate, din mai** (recenzia din 24.09, verificat pe bundle):
  calendarul ascultă `events` fără filtru, iar regula din 22 mai (`ee9e401`) nu-l poate dovedi —
  calendarul e gol. La fel portofelul, cheltuielile, `users` și căutarea din invitații. Nu se
  repară din reguli: o regulă care ar primi interogarea nefiltrată ar arăta oricui toate evenimentele.
- Cine folosește doar APK-ul **n-are profil public** (APK-ul nu scrie oglinda `profiles`): 3 profiluri
  pentru 8 conturi.
- Pe APK nu se poate adăuga nicio cheltuială (regula cere `ownerId`), iar erorile de pe telefoane nu
  ajung în `errorLogs` (bundle-ul din mai n-are raportare).

## 2. Securitate și confidențialitate (B)

- **`hiddenFrom`** — decizia e a lui Andrei (`OWNER_VERIFY.md`). Impunerea reală cere alt model de
  date și vine după reconstruire.
- **Storage:** `get` e permis oricărui cont autentificat pe orice cale, inclusiv `assets/{uid}/…`.
  De măsurat întâi ce citește, efectiv, fiecare ecran.
- **Storage:** `isImage()` pe `write` face ștergerea imposibilă (la delete nu există
  `request.resource`), iar `deleteGroupCascade` nu curăță `chat-images/`. Deci pozele șterse rămân
  pentru totdeauna.
- **Arcade:** un membru poate adăuga străini în `players` (reguli ~640-658). De verificat contra
  `apk-compat` — APK-ul creează și actualizează jocuri.
- **`logClientError`:** 200 de rânduri pe zi per cont, fără expirare. Codul poate scrie un
  `expireAt`; politica TTL se pornește din consolă.
- **Callable-uri fără test pe emulator:** `acceptGroupInvite`, `redeemGroupInviteLink`,
  `deleteGroupCascade`. Harness-ul există de pe 24.09 (`functions/test/`, sub `npm run test:rules`).
- Cererile și invitațiile vechi nu vor primi niciodată ștampila expeditorului (triggerul pornește o
  dată); rămân cu avertismentul. O ștampilare retroactivă se poate scrie — rulată doar cu confirmare.
- **Un eșec trecător la citirea contului Auth** (`authIdentityOf`) ștampilează `email: null` —
  pentru totdeauna, fiindcă triggerul pornește o dată. De la 24.09 ecranul arată atunci „nu am putut
  confirma” (corect: un nume singur nu confirmă pe nimeni), deci o cerere legitimă poate purta
  avertismentul. Reparația ar fi o reîncercare în trigger, sau ștampilarea retroactivă de mai sus.
- **Prietenii nu păstrează dacă emailul era verificat.** La acceptare se scrie emailul, nu și
  `emailVerified`, deci lista de prieteni nu poate deosebi o adresă dovedită de una tastată.
- **Emailul owner-ului rămâne în istoria git și în DEVLOG.** Din 24.09 vine din `functions/.env`
  (ignorat), dar repo-ul e public și istoria îl are. Rescrierea istoriei e decizia lui Andrei.
- **O cheltuială nu mai poate fi corectată după ce un membru pleacă din grup.** `splitIsHonest` cere
  ca toți din `splitAmong` să fie membri, pe documentul REZULTAT — deci orice editare a rândului e
  refuzată cât timp cel plecat e încă pe listă (scoaterea lui schimbă împărțirea). Ștergerea merge.

## 3. Cod și operațiuni (C)

- **Cheia Gemini** vine din `process.env.GEMINI_API_KEY_LOCAL` → `defineSecret`. Secretul trebuie
  creat întâi în Secret Manager (Andrei), altfel deploy-ul pică.
- **Bundle-ul:** chunk-ul principal are 1,5 MB (425 kB gzip). De împărțit pe rute: Wallet, Chat,
  Settings.
- **Warlord** (repo-ul Warlord, nu aici): 44 de PNG-uri, 28 MB, 800–900 kB fiecare → WebP.
- **Node 22 în Cloud Functions:** învechit din **30.04.2027**, scos din uz pe **31.10.2027**. Trecerea
  la Node 24 înainte de prima dată.
- **Fereastra de deploy și taburile vechi.** Regulile noi întâlnesc, până la hosting, clientul web
  vechi: o editare de ocurență fără `apply` se pierde, clopoțelul arată chei brute de i18n, oglinda
  `profiles` cu data completă e refuzată. De aceea **hosting imediat după reguli**. Un tab rămas
  deschis zile întregi le vede până la reîncărcare (`NewVersionNotice` o oferă).
- **Plasa AST din `requestSender.test.ts`** („nimic nu citește câmpurile expeditorului”) e oarbă la
  acces dinamic (`r[k]`), la destructurare cu redenumire printr-o variabilă și la fișiere în afara
  `src/`. O ocolire deliberată nu o prinde; o scăpare obișnuită, da.
- **Testul de emulator pentru checklist** nu poate deosebi o tranzacție de un „citește-apoi-scrie”
  fără fereastra lărgită pe care o folosește; fără ea, cursa nu se produce în timpul testului.
- **Checklist, în timpul unei scrieri:** instantaneul scrierii dinainte poate sosi și arăta pentru o
  clipă lista fără schimbarea mai nouă, până aterizează și ea. Cunoscut, lăsat (`checklistOps.ts`).
- **Toleranța ±1 zi la excepțiile de recurență** există pe server (`recurrenceServer.ts`), nu și în
  calendar. Contează doar pentru chei scrise de codul vechi: **măsurat pe live 24.09 — 0 chei de
  excepție**, iar cele noi se scriu exact. Nu merită portată decât dacă apar.

## 4. Produs (D) — doar înregistrat

- **Cont:** lipsesc resetarea parolei, ștergerea contului și schimbarea emailului sau a parolei.
  Niciun apel la `sendPasswordResetEmail` sau `deleteUser`. Ștergerea contului e obligatorie pentru
  GDPR, și pentru Google Play dacă aplicația ajunge acolo.
- **UI mort sau fals:**
  - `LeaveGroupModal` e montat, dar nu-l deschide nimic;
  - „invitațiile la evenimente în așteptare” citesc `inviteeId`, pe care nu-l scrie nimeni;
  - pull-to-refresh e doar un `setTimeout`;
  - comutatorul din overview are categorii inexistente.
- **PWA:** `public/manifest.json` trimite ambele iconuri la `/vite.svg`, care nu există.
- **Android:** fără bloc `server`, `versionCode 1`, doar permisiunea INTERNET. Push-urile din
  prim-plan sunt doar logate, iar tap-ul pe push nu deschide ecranul potrivit. Ține de reconstruire.
- **Cheltuieli:** plătitorul e mereu „eu”, fără monedă, fără editare, fără „settle up”, fără
  împărțire inegală.
- **Calendar:**
  - recurență personalizată (la 2 săptămâni, zile lucrătoare);
  - mai multe reminder-e per eveniment;
  - căutare și vedere agendă;
  - export ICS;
  - onboarding pentru un utilizator fără grup.
- **Chat:**
  - interogarea mesajelor n-are `limit` și se re-abonează la fiecare deschidere;
  - rândurile de notificare nu expiră niciodată;
  - indicatorul de tastare scrie la fiecare tastă.
- **Warlord, partea din repo-ul ăsta:**
  - sincronizarea pe două dispozitive (`src/warlordCloud.ts:~98-104`) dă câștig dispozitivului care
    a scris de mai multe ori, nu celui mai recent;
  - eșecul la încărcarea balansului e tăcut (`configApi.ts:~52-57`).
- **Warlord, în submodul** (se repară în repo-ul Warlord, nu de aici): `loadSave` pornește
  portofelul de la 5 aur, `resetAll` de la 10, iar `resetAll` nu resetează `inspection`.

## 5. Nivelul de owner — NU se începe fără Andrei

Orice admin poate face alt admin și poate trimite broadcast, fără MFA și fără autentificare recentă.
CLAUDE.md o numește o felie separată de autorizare.
