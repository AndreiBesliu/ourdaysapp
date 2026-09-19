# De verificat de Andrei

> **Starea listei, 19.09:** 262 de căsuțe nebifate, 8 bifate, peste o lună de acumulare. Aia nu
> mai e o listă, e o arhivă — și e vina mea: am scris și **fapte** ca și când ar fi sarcini
> (o secțiune numită chiar „Ce trebuie să știi, **nu** să verifici” are 52 de căsuțe).
>
> N-am șters nimic. Am pus în față ce contează, și am reparat două puncte care te trimiteau să
> faci lucruri deja făcute. **De-acum: faptele se scriu ca text, nu ca bife**, iar fiecare punct
> nou spune ce se strică dacă răspunsul e greșit.

---

## Dacă ai zece minute, astea sunt

Toate cele patru sunt măsurate **azi**, pe datele tale reale, nu repetate din memorie.

### 1. Rotează cheia de service account — singura cu miză de securitate

Cheia pe care ai creat-o pe 14.09 ca să pot citi erorile **a tranzitat Google Drive** (tot
`MyWork` e sincronizat). E doar-citire (`Cloud Datastore Viewer`), deci ce poate face cineva cu
ea e să **citească toată baza** — evenimente, chat, portofel, conturi. Nu poate scrie nimic.

- [ ] Șterge cheia veche din
      <https://console.cloud.google.com/iam-admin/serviceaccounts?project=our-days-2a939>
      (contul `claude-error-reader` → **Keys** → șterge-o pe cea existentă), creează alta, și
      pune-o tot la `~/.ourdays/service-account.json`. Durează un minut și închide subiectul.

### 2. Push-ul: merge acum pentru 2 din 8 conturi

**Corectat azi.** Punctul 30 de mai jos îți spunea să pui cheia VAPID — e deja pusă și
înregistrarea funcționează. Măsurat acum: **două conturi au token** (unul are șapte, adică mai
multe dispozitive), șase n-au niciunul.

- [ ] **Cele șase n-au nevoie de nicio cheie — doar să se reconecteze o dată** și să accepte
      notificările când le cere browserul. Spune-le, sau spune-mi când au făcut-o și confirm
      din date.
- [ ] **Tu** ai token: pune-ți un memento peste zece minute și vezi dacă sună telefonul. Dacă nu
      sună, ăsta e un bug real și vreau să știu — restul lanțului n-a fost probat niciodată
      cap-coadă pe un telefon adevărat.

### 3. Cardul pus pe un eveniment de grup (livrat ieri)

- [ ] Pune un card din portofel pe un eveniment de grup, salvează, și **întreabă pe cineva din
      grup dacă vede codul de bare**. Până ieri nu-l vedea nimeni în afară de tine: poza stă pe
      eveniment și se vede, codul stă pe card și nu se vedea.
- [ ] Apoi uită-te la card în portofel: trebuie să scrie **„Partajat cu «Grup»”**. Dacă nu
      scrie, ceva s-a lărgit fără să se vadă și vreau să știu imediat.

### 4. Două fișiere orfane în bucket (3,34 MB)

Sunt urma bug-ului de încărcare reparat ieri: unul e un card, unul o poză din chat, și niciun
document nu le arată. **Nu le-am șters** — cheia mea e doar-citire, și oricum e o ștergere pe
producție.

- [ ] Spune-mi dacă le vrei curățate și îți dau exact căile.

---

## Întrebări care te așteaptă (nu sunt verificări)

Niciuna nu e urgentă; niciuna nu se mișcă fără tine.

1. **PvP pe o singură linie** — `PVP_MAX_COMBATANTS` e exact lățimea tablei, deci al doilea rând
   nu intră niciodată în luptă. Se repară cu un rând în plus sau cu un plafon mai mic, dar ambele
   schimbă cum se simte jocul.
2. **Membrii noi și evenimentele vechi** — rezolvat pe 18.09 în favoarea „văd tot”. Dacă
   vreodată vrei invers, se schimbă într-un loc.
3. **App Check** — neaplicat. Înseamnă că cineva cu id-ul proiectului poate vorbi cu baza din
   afara aplicației. De pornit când ai chef de un sfert de oră de verificat că nu rupe nimic.

*Calibrarea Warlord rămâne amânată de tine — nu o ridic.*

---

## Restul, de la 1 la 31

O lună de puncte, de la 26.08 încoace, în ordinea în care au apărut. Nu sunt urgente și nu se
strică nimic dacă nu ajungi la ele — dar dacă deschizi ecranul respectiv oricum, aruncă un ochi.
**Dacă un punct ți se pare deja făcut, probabil chiar e**; spune-mi și îl verific din date.

---

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
---

## 21. Ziua pe ore (14.09)

- [ ] **Sub calendar apare grila pe ore** pentru ziua selectata. Schimbi ziua din calendar, se
      schimba si ea.
- [ ] **Un eveniment cu ora** apare in dreptul orei lui. **Doua la aceeasi ora** stau unul langa
      altul, nu unul peste altul — asta e cazul care conteaza.
- [ ] **Evenimentele de zi intreaga** apar intr-o banda deasupra grilei, nu la miezul noptii.
- [ ] **Schimba fusul orar din Setari** pe alt continent: un eveniment cu zona proprie trebuie sa
      se **mute** in grila si sa arate zona lui sub titlu. Pune-l inapoi dupa.
- [ ] **O zi goala** scrie „Nimic programat”, nu o grila goala fara explicatie.
- [ ] **Pe telefon**, grila nu trebuie sa produca derulare pe orizontala.
---

## 22. Erorile grupate in admin (14.09)

Nu pot vedea adminul (e in spatele autentificarii), deci **datele sunt la tine**.

- [ ] **Admin -> Health**: deasupra listei vechi apare o sectiune **„Distinct problems"**, cu un
      numar in stanga fiecarui rand.
- [ ] **Cele ~80 de erori trebuie sa se stranga in cateva randuri**, nu sa ramana ~80. Daca vezi tot
      o lista lunga, gruparea e prea stricta si vreau sa stiu.
- [ ] **Uita-te daca doua randuri par a fi ACEEASI problema.** Daca da, s-au despartit gresit —
      spune-mi textul lor.
- [ ] **Citeste-mi primele 3-5 randuri**: numarul, mesajul, eticheta de context si intervalul de
      date. Cu alea pot spune ce e fiecare si ce se repara.
- [ ] Randul **„Counts cover the newest 500 of N"** apare doar daca log-ul e mai mare de 500. Daca
      apare, spune-mi.
---

## 23. Deschiderea unui eveniment (14.09)

- [ ] **Reincarca tare** (Ctrl+Shift+R) si **deschide un eveniment**. Trebuie sa se deschida modalul,
      nu „Something went wrong". Asta era eroarea raportata; crapa la fiecare deschidere.
- [ ] Deschide si **inchide de cateva ori la rand**, si deschide **alt** eveniment fara sa
      reincarci — acolo se manifesta defectul (acelasi modal, randari succesive).
- [ ] Pe un **eveniment care se repeta**, apasa ceva care scrie (bifa unui element din checklist).
      Butonul care foloseste ref-ul mutat trece prin calea aia.
- [ ] **Admin -> Health**: grupul „Minified React error #310" **nu trebuie sa mai creasca** de acum.
      Numarul vechi ramane — sunt aparitii deja inregistrate.
---

## 24. Erorile ramase (14.09)

- [ ] **Limita de AI.** Cand se atinge cota zilnica Gemini, la „Genereaza checklist" trebuie sa apara
      **„Aplicatia a atins limita de AI pe ziua de azi"**, nu „Checklist-ul nu a putut fi generat".
      Sugestia automata de card ramane tacuta intentionat.
- [ ] **Admin -> Health:** grupul `[GoogleGenerativeAI Error] ... 429` **nu mai trebuie sa creasca**.
      Cel vechi ramane — sunt randuri deja scrise.
- [ ] **Intrebare pentru tine, nu pot decide eu:** `checkForAssetSuggestionsAI` se declanseaza la
      iesirea din campul titlu, la FIECARE element de checklist adaugat, si la iesirea din fiecare
      camp de element — fara amanare, fara dedupe. O lista de 6 lucruri = 7+ apeluri Gemini, iar
      cota gratuita e **20 pe zi pe tot proiectul**. Doua liste consuma ziua. Vrei sa le rarim
      (amanare + fara re-cerere pe acelasi text), sau treci proiectul pe facturare?
- [ ] **Tab vechi:** greu de provocat intentionat. Data viitoare cand tii un tab deschis peste o
      livrare si intri pe /admin, ar trebui sa vezi **„E disponibila o versiune noua" + buton**, nu
      „Ceva n-a mers".
- [ ] **Warlord, neatins (e submodul):** `TraditionPanel.tsx:342`, butonul „copiaza codul" —
      `navigator.clipboard?.writeText(c).then(...)`. Pe un WebView fara clipboard arunca. Spune-mi
      daca vrei sa-l reparam in repo-ul jocului.
---

## 25. Starile erorilor (14.09)

- [ ] **Admin -> Health**: deasupra listei sunt cipuri **Needs attention / New / Seen / Resolved /
      All**, cu numere. Se deschide pe „Needs attention".
- [ ] **Apasa „Resolved"** pe un grup. Dispare din „Needs attention" si apare in „Resolved".
- [ ] **„Reopen"** il aduce inapoi.
- [ ] **Proba care conteaza:** marcheaza ceva rezolvat, apoi provoaca acea eroare din nou. La
      urmatoarea incarcare trebuie sa reapara cu eticheta rosie **`regressed`** si textul „came back
      after being resolved". Daca NU reapare, filigranul e stricat si vreau sa stiu.
- [ ] **„Mark all seen"** apare doar cand sunt cel putin doua grupuri noi vizibile.
- [ ] Daca vezi randul galben „N group(s) were not updated", spune-mi — inseamna ca jurnalul s-a
      rotit intre incarcare si clic.
---

## 26. Cheia de service account, ca sa citesc erorile live (14.09)

**Eu nu pot crea cheia** — cere consola ta autentificata, si nu e ceva ce trebuie sa fac eu.
Andrei alege DOAR CITIRE (14.09), deci rolul de mai jos nu e negociabil in pasii astia.

1. Deschide <https://console.cloud.google.com/iam-admin/serviceaccounts?project=our-days-2a939>
2. **+ CREATE SERVICE ACCOUNT**
   - Name: `claude-error-reader`
   - **Create and continue**
3. La **Grant this service account access**, alege rolul **`Cloud Datastore Viewer`**.
   *Nu* „Editor", *nu* „Cloud Datastore User" — alea dau scriere pe TOATA baza.
   **Continue → Done**
4. Intra in contul nou → tabul **KEYS** → **ADD KEY → Create new key → JSON → CREATE**.
   Browserul descarca un fisier `.json`.
5. Muta fisierul (nu copia) la:
   `C:\Users\besli\.ourdays\service-account.json`
   *(folderul exista deja; e in afara repo-ului intentionat)*
6. Spune-mi si rulez `npm run errors`.

**Ce inseamna:**
- Cheia da **citire pe tot Firestore-ul**, nu doar pe erori — Firestore **nu are roluri pe colectie**.
  Asta e pretul; de asta nu am cerut si scriere.
- **Butonul de oprire:** acelasi tab KEYS → sterge cheia. Din secunda aia nu mai citesc nimic.
- Scriptul **refuza sa porneasca** daca cheia e pusa in interiorul repo-ului.
- Nu tiparesc niciodata uid sau email din jurnal.

- [ ] Dupa ce e gata: confirma ca `npm run errors` imi arata grupurile, si ca stergerea cheii chiar
      opreste accesul.
---

## 27. Butonul „Resolved" (14.09, revizuit)

- [ ] **Admin -> Health.** Sub fiecare grup scrie acum DE CE e sau nu butonul acolo:
      „Fixed in `<commit>` — ce era stricat" plus „Check for yourself: ..." — sau
      „Nobody has recorded a fix for this yet".
- [ ] **Butonul „Resolved" apare doar unde exista o afirmatie care tine.** Daca-l vezi lipsind,
      NU e un bug: inseamna ca nimeni n-a scris ca a reparat lucrul ala.
- [ ] **Citeste „Check for yourself" si verifica tu.** Astea sunt scrise ca sa le poti proba fara
      sa citesti cod. Daca vreuna nu se confirma, spune-mi — afirmatia e gresita.
- [ ] **Grupul React #310 va reaparea ca `new`**, nu ca `seen`. E asteptat: i s-a schimbat amprenta
      (acum pastreaza `#310`, ca sa nu se confunde cu #185), deci starea veche nu-l mai gaseste.
- [ ] Daca vreun grup arata cu rosu „Claimed fixed in `<commit>`, but it has happened since",
      **spune-mi imediat** — inseamna ca o reparatie de-a mea n-a functionat.
---

## 28. Ce am verificat EU din date (14.09) — nu mai e nevoie sa le faci tu

- [x] **§20 Mementourile pornesc.** `reminder_log`: un rand azi 14:02 UTC, zero duplicate. Clopotelul
      are doua randuri `reminder`. Ramane sa confirmi doar **limba** si ca suna **la timp** pe telefon.
- [x] **§17 Un link de invitatie nu poate fi folosit de doua ori.** 1 creat, 1 revendicat, 0 peste.
- [x] **§20 Dedublarea tine.** Zero perechi (eveniment, zi) duplicate.
- [x] **§16 Cele 16 bunuri cu bulina chihlimbarie sunt reale** — au `sharedWithFamily` si niciun grup,
      adica exact bunurile pe care nu le-a vazut nimeni niciodata. Nu e regresie.

### Ce a iesit la iveala si trebuie sa faci tu

- [ ] **Deconecteaza-te si reconecteaza-te o data.** Asta scrie fusul tau orar in cont (pana acum nu
      exista pentru niciun user). Spune-mi cand ai facut-o si confirm din date ca s-a scris.
      **De ce conteaza:** fara el, mementoul unui eveniment de zi intreaga suna la 12:00 in loc de
      09:00.
- [ ] **§16 Partajeaza un bun cu un grup.** Zero bunuri sunt partajate cu adevarat acum, deci toata
      jumatatea aia a portofelului n-a fost inca probata pe date reale.
- [ ] **§19 Porneste o conversatie privata.** Zero exista, deci calea aia n-a fost exercitata deloc.
---

## 29. Butonul „Resolve N fixed" (14.09)

- [ ] **Admin -> Health.** Deasupra listei apare **„Resolve 4 fixed"** (verde). Apasa-l o data.
- [ ] Trebuie sa scrie dedesubt **cate a rezolvat**, si toate patru sa treaca pe `RESOLVED`.
- [ ] **Filtrul „Needs attention" trebuie sa ramana gol** dupa aia. Aia e starea normala.
- [ ] Butonul **dispare** cand nu mai e nimic de aplicat. Nu e un bug.
- [ ] Daca scrie vreodata **„N refused: the recorded fix did not hold"**, spune-mi imediat —
      inseamna ca o reparatie de-a mea a picat si sistemul a refuzat s-o marcheze rezolvata.
---

## 30. Push-ul n-a functionat NICIODATA (14.09) — ai un pas de facut

**Constatat din date pe 14.09:** `fcmTokens` lipsea de pe toate cele 8 conturi. Cheia VAPID din
cod avea 44 de caractere in loc de 87, deci inregistrarea era respinsa de fiecare browser.

> **Re-masurat pe 19.09: cheia e pusa si inregistrarea MERGE.** Doua conturi au token (unul are
> sapte, adica mai multe dispozitive), sase n-au niciunul. Pasii de mai jos cu cheia sunt
> FACUTI — ce lipseste e ca cele sase sa se reconecteze o data. Vezi punctul 2 din capul
> listei.

- [ ] **Firebase Console → Project settings → Cloud Messaging → Web configuration →
      Web Push certificates.** Daca nu exista o pereche de chei, apasa **Generate key pair**.
      Copiaza **cheia publica** (87 de caractere).
- [ ] Pune-o in `.env`, pe randul pregatit:
      `VITE_FIREBASE_VAPID_KEY=<cheia>`
- [ ] Spune-mi, si reconstruiesc + livrez.
- [ ] **Dupa aia, reconecteaza-te o data** si confirm din date ca `users/{uid}.fcmTokens` are in
      sfarsit un token. Abia atunci pune-ti un memento peste 10 minute si asteapta sa sune telefonul.
- [ ] **Pana atunci:** clopotelul din aplicatie functioneaza si a functionat mereu. Doar push-ul pe
      telefon lipsea.
---

## 31. Cele cinci reparatii din audit (14.09)

- [ ] **Eveniment recurent:** deschide o apariție, schimba titlul, **salveaza fara sa atingi**
      alegerea „aceasta / toate". Trebuie sa se schimbe **doar acea apariție**. Inainte rescria
      toata seria.
- [ ] Apoi editeaza **alt** eveniment recurent: alegerea trebuie sa fie iar pe „aceasta", nu sa fi
      ramas pe ce ai ales data trecuta.
- [ ] **Culorile:** pune unui eveniment **portocaliu**, altuia **fucsia**, altuia **roz**. Trebuie
      sa se coloreze. Pana azi cele trei nu produceau nicio culoare, nici pe bulina din selector.
- [ ] **Sunet si vibratii:** daca ai contul facut prin inregistrare (nu Google), schimba-le in
      Setari, iesi si intra din nou. Trebuie sa ramana schimbate.
- [ ] **Chat → Mesaj nou:** alege pe cineva care n-a mai intrat de mult in aplicatie. Trebuie sa se
      deschida conversatia, nu „That person could not be found".
- [ ] **Admin → Health → „AI calls":** sectiune noua, un rand pe apel. Azi ar trebui sa fie goala
      sau cu putine randuri. Cand se atinge cota, apare rosu cu `http-429`.
---

## 32. Seria nu-si mai pierde trecutul (14.09)

- [ ] **Ia un eveniment care se repeta si care a inceput acum ceva timp.** Deschide o apariție
      RECENTA, schimba-i titlul, alege **„toate din serie"**, salveaza.
- [ ] **Aparitiile vechi trebuie sa fie tot acolo.** Inainte dispareau toate cele dinaintea zilei pe
      care o deschisesesi. Asta e proba care conteaza.
- [ ] **Apoi incearca sa MUTI seria:** deschide o apariție, schimba data cu doua zile, „toate din
      serie". Toata seria trebuie sa se mute cu doua zile — inclusiv aparitiile vechi — nu sa
      inceapa de la ziua editata.
- [ ] Daca vezi aparitii care dispar in oricare din cele doua cazuri, **spune-mi imediat**.
---

## 33. Ultimele trei, si o intrebare (14.09)

- [ ] **Memory Match:** castiga o partida. Trebuie sa scrie **„Ai castigat"**, nu numele celuilalt.
      Pana azi castigatorul vedea mereu numele adversarului.
- [ ] **Admin → Overview:** cifra **„Shared"** de la evenimente trebuie sa fie acum ~11, nu 0.
      **„Assets shared"** trebuie sa fie **0**, nu 16 — fiindca chiar nu e niciun bun partajat.
- [ ] **Panoul de evenimente recurente**, pe alta limba decat engleza: numarul de exceptii trebuie
      tradus.

### Intrebare pentru tine, nu pot decide eu

- [ ] **Opt jocuri din arcade sunt abandonate in mijlocul lor si nu pot fi inchise niciodata** —
      butonul „Termina jocul" apare doar intre runde. Vrei sa fie disponibil si **in timpul**
      jocului? Atentie la ce inseamna: poti incheia unilateral un joc in care celalalt e la mutare.
      Alternativa: sa expire singure dupa N zile.
---

## 34. Ferestrele: Escape, Back si focus (15.09)

Am schimbat felul in care se inchid ferestrele in opt locuri. **Nu pot intra in cont**, deci
niciuna n-a fost vazuta de mine in aplicatia reala — am probat hook-ul pe un banc de proba in
browser, nu fiecare fereastra in parte. Astea sunt lucrurile de verificat:

- [ ] **Proba principala, pe desktop:** deschide un eveniment, apasa **Edit**, scrie ceva in titlu,
      apoi **Escape**. Trebuie sa se inchida **doar formularul de editare**, iar detaliile
      evenimentului sa ramana pe ecran. Inainte se inchideau amandoua si pierdeai ce scrisesesi.
- [ ] **Aceeasi proba pe telefon, cu butonul Back.** O apasare = o fereastra inchisa. Doua apasari
      te intorc in calendar. **Nu** trebuie sa iasa din calendar sau sa schimbe pagina.
- [ ] **Defilarea:** cu o fereastra deschisa, incearca sa tragi de fundal. Pagina din spate nu
      trebuie sa se mai miste.
- [ ] **Setarile grupului → redenumeste grupul**, scrie ceva, apasa **Escape**. Trebuie sa anuleze
      **doar redenumirea**, nu sa inchida setarile — si daca redeschizi redenumirea, campul nu
      trebuie sa pastreze textul abandonat.
- [ ] **Titlul ferestrei de stergere/parasire a grupului** trebuie sa fie acum in limba aplicatiei,
      nu „Delete Group" / „Leave Group" in engleza.
- [ ] **Poza ramasa:** deschide un eveniment cu imagine, apasa pe imagine ca sa se faca mare,
      inchide cu Escape, apoi deschide **alt** eveniment. Nu trebuie sa apara poza evenimentului
      dinainte peste el.
- [ ] Oriunde vezi o fereastra care **nu** se mai inchide cum trebuie, sau un ecran care ramane
      blocat si nu mai defileaza, **spune-mi imediat** — asta ar fi semnul ca am gresit undeva.

**Ce NU e facut inca:** din 29 de ferestre gasite in aplicatie, opt trec prin sistemul nou.
Restul (lightbox-uri, selectoare, meniul din portofel, arcade) se comporta ca inainte.
---

## 35. Inca noua ferestre (15.09)

Tot fara sa le pot vedea — sunt in spatele contului. De verificat:

- [ ] **Portofel:** deschide formularul de adaugare asset, completeaza ceva, apoi deschide
      **selectorul de poze vechi** peste el si apasa **Escape**. Trebuie sa se inchida **doar
      selectorul**, iar formularul sa ramana completat. Inainte plecau amandoua.
- [ ] **Portofel → scanner de coduri:** apasa **Escape**. Trebuie sa se inchida. (Pana acum se
      inchidea printr-un noroc; daca nu se mai inchide, spune-mi — e singurul loc unde reparatia
      putea strica ceva ce mergea.)
- [ ] **Portofel → Gestionează filtre:** incepe sa redenumesti o categorie, apasa Escape, apoi
      redeschide. Categoria **nu** trebuie sa fie inca in modul editare cu textul vechi.
- [ ] **Titlul formularului de asset** trebuie sa fie tradus, nu „Add New Asset" / „Edit Asset".
- [ ] **Arcadă:** intra intr-un joc, deschide **Reguli**, apasa **Escape**. Trebuie sa se inchida
      **doar regulile**, nu toata arcada. La fel pentru alegerea temei la Memory Match.
---

## 36. Ultimele cinci ferestre (15.09)

- [ ] **Eveniment cu poza:** deschide evenimentul, apasa pe poza ca sa se faca mare, apoi **Escape**.
      Trebuie sa se inchida **doar poza**, iar evenimentul sa ramana deschis.
- [ ] **Formular de eveniment → alege din portofel:** deschide selectorul de asset peste formular si
      apasa **Escape**. Trebuie sa se inchida **doar selectorul**, iar formularul sa ramana completat.
- [ ] **Calendar:** apasa pe unul din numerele de sus (total / in asteptare / terminate) si inchide
      panoul cu **Escape**.
- [ ] **Chat → conversatie noua:** foaia de alegere trebuie sa se inchida cu Escape si cu Back.
- [ ] **Admin → fisa unui user:** la fel.

**Ce NU s-a schimbat, si e intentionat:** meniul de notificari, meniul mobil, meniul butonului
plutitor, panoul de chat flotant si selectorul de emoji raman cum erau. Sunt meniuri, nu ferestre,
si vor alt fel de tratament.
---

## 37. Butoane cu nume (15.09)

- [ ] **Nimic vizibil nu trebuie sa se fi schimbat.** Daca vezi vreun buton care si-a pierdut
      tooltip-ul sau arata altfel, spune-mi — am adaugat doar etichete, n-am mutat nimic.
- [ ] **Chat:** pregateste un raspuns la un mesaj (Reply), apoi **fara sa trimiti** deschide un
      eveniment si inchide-l cu Escape. Raspunsul pregatit trebuie sa fie **inca acolo**.
      Inainte se anula tacut.
---

## 38. Panoul de erori, reorganizat (15.09)

- [ ] **Deschide Health.** Nu mai trebuie sa scrie „Nothing in this state." la intrare — trebuie sa
      aterizeze pe prima stare care chiar are ceva (acum: **Seen**, cu cea cu VAPID).
- [ ] **Cifra mare** trebuie sa fie acum **5** (probleme), cu „· 98 logged" langa eticheta.
- [ ] **Lista lunga de la baza a disparut.** In locul ei, in fiecare card de problema e
      **„Show occurrences (N of M)"** — apasa si vezi randurile individuale ale ACELEI probleme.
- [ ] Daca apesi pe o stare goala, trebuie sa-ti spuna cate probleme sunt in total si sa-ti dea un
      buton catre ele.
---

## 39. Gemini 3.8 Flash (15.09)

- [ ] **Incearca fiecare din cele cinci functii AI** si confirma ca raspund:
      sugestia automata de checklist la crearea unui eveniment · butonul de generare checklist ·
      categoria sugerata a evenimentului · rezumatul de grup din chat · sugestia de asset.
      Daca vreuna da eroare, spune-mi imediat — SDK-ul e nou, iar astea sunt caile reale.
- [ ] **Admin → Health → AI calls:** dupa cateva apeluri, randurile trebuie sa scrie
      `gemini-3.8-flash` si sa aiba un cost **diferit de zero**. Un cost 0 ar insemna ca citirea
      jetoanelor nu potriveste forma noua — exact ce am reparat, deci merita privit.
- [ ] Erorile de cota **nu** trebuie sa mai apara in Health. Cheia e pe plan platit acum.

### Ramane decizia ta de ieri, si conteaza mai mult acum

`checkForAssetSuggestionsAI` porneste la fiecare element de checklist adaugat si la fiecare iesire
din camp, fara temporizare: o lista de 6 elemente = 7+ apeluri. Pe flash-lite era ieftin. Pe 3.8
Flash costa de ~9 ori mai mult per apel. **Vrei sa pun o temporizare?**
---

## 40. Temporizarea sugestiilor (15.09)

- [ ] **Fa o lista de cumparaturi cu 5-6 elemente** intr-un eveniment nou. Sugestia de asset trebuie
      sa apara in continuare — doar ca dupa o scurta pauza, nu instant.
- [ ] **Iesi si intra in acelasi element de checklist fara sa-l modifici.** NU trebuie sa se mai
      trimita nimic — inainte, fiecare astfel de iesire era un apel AI platit.
- [ ] **Admin → Health → AI calls**, dupa ce completezi lista: numarul de randuri `asset` trebuie sa
      fie aproximativ **cate elemente distincte ai scris + 1**, nu dublu.
- [ ] Daca sugestia nu mai apare deloc, spune-mi — inseamna ca am strans prea mult.
---

## 41. Predarea intre ferestre (15.09)

- [ ] **Recurente -> Edit -> Back o data** (pe telefon, butonul Back). Trebuie sa se inchida
      *doar* editorul si sa ramai in calendar. Inainte te scotea din calendar.
- [ ] **Atinge o zi in calendar, apoi un eveniment din lista zilei.** Detaliile trebuie sa se
      deschida *instant* — am scos o intarziere de 50 ms de acolo. Daca vezi vreo clipire sau
      ceva deschis peste altceva, spune-mi.
- [ ] **Inchide o fereastra singura cu X, deschide alta, apasa Back o data.** Trebuie sa se
      inchida din prima. Inainte, prima apasare nu facea nimic.
---

## 42. Push-ul, pasul tau (15.09)

Cheia VAPID e pe live. Mai lipseste un singur lucru si e la tine:

- [ ] **Pe fiecare telefon** (al tau si al celorlalti din grup): deschide aplicatia o data,
      **reincarca fortat** ca sa prinda bundle-ul nou, si accepta cererea de permisiune pentru
      notificari cand apare.
- [ ] **Admin -> Health:** rândul „Web push is not configured" **nu** trebuie sa mai apara
      cu o data de dupa deploy. Daca apare, spune-mi — inseamna ca telefonul ala a prins bundle-ul
      vechi sau ca ceva nu s-a incarcat.
- [ ] **Dupa ce macar un telefon a acceptat:** imi spui, si verific eu ca s-a scris un token pe
      contul respectiv (`users/{uid}.fcmTokens`) — numar, nu continut.
- [ ] **Proba finala:** pune un memento la un eveniment cu 10 minute inainte, si vezi daca
      notificarea ajunge pe ecranul blocat. Asta e prima data cand ar putea.
---

## 43. Notificarile, de testat cu telefonul (15.09)

Cheia e pusa, tokenurile exista, si acum si drumurile sunt deschise. Trei probe, in ordinea asta:

- [ ] **Cu aplicatia DESCHISA, in admin, apasa Send broadcast.** Trebuie sa apara o notificare de
      sistem — desi esti in aplicatie. Asta probeaza doua lucruri deodata: ca broadcast-ul trimite
      push, si ca handler-ul de prim-plan il afiseaza. Mesajul de confirmare trebuie sa scrie acum
      „pushed to N devices", nu doar „sent".
- [ ] **Blocheaza telefonul si roaga pe cineva sa-ti scrie in chat** (sau trimite broadcast de pe
      alt dispozitiv). Trebuie sa apara pe ecranul blocat — ala e drumul de fundal, prin
      `firebase-messaging-sw.js`.
- [ ] **Un memento la un eveniment al tau, telefonul blocat cand vine ora.** E drumul de zi cu zi.
      Daca nu vine, de data asta pot vedea de ce: rulare cu rulare, in jurnal.
- [ ] **Admin -> Health:** tila NOTIFS TODAY trebuie sa arate cel putin numarul de randuri scrise
      azi (opt de la broadcast-ul de dimineata, plus ce mai trimiti).
- [ ] Randul VAPID: eticheta trebuie sa zica acum ca s-a repetat *dupa ce a fost vazut, nu de la
      reparatie*, nu „still happening".
---

## 44. O singura notificare, si atingerea ei (15.09)

Worker-ul e un fisier static; browserul il actualizeaza la urmatoarea deschidere a aplicatiei.
Deci intai **deschide aplicatia o data**, apoi:

- [ ] **Send broadcast** (cu aplicatia in fundal sau telefonul blocat). Trebuie sa apara **o
      singura** notificare, cu icon-ul aplicatiei. Inainte apareau doua.
- [ ] **Atinge notificarea.** Trebuie sa se deschida aplicatia. Inainte nu facea nimic.
- [ ] Acelasi test cu aplicatia **deschisa**: tot una singura.
- [ ] Daca vezi tot doua, spune-mi si zi daca telefonul deschisese aplicatia dupa deploy — daca nu,
      inca ruleaza worker-ul vechi.
---

## 45. Arcade: sesiunile abandonate se inchid singure (16.09)

Ai cerut amandoua: butonul de End (exista deja, si in timpul jocului) **si** inchiderea automata
dupa 24 de ore fara nicio mutare. A doua e noua.

**Ce am masurat pe live inainte** (cu cheia read-only): 18 jocuri in total, **niciunul stampilat**,
si unul parcat intre runde. **Dupa reparatii, prima rulare inchide ZERO** — fiecare joc existent
primeste o zi intreaga de gratie, in care o mutare adevarata il marcheaza ca viu. Ce ramane
neatins se inchide maine.

- [ ] **Primul lucru, si cel mai important:** joaca ceva azi. Maine, acel joc **NU** trebuie sa fie
      inchis. Daca il gasesti inchis desi mutasesi, spune-mi imediat si zi cand.
- [ ] **Jocurile vechi** vor aparea maine ca „Inchis dupa o zi fara miscare". Daca vreunul avea
      runde castigate, numele castigatorului apare dupa text.
- [ ] **Clasamentul** va creste o singura data, cu sesiunile vechi care chiar aveau runde
      castigate. Cele fara castigator nu dau nimic nimanui si nici nu mai apar pe lista. Daca
      cineva sare cu multe victorii deodata, vreau sa stiu.
- [ ] **Un joc facut pentru o data viitoare** (deschizi arcade-ul de pe o zi de saptamana viitoare)
      NU trebuie sa se inchida inainte sa treaca ziua aia.
- [ ] **Batalia Warlord NU se atinge.** Daca vezi una inchisa de ceas, ala e un bug.
- [ ] **Nimic nu se sterge.** O sesiune inchisa isi pastreaza tabla si se poate citi; iar daca era
      un joc la care nu intrase nimeni, tot il poti sterge tu.
- [ ] **O sesiune inchisa nu se mai continua** — nici la Rummy, unde pana acum butonul „Mana
      urmatoare" ramanea acolo. Daca vrei sa se poata redeschide, spune si se face.

### Memory Match: contorul de runde (livrat 16.09, ai zis „adauga contorul")

- [ ] **Joaca doua runde la Memory Match si pierde-o pe a doua intentionat.** Sub punctele
      fiecaruia apare un 🏆 cu numarul de runde castigate. La final, castigatorul sesiunii
      trebuie sa fie cel cu **mai multe runde**, nu cel care a luat ultima.
- [ ] **Prima partida arata exact ca inainte** — 🏆 apare abia dupa ce s-a castigat o runda.
- [ ] **Un joc de Memory Match inceput INAINTE de azi** ramane pe vechea socoteala pana cand
      termina o runda noua. E intentionat: altfel un joc cu doua runde in spate ar fi raportat
      brusc „n-a castigat nimeni".

### Ce trebuie sa faca maturatoarea la noapte (prezis pe datele reale, 16.09)

Am rulat decizia ADEVARATA (modulul compilat) peste baza de date, cu ceasul pus la prima rulare
de dupa pragul de gratie. Deci asta nu e o speranta, e o predictie care se poate INFIRMA:

- **se inchid toate cele 18** — 6 Rummy, 8 X-si-0, 3 Connect 4, 1 Memory Match;
- **doar 3 dintre ele au un castigator de sesiune**, deci clasamentul creste cu exact **3
  victorii** (doua la o persoana, una la alta). Restul de 15 nu dau nimic nimanui.

- [ ] Maine, in Arcade: jocurile vechi apar „Inchis dupa o zi fara miscare".
- [ ] In Leaderboard: **exact 3 victorii in plus**, nu mai multe. Daca sare cineva cu 10, ceva e
      gresit si vreau sa stiu.
- [ ] **Daca joci ceva azi, acel joc NU trebuie sa fie printre cele inchise** — ala e singurul mod
      in care functia asta poate face rau.
---

## 46. Cheltuielile si portofelul, dupa prima lor revizie (16.09)

Zona asta n-avusese niciodata o a doua pereche de ochi. Patru recenzori, **26 de constatari
confirmate**. Ce am reparat si ce te uiti:

- [ ] **Balantele dau zero.** Deschide Wallet → Cheltuieli. Suma coloanelor dintr-un grup trebuie
      sa fie 0. Inainte, daca plecase cineva care platise, nu dadea — si nimeni nu era pe plus.
- [ ] **Cineva care a plecat din grup dar platise** apare acum in lista cu eticheta „a plecat din
      grup" si cu suma pe care o are de primit. Daca vezi pe cineva cu balanta dar fara nume
      („Cineva"), e normal: nu-i mai putem citi profilul.
- [ ] **Un card de fidelitate cu alt format** (nu EAN-13/UPC-A): daca scanezi unul si nu poate fi
      desenat, trebuie sa vezi **numarul mare** plus un rand galben care explica. Nu trebuie sa
      vezi niciodata un cod de bare pentru un card care nu e al lui.
- [ ] **Cardurile tale de acum trebuie sa arate exact la fel.** Toate cele 10 sunt EAN-13 sau
      UPC-A, formate care mergeau corect si inainte — daca vreunul arata altfel, spune-mi imediat.

### Fiecare cheltuiala isi retine participantii (livrat 16.09, ai ales varianta 1)

- [ ] **Inregistreaza o cheltuiala intr-un grup, apoi adauga pe cineva nou in grup.** Cheltuiala
      dinainte trebuie sa ramana impartita la cati erau atunci — omul nou NU trebuie sa apara
      dator pentru ea.
- [ ] **La fel invers:** daca pleaca cineva, datoriile celorlalti pentru cheltuielile vechi NU
      trebuie sa se schimbe.
- [ ] **Cheltuielile de dinainte de azi** raman pe vechea socoteala (se impart la membrii de
      acum). E intentionat: altfel s-ar fi miscat cifre pe care le-ai vazut deja.
- [ ] **Coloanele dau zero** in orice combinatie.

### Selectorul de participanti (livrat 16.09)

- [ ] **Alege un grup la o cheltuiala noua:** sub formular apar membrii ca bulinute, toti bifati.
      Debifeaza pe cineva — cheltuiala trebuie sa se imparta doar la cei ramasi.
- [ ] **Debifeaza-i pe toti:** butonul de adaugare trebuie sa se blocheze si sa scrie „Alege cel
      putin o persoana". NU trebuie sa adauge tacut pe toata lumea.
- [ ] **Schimba grupul:** bifele trebuie sa se reseteze la membrii grupului NOU.
- [ ] **O cheltuiala PERSONALA** (fara grup) nu arata bulinute si trebuie sa se poata adauga
      normal — asta era stricat si l-a prins abia bancul de proba.

### Taburile de grup isi arata doar evenimentele LOR (reparat 16.09, dupa raportul tau)

Ai avut dreptate si era mai rau decat parea: pe datele tale reale, tabul **Gym** iti arata 12
evenimente din care **9 erau ale altui calendar**, Family 9 straine din 13, B&D 7 din 12, iar
**Personal 11 straine din 23**. Doua dintre cele trei ascultatoare de evenimente erau legate de
TINE, nu de tabul deschis.

- [ ] **Deschide Gym, apoi Family, apoi B&D.** Fiecare trebuie sa arate ALT continut. Daca doua
      taburi arata aceeasi grila cu alt antet, reparatia n-a ajuns la tine (reincarca pagina).
- [ ] **Cele doua din capturi** (26 iulie „Cumparaturi” si 5 august „De cumparat”) trebuie sa
      apara **numai** in Family.
- [ ] **Tabul Personal** nu mai trebuie sa arate evenimente de grup. Trebuie sa ramana insa
      **sarcinile pe care ti le-a pus Emilia direct pe calendarul tau** (fara grup) — sunt cinci
      pe live, prin mai. Daca alea au disparut, spune-mi imediat: ala e singurul lucru pe care
      reparatia asta l-ar putea rupe.
- [ ] **Chatul de grup:** deschide chatul in Family, apoi comuta pe Gym si deschide-l iar.
      Trebuie sa fie gol / al lui Gym — nu mesajele si rezumatul AI din Family.
- [ ] **Arcade:** acelasi lucru pentru jocuri si clasament, cand comuti grupul.

### Doua lucruri pe care le-am gasit si NU le-am atins — sunt decizii de-ale tale

- [x] ~~Doi din cei patru membri B&D vad un calendar GOL acolo~~ — **reparat 18.09**, vezi
      sectiunea de mai jos.
- [x] ~~Cand schimbi „calendarul tinta”, persoanele asignate nu se refiltreaza~~ — **reparat**,
      vezi sectiunea de mai jos.

### Mutarea unui eveniment pe alt calendar (reparat 16.09, dupa ce ai zis „da-i drumul”)

- [ ] **Fa un eveniment intr-un grup, bifeaza pe cineva, apoi schimba „calendarul tinta” pe alt
      grup.** Persoana care nu e in grupul nou trebuie sa dispara si din ce se SALVEAZA, nu doar
      de pe ecran. (Inainte ramanea pe eveniment: n-o vedeai, ea nu vedea evenimentul, dar
      primea memento pentru el.)
- [ ] **Cine e in AMANDOUA grupurile trebuie sa ramana bifat** — alegerea ta se pastreaza acolo
      unde poate.
- [ ] **Muta un eveniment de grup pe Personal cu altcineva bifat.** Trebuie sa se salveze normal.
      Inainte **esua** — regulile nu lasa un eveniment fara grup sa numeasca pe altcineva decat
      autorul lui.
- [ ] **Bifele de vizibilitate** trebuie sa se refaca la membrii grupului nou cand schimbi
      calendarul. Daca restrangi vizibilitatea si apoi schimbi grupul, restrangerea se pierde —
      e intentionat, la fel ca la selectorul de participanti de la cheltuieli.

### Membrii care intra mai tarziu vad evenimentele de dinainte (reparat 18.09)

Ai zis „da-i drumul”. Campul nu mai spune cine ARE VOIE sa vada (lista aia imbatranea de
fiecare data cand intra cineva in grup), ci **cine a fost lasat afara dinadins**.

- [x] ~~Intreaba-i pe cei doi din B&D ce vad acum in grupul ala~~ — **confirmat de Andrei,
      18.09.** Grupul nu mai e gol pentru ei. Asta era toata schimbarea, si singurul loc unde
      se vedea pe date reale.
- [ ] **Fa un eveniment nou intr-un grup si nu atinge bifele de vizibilitate.** Toti membrii
      trebuie sa-l vada — inclusiv cineva pe care il adaugi in grup DUPA aceea.
- [ ] **Debifeaza pe cineva la un eveniment nou.** Doar acela nu trebuie sa-l vada. Ceilalti,
      si cei care vin mai tarziu, da.
- [ ] **Deschide un eveniment VECHI si salveaza-l fara sa schimbi nimic.** Bifele pornesc toate
      pe „vede” — intentionat: nicio audienta de pe live nu fusese ingustata vreodata, toate
      erau doar instantaneul de la creare (una numea chiar doi oameni din alt grup).
- [ ] **Editeaza o singura aparitie dintr-o serie care se repeta**, la un eveniment unde ai
      debifat pe cineva. Excluderea trebuie sa ramana. (Aici era capcana: lista alba de pe
      server arunca in tacere orice camp nou.)

**De stiut, ca sa nu te bazezi gresit pe el:** bifa asta nu e o masura de securitate. Nici
vechiul camp, nici cel nou nu apar in regulile bazei de date — orice membru al grupului POATE
citi orice eveniment al grupului daca sapa. Calendarul doar refuza sa-l deseneze.

### Cardul atașat la un eveniment de grup (livrat 18.09)

Până azi, un card din portofel pus pe un eveniment de grup era vizibil doar pentru tine: ceilalți
vedeau poza și nu vedeau codul. Două din două atașamente de pe live erau așa.

- [ ] **Pune un card pe un eveniment de grup și salvează.** Sub poză trebuie să apară, îNAINTE de
      salvare, un rând galben: „Cardul atașat va deveni vizibil pentru «Grup»”. Întreabă pe cineva
      din grup dacă vede codul de bare.
- [ ] **Uită-te apoi la card în portofel:** trebuie să scrie „Partajat cu «Grup»”. Dacă nu scrie,
      ceva s-a lărgit fără să se vadă — spune-mi imediat.
- [ ] **Cele două atașamente vechi** („Listă de cumpărături” și „Shop Mega image”) rămân private
      până le deschizi și apeși **Done**. Autosalvarea NU le partajează, intenționat: o lărgire de
      acces urmează un gest, nu un cronometru.
- [ ] **Un card deja partajat cu ALT grup nu se mută.** Rămâne unde e, și pe ecranul celuilalt
      scrie de ce nu-l vede.
- [ ] **Codul de pe lista de bifat și cel al evenimentului** trebuie să arate la fel ca în
      portofel. Aici era și vechea mapare greșită: un card UPC-E se desena ca Code 128, adică
      **alt număr la casă**. Dacă ai vreun card care nu e EAN-13 sau UPC-A, ala e de încercat.

**Ține minte:** bifa de vizibilitate și partajarea cardului NU sunt măsuri de securitate. Nimic din
ele nu apare în regulile bazei de date pentru evenimente; pentru carduri, regula chiar există, dar
un membru al grupului poate citi cardul partajat oricând, nu doar din evenimentul ăla.

**Găsit și NEreparat** (ți-l las ție): dacă înlocuiești poza unui eveniment care avea un card, pe
document rămâne `assetId`-ul cardului vechi — deci sub poza nouă se poate desena codul vechi. Am
oprit doar partajarea lui; reparația scrierii e separată.

### Cardul dat mai departe (reparat 18.09)

- [ ] **Partajează un card cu un grup** (pune-l pe un eveniment de grup), **apoi dă-l cuiva** din
      portofel. În portofelul lui trebuie să apară **„Privat”**, nu „Partajat”. Dacă scrie
      „Partajat” fără numele unui grup de-al lui, spune-mi — ăla e exact bug-ul.
- [ ] **Cardul trebuie să fie întreg:** nume, poză, cod de bare, categorii. Doar partajarea se
      pierde la transfer.

### Încărcarea pozelor (reparat 18.09)

- [ ] **Adaugă un card cu o poză MARE** (2–10 MB). Butonul trebuie să arate procente — 25%, 60%,
      90% — nu să stea înghețat. Înainte se dădea bătut la 15 secunde fix.
- [ ] **Încearcă cu net oprit** (mod avion după ce apeși Salvează). După ~20 de secunde trebuie
      să scrie că încărcarea s-a oprit și să te lase să reîncerci. Nu mai scrie „Storage might be
      blocked” — aia era o ghiceală.
- [ ] **La fel pentru poza de profil, fundal, poza din chat și mesajul vocal** — toate șapte
      locurile trec acum prin același încărcător.

**De știut:** în bucket sunt **2 fișiere orfane (3,34 MB)** pe care nu le arată niciun document —
unul e un card, unul o poză din chat. Sunt urma bug-ului ăstuia. **Nu le-am șters** (cheia mea e
doar de citire, și oricum e o ștergere pe producție). Dacă vrei curățate, spune-mi și îți dau
exact căile.

### Panoul de erori vede acum și restul (19.09)

Din 143 de blocuri `catch` din aplicație, **49 scriau doar în consola telefonului** și nu
ajungeau niciodată la tine. Acum ajung toate.

- [ ] **Așteaptă-te ca panoul să arate MAI MULTE lucruri**, nu mai puține. Nu s-a stricat nimic —
      se vede ce se întâmpla în tăcere. Dacă apare ceva ce se repetă des, spune-mi și mă uit.
- [ ] **Nu poate inunda:** același mesaj se trimite o dată la 30 de secunde, și cel mult 10 erori
      la 10 secunde, de dinainte.

