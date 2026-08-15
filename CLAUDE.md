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
AMBELE locuri (`diff -q`), apoi `firebase deploy --only functions`. `army.ts` / `ai.ts` /
`enemies.ts` **nu** fac parte din copia server.

## Reguli de lucru (hard)
- **Sync workflow:** după FIECARE task: `npx tsc -b` verde → `npm test` verde → `npm run build` verde → intrare în DEVLOG.md → commit → push
- **DEVLOG.md** (append-only): Task Started + Task Completed cu prompt-ul exact și modelul
- **i18n:** TOT textul vizibil din aplicație trece prin `t()` (6 limbi). **Excepție decisă de Andrei:** interfața Warlord rămâne doar în engleză.
- **Save/load Warlord:** orice stare nouă adăugată în joc trebuie pusă în 4 locuri din `src/warlord/state/useGameState.tsx` — obiectul de save, dependency array-ul efectului de persistență, `loadSave` și `resetAll`.
- **Adminul e punct orb la randare:** `/admin` și panoul Warlord cer autentificare, deci nu pot fi încărcate de mine în browser. Typecheck + teste + build pot fi toate verzi cu adminul căzut pe ErrorBoundary. Ancorează hook-urile lângă celelalte hook-uri, nu lângă un `return`.

## ⚠️ REGULĂ (Andrei, 2026-08-15): fereastra „ce e pe testing și încă nu e pe live"

Fiecare proiect capătă **două instanțe Firebase — `test` și `live`** — și, în adminul lui, o
**fereastră care arată tot ce e pe testing și nu a ajuns încă în live**. De implementat în
sesiunea dedicată proiectului ăstuia.

**Starea de azi:** `.firebaserc` are aliasul `live` lângă `default`; deploy-urile trec prin
`--project live`. Instanța de **test nu există încă** — se creează, se adaugă `"test": "<id>"`
în `.firebaserc`, și de-acolo deploy-urile cu `--project test` trec fără confirmare
(guard-ul din `Apps/.claude/hooks/deploy-guard.py` le recunoaște deja).

**Ce trebuie să arate fereastra — două lucruri diferite, nu unul:**
1. **Cod livrat** — ce commit-uri sunt pe test și nu pe live.
2. **Configurare/conținut editat din admin** — documentele pe care le schimbi din panou și
   care se *promovează* separat de cod (la Warlord `warlordConfig/live`, la Presto
   `settings/*`, la DataRead conținutul per-pagină). Astea nu se mișcă la un deploy.

**PRECONDIȚIA care se plătește ieftin acum și scump mai târziu:** o aplicație de pe test
nu are cum să știe ce e pe live decât dacă i se spune. Deci **fiecare deploy trebuie să-și
lase o amprentă** — un document de tip `meta/deployment` scris în propriul Firestore, cu
`gitSha`, `builtAt`, `deployedBy`. Fără amprenta asta fereastra n-are ce compara și ar
trebui să ghicească. Cu ea, `git log <shaLive>..<shaTest>` dă exact lista de schimbări.

**Decizia de arhitectură (o dată, nu de patru ori):** cum citește adminul de pe test starea
de pe live. Două variante — un serviciu de pe test cu drept de citire în proiectul live,
sau un callable pe live care-și întoarce propria amprentă. **A doua e de preferat:** nu cere
credențiale încrucișate și expune exact un câmp, nu toată baza.

**Nu porni implementarea fără să confirmi cu Andrei forma amprentei** — patru sesiuni care
inventează fiecare alt format înseamnă patru ferestre care nu se pot compara între ele.

## Capcane cunoscute
- **Prerender/service worker:** `index.html` înregistrează `sw.js` dar nu cheamă niciodată `registration.update()`, iar gate-ul de versiune rulează doar la parsarea unui index.html PROASPĂT. Un tab deschis de ore rulează cod dinaintea deploy-ului. Workaround: hard-reload. (Item în roadmap.)
- **`groups/${null}` e o cale Firestore VALIDĂ** — o citire de membru neghidată se rezolvă la un document inexistent și refuză tot. Orice `groupId` se verifică `typeof x === 'string' && x`.
- **Ceasul zilei din Warlord** e ancorat de `lastTickAt` DIN SAVE, nu de o cheie locală; vezi `src/warlord/logic/tick.ts`.
- **Matematica economiei** are o singură sursă: `simulateEconomyDay` din `src/warlord/logic/economy.ts`. UI-ul NU reimplementează formule — s-a livrat de trei ori bug-ul ăsta (numere afișate pe care jocul nu le plătea).
