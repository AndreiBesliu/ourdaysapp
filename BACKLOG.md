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
  (`725993e`), dar APK-ul încă le scrie.
- Scoaterea token-ului de push la delogare pe APK: codul e gata (`a556640`), ajunge cu reconstruirea.
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
- Un override vechi (fără `overrideDate`) care a fost și **mutat** poate încă ascunde o ocurență
  reală de reminder și digest. Cele noi nu pot (`2d985db`).

## 3. Cod și operațiuni (C)

- **Cheia Gemini** vine din `process.env.GEMINI_API_KEY_LOCAL` → `defineSecret`. Secretul trebuie
  creat întâi în Secret Manager (Andrei), altfel deploy-ul pică.
- **Bundle-ul:** chunk-ul principal are 1,5 MB (425 kB gzip). De împărțit pe rute: Wallet, Chat,
  Settings.
- **Warlord** (repo-ul Warlord, nu aici): 44 de PNG-uri, 28 MB, 800–900 kB fiecare → WebP.

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
