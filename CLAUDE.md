# CLAUDE.md — OurDaysApp

## Ce este
Aplicație de familie/grup: calendar partajat, chat, wallet și un arcade de jocuri.
React + TypeScript + Vite + Tailwind, Firebase (Auth, Firestore, Functions, Hosting, FCM),
împachetată și cu Capacitor pentru Android. Live: <https://our-days-2a939.web.app>.

## Fapte stabile (infra)
- **Proiect Firebase:** `our-days-2a939`
- **Dev:** `npm run dev` (Vite, portul 5173) — sau preview managed: config `ourdays` în `Apps\.claude\launch.json`
- **Build:** `npm run build` (= `tsc -b && vite build`)
- **Teste:** `npm test` (Vitest, fără DOM — logica jocului Warlord)
- **Deploy:** `npx firebase deploy --only hosting` / `--only functions` / `--only firestore:rules`
  / `--only firestore:indexes` / `--only storage`. **`firestore:indexes` poartă și politica TTL** pe
  `errorLogs.expireAt` (din 25.09): dacă `firestore.indexes.json` s-a schimbat, pasul ăsta nu e opțional,
  altfel rândurile au dată de expirare și nu expiră niciodată. La el se răspunde **Nu** la ștergerea
  indecșilor care există doar pe live.
  **AI-ul e Claude Opus 5.5** (`claude-opus-5-5`, din 26.09; înainte Gemini), prin
  `functions/src/claude.ts`, și **nu are nicio cheie**: se autentifică prin Workload Identity
  Federation. Funcția ia de la serverul de metadate Google un token al contului de serviciu cu care
  rulează, iar Anthropic îl schimbă pe un token scurt. Regula din consola Claude acceptă un singur cont
  Google, iar doar cele cinci funcții AI rulează ca el (`AI_SERVICE_ACCOUNT`).
  - **Nu cere niciodată o cheie Anthropic sau Gemini.** Nu pune `ANTHROPIC_API_KEY` nicăieri: SDK-ul o
    preferă federării (clientul o anulează explicit, iar garda o refuză în `.env`).
  - Fără ID-urile federării, orice funcție AI răspunde „AI is not configured on the server”, gratuit.
    Asta NU blochează deploy-ul, doar îl avertizează.
  **Cât timp există `functions/.env`**, fiecare deploy de funcții pune pe TOATE funcțiile exact
  conținutul lui. Nimic din mediul de pe live nu se păstrează. Fără fișier, mediul de pe live s-ar
  păstra. Un secret declarat NU schimbă asta (măsurat în sursa CLI-ului pe 25.09). Fișierul conține
  numai ID-uri, nimic secret. Copia stă în `~/.ourdays/functions.env.bootstrap`.
  - `BOOTSTRAP_ADMIN_EMAILS`, completat. Fără adresă, contul lui Andrei nu mai e recunoscut ca owner;
    s-a întâmplat pe 25.09.
  - O linie `AI_SERVICE_ACCOUNT=`, chiar goală. E param declarat, iar un deploy `--non-interactive`
    se oprește dacă lipsește (`firebase-tools` `params.js`). Goală = contul implicit, deci AI oprit.
  - Federarea completă sau deloc: `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`,
    `ANTHROPIC_SERVICE_ACCOUNT_ID` și `AI_SERVICE_ACCOUNT` (`nume@`). `ANTHROPIC_WORKSPACE_ID` e opțional.
  - Nicio cheie AI în fișier, și nici `ANTHROPIC_BASE_URL` / `ANTHROPIC_CUSTOM_HEADERS`.
  - Fără `.env.live` / `.env.default`: predeploy-ul nu știe ce alias folosește comanda.
  - Predeploy-ul `scripts/functions-env-guard.mjs` refuză un deploy care încalcă oricare dintre ele;
    nu-l ocoli.
  **Contul AI (`ourdays-ai@…`) are nevoie de trei roluri**, pe care CLI-ul NU le dă (le dă doar contului
  implicit): `roles/datastore.user`, `roles/eventarc.eventReceiver` și `roles/run.invoker`. Fără ele,
  checklist-ul automat (un trigger Firestore) nu primește evenimentele și nu lasă nicio urmă.
  **Deploy-ul de funcții rulează cu `--non-interactive`:** interactiv, un param lipsă e cerut la prompt.
- **Hosting-ul are o dependență de funcții, de la 26.09:** repetarea zilnică cu filtru (`onlyOn`, în
  `recurrenceCore.ts`). Un hosting publicat înaintea funcțiilor lasă serverul vechi să trimită
  memento-uri în zilele pe care seria le sare, fără ca utilizatorul să aibă ce șterge. Ordinea rămâne
  **functions → hosting**. Hosting singur doar cu acordul explicit al lui Andrei, spus în aceste
  cuvinte.
- **CI:** `.github/workflows/ci.yml` — typecheck + teste + build la fiecare push pe `main`. **Nu** face deploy: livrarea rămâne manuală și deliberată.

## ⚠️ Warlord e un SUBMODUL, nu cod din repo-ul ăsta
Jocul Warlord e produs propriu, cu repo propriu (`github.com/AndreiBesliu/Warlord`), pentru că
poate fi distribuit și prin alte canale. `src/warlord` e un **submodul git** — un pointer către
un commit din acel repo, nu o copie. Înainte de 2026-08-02 era o copie ținută identică manual;
regula aceea a dispărut.

- **Clonare:** `git clone --recurse-submodules`, sau `git submodule update --init` după.
- **Import:** prin aliasul `@warlord/*` → `src/warlord/src/*` (definit în `vite.config.ts` și
  `tsconfig.app.json`). Nu importa prin căi relative în submodul — aliasul e acolo ca să putem
  schimba mecanismul (pachet npm, altă cale) fără să atingem fiecare fișier.
- **`dedupe: ['react','react-dom']`** în `vite.config.ts` e OBLIGATORIU: submodulul își are
  propriul `node_modules` când e dezvoltat standalone, iar altfel aplicația ajunge cu două
  copii de React — simptomul e „Invalid hook call”, nu o eroare de modul.
- **Actualizarea jocului în aplicație:** `git -C src/warlord pull` (sau
  `git submodule update --remote`), apoi commit care urcă pointerul. **Fără commit-ul ăsta,
  live-ul rămâne pe versiunea veche a jocului.**
- **Teste:** `npm test` de aici rulează testele jocului DIN submodul
  (`src/warlord/src/**/*.test.ts`) — deci CI-ul aplicației verifică exact codul de joc pe care
  îl livrează. Sunt excluse din `tsconfig.app.json`, la fel ca `main.tsx`-ul și tooling-ul
  submodulului (jocul e și o aplicație de sine stătătoare).
- **Rută în aplicație:** `/warlord` (`src/screens/Warlord.tsx` — comută Domain / PvP / Admin,
  încarcă domeniul din cloud și configurarea de balans înainte de montare).
- Ce e OurDaysApp-only, nu joc: `src/screens/Warlord.tsx`, `src/warlordCloud.ts`,
  `src/warlordPvp/`, `src/warlordAdmin/`.

### ⚠️ Copia motorului de luptă din `functions/`
PvP-ul e server-authoritative, deci Cloud Functions rulează ACELAȘI motor pur:
`functions/src/warlordCombat/` conține byte-identic
`logic/combat/{types,rng,stats,engine,pvp}.ts` din joc. **`logic/types.ts` NU e byte-identic și
nu trebuie să fie** — a divergat de mult, inert: serverul importă din el exact 7 simboluri
(`SoldierType`, `SoldierTypes`, `Rank`, `Ranks`, `RankNumber`, `UnitBucket`, `Weapon`) și doar
alea trebuie să rămână identice. `Unit` e declarat acolo dar nu-l importă nimic. E singura duplicare rămasă și e
intenționată (alt runtime, alt tsconfig). Orice modificare la aceste fișiere se aplică în
AMBELE locuri, apoi `firebase deploy --only functions`. **Din 24.08 regula e APLICATĂ:**
`src/warlordServerCopy.test.ts` (15 teste) refuză divergența și fixează contractul de 7 simboluri.
**NU verifica de mână cu `diff -q`** — submodulul e checkout Windows (CRLF), copia din functions e
LF, deci un diff brut spune „diferă" pe toate cinci fără ca nimic să fi divergat. Testul
normalizează sfârșiturile de linie tocmai ca să nu ajungi să-l ignori. `army.ts` / `ai.ts` /
`enemies.ts` **nu** fac parte din copia server.

## Reguli de lucru (hard)
- **Sync workflow:** după FIECARE task: `npx tsc -b` verde → **`node scripts/lint-gate.mjs` verde** →
  `npm test` verde → `npm run build` verde → intrare în DEVLOG.md → commit → push
  - **Poarta de lint NU e opțională și NU e `npm run lint`** (ăla e roșu permanent, 520 de constatări
    vechi). `scripts/lint-gate.mjs` rulează lista de reguli ținute la ZERO, între care
    `react-hooks/rules-of-hooks`. Pe 18.09 am pus trei hook-uri sub `if (!isOpen) return null` în
    `AddEventModal`: typecheck verde, 1407 teste verzi, build verde, bancul verde — și fereastra de
    adăugat evenimente ar fi murit la prima deschidere, cu calendarul pe ErrorBoundary. Poarta o
    prindea în două secunde. **A doua oară când aplicația asta livrează React #310.**
- **DEVLOG.md** (append-only): Task Started + Task Completed cu prompt-ul exact și modelul
- **i18n:** TOT textul vizibil din aplicație trece prin `t()` (6 limbi). **Excepție decisă de Andrei:** interfața Warlord rămâne doar în engleză.
- **Save/load Warlord:** orice stare nouă adăugată în joc trebuie pusă în 4 locuri din `src/warlord/state/useGameState.tsx` — obiectul de save, dependency array-ul efectului de persistență, `loadSave` și `resetAll`.
- **`OWNER_VERIFY.md` e lista lucrurilor pe care NU le pot verifica eu** (admin, ecrane în spatele
  autentificării) plus deciziile care-i aparțin lui Andrei. Când livrezi ceva ce nu poți vedea
  singur, adaugă-l acolo cu „ce te uiți" și „cum arată bine" — nu în DEVLOG, care e append-only și
  se citește ca istorie, nu ca listă de bifat.
  - **O listă la care doar adaugi încetează să fie o listă.** Pe 19.09 avea **262 de căsuțe
    nebifate și 8 bifate**, dintre care zeci erau *fapte* scrise ca sarcini — o secțiune numită
    chiar „Ce trebuie să știi, NU să verifici" avea 52 de bife. Andrei n-a putut bifa nimic din
    șapte livrări în două zile, fiindcă ce contează era îngropat.
  - **Un fapt se scrie ca text, nu ca bifă.** O bifă e ceva ce omul FACE și termină.
  - **Fiecare punct spune ce se strică dacă răspunsul e greșit** — altfel nu se poate prioritiza.
  - **Re-măsoară înainte să repeți o constatare veche.** Punctul despre push îi cerea de cinci
    zile să pună o cheie VAPID care era deja pusă: măsurat pe 19.09, două conturi din opt aveau
    deja token. O listă învechită nu doar că nu ajută — îi consumă timpul pe lucruri făcute.
- **Adminul e punct orb la randare:** `/admin` și panoul Warlord cer autentificare, deci nu pot fi încărcate de mine în browser. Typecheck + teste + build pot fi toate verzi cu adminul căzut pe ErrorBoundary. Ancorează hook-urile lângă celelalte hook-uri, nu lângă un `return`.

## ⚠️ REGULĂ (Andrei, 2026-08-15): publicarea test → live, din adminul proiectului

Fiecare proiect capătă **două instanțe Firebase — `test` și `live`** — și, în adminul lui,
un panou din care **vezi ce e pe test și nu e încă pe live, și îl publici pe live**: și cod,
și configurare. **Doar owner-ul, cu confirmare.** De implementat în sesiunea dedicată.

**Starea de azi:** `.firebaserc` are aliasul `live` lângă `default`; deploy-urile trec prin
`--project live`. Instanța de **test nu există încă** — se creează, se adaugă `"test": "<id>"`
în `.firebaserc`, și de-acolo deploy-urile cu `--project test` trec fără confirmare
(guard-ul din `Apps/.claude/hooks/deploy-guard.py` le recunoaște deja). **Directorul `.claude/` NU e sub git** — copia canonică a guard-ului stă în `OurDaysApp/tools/claude/`. **Dacă guard-ul lipsește de pe mașina pe care lucrezi, cere confirmarea MANUAL înainte de fiecare deploy** — o plasă care dispare nu poate anunța că a dispărut, deci absența ei e tratată aici, nu acolo.

### Cele două lucruri care se publică sunt DIFERITE
1. **Cod** — un build + deploy real. Un browser nu poate face asta: cere un declanșator
   privilegiat pe server (Cloud Function → `workflow_dispatch` în GitHub Actions, cu tokenul
   în Secret Manager). **Tokenul nu ajunge niciodată în browser.**
2. **Configurare/conținut editat din admin** — documente Firestore care se promovează
   separat de cod (balansul la Warlord, `settings/*` la Presto, conținutul paginilor la
   DataRead). Astea nu se mișcă la un deploy de cod.

### Capcanele care contează, ca să nu se descopere de patru ori
- **Configurarea NU se copiază în bloc.** O parte din ea e specifică mediului — chei, id-uri
  de proiect, URL-uri de webhook, praguri de test. Copiate de pe test peste live, strică
  live-ul. Fiecare proiect are nevoie de o **listă albă explicită de documente promovabile**
  și de câmpuri excluse. Asta e capcana cea mai scumpă din toată felia.
- **Ordinea: întâi codul, apoi configurarea.** Configurare nouă peste cod vechi înseamnă
  live care citește câmpuri pe care codul lui nu le știe.
- **Calea de întoarcere trebuie să existe înainte de primul buton.** Hosting are rollback
  de release; configurarea nu — deci versiunea anterioară a documentelor promovate se
  păstrează, altfel „publică" e ireversibil.
- **Verificarea de owner se face pe SERVER.** Un buton ascuns în UI nu e o protecție;
  callable-ul trebuie să refuze pe cont care nu e owner-ul.
- **Jurnal:** cine a apăsat, când, ce `gitSha` a plecat. Fără el, „ce e pe live" redevine
  o presupunere.

### PRECONDIȚIA, ieftină acum și scumpă mai târziu
O aplicație de pe test nu are cum să știe ce e pe live decât dacă i se spune. **Fiecare deploy
trebuie să-și lase o amprentă** — `meta/deployment` în propriul Firestore, cu `gitSha`,
`builtAt`, `deployedBy`. Fără ea panoul n-are ce compara și ar trebui să ghicească; cu ea,
`git log <shaLive>..<shaTest>` dă exact lista de schimbări.

### DECIS cu Andrei, 2026-08-15 — nu redeschide fără el

**Decizia 1 — amprenta.** `meta/deployment`, UN document, în Firestore-ul instanței, scris de
deploy (niciodată de aplicație). Reguli: citire admin, scriere doar Admin SDK.
```
{ schema: 1, gitSha: "<40 caractere, NU scurt>", gitRef: "main",
  builtAt, deployedAt (server), deployedBy: "ci" | "cli:<user>",
  target: "test" | "live", projectId: "<id-ul REAL>", app: "<proiect>" }
```
`gitSha` complet fiindcă `git log a..b` cere referințe rezolvabile și cele scurte se ciocnesc.
`schema` fiindcă formatul se va schimba. **`projectId` scris de deploy** fiindcă un alias e
doar un nume — dacă „test" ajunge să numească proiectul live, amprenta o spune.
Presto, DataRead și CNCVS calculează deja `__BUILD_HASH__`/`__BUILD_TIME__` prin Vite `define`
(azi doar pe rândurile de eroare) — **aia e sursa, nu una nouă**.

**Decizia 2 — declanșatorul: DIRECT.** Callable pe live → `workflow_dispatch`, tokenul în
Secret Manager. Andrei a ales asta **după** ce i-am prezentat lanțul de risc: dispatch →
deploy de funcție → cod arbitrar cu drepturile SA-ului de runtime. **E o decizie deliberată,
nu o scăpare — nu o „repara" într-o sesiune viitoare.** Prețul ei sunt cele cinci obligatorii:
1. **Precondiție:** doar CNCVectorStudio are `workflow_dispatch` azi. Celelalte patru n-au
   niciun workflow de deploy — trebuie creat, ca prima felie.
2. **Fixează sha-ul.** `deploy.yml` face azi `checkout` fără `ref`, deci publică `main` HEAD,
   nu ce ai testat. Cererea numește un sha; workflow-ul îl verifică și refuză dacă nu e
   strămoș al lui `main`. Asta e corectitudine, nu securitate.
3. **Fixează SA-ul de runtime** (`serviceAccount:` în opțiunile funcției), ca „deploy de
   funcții" să înceteze să însemne „devii admin pe Firestore".
4. **Token minim:** GitHub App pe repo-urile țintă (token de instalare sub 1h) sau PAT
   fine-grained cu `Actions: write` + `Contents: read`. **Niciodată `Contents: write`, niciodată
   PAT clasic** — ăla e per-utilizator și acoperă toate repo-urile. GitHub **nu** are
   granularitate per-workflow, deci îngustimea se pune în YAML, nu în token.
5. **A doua confirmare pe alt canal:** GitHub Environment cu reviewer obligatoriu. Un al doilea
   clic în același browser nu apără de nimic (același XSS, aceeași sesiune).

Plus, în callable: **citește owner-ul din Firestore, nu din claim** (claim-urile sunt vechi
până la reîmprospătare, deci retragerea drepturilor nu retrage butonul) și cere autentificare
recentă. Și: **intrările noi de workflow trec prin `env:`**, niciodată `${{ }}` direct în `run:`
— azi `deploy.yml` scapă doar pentru că `target` e `type: choice`.

**Decizia 3 — jurnalul.** `meta/publishLog/{id}`, append-only (create de owner, update doar
Admin SDK, delete niciodată).
```
{ schema: 1, at (server), by: {uid, email}, kind: "code" | "config",
  fromSha, toSha, docs: [{path, fields}], backupPath, status, detail }
```
`docs` cu **exact ce a plecat** — „config" ca etichetă e neauditabil. Presto are deja
`adminAudit` cu valorile dinainte și un `restoreFromAudit` funcțional: ăla e modelul.

### Domeniul de aplicare
**OurDaysApp NU primește butonul** (decis 2026-08-15). Nu are un nivel de owner deloc:
`adminSetAdmin` e păzit de `assertAdmin`, deci orice admin poate face alt admin; iar
`warlordConfig` se scrie direct din browser, fără callable pe care să atârni listă albă sau
jurnal. Se reia după o felie separată de autorizare.
*Capcană de denumire acolo:* `isOwner(uid)` din `firestore.rules` înseamnă „deține ACEST
document", nu „e owner-ul aplicației" — e adevărat pentru orice user despre datele lui.

### Promovarea configurării — direcția și interdicțiile
- **Live trage din test**, niciodată invers. Regulile Firestore nu constrâng Admin SDK-ul, deci
  cine scrie are scriere-pe-orice. Invers ar însemna un drept permanent de scriere pe live,
  ținut în mediul mai puțin de încredere.
- **Plan → aplică, bifă per document.** Niciodată „promovează tot". Lista albă e **codificată
  în codul de pe LIVE**, nu citită de pe test — altfel test-ul își decide singur permisiunile.
- **Interdicții explicite, nu simple absențe din listă:** `admins/*` la Presto declanșează
  custom claims pe Auth; `settings/company.email` alimentează destinatarii alertelor
  (promovat, taie tăcut detecția). Plus orice ține chei, id-uri de proiect sau URL-uri.
- **Pre-imaginea se scrie înainte de fiecare scriere** (`configBackups/{promotionId}/…`) —
  configurarea n-are rollback nativ, spre deosebire de Hosting.
- Material refolosibil găsit: listele `hasOnly` din regulile CNCVS (liste albe literale, gata
  făcute), `planContentApply` din DataRead (singura primitivă plan/diff existentă),
  `adminAudit` + `restoreFromAudit` din Presto (singurul rollback funcțional).

## Capcane cunoscute
- **Cod vechi într-un tab deschis — jumătate reparat 26.08.** Erau DOUĂ cauze, nu una.
  (1) *Antetele*: `firebase.json` cerea `no-cache` pe `**/*.html`, dar Hosting potrivește pe CALEA
  CERERII, iar nicio rută reală nu se termină în `.html` — deci `/`, `/log`, `/wallet` veneau cu
  `max-age=3600` și reîncărcarea îți dădea codul vechi o oră. **Reparat**; vezi
  `reference_firebase_hosting_headers` pentru cele două capcane (potrivirea pe cale + câștigă
  ULTIMA regulă). (2) *Tabul deschis*: niciun antet nu-l ajută, fiindcă nimic nu re-descarcă nimic.
  Acum `src/utils/appVersion.ts` compară hash-ul bundle-ului care rulează cu cel servit și
  `NewVersionNotice` oferă reîncărcarea — **niciodată automat**, un reload în timpul unui mesaj îl
  aruncă. Poarta `app_version` din `index.html` a fost retrasă: compara un literal pe care nu-l
  urca nimeni.
- **`functions/` e TypeScript** (`src/` → `lib/`), singurul proiect dintre cele patru care e așa.
  `tsc --noEmit` **NU** e build. Există acum un hook `predeploy` în `firebase.json`; dacă atingi
  un callable, verifică oricum în log-ul de deploy că apare `creating`/`updating` funcția ta și
  în `npx firebase functions:list --project live`. Ordinea când clientul depinde de un callable
  nou: **functions → rules → hosting**.
- **O interogare LIST se validează față de reguli FĂRĂ să citească documente** — deci filtrele
  trebuie să GARANTEZE regula. `where('overrideOfParent','==',id)` singur e refuzat în bloc, și
  arată ca o listă goală. S-a livrat de trei ori pe `events`; `src/utils/eventQueryRules.test.ts`
  citește câmpurile permise DIN `firestore.rules` și refuză orice interogare care nu le atinge.
- **`groups/${null}` e o cale Firestore VALIDĂ** — o citire de membru neghidată se rezolvă la un document inexistent și refuză tot. Orice `groupId` se verifică `typeof x === 'string' && x`.
- **Ceasul zilei din Warlord** e ancorat de `lastTickAt` DIN SAVE, nu de o cheie locală; vezi `src/warlord/logic/tick.ts`.
- **Matematica economiei** are o singură sursă: `simulateEconomyDay` din `src/warlord/logic/economy.ts`. UI-ul NU reimplementează formule — s-a livrat de trei ori bug-ul ăsta (numere afișate pe care jocul nu le plătea).
