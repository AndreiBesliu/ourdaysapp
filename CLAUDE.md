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

## ⚠️ REGULĂ (Andrei, 2026-08-15): publicarea test → live, din adminul proiectului

Fiecare proiect capătă **două instanțe Firebase — `test` și `live`** — și, în adminul lui,
un panou din care **vezi ce e pe test și nu e încă pe live, și îl publici pe live**: și cod,
și configurare. **Doar owner-ul, cu confirmare.** De implementat în sesiunea dedicată.

**Starea de azi:** `.firebaserc` are aliasul `live` lângă `default`; deploy-urile trec prin
`--project live`. Instanța de **test nu există încă** — se creează, se adaugă `"test": "<id>"`
în `.firebaserc`, și de-acolo deploy-urile cu `--project test` trec fără confirmare
(guard-ul din `Apps/.claude/hooks/deploy-guard.py` le recunoaște deja).

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

### De decis O DATĂ cu Andrei, nu de patru ori
Forma amprentei · mecanismul declanșatorului · forma documentului de jurnal. Patru sesiuni
care inventează fiecare alt format înseamnă patru panouri care nu se pot compara între ele.
**Nu porni implementarea fără confirmarea astea trei.**

## Capcane cunoscute
- **Prerender/service worker:** `index.html` înregistrează `sw.js` dar nu cheamă niciodată `registration.update()`, iar gate-ul de versiune rulează doar la parsarea unui index.html PROASPĂT. Un tab deschis de ore rulează cod dinaintea deploy-ului. Workaround: hard-reload. (Item în roadmap.)
- **`groups/${null}` e o cale Firestore VALIDĂ** — o citire de membru neghidată se rezolvă la un document inexistent și refuză tot. Orice `groupId` se verifică `typeof x === 'string' && x`.
- **Ceasul zilei din Warlord** e ancorat de `lastTickAt` DIN SAVE, nu de o cheie locală; vezi `src/warlord/logic/tick.ts`.
- **Matematica economiei** are o singură sursă: `simulateEconomyDay` din `src/warlord/logic/economy.ts`. UI-ul NU reimplementează formule — s-a livrat de trei ori bug-ul ăsta (numere afișate pe care jocul nu le plătea).
