# Unelte pentru sesiunile Claude Code

## `deploy-guard.py` (+ `test_deploy_guard.py`, `test_deploy_guard_vanatoare.py`)

Cere confirmare înainte de orice comandă care poate scrie pe un proiect Firebase **live**: `deploy`, `hosting:clone`
(publică direct pe live), canalele și site-urile, și orice altă comandă Firebase care nu e pe lista de citiri.

**Cum judecă** (rescris pe 08.10.2026, după o vânătoare adversarială care a găsit 121 de ocoliri în prima rescriere;
a doua vânătoare, pe gardianul rescris, a mai găsit 3 forme, închise la punctele 4–6):
1. **Detectarea e pe cuvinte, nu pe forme.** Comanda se extinde cu tot ce poate porni: corpul scripturilor npm (cu
   pre / post, și prin `run-s`, `concurrently`…), fișierele numite (`.sh`, `.ps1`, `.bat`, `.js`, `.ts`, `.py`),
   importurile relative ale codului și comenzile pe care codul le lansează. E riscantă dacă undeva apare CLI-ul Firebase
   și undeva o scriere. Formele de shell (`A; if ($?) { B }`, `timeout 900 …`, `bash -lc`, un `'` neînchis) nu mai
   contează.
2. **Trecerea cere dovadă.** Fiecare pomenire a CLI-ului trebuie să fie o invocare citibilă care țintește explicit un
   proiect de test (`--project test`, `--site` / ținta unui clone de test), fără `--config` și fără argumente trimise
   mai departe (`npm run x -- -Plive`). Altfel, cere.
3. **Buget de 5 s** (Drive-ul rece poate face un `isfile` lent; timeout-ul hook-ului e 10 s): peste el, o comandă care
   pornește ceva cere.
4. **O singură regulă de decojire** (`_invocare`): atribuirile (`FIREBASE_TOKEN=x`), cuvintele de control și
   învelișurile (`sudo -E`, `nice -n 5`, `timeout -s KILL 900`, `dotenv -e .env --`) se sar la fel în dovadă, în
   filtrul de proză și în lansările din cod. A doua vânătoare a găsit că straturile decojeau diferit:
   `execSync('CI=1 npm run deploy')` era luat drept mesaj.
5. **Monorepo:** cu un selector de pachet (`npm run x -w <nume>`, `yarn workspace <nume> x`, `pnpm --filter <nume> x`,
   `-r`, `--workspaces`), se citesc scripturile tuturor pachetelor din `workspaces` / `pnpm-workspace.yaml`.
6. **Heredoc:** corpul dat unui program de date (`git commit -F - <<EOF`) nu e comandă. Devine comandă dacă pleacă
   mai departe: printr-un pipe spre altceva decât un vizualizator (`| sh`, `| tee x.sh`), într-un fișier
   (`> x.sh`, `tee`), sau dacă în restul comenzii e un interpret (`bash -c "$(git log -1 --format=%B)"`).

**Limite cunoscute, lăsate intenționat** (testele le fixează, ca o schimbare să se vadă): ofuscarea deliberată
(`F=fire; ${F}base deploy`) și un înveliș necunoscut într-un șir din cod (`execSync('xvfb-run firebase deploy')`), care
arată exact ca un mesaj. A trata orice șir care pomenește `firebase deploy` drept comandă ar face `npm test` să ceară în
CNCVectorStudio și DataRead: testele lor descriu deploy-ul în mesaje (8 șiruri, măsurat pe 08.10).

Copia canonică e aici. Copia care rulează stă în `Apps/.claude/hooks/`, iar directorul ăla **nu e sub git**, de-aia
există fișierul de față.

**Instalare pe o mașină nouă** (rescrisă pe 08.10.2026):
```bash
cp OurDaysApp/tools/claude/deploy-guard.py OurDaysApp/tools/claude/test_deploy_guard*.py <cale>/Apps/.claude/hooks/
python <cale>/Apps/.claude/hooks/test_deploy_guard.py
python <cale>/Apps/.claude/hooks/test_deploy_guard_vanatoare.py
```
apoi în **`~/.claude/settings.json`** (setările de utilizator, nu cele din `Apps`):
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|PowerShell", "hooks": [
  { "type": "command", "command": "python \"<cale absoluta>/Apps/.claude/hooks/deploy-guard.py\"", "timeout": 10 }
] } ] } }
```

**De ce în setările de utilizator:** setările de proiect se citesc doar din directorul în care pornește sesiunea, fără
părinți. Hook-ul pus în `Apps/.claude/settings.local.json` nu exista pentru o sesiune deschisă direct în `DataRead` sau
`cncvs2`.

**De ce `Bash|PowerShell`:** pe Windows, Claude Code are și unealta PowerShell; un matcher doar „Bash” o lasă nepăzită.

**Proba că rulează:** fiecare rulare scrie `%TEMP%/deploy-guard-heartbeat-<Unealta>.json`. Un hook care nu se
declanșează e mai rău decât niciunul.

**De ce un hook și nu o regulă de permisiuni:** o regulă se potrivește pe PREFIXUL comenzii, iar deploy-urile reale sunt
compuse: `cd X && git commit ... && npx firebase deploy` începe cu `cd` și ar trece nestingherit. Hook-ul citește tot
șirul.

**De ce nu crede cuvântul „test”:** un alias e doar un nume. Dacă cineva pune `"test": "<id-ul live>"` în `.firebaserc`,
un gardian care s-ar lua după cuvânt ar lăsa un deploy live să treacă tăcut. Verifică id-ul din spatele aliasului.

**De ce ieșirea e doar ASCII:** pe consola Windows (cp1252), un `ă` scris direct făcea Python să arunce. Hook-ul ieșea
cu 1, iar Claude Code tratează o eroare de hook ca neblocantă, deci comanda live trecea. Testul de stdin rulează fără
`PYTHONIOENCODING`, ca s-o prindă. Orice eroare internă, pe o comandă care pomenește firebase / deploy / hosting, cere.

**Dacă fișierul lipsește** de pe mașina pe care lucrezi, plasa nu lipsește în tăcere: regula din `CLAUDE.md` spune ce
să faci, adică să ceri confirmarea manual, la fiecare deploy.

`jq` nu e instalat pe mașina lui Andrei, deși toate exemplele de hook-uri din documentația Claude Code îl folosesc.
De-aia e scris în Python.
