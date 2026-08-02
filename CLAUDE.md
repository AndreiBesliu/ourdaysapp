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

## ⚠️ Warlord trăiește AICI (din 2026-08-02)
Jocul Warlord era într-un repo separat (`AndreiBesliu/Warlord`) și era **copiat** aici,
două copii byte-identice ținute sincronizate manual. **Regula aceea a dispărut.** Repo-ul
vechi e arhivat; singura copie a codului de joc e `src/warlord/**`, aici.

- **Rută în aplicație:** `/warlord` (`src/screens/Warlord.tsx` — comută Domain / PvP / Admin, încarcă domeniul din cloud și configurarea de balans înainte de montare)
- **Harness standalone de dezvoltare:** `npm run dev:warlord` → `warlord.html` montează ACELAȘI `src/warlord/WarlordApp.tsx`, fără auth, fără Firebase, cu salvarea în `warlord_dev`. **Nu intră în build-ul de producție** (nu e în `rollupOptions.input`). Îl folosești ca să verifici jocul în browser fără să te autentifici.
- **Teste:** `src/warlord/**/*.test.ts` (96 la 2026-08-02). Sunt excluse din `tsconfig.app.json` — le typechecks Vitest, nu build-ul aplicației.
- **Istoricul jocului** dinainte de unificare: `docs/WARLORD_DEVLOG.md`.

### ⚠️ A DOUA copie care ÎNCĂ există: motorul de luptă din `functions/`
PvP-ul e server-authoritative, deci Cloud Functions rulează ACELAȘI motor pur:
`functions/src/warlordCombat/` conține byte-identic `logic/types.ts` +
`logic/combat/{types,rng,stats,engine,pvp}.ts`. Orice modificare la aceste fișiere se
aplică în AMBELE locuri (verifică: `diff -q`), apoi `firebase deploy --only functions`.
`army.ts` / `ai.ts` / `enemies.ts` **nu** fac parte din copia server.

## Reguli de lucru (hard)
- **Sync workflow:** după FIECARE task: `npx tsc -b` verde → `npm test` verde → `npm run build` verde → intrare în DEVLOG.md → commit → push
- **DEVLOG.md** (append-only): Task Started + Task Completed cu prompt-ul exact și modelul
- **i18n:** TOT textul vizibil din aplicație trece prin `t()` (6 limbi). **Excepție decisă de Andrei:** interfața Warlord rămâne doar în engleză.
- **Save/load Warlord:** orice stare nouă adăugată în joc trebuie pusă în 4 locuri din `src/warlord/state/useGameState.tsx` — obiectul de save, dependency array-ul efectului de persistență, `loadSave` și `resetAll`.
- **Adminul e punct orb la randare:** `/admin` și panoul Warlord cer autentificare, deci nu pot fi încărcate de mine în browser. Typecheck + teste + build pot fi toate verzi cu adminul căzut pe ErrorBoundary. Ancorează hook-urile lângă celelalte hook-uri, nu lângă un `return`.

## Capcane cunoscute
- **Prerender/service worker:** `index.html` înregistrează `sw.js` dar nu cheamă niciodată `registration.update()`, iar gate-ul de versiune rulează doar la parsarea unui index.html PROASPĂT. Un tab deschis de ore rulează cod dinaintea deploy-ului. Workaround: hard-reload. (Item în roadmap.)
- **`groups/${null}` e o cale Firestore VALIDĂ** — o citire de membru neghidată se rezolvă la un document inexistent și refuză tot. Orice `groupId` se verifică `typeof x === 'string' && x`.
- **Ceasul zilei din Warlord** e ancorat de `lastTickAt` DIN SAVE, nu de o cheie locală; vezi `src/warlord/logic/tick.ts`.
- **Matematica economiei** are o singură sursă: `simulateEconomyDay` din `src/warlord/logic/economy.ts`. UI-ul NU reimplementează formule — s-a livrat de trei ori bug-ul ăsta (numere afișate pe care jocul nu le plătea).
