# Backlog — OurDaysApp

> **Ce e și ce NU e fișierul ăsta.** O **evidență**, nu o coadă de lucru. Nimic de aici nu se
> începe fără ca Andrei să-l aleagă. O listă de „mai târziu” citită de o sesiune viitoare devine
> ușor o instrucțiune pe care n-a dat-o nimeni — de aceea fiecare punct spune **de ce așteaptă**.
>
> Nu e nici `OWNER_VERIFY.md` (ce verifică Andrei cu ochii lui și deciziile lui), nici `DEVLOG.md`
> (istoria, append-only). Sursa: auditul read-only din 24.09.2026 (pe `3d74d7c`), secțiunile B, C, D,
> plus ce a rămas deschis din felii. Un punct închis se **șterge de aici**, cu commit-ul care l-a
> închis menționat în DEVLOG.

## 1. Așteaptă ca APK-ul să nu mai fie folosit

**Decis de Andrei pe 25.09: deocamdată aplicația rămâne web app, fără reconstruire.** APK-ul instalat
rulează bundle-ul din 9 mai și vorbește cu aceleași reguli. Orice regulă care refuză ce trimite el îl
strică, iar `rules-tests/apk-compat.test.ts` pică exact când se ajunge aici. Ce e mai jos se deblochează
fie când nimeni nu mai folosește APK-ul (Andrei spune), fie dacă se reia reconstruirea.

- **Felia de reconstruire însăși:**
  - `android/app/google-services.json` **lipsește** — build-ul scrie „Push Notifications won't work”,
    deci push-ul pe APK n-a mers, după toate probabilitățile, niciodată;
  - permisiunile CAMERA și RECORD_AUDIO;
  - `versionCode` 2;
  - handler pentru tap pe push și afișarea push-urilor în prim-plan;
  - `npx cap sync`.

  **Decizia (a) bundle local vs (b) `server.url` e a lui Andrei** (`OWNER_VERIFY.md`).
- Regula temporară din Storage pentru numele vechi de fișier (`chat-images`, `chat-audio`): se scot
  ramurile vechi, **atât la `create`, cât și la `get`**. Fereastra de 10 minute de citire (25.09)
  există doar pentru APK. Până atunci, oricine e logat și ține calea exactă a unei poze cu nume vechi o
  poate citi în primele 10 minute de la încărcare.
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

- **`hiddenFrom`:** eticheta e reformulată din 25.09, la decizia lui Andrei. Impunerea reală ar cere
  alt model de date (`restricted` + listă albă + două interogări) și o regulă de citire nouă pe
  `events`, pe care APK-ul n-ar suporta-o. Rămâne aici doar ca posibilitate.
- **Ștergerea unui grup din APK ocolește cascada.** APK-ul șterge grupul direct din client:
  evenimentele, apoi invitațiile, apoi `groups/{id}`. Lasă în urmă mesajele, `typing` și media.
  Singurul remediu care acoperă telefoanele e un trigger `onDocumentDeleted('groups/{id}')` cu
  aceeași gardă ca în `groupMedia.ts`. Decizia lui Andrei; până atunci îl rezolvă reconstruirea.
- **Ce mai lasă cascada în urmă, intenționat până decide Andrei** (măsurat 25.09):
  - cheltuielile grupului, care rămân cu un `groupId` mort și devin needitabile;
  - jocurile grupului;
  - cardurile partajate cu grupul, care rămân cu `sharedGroupId` mort.
  Pentru fiecare: ștergere, mutare pe personal, sau nimic.
- **Storage, apartenența la conversație:** oricine e logat poate încărca un fișier NOU, pe numele
  lui, în folderul oricărei conversații. Închiderea cere regulile cross-service (un grant IAM și o
  citire facturată pe cerere), pe care `storage.rules` le refuză deliberat. Decizia lui Andrei.
- **Arcade, în interiorul grupului:** mutările din APK nu scriu `lastMoveAt`, deci un joc jucat doar
  pe telefon poate fi închis de expirarea de 24h în timp ce e jucat (dedus din cod, nemăsurat).
  (Titlul push-ului din `gameType` e închis din 06.10.)
- **Alte câmpuri ale unui joc, scrise de un membru, pot strica ecranul celorlalți** (recenzia din
  06.10, citit în cod, nereprodus). Regulile nu verifică `state` decât ca formă de bază (o hartă, iar
  `playerIds` o listă, din 06.10) și nici `createdAt`. Toate trei cer un membru rău-intenționat al
  grupului:
  - **un joc deschis cu date stricate** (de exemplu `state.board` care nu e listă) duce toată aplicația
    pe ecranul de eroare la apăsarea „Join”. Reîncărcarea o repară. Remediul: o graniță de eroare în
    jurul panoului de joc din `GamesHubModal.tsx`, cu „datele jocului sunt stricate” și înapoi;
  - **un `createdAt` care nu e dată** face sortarea listei din Arcade să arunce la fiecare actualizare,
    iar lista zilei rămâne goală sau veche pentru toți, fără mesaj. Remediul: sortarea prin `activityMs`
    din `gameSession.ts`;
  - **un jucător numit `__proto__`** într-un joc terminat strică numerele clasamentului (și „NaNW” în
    PvP) pentru cine deschide clasamentul, până la reîncărcare. Remediul: `Object.create(null)` pentru
    harta clasamentului.
  Implicit: toate trei într-o felie, doar în client. APK-ul rămâne expus la primul.
- **Un joc nou trimite o notificare tuturor membrilor, fără nicio limită.** Un membru poate crea și
  șterge jocuri la nesfârșit, iar fiecare trimite un push grupului (rândurile din clopoțel rămân).
  Cererile de prietenie și provocările Warlord au cotă zilnică (`notif_usage`); `onGameCreated` nu are.
  De ales limita: implicit aceeași cotă zilnică. Decizia lui Andrei.
- **`notifyUsers` scrie orice text în clopoțelul altui membru** (fără push): titlu până la 200 de
  caractere, text până la 500 și orice cheie de titlu, cu cota zilnică de notificări. APK-ul afișează
  titlul scris. Clientul îl folosește pentru sarcinile atribuite. Închiderea cere o listă de chei și
  textul compus pe server. De decis dacă merită.
- **Serverul citește orice `invalid-argument` de la FCM ca token mort** și îl șterge
  (`functions/src/notify.ts`). Pentru un token chiar invalid e corect. Pentru un mesaj refuzat întreg
  (prea mare, câmp greșit) ar șterge tokenurile tuturor destinatarilor. Din 06.10, textul membrilor
  nu mai poate face un mesaj prea mare (tăiat la 200/500). Rămâne ca risc pentru un apel nou care ar
  trimite un câmp greșit.
- **Rândurile de eroare scrise de server n-au plafon zilnic** (cele de client au 200 pe cont). TTL-ul
  limitează cât trăiesc, nu câte sunt. (Că se pierdeau pe căile de eșec e reparat din 25.09: toate
  sunt așteptate cu `await`.)
- **Un membru scos poate accepta o a DOUA invitație încă în așteptare** în același grup. Scoaterea
  nu anulează invitațiile și linkurile lui. Asta cere un trigger pe `groups` sau o listă a celor scoși,
  ținută de server. Decizia lui Andrei.
- **5 invitații „acceptate” fără `toId`** (măsurat 25.09): acceptări din APK care n-au băgat pe
  nimeni în grup, fiindcă scrierea în `members` e refuzată. Rămân moarte. Recuperarea e decizia lui
  Andrei.
- Cererile și invitațiile vechi nu vor primi niciodată ștampila expeditorului (triggerul pornește o
  dată); rămân cu avertismentul. O ștampilare retroactivă se poate scrie — rulată doar cu confirmare.
- **Un eșec trecător la citirea contului Auth** (`authIdentityOf`) ștampilează `email: null` —
  pentru totdeauna, fiindcă triggerul pornește o dată. De la 24.09 ecranul arată atunci „nu am putut
  confirma” (corect: un nume singur nu confirmă pe nimeni), deci o cerere legitimă poate purta
  avertismentul. Reparația ar fi o reîncercare în trigger, sau ștampilarea retroactivă de mai sus.
- **Prietenii nu păstrează dacă emailul era verificat.** La acceptare se scrie emailul, nu și
  `emailVerified`, deci lista de prieteni nu poate deosebi o adresă dovedită de una tastată.
- **Emailul owner-ului rămâne în istoria git și în DEVLOG.** Din 24.09 nu mai e în cod, iar din 25.09
  nici în teste și comentarii. Stă în `functions/.env`, ignorat de git, cu o copie în `~/.ourdays/`.
  Dar repo-ul e public și istoria îl are.
  Rescrierea istoriei e decizia lui Andrei.
- **Cine iese dintr-un grup e scos de pe evenimentele care URMEAZĂ (05.10), nu de pe toate.** Ce a
  rămas deliberat, după deciziile lui Andrei din 05.10:
  - **Evenimentele trecute își păstrează numele lui** (istoria rămâne, și se vede: „Gina”, nu
    „Membru”). „Trecut” = ultima zi s-a terminat peste tot pe glob (UTC−12). Le citește în continuare,
    iar orice editare a lor e refuzată cât timp e pe listă (`namedAreInGroup`, pe documentul REZULTAT).
    Singura ieșire din aplicație: pe un task, proprietarul sau un responsabil îl scoate cu X-ul de pe
    numele lui, în detalii.
  - **Evenimentele create de el rămân ale lui.** Le citește, îi vin memento-urile lor și le poate
    șterge chiar și după ce a plecat. Nimeni din grup nu le mai poate șterge, iar
    `createEventOverride` îl lasă să modifice o apariție a seriei lui (fără să se poată pune pe ea).
  - **La ștergerea unui grup** evenimentele celorlalți devin personale și păstrează numele colegilor,
    deci rămân înghețate, chiar și pentru autor. Pe live: 5, toate în trecut.
  - **Alte urme ale plecării, mărunte:** invitațiile trimise de el rămân în așteptare (acceptarea dă
    „nu mai e în grup”), linkurile lui nu sunt revocate (doar refuzate la folosire), iar indicatorul
    „scrie…” rămâne. Ștergerea contului le curăță pe toate.
- **Un grup șters din APK sau din consolă își lasă resturile (06.10).** APK-ul șterge singur documentul
  grupului, fără serverul care curăță. Rămân mesajele, indicatorul „scrie…”, linkurile de invitație
  nerevocate, jocurile, cheltuielile și cardurile încă partajate cu grupul. De la 06.10 nimeni nu le mai
  poate deschide, fiindcă id-ul nu mai poate fi recreat, dar ocupă loc. Un trigger la ștergere le-ar
  putea curăța: de decis. Și ștergerea de pe server lasă jocurile, cheltuielile și cardurile, iar
  invitațiile se șterg doar până la 3.200.
- **Răspunsurile RSVP (05.10): ce a rămas deliberat.**
  - **Un eveniment PERSONAL poate fi creat cu răspunsurile oricui.** Copia de la ieșirea dintr-un grup
    le are în APK, care nu poate fi schimbat. Le citește doar proprietarul și nu pot ajunge într-un
    grup: mutarea într-un grup păstrează doar răspunsul celui care mută.
  - **Mutarea între grupuri păstrează doar răspunsurile membrilor comuni** (decizia lui Andrei). Deci
    oricine poate muta un eveniment al grupului (orice membru poate) poate șterge răspunsurile celorlalți
    în doi pași: îl mută într-un grup doar al lui și înapoi. Ștergerea directă e refuzată. Poate deja
    scoate evenimentul din grup, așa că nu e o putere nouă.
  - **Mutarea din web nu e o tranzacție:** cine răspunde exact între citire și scriere face mutarea să
    fie refuzată („Evenimentul nu a fost salvat”), nu stricată. Se reface apăsând din nou.
  - **Invitațiile doar după uid nu apar în APK** (ascultă doar după email).
  - **Membrii unui grup văd invitațiile acceptate ale grupului**, cu uid-ul și adresa invitatului
    (`acceptGroupInvite` scrie `toId` pe o invitație adresată pe email). Deci un membru poate afla
    adresa unui coleg intrat prin invitație pe email. E veche, nu ține de RSVP. De închis împreună cu
    citirea invitațiilor după grup.
- **O cheltuială nu mai poate fi corectată după ce un membru pleacă din grup.** `splitIsHonest` cere
  ca toți din `splitAmong` să fie membri, pe documentul REZULTAT — deci orice editare a rândului e
  refuzată cât timp cel plecat e încă pe listă (scoaterea lui schimbă împărțirea). Ștergerea merge.

## 3. Cod și operațiuni (C)

- **AI-ul pe Claude (26.09): ce a rămas deliberat în afara livrării.**
  - **Rezervarea pe apel nu e un plafon peste un fallback.** Un apel refuzat de Opus 5.5 și servit de
    alt model plătește ambele încercări. Decontarea le încasează pe amândouă (`costOf`), dar rezervarea
    acoperă una singură. Sub concurență, bugetul poate fi depășit cu cel mult o încercare. Se lasă
    așa: fallback-urile ar trebui să fie rare. De reluat dacă ledger-ul arată altceva.
  - **Confidențialitatea:** rezumatul grupului trimite până la 50 de mesaje din chat, iar sugestia de
    card trimite numele cardurilor din portofel. Până pe 26.09 mergeau la Google, acum merg la
    Anthropic. Aplicația n-are o pagină de confidențialitate care să spună asta. Decizia e a lui Andrei.
  - **Workspace-ul separat există din 27.09** (`ourdays`, singurul pe regula de federare), deci
    cheltuiala OurDays se vede separat în consolă. Au rămas două lucruri:
    - **limita de cheltuială** pe workspace se pune din consolă;
    - **limitele de rată** Anthropic sunt pe organizație. Un alt proiect pe aceeași organizație poate
      face ca OurDays să răspundă „AI-ul e ocupat”.
    Decizia e a lui Andrei.
  - **Lista funcțiilor AI** e scrisă de mână în `claudeAuth.test.ts`. Plasa reală e alta: o funcție nouă
    care cheamă `paidGenerate` fără să intre în lista de cinci pică `aiLedgerShape.test.ts`, deci nu
    trece neobservată.

- **Bundle-ul, pasul următor.** Wallet, Chat și Settings sunt separate din 25.09: chunk-ul principal
  a scăzut de la 1.592 kB la 1.145 kB. Rămân în el două lucruri: coduri de bare și QR
  (`AssetBarcode`, importat de `EventDetailsModal`) și `GroupChatWidget` (importat de `CalendarHome`).
  Candidatul următor e `AssetBarcode`, încărcat la cerere.
- **Hosting răspunde cu `index.html` la un `/assets/*.js` lipsă**, cu cache imutabil pe un an (măsurat
  pe live).
  - **Ce nu se strică:** un tab vechi după un deploy vede tot „versiune nouă”; Chrome, Firefox și
    Safari raportează eșecul cu mesajele pe care le recunoaște detectorul.
  - **Ce se strică:** după un **rollback** de Hosting, browserele care au ținut HTML-ul în cache sub
    URL-urile vechi nu mai pot încărca acele chunk-uri. Durează până expiră cache-ul.
  - **Nereparat intenționat (25.09):** singura reparație din config schimbă rescrierea care servește
    TOATE paginile aplicației. Pe emulator potrivirea e minimatch, în producție nu e verificată, iar o
    greșeală ar da 404 pe orice link direct de pe live. E prea mult risc pentru un caz de rollback.
    Se reia cu un test pe emulatorul de hosting ȘI o verificare pe live imediat după deploy.
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

- **Iconițele PWA lipsesc din mai.** `public/manifest.json` declară ambele iconițe (192 și 512) ca
  `/vite.svg`, un fișier care nu există. Hosting-ul răspunde la el cu `index.html`, deci instalarea pe
  ecranul de start n-are iconiță. Găsit de verificarea de după deploy (25.09). Cere iconițe reale,
  deci o decizie vizuală.
- **Refuzurile de reguli nu lasă urme pe server.** Proiectul n-are log-uri de acces la date, iar
  Hosting nu exportă log-uri de cereri, deci o regulă care refuză un utilizator logat sau un chunk
  care nu se încarcă se vede doar dacă clientul raportează în `errorLogs`. Log-urile de acces la date
  costă și se pornesc din IAM, deci e decizia lui Andrei.

- **Același tipar, „buton în lucru fără sfârșit”, în afara Wallet-ului** (inventar 03.10, grep). În
  aplicație mai sunt în jur de 55 de scrieri Firestore așteptate cu `await`, în aproape 20 de fișiere:
  - `EventDetailsModal` 11, `Settings` 8, `AddEventModal` 7, chatul 6;
  - restul, câte 1–3, în rest.
  Offline, oricare dintre ele ține butonul „în lucru” până revine rețeaua, deși scrierea e deja în
  coadă. Wallet-ul a primit reparația pe 03.10 (`pendingWrite.ts`, `walletLedger.ts`); restul nu. **De ce
  așteaptă:** fiecare ecran are refuzurile lui, de gândit separat; nu e cerut.
- **Wallet offline (03.10), ce a rămas deliberat în afară:**
  - **Două dispozitive, aceeași fereastră:** o schimbare fără promisiune (după o repornire) e judecată
    pe primul răspuns al serverului după reconectare, în câteva secunde. Dacă ALT dispozitiv editează
    exact acel card în secundele acelea, schimbarea noastră e raportată „nu e pe server”. Pe server
    chiar nu mai e, dar a fost acolo. Amprenta acoperă redenumirile de categorie și partajarea din
    evenimente, nu și editarea din alt Wallet.
  - **Transferul „necunoscut”:** dacă funcția nu răspunde, nota spune „nu s-a putut confirma” și cere o
    verificare. O reîncercare a unui transfer cu „păstrează o copie” care totuși reușise face a doua
    copie: serverul nu deduplică.
  - **„Stop” exact când poza termină de urcat:** fișierul rămâne în Storage fără card. Se vede la „Pick
    from past uploads”.
  - **O redenumire de categorie întreruptă** (offline, apoi repornire) se termină la următoarea
    deschidere a Wallet-ului, nu din alt ecran. Până atunci rândul spune „Not sent yet”.
- **Cardurile offline, ce a rămas deliberat în afară (28.09):**
  - **Semnal fără date la casă:** căderea automată pe pagina offline vine doar când rețeaua REFUZĂ,
    fără timeout, ca o conexiune lentă să primească aplicația reală. Scurtătura „Cards” (apăsare lungă
    pe iconiță) și modul avion o deschid imediat. Un timeout se reia doar dacă îl cere o măsurătoare.
  - **Pozele cardurilor** nu sunt offline (decizia lui Andrei, implicit nu: câțiva MB per card).
- **Comentariul din `firestore.rules` despre `inviteeId`** (în jur de liniile 546–548) spune că
  `CalendarHome` interoghează `where('inviteeId','==',uid)`. Interogarea a fost scoasă pe 28.09 („UI
  fals”). Regula rămâne corectă; doar comentariul e vechi. Se corectează la următoarea atingere a
  regulilor, ca să nu ceară o publicare de reguli doar pentru un comentariu.

- **Repetarea zilnică cu filtru (26.09) — ce a rămas deliberat în afară:**
  - **Tipul de repetare nu se poate schimba după creare.** Asta nu e nou: nici frecvența nu se putea
    schimba.
  - **Apelanții nucleului de repetare:** o funcție nouă care uită `onlyOn` n-ar fi prinsă de nimic în
    afara testului care compară calendarul cu serverul.

## 4. Produs (D) — doar înregistrat

- **Cont:** omul nu-și poate schimba din aplicație emailul sau parola (resetarea prin email există din
  28.09). Ștergerea propriului cont există din 04.10 (Settings → „Delete account”, DEVLOG 04.10).
- **Ștergerea contului (04.10) — ce a rămas deliberat în afară:**
  - **Mesajele din grupurile părăsite mai demult** apar tot „Necunoscut”: numele se păstrează doar pe
    conversațiile în care persoana era când și-a șters contul. Așa arată azi și cineva care doar a
    plecat dintr-un grup.
  - **Pozele de pe copii se pierd.** Pe o copie a unui eveniment făcută de cineva care a ieșit dintr-un
    grup, poza lui se șterge: nimic nu dovedește de unde vine linkul, iar a ține fișierul pe baza lui
    ar lăsa pe oricine să păstreze pozele oricui. Se pierd la fel pozele puse în evenimentele altora
    din grupurile părăsite mai demult, pe care cascada nu le mai vede.
  - **Evenimentele moștenite nu-și mai arată autorul:** apar ale proprietarului grupului. Un câmp cu
    autorul inițial și „de X (cont șters)” în detalii ar fi un pas mic, dacă vrei.
  - **Rezumatul AI al chatului** spune „Someone” pentru un cont șters: nu citește `formerMembers`.
  - **O sesiune deschisă pe alt dispozitiv** mai poate scrie până la o oră după ștergere (tokenul e încă
    valabil): un eveniment, un card, un mesaj, o poză urcată. Contul însuși, profilul și datele Warlord
    nu se mai pot recrea (regulile), rapoartele ei de erori sunt ignorate, iar o pornire cu internet o
    delogează.
  - **Ordinea membrilor din grupurile de pe live** e cea de azi. Dacă cineva a reordonat-o înainte de
    04.10, cât era încă permis, moștenitorul se alege după acea ordine.
- **Invitațiile la evenimente (`inviteeId`), partea de server:** clientul nu le mai ascultă și nu le mai
  afișează (28.09). Regulile (`events` read/create/update) și logica de vizibilitate AI de pe server încă
  tratează un invitat drept cititor, inofensiv cât timp nimic nu scrie câmpul. Un test (`falseUi.test.ts`)
  pică dacă ceva începe să-l scrie. Comentariul din `firestore.rules` care spune că CalendarHome îl
  interoghează e acum vechi: de corectat la următoarea schimbare de reguli.
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
- **Chat:** rândurile de notificare nu expiră niciodată. (Fereastra de mesaje și rărirea scrierilor
  „scrie...” sunt făcute din 28.09.)
- **Warlord, partea din repo-ul ăsta:**
  - sincronizarea pe două dispozitive (`src/warlordCloud.ts:~98-104`) dă câștig dispozitivului care
    a scris de mai multe ori, nu celui mai recent;
  - eșecul la încărcarea balansului e tăcut (`configApi.ts:~52-57`).
- **Warlord, în submodul** (se repară în repo-ul Warlord, nu de aici): `loadSave` pornește
  portofelul de la 5 aur, `resetAll` de la 10, iar `resetAll` nu resetează `inspection`.

## 5. Nivelul de owner — NU se începe fără Andrei

Orice admin poate face alt admin și poate trimite broadcast, fără MFA și fără autentificare recentă.
CLAUDE.md o numește o felie separată de autorizare.
