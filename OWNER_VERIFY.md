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
