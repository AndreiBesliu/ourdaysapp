# DEVLOG — Warlord

## Reguli DEVLOG
- **Append-only** — nu se șterg intrări istorice
- Fiecare task are **Task Started** și **Task Completed** cu timestamp, prompt exact, model
- Roadmap-ul e updatat la fiecare sesiune
- Format timestamp: `YYYY-MM-DD HH:MM`

---

## 🚀 Active Roadmap & Backlog

### 🔬 Research legat de lume — plan pe 4 felii (decis cu Andrei, 2026-08-01)
**Felia 1 ✅ LIVRATĂ** (vezi Session Log): clădirea **Scriptorium** ca poartă a cercetării + cerințe de infrastructură per tehnologie (`TechDef.requiresBuildings`, tip + nivel).

**Modelul agreat pentru feliile următoare** — progresul nu mai e o numărătoare de zile, ci **Studiu, resursă produsă zilnic**:
- **Felia 2 — Studiu ca producție.** Rezervoare pe ramuri (Economy/Army/Campaign/Doctrine), alimentate de Scriptorium (nivel) + clădirile relevante fiecărei ramuri. **Fiecare clădire primește un al treilea slider: Research%**, care ia din producția curentă (monede vs. iteme) — logica lui Andrei: o clădire contribuie la cercetare fie prin resursele ei, fie prin timpul dedicat studiului în locul producției. Plus: **fonduri** (bani, randament descrescător, plafon zilnic) și **materiale dedicate** (pachet de resurse ⇒ multiplicator temporar pe proiectul activ).
- **Felia 3 — Oameni.** Două roluri DISTINCTE: (a) **Head of Research / erou** — unul singur, permanent, care ridică șansa zilnică de *big leap* (salt mare de progres), influențată și de domeniul cercetat; (b) **experți angajați per proiect** — salariu zilnic în bucla de upkeep + **randament dramatic descrescător dacă îngrămădești mai mulți pe același domeniu** (cerință explicită Andrei), tot cu trăsături (Pedant / Alchimist / Veteran de campanie).
- **Felia 4 — Consecințe.** Probe de teren (tehnologiile militare cer o bătălie purtată), eșecuri și eureka legate de buff-ul `BREAKTHROUGH` existent, și **deblocările din Doctrine să blocheze ceva real** (`GRAND_ARMORY`, `ELITE_DRILL` sunt azi promisiuni goale).
- **Felia 5 (viziune Andrei, de detaliat) — Doctrine & Tradiții.** Jucătorul *impune* o doctrină; dacă o ține destul de mult, ea *naște o tradiție* permanentă (ex. Apprenticeship). Direcția: un sistem prin care jucătorul își personalizează regatul, nu doar un arbore de bonusuri. De proiectat separat, după felia 3.

**Ce înseamnă trecerea de la zile la Studiu pentru restul producției** (întrebarea lui Andrei): tick-ul zilnic rămâne neatins — ziua e în continuare unitatea de timp pentru venituri, upkeep, hrană, loturi de antrenament și campanie. Se schimbă DOAR contorul unui proiect de cercetare: din „mai ai 3 zile" în „mai ai 120 de Studiu". Singura cuplare economică reală e sliderul Research% pe clădiri — acolo cercetarea chiar CONCUREAZĂ cu monedele și itemele, ceea ce e și scopul.

### 🎨 Revamp UI/UX + temă dark (CERUT de Andrei, 2026-08-01 — următorul lucru mare)
> Motivul, în cuvintele lui: *„ma dor ochii incercand sa testez, dar sa mai si joc"*. Deci nu e cosmetică — e condiție ca jocul să poată fi testat și jucat sesiuni lungi.

**Cauza directă a durerii de ochi:** jocul NU are temă dark, iar embed-ul o dezactivează explicit. `OurDaysApp/src/screens/Warlord.tsx` învelește jocul în `bg-white text-zinc-900 [color-scheme:light]` tocmai pentru că tot Warlord-ul folosește clase Tailwind deschise, fără variante `dark:`. Rezultat: chiar dacă OurDaysApp e pe dark, Warlord rămâne o placă albă pe tot ecranul. Lacătul ăsta se scoate ULTIMUL, după ce jocul chiar suportă dark.

**Observații concrete (din sesiunea de testare + captura de pe ziua 159):**
- **Suprafețe albe uriașe** — pagină albă + carduri albe, nimic pe care să se odihnească ochiul; contrast maxim pe toată suprafața, ore în șir.
- **Costurile sunt șiruri de iconițe fără etichetă** — „🪙1 ⚙50 ▪40 ◪4 3d". Nu poți învăța ce e fiecare pictogramă, nu există tooltip, iar badge-ul de zile arată exact ca încă o resursă.
- **„Cannot afford" nu spune CE lipsește** — buton gri, mort, fără „îți mai trebuie 30 Iron / 2 zile". Aceeași informație există deja în state, doar nu e arătată.
- **Tehnologiile blocate (🔒) diferă de cele disponibile doar prin opacitate** — la fel și ierarhia T1/T2/T3, redusă la un badge mic în colț.
- **Antetul e înghesuit** pe un singur rând: Day / Load / Reset / numărătoare / Pause Auto / Run Day. `Reset` (distructiv) stă lipit de `Load`, în linia principală.
- **Bara de taburi = 9 pastile plate**, fără iconițe și fără grupare; tabul activ e un bloc negru greu. La 9 taburi ar trebui grupare (Domeniu / Militar / Extern) sau iconițe.
- **Codul de culoare pe ramuri nu coboară în arbore** — Economy/Army/Campaign/Doctrine colorează doar cardurile T1; T2/T3 sunt gri, deci culoarea nu mai ajută la orientare exact acolo unde arborele devine complex.
- **Panoul de Momentum ocupă o casetă mare ca să spună „nimic încă"** — spațiu care ar trebui să se contracte când e gol.
- **Ierarhie tipografică plată** — titlu, cost, descriere și buton au greutăți apropiate; ochiul nu are unde să intre în card.
- **Log-ul e un dump brut** cu timestamp complet pe fiecare linie; fără filtre (economie / luptă / cercetare) și fără grupare pe zile.
- **Nemăsurat pe telefon** — layout `max-w-6xl` fix și grile de 4 coloane, deși aplicația-mamă e PWA/Capacitor și se deschide pe telefon.
- **Panoul de admin** are aceeași problemă: liste lungi de câmpuri, tot pe alb, fără secțiuni pliabile.

**Fundația tehnică (înainte de orice ecran):** jocul folosește clase Tailwind stock peste tot, deci soluția NU e să presar `dark:` prin 30 de fișiere, ci un set de **tokenuri semantice** (suprafață / suprafață-ridicată / text / text-slab / accent / avertisment) definite o dată și folosite de toate componentele. Abia apoi tema dark e o a doua valoare per token.

**Constrângeri de care să ții cont:**
- Cele **2 copii identice** (`games/warlord/src` ↔ `OurDaysApp/src/warlord`) — orice pasă de temă se aplică în ambele și se verifică cu `diff -q`.
- Warlord e **English-only** prin decizie explicită, deci revamp-ul UI nu costă traduceri (spre deosebire de restul OurDaysApp).
- Adminul cere autentificare ⇒ e punct orb la randare; verificarea lui rămâne pe seama owner-ului.

**Decizii de luat cu Andrei înainte de implementare:**
1. Tema dark a jocului **urmează tema OurDaysApp** (isDarkMode/customThemeIsDark din store) sau are comutator propriu în antet?
2. Păstrăm direcția vizuală medievală (pergament, texturi, imaginile de clădiri) și o adaptăm la dark, sau trecem pe ceva plat/modern și lăsăm arta doar în modale?
3. Revamp pe felii (întâi tokenuri + dark peste tot, apoi ecran cu ecran) sau redesign complet al unui singur tab ca prototip, aprobat, apoi restul?

### În curs / Următor
- **Combat System (grid tactic)** 🔨 ÎN CURS — tab nou "Campaign", luptă tură-cu-tură pe grid; motor pur + determinist (RNG cu sămânță) reutilizabil server-side pentru PvP viitor; PvE acum + document design PvP (OurDaysApp)
- **PvP în OurDaysApp** — integrare Warlord ca joc în arcade-ul OurDaysApp (Cloud Function autoritativ pe același motor); design în `docs/PVP_INTEGRATION.md`, implementare sesiune viitoare
- **Upgrade clădiri** — `level` pe `Building`, bonusuri producție per nivel
- **Comandanți/Lideri** — unitate specială cu bonusuri (XP, training time)

### Completate în sesiuni anterioare (mutate din roadmap)
- Unit Upkeep zilnic, Sistem Hrană (FOOD/FARM), Morale & Oboseală, Sistem Evenimente aleatorii

### Backlog
- **Rute comerciale pasive** — vânzări automate zilnice din Market
- **Tech Tree** — cercetare cu resurse + timp

---

## ✅ Features Completate

### Sistem de bază (pre-sesiune 1)
- Economy loop: clădiri → producție pasivă → wallet
- Resurse: WOOD, STONE, ORE, COAL, ingots
- Barăci: recrutare, antrenament batches, conversie tip/rang
- Unități: split, merge, replenish, training XP
- Market: cumpărare/vânzare echipament și resurse
- Save/Load localStorage
- Sistem modding (Registry)

---

## 📅 Session Log

### Session 4 — 2026-08-01

**2026-08-02 - Task Completed (topbar cu resurse + prognoză zilnică)**
> Prompt: „o sa vreau ca resursele sa poata fi vazute permanent in topbar, si vreau sa se vada si cat vor creste zilnic in functie de setarile cladirilor".
> Model: Claude Opus 5
> - **`simulateEconomyDay(input)` în `logic/economy.ts`** — o zi de economie ca funcție PURĂ. Corpul e ridicat verbatim din `useEconomy.applyBuildingIncome` (producție + rețete + minter + grajd), plus upkeep-ul soldaților și hrana. `useEconomy` a rămas un ambalaj de 25 de linii care doar comite rezultatul. **Prognoza nu e o a doua implementare — e ACEEAȘI funcție**, singurul mod în care numărul afișat nu poate devia de cel plătit (bug pe care proiectul l-a livrat deja de două ori).
> - **`logic/forecast.ts`** — `forecastDay()` întoarce deltele exacte pe resursă, delta de monede, hrana cerută vs. consumată, zilele până la golire și clădirile blocate; `explainResource()` construiește explicația din același breakdown, deci tooltipul nu poate contrazice cifra.
> - **`components/common/ResourceBar.tsx`** — bară persistentă în antet, vizibilă din orice tab: monede + fiecare resursă cu stocul și `+n/−n` pe zi. Hrana insuficientă colorează pastila în roșu; tooltipul spune cine produce, cine consumă și în câte zile se golește. Se recalculează la fiecare render **intenționat** — memoizarea pe `inv` ar fi greșită, pentru că `queueLightTraining` mută inventarul pe loc, fără să schimbe referința.
> - **Trei minciuni de UI reparate, găsite de cartografiere:** (1) `ProductionModal` avea încă o ramură hardcodată `LUMBER_MILL + WOOD → 0 monede, 10 lemn` chiar sub comentariul care documenta postmortemul aceleiași erori — la focus 100 tick-ul plătește 500c și 0 lemn; (2) `OverviewTab` afirma „10% din cost / 70% valoare", formulă pe care jocul n-o mai folosea (clădirile de resurse au valori proprii, iar craftEfficiency intră în numitor); (3) `ResourcesTab` **omitea complet FOOD**, singura resursă consumată în fiecare zi.
> - Reparat și un `NaN` latent: `nres[outItem] += maxAfford` la topirea într-un save fără cheia de lingou dădea `undefined + n` și otrăvea resursa permanent.
> - **Ce scoate la iveală bara:** `buyBuilding` creează orice clădire cu `focusCoinPct: 100`, iar la focus 100 nu mai rămâne nimic de transformat în bunuri — **o fermă nou-construită produce 800 de monede și ZERO hrană**. Până acum nimic nu-ți spunea asta.
> - 96 teste verzi (17 noi în `logic/forecast.test.ts`: ordinea clădirilor contează, deficitul se distruge, hrana se oprește la 0, punga NU, zilele până la golire, config-ul admin ajunge în prognoză).
> - Verificat live: prognoza afișată (WOOD +15, IRON_ORE −38, COAL −19, IRON_INGOT +19, FOOD ±0, +800c) a coincis **exact** cu ce a produs apăsarea pe „Run Day"; cu 30 de soldați și 7 hrană pastila devine roșie, arată −7 (nu −30) și explică „needs 30 — starving, Empty in 1 day". Zero erori în consolă.

**2026-08-01 - Task Completed (Research felia 1 — Scriptorium + cerințe de infrastructură)**
> Prompt: „research ar trebui sa fie disponibil dupa ce se construieste o cladire anume, si anumite research options ar trebui sa fie influentate de unele cladiri si de nivelul lor de upgrade… vreau un sistem complex si realistic".
> Model: Claude Opus 5
> - **NOU: clădirea `SCRIPTORIUM`** (60.000 cupru + 60 Wood + 40 Stone, niveluri 1-3). Fără ea, tabul Research **nu există** în navigație, iar `startResearch` refuză orice proiect. Click pe Scriptorium în Buildings → deschide direct tabul Research (același comportament ca Barracks). Nu produce încă nimic — producția de Studiu vine în felia 2, deci e în lista de clădiri fără venit din `useEconomy`.
> - **`TechDef.requiresBuildings`** — fiecare din cele 12 tehnologii cere infrastructura care o face plauzibilă (Improved Kilns ⇒ Smelter L2, War Academy ⇒ Barracks L3 + Armory L2, Grand Armory ⇒ Armory L3 + Scriptorium L2 etc.). Nou în `catalog.ts`: `missingBuildings()` (întoarce text gata de afișat: „Smelter L2 (you have L1)"), `buildingReqsMet()`, `hasResearchBuilding()`. Verificarea e ȘI în `startResearch`, nu doar în UI.
> - Cardul blocat spune acum exact ce lipsește, pe două linii separate: tehnologii („Requires:") și clădiri („Needs:").
> - Cerințele trec prin `resolveCatalog`, deci sunt **editabile din admin** (tabul JSON) ca orice altă valoare de balans; un override le poate înlocui sau șterge complet.
> - **Bug găsit pe drum:** `FARM` exista în TOATE tabelele (cost, resurse, output, consum de hrană) dar **nu apărea în nicio listă de construcție** din `BuildingsTab` — nu puteai construi o fermă, deși hrana se consuma zilnic. Adăugată la `resTypes`.
> - 79 teste verzi (11 noi în `logic/research/gating.test.ts`), tsc + build verzi, cele 2 copii identice.
> - Verificat live: fără Scriptorium tabul Research lipsește din cele 8 taburi; după construire apare al 9-lea; cele 12 carduri afișează exact ce infrastructură le lipsește; construind un Blacksmith se deblochează fix un card (Iron Tools); pornirea cercetării scade banii și cele 4 lingouri și intră în coadă. Zero erori în consolă.

**2026-08-01 - Bug Fix (ziua nu avansa după ieșire/intrare în aplicație)**
> Raport: „am lăsat jocul deschis și a ajuns la ziua 159, am ieșit și am intrat înapoi, iar ziua nu a avansat" + „timer-ul s-a resetat".
> Model: Claude Opus 5
> - **Cauza:** `App.tsx:46` — `n > Date.now() ? n : Date.now() + TICK_MS`. Termenul următoarei zile era un timestamp ținut lângă save (`${saveKey}:nextTickAt`) și era ARUNCAT dacă trecuse, la orice montare. Timpul petrecut cu jocul închis credita zero zile, numărătoarea repornea la 5:00, iar vizitele mai scurte de 5 minute nu avansau niciodată ziua.
> - **NOU `src/logic/tick.ts`** (pur, testat): `planTicks(now, lastTickAt, tickMs, maxDays)` → `{ due, grant, forfeited, anchor, remainingMs }`. Ceasul e ancorat de `lastTickAt` — momentul ultimei zile încheiate — care intră ÎN SAVE (deci se sincronizează cu norul în embed, ca `day`). Numărătoarea e derivată din ancoră: fără derivă, fără reset la remontare.
> - `useGameState`: `lastTickAt` în save + dep-array + `loadSave` + `resetAll` (cele 4 locuri); `runDailyTick(anchorTo?)` avansează ancora cu exact o fereastră, sau la un moment dat de apelant (butonul „Run Day").
> - `App.tsx`: recuperarea rulează **o zi per commit** (`pendingDays`), pentru că `runDailyTick` citește snapshot-ul de render — N apeluri sincrone ar fi avansat ziua cu 1. Heartbeat-ul se instalează o singură dată și citește jocul printr-un ref (înainte avea `state`, obiect nou la fiecare render, în dependențe).
> - Plafon implicit 24 de zile (2 ore reale), reglabil din admin (`GameConfig.tick()`: `minutesPerDay`, `maxOfflineDays`). Excedentul se pierde și ancora e rebazată, ca următoarea intrare să nu-l crediteze din nou. O singură linie de log pentru absență, ca `LOG_CAP` să nu șteargă istoricul.
> - 68 teste verzi (15 noi), `npx tsc --noEmit` ✅, `npm run build` ✅, cele 2 copii identice. Verificarea live e în DEVLOG-ul OurDaysApp.

**2026-08-01 - Task Started (admin de balans)**
> Prompt: "adminul" — un admin de unde se configurează tot ce ține de balans. Decizii: aceiași admini ca OurDaysApp (`admins/{uid}`, panou separat, permisiune comună); scope v1 = tehnologii + buff-uri de momentum + economia de bază.
> Plan: singleton `GameConfig` (model `Registry`) peste tabelele existente, pârghii care citesc din el, reparat modificatorii de research care nu ajungeau nicăieri, doc `warlordConfig/live` + reguli, panou în OurDaysApp.
> Model: Claude Opus 5

**2026-08-01 - Task Completed (admin de balans + modificatori reparați)**
> Model: Claude Opus 5
> - **NOU `src/logic/config.ts`** — singleton `GameConfig` cu override-uri peste DEFAULT-uri: prețuri clădiri (copper + resurse), valoarea de bază pe resursă, upkeep (bază + multiplicator de rank), hrană, antrenament (`baseDays`/`minDays`/`maxSlots`), presete de misiune, catalog de tehnologii, buff-uri. Valorile invalide (NaN, negative, tip greșit, id necunoscut) cad pe default — un typo în admin nu poate strica economia. Singleton pentru că `BuildingsTab`/`ProductionModal` citesc tabelele direct din module: o configurare pasată doar prin `useGameState` ar fi afișat un preț și ar fi încasat altul.
> - **REPARAT — doi modificatori de research erau inerți.** `mods.buildCostMult` (Craft Guilds, Grand Armory) și `trainDaysDelta`/`trainSlotsDelta` (War Academy) apăreau în `ResearchTab` fără să ajungă nicăieri. Acum: `buildingCostCopper(type, mult)` e SINGURA sursă de preț (cumpărare, upgrade, PriceTag, tooltip), iar `enqueueBatch(…, daysDelta)` / `canEnqueue(…, extraSlots)` primesc deltele prin `Ctx.mods` din `training.ts`.
> - **REPARAT — `ProductionModal` reimplementa formula de venit** (`0.10*cost`, `0.7*mv`), ignorând nivelul clădirii, valorile de bază pe resursă și bonusurile de research. Acum cheamă `passiveIncomeAndProduction`, exact funcția rulată de tick-ul zilnic. `useEconomy` folosește prețul din config drept bază de venit, FĂRĂ reducerea de research (o tehnologie de construcție ieftină nu trebuie să reducă și veniturile).
> - Date resolvate: `missionPresets()` în `enemies.ts` și `resolveBuffs(overrides)` în `momentum.ts` (plus `onBattleWon/Lost/onResearchCompleted(buffs, table)`), lângă `resolveCatalog` existent. `useGameState` acceptă `opts.config`, inițializează `GameConfig` și exportă presetele resolvate + getterele de preț.
> - Exportate ca DEFAULT-uri pentru panou: `UPKEEP_BASE`, `UPKEEP_RANK_MULT`, `FOOD_BASE`, `RESOURCE_BUILDING_BASE_VALUE`.
> - `App.tsx` primește prop-ul `config` (embed-ul îl încarcă din Firestore înainte de montare). Panoul de admin + regulile trăiesc în OurDaysApp (`src/warlordAdmin/`, `warlordConfig/live`) — vezi DEVLOG-ul de acolo.
> - `npx tsc --noEmit` ✅, `npm run build` ✅, 53 teste verzi (13 noi în `src/logic/config.test.ts`, inclusiv testele care dovedesc că modificatorii nu mai sunt inerți). Cele 2 copii de cod de joc identice (`diff -q`).

### Session 3 — 2026-07-11

**2026-07-11 - Task Started**
> Prompt: "poti sa vezi folderul games, vreau sa lucram la jocuri online in aces folder" → decizii: (1) Warlord devine multiplayer și va trăi în interiorul OurDaysApp (fără deploy separat deocamdată); (2) sesiunea asta = Combat System, model grid tactic tură-cu-tură; (3) livrăm motor determinist + PvE complet în Warlord standalone + document de design PvP pentru OurDaysApp (implementat sesiunea viitoare).
> Plan: Motor de luptă PUR și DETERMINIST (RNG cu sămânță) în `src/logic/combat/` (types, rng, stats, engine, ai, enemies, army) ca să ruleze identic pe client (PvE) și mâine într-un Cloud Function (PvP verificabil). Stat-uri de combat + matrice counters (nu există azi). Slice `useCampaign` + tab `CampaignTab` cu grid. Pierderi aplicate înapoi în armată (închide bucla economică). Teste Vitest pe determinism. Doc `docs/PVP_INTEGRATION.md`.
> Model: Claude Opus 4.8

**2026-07-11 - Task Completed**
> Model: Claude Opus 4.8
> Changes:
> - **Motor pur de combat** `src/logic/combat/` (nou): `types.ts` (BattleState/Combatant/Command JSON-serializabile, grid map-of-rows), `rng.ts` (mulberry32 cu sămânță, poziția = `rngCursor`), `stats.ts` (`DEFAULT_COMBAT_STATS` pt toate 11 tipurile + matrici counters `weaponVsArmor`/`weaponVsMounted`/cav-vs-ranged/brace/shield + tabel terrain + tunables), `engine.ts` (`applyCommand` reducer pur, `legalMoves`/`legalTargets`, `computeKillsCore`/`resolveDamage`/`estimateKills`, `checkVictory`, `buildBattle`), `ai.ts` (`chooseEnemyCommands` determinist, planifică cu daune medii, nu consumă rng-ul luptei), `army.ts` (`unitToCombatant`, `fieldedStrength`, `applyBattleResult` write-back pierderi rank-crescător/XP/morală + șterge distrusele), `enemies.ts` (`MISSION_PRESETS` bandit/baron/invazie + `generateEnemyArmy`/`generateTerrain`/`createBattle`), `index.ts` barrel.
> - `src/logic/units.ts`: extras `computeEquipped` din `computeReady` (refactor behavior-preserving) + comentariu despre `equip` gol.
> - `src/logic/registry.ts`: `UnitDef.combat?` (override moddabil de stat-uri, injectat, nu citit în hot-path).
> - `src/state/useCampaign.ts` (nou): slice campanie (luptă activă, deployedIds, reward, record W/L, lastResult).
> - `src/state/useGameState.tsx`: instanțiere `useCampaign`; funcții `grantLoot`/`startBattle`/`battleCommand`/`runEnemyTurn`/`finishBattle`/`abandonBattle`/`dismissBattleResult`; `campaign` în save+dep-array+load+reset; export tot în return.
> - UI (nou): `components/tabs/CampaignTab.tsx` (state machine MENU/DEPLOY + luptă + rezultat, auto-enemy-turn via useEffect) + `components/campaign/{BattleGrid,BattleLog,MissionList,DeployPanel,ResultScreen}.tsx`. Wiring `App.tsx` (tab „Campaign").
> - Teste: Vitest instalat + `combat.test.ts` (10 teste: determinism seed, serialize/resume, AI pur, counters, conservare pierderi, veterani supraviețuiesc, unitate distrusă scoasă, luptă completă la rezoluție). Script `test`/`test:watch`.
> - `docs/PVP_INTEGRATION.md` (nou): design integrare PvP în OurDaysApp (schemă Firestore, Cloud Function autoritativ pe același motor, partajare cod `shared/`, întărire rules, i18n, limitări).
> - `CLAUDE.md`: path corectat (`Apps\games\warlord`), regula „nu atinge Apps\" re-scopată la proiectele-soră, hartă combat, capcane noi (equip gol, dual-units bug, puritate motor, save campanie).
> Build: `npx tsc --noEmit` ✅ | `npm run build` ✅ (2.27s) | `npm run test` ✅ (10/10)
> Verificare end-to-end (dev server, prin DOM — screenshot-urile panoului dădeau 0x0): Bandit Raid jucat până la victorie — armată generată determinist (forță 75 ≈ 0.6×125, morală 70, plasare corectă), select/move/attack + AI inamic funcționale, la victorie prada +3000c (=40×75) în wallet, pierderile scrise înapoi (4→2 unități, veteranii supraviețuiesc, +XP), record 1W/0L, persistat în localStorage.

**2026-07-11 - Task Completed (embed în OurDaysApp)**
> Prompt: "vreau sa ii facem deploy in aplicatia OurDaysApp si sa il lucram acolo, iar eu sa il testez in aplicatie"
> Model: Claude Opus 4.8
> Decizii: tot jocul single-player ca rută `/warlord` în OurDaysApp; i18n în engleză deocamdată; ambele repo-uri ținute IDENTICE.
> Changes:
> - Copiat codul de joc în `OurDaysApp/src/warlord/` (logic/state/components/mods/assets + App.tsx→WarlordApp.tsx). Rută lazy `/warlord` + `src/screens/Warlord.tsx` wrapper + buton ⚔ (Swords) în header CalendarHome (desktop+mobil).
> - Curățenie strict-compat (aplicată în AMBELE copii ca să rămână identice): `import type` (verbatimModuleSyntax), eliminat importuri/variabile nefolosite (React inutil cu jsx:react-jsx, dead destructure în App/BuildingsTab, dead local `units` state → `const [, setUnits]`, funcție `hasFreeBatchSlot` nefolosită etc.).
> - Adăugat notă de sincronizare în CLAUDE.md.
> Build: standalone `tsc --noEmit` ✅ + `test` ✅ (10/10); OurDaysApp `tsc -b` ✅ + `vite build` ✅ (Warlord = chunk lazy 118kB/gzip 32kB, bundle principal neschimbat) + deploy hosting ✅ (live: our-days-2a939.web.app/warlord).
> Verificat local (bypass temporar de auth, revenit): Warlord se randează la /warlord fără erori de consolă; flux complet Load→Campaign→Deploy→March→grid de luptă funcțional în contextul embed.

**2026-07-11 - Task Started (dezvoltare joc)**
> Prompt: "vreau sa imbunatatim si sa dezvoltam jocul / deci? / limita este libera"
> Plan: (1) fix dead-state split/merge/training; (2) promovare rank din XP + XP antrenament aplicat zilnic; (3) upgrade clădiri cu nivele; (4) progresie campanie (1 luptă/zi, escaladare, streak); (5) prognoză de atac + raport de bătălie; (6) salvări per-uid în embed. Sync ambele repo-uri + teste + review + deploy.
> Model: Claude Opus 4.8

**2026-07-11 - Task Completed (dezvoltare joc)**
> Model: Claude Opus 4.8
> BUG-URI REALE REPARATE:
> - **Save pierdut la refresh** — useGameState scria save-ul la mount cu state proaspăt, suprascriind salvarea înainte de Load. Fix: hidratare la inițializare (`readSaveBlob` citit sincron în useState initializer; toate slice-urile — useEconomy/useBarracks/useUnits/useCampaign — primesc blob-ul). Refresh-ul păstrează acum progresul.
> - **Dead-state**: doSplit/doMergeIfReady/toggleTraining scriau într-un `units` local mort → mutate pe `unit.setUnits` (butoanele Split/Merge/Training funcționează de-acum); checks înainte de setState.
> - **XP fără destinație**: `trainingGainPerDay` nu era folosit nicăieri; unitățile în training nu primeau nimic.
> FEATURES NOI:
> - **Promovare în rank** (`units.ts`): `PROMOTE_AT` (NOVICE 100 / TRAINED 250 / ADVANCED 450 / VETERAN 700 → ELITE doar din luptă), `promoteBuckets` pur (conservare exactă, overflow XP purtat, merge ponderat în bucket-ul superior, same-ref când nu promovează nimic). Aplicat zilnic în `runDailyTick` (training) și post-luptă în `applyCasualtiesToUnit`.
> - **Upgrade clădiri** (`economy.ts` + `BuildingsTab`): `Building.level` 1–3, output ×1.0/×1.3/×1.6 (`buildingLevelMult` în `passiveIncomeAndProduction`), cost upgrade = 60% × cost bază × nivel curent; badge L{n} real + buton UP (înlocuiește „LVL 1" hardcodat). BARRACKS/MARKET/STABLE excluse.
> - **Progresie campanie** (`useCampaign` + `enemies.ts`): `lastBattleDay` (1 bătălie/zi — butonul Prepare devine „Resting 🏕"), `clears` per misiune → `escalationMult` (+5%/victorie, cap +50% forță inamică), `streak` → `streakLootMult` (+5%/victorie consecutivă, cap +50% pradă; reset la înfrângere/retragere). `createBattle(units, diff, seed, {ratioMult, rewardMult})`.
> - **Prognoză de atac** (`engine.ts` + `CampaignTab`): `forecastAttack` pur (varianță medie, ZERO rng consumat, zero mutație — sigur pt PvP); panou lateral cu ținta, ~kills, ~pierderi la ripostă, ☠ letal, (ranged); click pe rând = atac.
> - **Raport de bătălie** (`army.ts` + `ResultScreen`): `UnitReport[]` per unitate (fielded/lost/XP/promovări/💀) în `lastResult.report`; tabel în ecranul de rezultat.
> - **Salvări per-uid în embed** (`App.tsx` + OurDaysApp `screens/Warlord.tsx`): prop `saveKey` scopează save + timerele autoTick; embed folosește `warlord_save_{uid}` cu migrare one-time din `warlord_save`.
> COMPAT: save-urile vechi se hidratează cu defaults (`hydrateCampaign`, `level ?? 1`, `report?`).
> Build: standalone `tsc` ✅ + `build` ✅ + Vitest **18/18** ✅ (6 teste noi: promovare/conservare/forecast-pur/escaladare); OurDaysApp `tsc -b` ✅ + `build` ✅ (chunk Warlord 126kB).
> Verificat end-to-end în preview (embed): hidratare la refresh (Day 5 fără Load), save vechi fără crash, promovare NOVICE→TRAINED cu overflow 15 XP, FARM L1→L2 cu −4800c exact, lastBattleDay setat la start de luptă, panou forecast apărut la țintă în rază + atac prin panou (8 kills, ranged, fără ripostă) + ascuns după acțiune.
> REVIEW ADVERSARIAL (workflow 19 agenți, 15 constatări confirmate = 9 distincte, toate reparate):
> - CRITIC: schimbarea saveKey pe componentă montată suprascria save-ul noii chei cu state-ul vechii chei → `key={saveKey}` la <WarlordApp> în embed (remount = re-hidratare) + guard `hydratedKey` în useGameState (persist doar pentru cheia din care s-a hidratat).
> - MAJOR: migrarea legacy `warlord_save` putea fi consumată de un render anonim → migrare doar cu uid real autentificat.
> - MAJOR: `canPayUpkeep`/`foodShortage` calculate pe snapshot-ul PRE-venit (moral scădea deși upkeep-ul era de fapt plătit din venitul zilei) → `applyBuildingIncome` returnează `{walletDelta, resources}` post-producție, flag-urile se calculează pe valorile de azi.
> - MAJOR: estimarea inamicului din DeployPanel ignora escaladarea (subestima) → primește `clears` + `escalationMult`.
> - MINOR: setBarracks/addLog în interiorul updater-ului setBatches (dublare latentă în StrictMode) → pre-pass pur; kills-urile unităților distruse pierdute din raport → combatanții distruși rămân în array (hp 0, toți consumatorii filtrează hp>0), selecție curățată la moarte; resetAll nu golea mergePick → golit; tooltip UP zicea „+30%" mereu → arată multiplicatorul rezultat (×1.3/×1.6).
> Post-fix: tsc ✅, 18/18 teste ✅, build ambele ✅, redeploy ✅.

**2026-07-12 - Task Started (PvP server-authoritative)**
> Prompt: "pvp" + decizii: server-authoritative de la început („securitate și anti-cheat bun, aplicația se extinde de la familie la social mai larg"), pierderi reale, push de tură.
> Plan: modul pur `combat/pvp.ts` (sanitizeDeploy + createPvpBattle) în TOATE 3 copiile (standalone/embed/functions); 4 Cloud Functions (accept/submit/forfeit/turn-push) rulând ACELAȘI applyCommand; fence firestore.rules pe gameType warlord-battle; client OurDaysApp-only `src/warlordPvp/` cu optimistic UI + reconciliere prin determinism + write-back pierderi idempotent.
> Model: Claude Opus 4.8

**2026-07-12 - Task Completed (PvP server-authoritative)**
> Model: Claude Opus 4.8
> LIVRAT (server-authoritative, LIVE pe our-days-2a939.web.app/warlord → tab ⚔ PvP):
> - Motor: `combat/pvp.ts` NOU pur (sanitizeDeploy — reconstruiește Combatant-uri curate cu caps ≤12 unități/≤500 per unitate/≤2000 total, vet derivat, statsOverride ȘI loadoutWeapon eliminate; createPvpBattle determinist). A TREIA copie byte-identică în `Apps/OurDaysApp/functions/src/warlordCombat/`. `army.ts applyBattleResult(side)` pt perspectiva ENEMY. 24 teste vitest.
> - Cloud Functions (`OurDaysApp/functions/src/index.ts`): createWarlordChallenge, acceptWarlordChallenge, submitWarlordCommand, forfeitWarlordBattle (onCall + tranzacții) + onWarlordBattleUpdated (push „e tura ta"/„joined"/„battle over"). Toate rulează ACELAȘI applyCommand ca autoritate.
> - firestore.rules: fence pe warlord-battle (create doar prin callable; update interzice state/winner/status/seed/deploy/players/finalized/etc.; delete doar waiting); colecția privată `warlordDeploys` interzisă total clientului.
> - Client OurDaysApp-only `src/warlordPvp/` (pvpApi/PvpPanel/PvpBattle) + toggle Domain|PvP în screens/Warlord.tsx + branch GamesHubModal. Optimistic UI (applyCommand local) reconciliat cu doc-ul server prin determinism, rollback la applied:false. Pierderi reale idempotente (warlord_pvp_applied_{uid}).
> REVIEW ADVERSARIAL (workflow, constatări confirmate reparate ÎNAINTE de ship-ul final):
> - CRITIC: `loadoutWeapon` valida independent de `type` → arcaș-cu-halebardă (rază 3 fără ripostă + ×1.5 vs armură + fură scutul). FIX: `loadoutWeapon` eliminat complet din sanitizeDeploy (PvP = stats vanilla, arma mereu default-ul tipului). Test nou.
> - MAJOR: adversarul putea citi armata provocatorului din doc înainte să-și aleagă a lui (counter-pick). FIX: crearea prin `createWarlordChallenge` (callable), armata provocatorului în `warlordDeploys/{gameId}` (Admin-only); doc-ul „waiting" n-are info de armată. Repară și verificarea de membru grup + validarea server la creare.
> - MINOR: `finalized` adăugat la deny-list.
> AMÂNAT (documentat în docs/PVP_INTEGRATION.md): fără timeout de tură (retragerea = portița); i18n engleză.
> Build: standalone tsc+24 teste ✅; embed tsc ✅; functions tsc ✅; vite build ✅. Deploy: functions ✅ + rules ✅ + hosting ✅.

**2026-07-12 - Task Completed (Tech Tree + Momentum)**
> Model: Claude Opus 4.8
> LIVRAT (ultimul item din backlog-ul original):
> - **Nucleu pur `logic/research/`**: `catalog.ts` — 12 tehnologii pe 4 ramuri × 3 trepte, DEFINITE CA DATE, cu `resolveCatalog(overrides)` (merge peste default; viitorul admin doar livrează un obiect de override — fără migrare). `effects.ts` — UN SINGUR obiect `Modifiers` + `applyDelta`/`clampModifiers` cu **plafoane** (economia nu poate exploda). `momentum.ts` — buff-uri temporare + `aggregate()`.
> - **EFECTELE ÎNCRUCIȘATE cerute:** o victorie nu mai dă doar pradă — declanșează **War Spoils** (+25% producție 3z) ȘI **Martial Fervour** (+50% XP antrenament 3z); o cercetare terminată dă **Breakthrough** (+10% prod, +20% XP, 2z); o înfrângere/retragere dă **Licking Wounds** (−15% prod, 2z). Buff-urile trec prin ACEEAȘI agregare ca tehnologiile ⇒ o singură cale de efect, nu două sisteme. Re-câștigarea REÎMPROSPĂTEAZĂ buff-ul (nu-l stivuiește) — altfel o serie de victorii ar compune la infinit.
> - **Pârghii backward-compatible** (default = fără efect): `passiveIncomeAndProduction(outputMult, craftEfficiency)`, `applyBuildingIncome(addNote, mods)`, `dailyUpkeepCopper/dailyFoodConsumption(units, mult)`, `batchDurationDays/batchSlots(level, delta)`, `trainingGainPerDay × mods.trainXpMult`, `rewardMult × mods.lootMult`, sloturi de training + `mods.trainSlotsDelta`, moral post-luptă.
> - `useResearch` (model `useCampaign`, cu `hydrateResearch` tolerant la save-uri vechi) + `startResearch` (tiparul `buyBuilding`: toate verificările înainte de setState) + bloc în `runDailyTick` (pre-pass pur, ca la batch-uri) + save/deps/load/reset/export.
> - `ResearchTab`: 4 coloane, stări blocat/disponibil/în curs/cercetat, bara de **Momentum** cu zilele rămase și panoul „Total effect".
> DECIZIE: cercetarea afectează DOMENIUL, nu stat-urile de luptă — motorul (3 copii byte-identice) rămâne neatins, PvP-ul rămâne vanilla, iar avantajul se propagă onest prin trupe mai multe/mai bine antrenate. Arena „armate reale" va fi doar o decizie de includere a obiectului `Modifiers`.
> BUG prins de verificarea LIVE (nu de teste): garda „s-a schimbat ceva?" din tick compara doar lungimile, iar decrementarea zilelor nu schimbă lungimea ⇒ cercetarea nu progresa niciodată. Acum scrie ori de câte ori există ceva în desfășurare.
> Build: `tsc` ✅ + **40/40 teste** (16 noi) ✅ + `build` ✅ standalone; `tsc -b` ✅ + `build` ✅ embed; cele 10 fișiere verificate identice între copii (`diff -q`). Deploy hosting ✅.
> Verificat live: costuri deduse exact (18000c + 50 lemn), zile 3→2→…→deblocat, Breakthrough auto-acordat, XP/zi 25 → 53 (35 bază după promovare × 1.25 tech × 1.2 buff), retragerea adaugă Licking Wounds fără să distrugă buff-ul existent, zero erori de consolă.
> RĂMÂNE (notat): admin Warlord (editor peste `resolveCatalog`), Arene PvP, deblocările din ramura Doctrine încă nu filtrează UI-uri (ids expuse în `mods.unlocks`).

**2026-07-12 - Task Completed (matchmaking GLOBAL — o singură lume)**
> Prompt: "atacam acum" (după decizia: toți userii aplicației sunt jucători în ACEEAȘI lume; grupurile = strat social)
> Model: Claude Opus 4.8
> PvP-ul era limitat la membrii unui grup comun. Acum ORICE user poate provoca pe ORICINE; grupurile/prietenii rămân doar scurtături de descoperire.
> Totul e OurDaysApp-only (codul de joc sincronizat NU s-a schimbat): registru public `warlordPlayers/{uid}` (nume/nameLower/poză/putere + wins/losses scrise DOAR de server), `createWarlordChallenge` cu groupId opțional (etichetă, nu poartă) + notificare/push scrise direct de funcție, `recordWarlordResult` la fiecare final, selector de adversar din toată lumea (recenți + căutare + badge „known").
> REPARAT în aceeași sesiune (prins de review-ul adversarial, era LIVE): `acceptWarlordChallenge` citea necondiționat `groups/${g.groupId}` — cu groupId null rezultă calea validă-dar-inexistentă „groups/null", deci ORICE provocare globală eșua cu permission-denied. Acum e ghidat de `battleGroupId` tipat; eticheta de grup, când există, se verifică în continuare.
> Reguli: ramura de grup rămâne PRIMA (interogările arcade evaluează exact ca înainte) + gardă de null, ramura `players` gardată pe cheie.

**2026-07-12 - Task Completed (cont de joc cloud-sync)**
> Prompt: "fiecare user al aplicatiei OurDaysApp are un cont separat pentru jocul Warlords...?" → decizie: toți userii = O lume; regatul fiecăruia devine cont real cross-device.
> Model: Claude Opus 4.8
> Persistență pluggable în `useGameState(saveKey, opts?)` (SYNCED): `opts.initialBlob` (cloud override) + `opts.onPersist(blob)` (scriere suplimentară, ex. cloud). Log plafonat la 300 (protejează doc-ul cloud). `App.tsx` propagă prop-urile. Standalone neschimbat (fără opts → localStorage). 24 teste.
> OurDaysApp-only: `src/warlordCloud.ts` (loadWarlordDomain: cloud→localStorage + migrare local→cloud dacă cloud gol; saveWarlordDomain; createDomainSync debounced 2.5s + flush). `screens/Warlord.tsx`: încarcă cloud ÎNAINTE de mount (ready-gate + spinner), onPersist=writer debounced, flush la unmount/switch-view. PvP write-back (`writeLocalArmy`) împinge acum și în cloud. Rule nouă `warlordDomains/{uid}` owner-only.
> Model salvare: localStorage = cache write-through + offline; Firestore `warlordDomains/{uid}` = sursă durabilă. Regatul urmează userul pe orice dispozitiv.
> NOTAT (viziune, de construit ulterior): toți userii într-o singură lume, PvP dincolo de grupuri (grupurile = strat social: căutare/mesaje/invitații), legături joc↔app definite în sesiunea principală.
> Build: standalone tsc+24 teste ✅; embed tsc+build ✅; deploy rules ✅ + hosting ✅. Verificat local: ready-gate hidratează Day 8, toggle Domain↔PvP fără pierdere, zero erori consolă.

**2026-07-12 - Task Started (Tech Tree + Momentum)**
> Prompt: "tech tree" + cerințe: toate cele 4 ramuri; **efecte încrucișate subtile** („o victorie ar trebui să aducă și un boost temporar în economie, nu doar loot, și un XP boost temporar pentru unitățile în antrenament"); **un admin Warlord separat** de unde se configurează totul; context viitor: mai multe **Arene** PvP (vanilla / armate reale / custom sandbox).
> Plan: nucleu pur `logic/research/` cu definițiile ca DATE (`resolveCatalog(overrides)` → admin-ul de mai târziu doar suprascrie, fără migrare) + UN SINGUR obiect `Modifiers` agregat din cercetări ȘI buff-uri temporare (aceeași cale de efect, nu două sisteme). Cercetarea afectează DOMENIUL (producție/antrenament/upkeep/pradă), NU stat-urile de luptă — motorul rămâne sigilat (3 copii byte-identice) și PvP-ul rămâne vanilla; avantajul se propagă onest prin trupe mai bune. Arena „armate reale" devine ulterior o decizie de includere a obiectului `Modifiers`.
> Model: Claude Opus 4.8

### Session 2 — 2026-06-20

**2026-06-20 - Task Started**
> Prompt: "toate suna bine, vreau ca inainte sa adaugi ceva, sa iti faci un plan de implementare si sa verifici apoi, daca codul actual este corect, optim si sa il aduci up to speed" + "nu vreau sa modifci nimic in folderul apps, vreau doar sa intelegi modul de lucru pe care il vreau" + "ok, deci, vreau sa intelegi modul de lucru din apps si sa aplici pentru warlord, acum, continua cu dezvoltarea jocului"
> Plan: Aplică metodologia din Apps (CLAUDE.md + DEVLOG), continuă cu Fazele 3.1-3.4 din plan
> Model: Claude Sonnet 4.6

**2026-06-20 - Task Completed**
> Model: Claude Sonnet 4.6
> Changes:
> - `CLAUDE.md` creat — reguli permanente, arhitectură, capcane cunoscute
> - `DEVLOG.md` creat — metodologie + session log
> - `src/logic/economy.ts`: `dailyUpkeepCopper()` — cost zilnic per soldat (tip × rank); `dailyFoodConsumption()` — consum hrană per soldat; `RESOURCE_BUILDING_BASE_VALUE` include FOOD; `FARM` adăugat la `BuildingCostCopper`, `ResourceBuildingCosts`, `BuildingOutputChoices`
> - `src/logic/types.ts`: `FOOD` adăugat la `ResourceType`; `FARM` adăugat la `Building.type`; `morale: number` adăugat pe `Unit`
> - `src/logic/units.ts`: `computeReady()` aplică factor morale (50%–100%); `applyMoraleChange()` — modifică morale zilnic bazat pe upkeep + hrană; `mergeUnits()` calculează morale ponderat; `splitUnit()` propagă morale
> - `src/logic/events.ts` creat — 6 tipuri de evenimente aleatorii (RAID, EPIDEMIE, etc.); `rollDailyEvent()` cu 15% șansă/zi
> - `src/logic/registry.ts`: FOOD înregistrat ca item
> - `src/state/useGameState.tsx`: `runDailyTick()` integrează upkeep + consum hrană + morale update + evenimente aleatorii; unit creat cu `morale: 100`
> - `src/state/useEconomy.ts`: FOOD în resources inițiale
> Build: `npx tsc --noEmit` ✅ | `npm run build` ✅ (3.31s)

### Session 1 — 2026-06-20

**2026-06-20 - Task Started**
> Prompt: "intentionez sa adaug complexitate jocului, vreau sa imi dai sugestii"
> Plan: Audit complet codebase + identificare buguri + plan de implementare features noi
> Model: Claude Sonnet 4.6

**2026-06-20 - Task Completed**
> Model: Claude Sonnet 4.6
> Changes:
> - `src/logic/units.ts`: Fix `computeReady()` (returna 0 fără constrângeri → returna `size`); fix `splitUnit()` horses ca `{active,inactive}` nu scalar; curățat comentarii verbose din `requiredCountsFor()`; extras helpers `splitScalarEquip`/`subtractScalarEquip`
> - `src/logic/economy.ts`: Fix Lumber Mill — nu mai e hardcodat la 10 WOOD, respectă `focusCoinPct` via `RESOURCE_BUILDING_BASE_VALUE`
> - `src/logic/batches.ts`: Eliminat bloc comentat imens (implementare veche); formula `batchSlots` corectată la `Math.min(level + 1, 5)`
> - `src/logic/registry.ts`: Adăugată validare la `registerItem()`/`registerUnit()` + warning la duplicate ID
> - `src/logic/training.ts`: `setWallet(() => res.wallet)` → `setWallet(w => w - res.spent)`; eliminat comentarii narative; ordine corectă checks-before-mutations
> - `src/state/useGameState.tsx`: Fix stale closure în `doMergeIfReady()`; `setWallet()` scos din callbacks setState în `sell()`; `econ.resources` adăugat la useEffect deps
> - `src/state/useBarracks.ts`: `recruit()` blendează corect `avgXP` în loc să reseteze la 0
> - `CLAUDE.md` + `DEVLOG.md` create (metodologie din Apps aplicată)
> Build: `npx tsc --noEmit` ✅ fără erori
