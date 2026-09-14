# De verificat de Andrei

Lucruri pe care **nu le pot verifica eu** și de ce. Fiecare are ce să te uiți și cum arată „bine".
Acoperă și Warlord, fiindcă se livrează prin aplicația asta.

Când bifezi ceva, taie-l de aici. Dacă un punct pică, spune-mi *ce ai văzut*, nu doar că n-a mers.

> **Reîncarcă înainte de orice.** Reparat 26.08: până azi, `/`, `/log`, `/wallet` și toate rutele
> reale veneau cu `max-age=3600`, deci reîncărcarea îți dădea tot codul vechi timp de o oră. Acum
> vin cu `no-cache`, iar o reîncărcare normală ajunge (măsurat pe un canal de preview).
>
> **Două excepții rămân:** (1) dacă browserul tău are deja `index.html` din cache de dinainte de
> reparație, poate sta pe versiunea veche **încă până la o oră** — o singură dată; (2) un tab lăsat
> deschis fără reîncărcare rulează codul din memorie, oricât de proaspăt e serverul, fiindcă nimeni
> nu cheamă `registration.update()`. Dacă ceva pare vechi: închide tabul complet și redeschide-l.

---

## 1. Admin → Enemy AI (Warlord) — PRIORITATE

**De ce nu pot eu:** panoul de admin cere autentificare, deci nu-l pot încărca în browser. Typecheck,
teste și build pot fi toate verzi cu panoul căzut pe ErrorBoundary — s-a întâmplat deja o dată în
proiectul ăsta, un hook pus lângă un `return`. Am ancorat toate hook-urile sus tocmai de-aia, dar
rămâne punctul meu orb.

- [ ] Tabul **Enemy AI** apare între *Campaign* și *JSON* și se randează (nu ecran alb).
- [ ] Lista de reguli arată **24 de reguli**, fiecare cu aritmetica ei și cu motivul.
- [ ] **Run** produce ture cu decizii per cohortă, nu o listă goală.
- [ ] Clic pe un id de regulă **filtrează** cohortele care l-au citat, nu golește lista.
- [ ] Linkul **„Reset this section to defaults" NU apare** în tabul ăsta (apare în Economy, Army,
      Techs, Momentum, Campaign — acolo e corect).
- [ ] Schimbi un câmp (seed, cohorte) și **nu se re-rulează** singur; abia **Run** face asta. Dacă
      ciornele diverg de replay-ul afișat, apare o linie sub controale.

## 2. Ecranul de recuperare la save stricat (Warlord)

**De ce nu pot eu:** l-am verificat cap-coadă în jocul de sine stătător, dar **nu** în interiorul
OurDaysApp, unde save-ul vine din cloud și garda rulează cu `external` — fără buton de ștergere,
fiindcă acolo o ștergere locală n-ar repara nimic și ar putea promova un domeniu gol peste cel real.

- [ ] Nu forța un crash. Doar ține minte: dacă vreodată vezi ecran alb la `/warlord`, ar trebui să
      apară în schimb **„The domain could not be drawn"** cu butonul **Copy my save**.
- [ ] Dacă apare: apasă **Copy my save** ÎNAINTE de orice altceva și trimite-mi textul.

## 3. Ecranul nou „Ce s-a întâmplat" (`/log`) — PRIORITATE

**De ce nu pot eu:** e în spatele autentificării, ca adminul. Am verificat că tipurile, testele și
build-ul sunt verzi și că apelul server e deja livrat și revizuit, dar randarea rămâne oarbă pentru
mine. **Nu costă nimic să-l deschizi** — nu cheamă niciun model.

- [ ] Iconița de listă (indigo) apare lângă Portofel în bara de sus, și în meniul de pe telefon.
- [ ] `/log` se deschide și **Arată luna asta** aduce ceva (nu ecran alb, nu eroare).
- [ ] Zilele apar de la cea mai nouă la cea mai veche, cu evenimente și cheltuieli amestecate în
      aceeași zi.
- [ ] Săgețile ← → schimbă luna și reîncarcă.
- [ ] Cheltuiala „Cina restaurant" (400) apare în ziua în care ai adăugat-o, cu eticheta *Family*;
      cea personală (200) apare cu *personal*.
- [ ] Dacă apare o casetă galbenă cu avertismente, trimite-mi textul — înseamnă că serverul a citit
      mai puțin decât întrebarea, și vreau să știu care dintre motive.
- [ ] Textul e în română peste tot.

## 4. Panoul de admin general (OurDaysApp)

**De ce nu pot eu:** aceeași autentificare.

- [ ] `/admin` se deschide normal după ce am adăugat secțiunea de backfill.
- [ ] Secțiunea **Expenses backfill** din *Wallet & Social* arată raportul (deja verificat: 3
      documente, toate scopate — nu e nimic de migrat, **nu apăsa Apply**).

## 5. Decizii care sunt ale tale, nu verificări

- [ ] **PvP se desfășoară pe o singură linie.** `PVP_MAX_COMBATANTS` e exact lățimea tablei (12),
      deci al doilea rând de start nu e atins niciodată: zero adâncime, zero flancare, două ranguri
      perfect față în față. Se repară cu un rând în plus sau cu un plafon mai mic — dar ambele
      schimbă cum se simte PvP-ul, deci decizi tu.
- [ ] **Calibrarea Warlord** rămâne amânată explicit de tine. Nu o ridic nesolicitat.

## 6. Ecranele din spatele autentificarii, dupa trecerea ascultatorilor (26.08)

**De ce nu pot eu:** am convertit **toti** ascultatorii Firestore din aplicatie ca sa nu mai poata
pica in tacere. Am pornit aplicatia in browser (fara erori de consola) si am typecheck + 724 teste
verzi, dar tot ce e dupa login ramane punctul meu orb — exact ca adminul. Am atins CalendarHome,
Wallet, Friends, Settings, chatul de grup, GamesHub, AddEvent si PvP, deci merita o plimbare.

Toate astea trebuie sa arate **exact ca inainte** — schimbarea se vede doar cand ceva pica.

- [ ] Calendarul se deschide, evenimentele apar, comutatorul de grup are grupurile tale.
- [ ] **Nu** apare bannerul rosu de sus („Grupurile tale nu au putut fi incarcate...").
- [ ] Portofelul: bunurile apar; daca n-ai niciunul, scrie „Niciun bun inca" (nu rosu).
- [ ] Prieteni: lista si cererile apar normal.
- [ ] Setari: numele, ziua de nastere si poza sunt acolo — **nu goale**. Daca sunt goale, NU salva,
      spune-mi.
- [ ] Chatul de grup: mesajele se incarca; bulinele „scrie acum" apar cand scrie cineva.
- [ ] Arcade: jocurile de azi si clasamentul.
- [ ] Warlord → PvP: bataliile tale apar.

Daca vreunul arata un text rosu de eroare, **trimite-mi textul exact** — ala e chiar rostul
schimbarii, si imi spune ce citire e refuzata.

## 7. Restanțe vechi, doar din consolă (dinainte de sesiunea asta)

Le las aici ca să nu se piardă; nu s-au mișcat.

- [ ] App Check pe *enforce*.
- [ ] Cotă pe cheia Gemini.
- [ ] Alertă de buget în GCP.

## 8. Limbile (26.08) — ai ce verifica repede

**De ce nu pot eu:** partea de dinainte de login am verificat-o singur, pe viu, în română și în
germană. Ce e după login rămâne punctul orb.

- [ ] Setări → limba ta e tot **Română** (nu s-a resetat).
- [ ] Schimbi limba în Setări și **rămâne** după o reîncărcare completă a paginii.
- [ ] Ecranul de login (deconectat sau în fereastră privată) apare **în română**, nu în engleză.
- [ ] Portofelul, prietenii, chatul, arcade-ul: nu mai vezi engleză amestecată.
- [ ] Antetul rezumatului din chat („Ce s-a mai întâmplat?") apare în limba TA, nu mereu română.

Ce rămâne **intenționat în engleză**: tot `/admin` (e consola ta) și interfața Warlord (decizia ta
veche). Numele limbilor din Setări (English, Français, Deutsch...) rămân în limba lor — asta e ideea.

## 9. Camera si microfonul, dupa anteturile noi (26.08)

**De ce nu pot eu:** am adaugat anteturi de securitate pe live si am verificat in browser ca
politica **permite** camera si microfonul (`document.featurePolicy` spune `true` pentru amandoua).
Dar n-am camera si n-am cont, deci nu pot apasa efectiv butoanele.

- [ ] Portofel -> adaugi un bun -> **Scaneaza codul**: camera porneste normal.
- [ ] Chat de grup -> **mesaj vocal**: microfonul porneste si mesajul se trimite.

Daca vreunul spune ca permisiunea e blocata, spune-mi imediat - se scoate directiva din
`firebase.json` cu un singur deploy.

## 10. Stergerea unui grup s-a SCHIMBAT (26.08) — citeste inainte sa testezi

**De ce nu pot eu:** e in spatele autentificarii si e ireversibila. Nu o incerc pe date reale.

Pana azi, "sterge grupul" nu putea sa se termine niciodata: bucla de pe client stergea evenimentele
unul cate unul si se opria cu eroare la primul care apartinea altui membru — dupa ce o parte din
ale tale erau deja sterse. Acum e un apel server.

**Comportamentul nou, ca sa nu te surprinda:**
- Evenimentele TALE nebifate: se sterg (ca inainte, dar acum chiar functioneaza pana la capat).
- Evenimentele TALE bifate: devin personale.
- Evenimentele ALTOR MEMBRI: **NU se mai sterg** — devin personale, la ei. Nu erai indreptatit
  sa le stergi, iar incercarea era chiar ce rupea fluxul.
- Chatul grupului se sterge si el (inainte ramanea in Firestore, nereachabil si tot platit).

- [ ] **Pe un grup de test, nu pe Family.** Creezi un grup, pui 2-3 evenimente, il stergi.
      Grupul dispare, evenimentele bifate raman ca personale, cele nebifate dispar.
- [ ] Butonul rosu e **dezactivat** cat timp lista de evenimente nu s-a incarcat.
- [ ] Textul modalului e **in romana**, tot (era in engleza pana azi, inclusiv randul care spune
      ce se sterge definitiv).
- [ ] Daca apare o eroare, trimite-mi textul — acum ajunge si in `/admin` → erori.

## 11. Restul lucrurilor din 26.08

- [ ] **Bara "A aparut o versiune mai noua"** poate sa apara jos, in mijloc, cand tii un tab
      deschis peste un deploy. Are **Reincarca** si **Nu acum**. Nu reincarca singura niciodata.
      Daca apare cand NU am livrat nimic, spune-mi — ala ar fi un fals pozitiv si e exact ce am
      incercat sa fac imposibil.
- [ ] **Login-ul in romana** (l-am verificat singur, dar uita-te si tu): deconectat sau in
      fereastra privata.
- [ ] Mesaje de eroare mai precise la autentificare: incearca sa te inregistrezi cu adresa ta
      existenta — trebuie sa scrie "Adresa asta are deja cont", nu un mesaj generic.
- [ ] **Prieteni**: lista si cererile arata normal; nimic rosu.

## 12. Restul auditului (26.08) — ce s-a schimbat in comportament

**De ce nu pot eu:** tot ce e dupa login.

**O schimbare pe care e bine s-o stii inainte s-o intalnesti:** „da un bun altcuiva" (Portofel →
editezi un bun → Transfera) trecea printr-o scriere directa de pe client. Acum trece prin server,
care cere ca **tu si destinatarul sa fiti in acelasi grup** — verificarea pe care aplicatia o facea
deja pe ramura „pastreaza o copie" si o sarea pe cealalta. Daca incerci sa transferi catre cineva
cu care NU imparti un grup, va fi refuzat acum, unde inainte mergea.

- [ ] Transferi un bun catre un membru din grupul tau: functioneaza, iar bunul dispare de la tine
      si apare la el.
- [ ] **Evenimente care se repeta:** deschizi o ocurenta si bifezi sarcina / adaugi un responsabil
      / bifezi un element din lista. Pana azi **nu se intampla nimic** (tacut). Acum trebuie sa
      functioneze — si ocurenta aia devine „desprinsa" din serie, ca atunci cand o editezi.
- [ ] Butoanele de stergere a unei serii (din eveniment si din panoul Recurente) duc treaba la
      capat, fara sa lase ocurente orfane.
- [ ] Rezumatul AI din chat: daca au fost peste 50 de mesaje in 48h, apare o linie mica sub el care
      spune ca acopera doar cele mai recente.
- [ ] `/log`: daca apare avertismentul „sunt listate doar primele 200 de intrari", spune-mi.
- [ ] Ferestrele de confirmare (sterge eveniment, sterge bun, sterge mesaj, sterge categorie) sunt
      **in romana**. Erau toate in engleza.
- [ ] Arcade: jocurile de azi si clasamentul; nimic rosu.

## 13. Tema personalizata (06.09) — cere ochi pe ecran, e in spatele autentificarii

**De ce nu pot eu:** Setari cere cont. Am verificat in browser doar ecranul de login (tema implicita,
neschimbata: card `rgb(24,24,27)`, eticheta `rgb(212,212,216)`, contrast 11,99).

Pana azi, clasa care intoarce culoarea textului era decisa de un COMUTATOR, iar fundalul de un
selector liber de culoare — fara nicio legatura intre ele. „Modul intunecat pornit + fundalul meu
deschis" dadea text deschis pe pagina deschisa: **1,01–1,46 la strat mic (invizibil)**, si tot doar
3,62 la stratul implicit de 50%. Acum decide fundalul, nu comutatorul.

Ca sa ajungi la sectiune: **Setari → oprești modul intunecat global**, apoi apare „Tema avansata".

- [ ] Tema ta actuala arata **exact ca inainte**. Asta e verificarea cea mai importanta — reparatia
      n-are voie sa schimbe o tema deja coerenta.
- [ ] Pornesti „Elemente UI intunecate" si alegi un fundal **alb**: textul trebuie sa devina
      **inchis** (lizibil), si apare o linie care spune de ce: „Fundalul tau e deschis, deci textul
      e afisat inchis".
- [ ] Invers: comutatorul pe deschis + fundal **negru** → text deschis, cu nota corespunzatoare.
- [ ] Alegi un **gri mediu** (ex. #7f7f7f) cu stratul pe 0: apare avertismentul rosu cu raportul
      masurat, fiindca acolo chiar nicio culoare de text nu trece — nu e o scapare, e limita reala.
- [ ] Sliderul de strat, de la 0 la 100: nimic nu devine ilizibil pe drum.
- [ ] Textele noi sunt **in romana**.

Daca ceva arata altfel decat inainte pe tema TA, spune-mi ce combinatie ai — aia ar fi o regresie,
si testul care ar fi trebuit s-o prinda e `themeContrast.test.ts` → „a coherent theme is left alone".

## 14. Inca 32 de siruri englezesti, traduse (06.09) — toate in spatele autentificarii

**De ce nu pot eu:** fisa de eveniment, chatul si portofelul cer cont.

Afirmasem pe 26.08 ca nu mai e engleza nicaieri. **Era gresit** — scanerul meu se uita pe o
singura linie, iar forma obisnuita aici se intinde pe trei (iconita, cuvintele, tagul de inchidere).
Erau 32, si nu ascunse: butoanele de pe fisa de eveniment si etichetele din chat.

- [ ] **Fisa unui eveniment** (deschide un eveniment): `Începe sarcina`, `Finalizează`, `Termină`,
      `Finalizat`, `În desfășurare`, `Notițe`, `Listă de făcut`, `Șterge evenimentul`,
      `Confirmare — vii?` cu `Particip` / `Poate`.
- [ ] **La editarea unui eveniment care se repeta:** `Doar evenimentul ăsta` / `Toate evenimentele
      din serie`.
- [ ] **Chat:** titlul `Chat de grup · <nume>`, `Mesajul a fost șters`, `Fixat`, `Răspunzi lui`.
- [ ] **Portofel:** tabul `Portofel`, `Alege o încărcare anterioară`, si textul de sub codul de
      bare („Arată codul la scaner...").
- [ ] **Arcade:** butonul `Deschide în Warlord`.

Ramane in engleza, intentionat: `Admin` in bara de sus (acelasi cuvant in toate cele sase limbi),
tot `/admin`, si interfata Warlord.

## 15. Auditul 2 (06.09) — patru reparatii, si trei lucruri care sunt ALE TALE

**De ce nu pot eu:** tot ce urmeaza e in spatele autentificarii sau pe telefon.

### De verificat (reparate azi)

- [ ] **Locatia si mementoul unui eveniment.** Pana azi se pierdeau LA SALVARE — le scriai, apasai
      Salveaza, si dispareau. Adauga un eveniment cu locatie si cu un memento; redeschide-l:
      locatia trebuie sa fie acolo, iar notificarea sa porneasca la timp.
      *(Pe telefon mementoul tot nu porneste — vezi mai jos, e alta cauza.)*
- [ ] **Deconectare → alt cont pe acelasi dispozitiv.** Tema, POZA de fundal, sunetul si haptica
      trebuie sa reporneasca de la valorile implicite. **Limba ramane** — e intentionat, ca ecranul
      de login sa fie in limba ta.
- [ ] **Scanerul de coduri de bare:** deschide-l si inchide-l repede, cat inca porneste camera.
      Ledul camerei trebuie sa se stinga. Inainte ramanea aprins pana reincarcai pagina.
- [ ] **Stergerea unui cont din admin** (pe un cont de TEST): raportul trebuie sa numere acum si
      `expenses` si `notifications`. Inainte cheltuielile ramaneau, iar soldurile grupului aratau
      gresit pentru toti ceilalti, permanent.

### Decizii care sunt ale tale

- [ ] **PvP-ul nu e autoritar pe CONSECINTE.** Serverul stabileste cine a castigat, dar armata e
      scrisa doar de browserul celui care pierde. Deci: o infrangere nu costa nimic daca nu deschizi
      ecranul de rezultat · aceiasi soldati pot fi mizati in mai multe batalii simultan · pe al
      doilea dispozitiv pierderile se aplica de doua ori. **Reparatia evidenta scurge informatie**
      (i-ar arata adversarului cate unitati ai angajat inainte sa se angajeze el), deci vreau sa
      alegi tu forma inainte s-o construiesc.
- [ ] **Android: mementourile nu pornesc deloc pe telefon.** `@capacitor/local-notifications` nu e
      in build. Cere `npx cap sync android` + reconstruire + un telefon pe care sa verifici.
- [ ] **Android 15 (targetSdk 35):** edge-to-edge e pornit si nimic nu rezerva barele de sus/jos.

---

## Ce am verificat eu, ca să nu le mai faci

Măsurate, nu presupuse — le scriu ca să știi unde **nu** trebuie să te uiți:

- Contrast pe tot UI-ul Warlord, ambele teme, desktop și 375px: zero eșecuri, cel mai slab raport
  4,72. Auditul precedent folosise pragul greșit (3:1 e pentru text mare; corpul cere 4,5:1).
- Bucla rezervor → unitate → rezervor în Warlord: 2410 XP la ieșire, 2410 la întoarcere, pierdere 0.
- Plafonul de 24 de cohorte la desfășurare, pe viu: 27 de cohorte → 3 butoane dezactivate cu motivul
  lângă ele; trei legiuni × 12 → a treia refuzată la buton.
- Migrarea unui save Warlord de forma veche: 1210 / 1200 / 999, niciun `NaN`, schema rescrisă.
- `/wallet`: cheltuieli per grup, soldurile `+350 / −350` corecte, personalele excluse din solduri.
- Fiecare deploy: chunk-ul de pe live comparat **byte cu byte** cu ce am construit local.
- Login-ul în română și în germană, pe viu, cu diacritice corecte; cele șase dicționare au aceleași
  chei, fără duplicate și fără blocuri scrise în ASCII (test, nu ochiul meu).
- Antetele de cache de pe live, pe 7 rute: rutele reale sunt `no-cache`, assets-urile `immutable`,
  toate cele 54 de fișiere din `/assets` au hash de conținut în nume. Măsurat pe canal de preview
  înainte de a atinge live-ul.
- Anteturile de securitate pe canal de preview: camera si microfonul PERMISE (verificat cu
  `document.featurePolicy` in browser), geolocatia refuzata, zero violari CSP.
- Cele 46 de constatari ale auditului au trecut fiecare printr-o pasa de RESPINGERE inainte sa le
  ating; 3 au fost doborate acolo. Reparatiile distructive au test propriu care musca.
- Ca noul callable `deleteGroupCascade` chiar exista pe live (`firebase functions:list`) — deploy-ul
  raportase succes fara sa-l contina.
- Zero siruri englezesti ramase in afara adminului si a ecranelor Warlord (re-scanat), si zero
  `alert(`/`confirm(` cu text literal acolo.
- Toate cele 16 commit-uri de azi verzi in CI; fiecare deploy verificat pe live.
- Tema implicita, in browser: clasa `dark` aplicata, card zinc-900, eticheta zinc-300, contrast 11,99.
- Matricea de teme: 100 de combinatii (5 fundaluri x 10 trepte de strat x 2 pozitii de comutator) —
  in fiecare, culoarea de text aleasa e cea MAI BUNA dintre cele doua, niciodata cea mai proasta.
- Ca nu mai exista NICIUN sir englezesc literal in ecranele obisnuite — dar de data asta cu un test
  in suita (`i18nCoverage.test.ts`), nu cu un grep de-o data, fiindca exact aia m-a facut sa afirm
  gresit pe 26.08.
- Al doilea audit: 13 agenti, 6 lentile, 52 de constatari trecute prin respingere. Cele patru fara
  ambiguitate sunt reparate si au garzi care musca; restul de 48 sunt in DEVLOG, ordonate.
---

## 16. Portofelul: partajarea chiar functioneaza acum (14.09)

**De ce nu pot eu:** e in spatele autentificarii, si jumatate din ea cere **doua conturi**.

### Primul lucru, inainte de orice altceva

- [ ] **Deschide portofelul si uita-te daca bunurile tale sunt acolo.**
      *Actualizare, cateva ore mai tarziu:* regula **e probata acum** — 20 de teste pe motorul
      real de reguli, prin emulator (`npm run test:rules`), inclusiv „proprietarul isi citeste
      activele exact ca inainte". Deci asta a devenit o confirmare, nu o alarma. Daca totusi lista
      e goala, **spune-mi** — se revine la regula veche in treizeci de secunde.

### Apoi

- [ ] **Un bun marcat „Shared" inainte arata acum `N-a fost partajat de fapt`**, cu bulina
      chihlimbarie. Nu e o regresie: comutatorul acela n-a fost niciodata legat de nimic, deci
      nimeni nu vazuse vreodata acele bunuri. Alege un grup din selector ca sa-l partajezi cu
      adevarat.
- [ ] **Partajeaza un bun cu un grup** si verifica de pe **al doilea cont**, din grup, ca apare in
      portofelul lui, cu eticheta `De la <numele tau>` — si ca **imaginea si codul de bare chiar se
      vad**, nu doar numele.
- [ ] **Pe contul celalalt, bunul tau nu trebuie sa se poata edita sau sterge.** Fara butoane de
      creion si cos, iar clicul pe card nu deschide editarea.
- [ ] **Scoate contul din grup** (sau iesi tu) si verifica faptul ca bunul **dispare imediat** din
      portofelul lui. Asta e tot motivul pentru care partajarea numeste un grup si nu o lista de
      oameni.
- [ ] **Cand compui un eveniment pentru un grup**, selectorul de card din eveniment trebuie sa
      arate si cardurile pe care grupul le-a partajat cu tine, nu doar pe ale tale.
- [ ] **Selectorul de partajare in toate cele sase limbi** — eticheta, optiunea „Privat" si textul
      de pe card.
---

## 17. Invitatii prin link (14.09) — WhatsApp, mail, SMS, QR

**De ce nu pot eu:** cere doua telefoane, doua conturi si aplicatii instalate.

### Inainte de orice
- [ ] **Butonul vechi „Share invite" a disparut.** Nu e o pierdere: compunea un text englezesc
      care spunea „inscrie-te si accepta invitatia" **fara sa creeze vreo invitatie**. Cine il
      primea se inscria si nu gasea nimic.

### De verificat
- [ ] **Creeaza un link** dintr-un grup, si trimite-l pe **WhatsApp**. Pe telefon, butonul
      `Distribuie…` trebuie sa deschida foaia sistemului cu toate aplicatiile instalate.
- [ ] **Deschide linkul pe un telefon unde NU esti conectat.** Trebuie sa vada „X te invita in
      Y" **inainte** sa i se ceara cont — asta e tot rostul ecranului.
- [ ] **Fa un cont nou de pe acel link.** Dupa inscriere trebuie sa ajunga **inapoi la invitatie**,
      nu intr-un calendar gol, si sa intre in grup.
- [ ] **Verifica prietenia in AMBELE sensuri:** el trebuie sa apara la tine in Prieteni si tu la
      el. Si trebuie sa primesti o notificare „Invitatie acceptata".
- [ ] **Acelasi lucru pe invitatia veche, pe email** — acum si aia face prietenie.
- [ ] **Retrage un link** si verifica faptul ca deschis din nou spune „Invitatia a fost retrasa".
- [ ] **Foloseste acelasi link de doua ori de pe ACELASI cont** — a doua oara nu trebuie sa
      consume inca o folosire.
- [ ] **Codul QR** scanat cu camera altui telefon duce la ecranul de invitatie.
- [ ] **In toate cele sase limbi** — ecranul de invitatie si sectiunea din modal.

### Ce trebuie sa stii, nu sa verifici
- [x] **DECIS 14.09: un link e bun pentru O SINGURA inregistrare**, si expira in 7 zile.
      Ramane la purtator — cine il are, intra — dar ce se poate da mai departe e un singur loc,
      consumat de primul care ajunge, nu o usa deschisa catre tot grupul de WhatsApp.
      *Consecinta practica:* pentru trei persoane faci trei linkuri. Butonul „Creeaza alt link"
      e chiar sub canalele de trimitere.
---

## 18. Ora pe evenimente si fusul orar (14.09)

**De ce nu pot eu:** calendarul e in spatele autentificarii.

- [ ] **Adauga un eveniment si pune-i o ora.** Câmpul de ora e lânga cel de data. Redeschide-l:
      ora trebuie sa fie acolo.
- [ ] **Iconita de ceas apare acum lânga eveniment** — in grila de calendar si in lista de acasa.
      **N-a aparut niciodata pâna azi:** codul o desena de mult, dar nimic nu scria vreodata o ora.
- [ ] **Lasa ora goala** la alt eveniment — ala e „zi intreaga", exact cum erau toate pâna acum, si
      nu trebuie sa arate niciun ceas.
- [ ] **Setari → Fus orar.** Trebuie sa fie deja pe zona ta, detectata singura. Schimb-o pe
      `Europe/London` si uita-te la un eveniment cu ora: trebuie sa arate ora convertita **si** sa
      spuna zona evenimentului. Pune-o inapoi dupa.
- [ ] **Evenimentele vechi n-au zona** — se afiseaza exact cum au fost scrise, fara conversie. E
      intentionat: a le converti cu o presupunere le-ar muta cu ore.
- [ ] **In toate cele sase limbi**: eticheta de ora si sectiunea de fus orar din Setari.

**Nota:** mementourile **inca nu pornesc**. Asta e felia urmatoare; pâna atunci ora e doar afisata
si stocata corect.
---

## 19. Tabul de chat (14.09)

**De ce nu pot eu:** tot ecranul e in spatele autentificarii, iar jumatate din el cere **doua
conturi**.

- [ ] **Iconita de chat** apare in bara de sus, intre jurnal si portofel. Deschide `/chat`.
- [ ] **Pe desktop:** lista de conversatii in stanga, conversatia in dreapta. Grupurile tale
      trebuie sa fie deja acolo.
- [ ] **Pe telefon:** vezi doar lista; alegi o conversatie si devine ecran intreg; sageata inapoi
      din antetul conversatiei te intoarce la lista.
- [ ] **Conversatie noua** → lista trebuie sa contina prietenii tai **si** oamenii din grupurile
      tale, si **sa nu** contina pe cineva cu care ai deja o conversatie. Alege pe cineva: se
      deschide direct conversatia.
- [ ] **Scrie-i ceva de pe al doilea cont.** Trebuie sa primesti **si** notificare pe telefon,
      **si** rand in clopotel — in limba ta, nu a expeditorului.
- [ ] **Previzualizarea din lista** arata ultimul mesaj, cu `Tu:` in fata cand e al tau.
- [ ] **Lipeste un screenshot** (Ctrl+V) in casuta de mesaj, si intr-un grup si intr-o conversatie
      privata. Trebuie sa apara ca imagine atasata, nu ca text.
- [ ] **Rezumatul AI (sclipiciul)** apare doar la grupuri, nu la conversatiile in doi.
- [ ] **In toate cele sase limbi.**
---

## 20. Mementourile (14.09) — acum pornesc

**De ce nu pot eu:** cere sa astepti trecerea unui moment real, pe contul tau.

- [ ] **Pune un eveniment peste ~10 minute, cu ora si cu memento la 5 minute.** Trebuie sa
      primesti notificare pe telefon **si** rand in clopotel, la timp, **in limba ta**.
- [ ] **Un eveniment de zi intreaga cu memento** — se trateaza ca si cum ar incepe la **09:00** in
      fusul tau. Spune-mi daca vrei alta ora; e o constanta, se schimba usor.
- [ ] **Un eveniment recurent** trebuie sa aminteasca la FIECARE ocurenta, nu o singura data.
- [ ] **Nu trebuie sa primesti acelasi memento de doua ori.** Daca se intampla, spune-mi —
      inseamna ca dedublarea n-a prins, si vreau sa stiu.
- [ ] **Nu mai exista memento local pe telefon.** Am sters codul care incerca; n-a functionat
      niciodata. Daca vezi DOUA notificari pentru acelasi eveniment, aia e important.

**Limita declarata:** un memento pus cu mai mult de **31 de zile** inainte nu se trimite. Daca ai
nevoie de mai mult, se ridica — dar costa o cautare mai larga la fiecare rulare.
