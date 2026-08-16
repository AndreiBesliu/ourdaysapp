# Unelte pentru sesiunile Claude Code

## `deploy-guard.py`

Cere confirmare înainte de orice deploy pe o instanță **live**. Copia canonică e aici;
copia care rulează stă în `Apps/.claude/hooks/deploy-guard.py`, iar directorul ăla **nu e
sub git** — de-aia există fișierul de față.

**Instalare pe o mașină nouă:**
```bash
cp OurDaysApp/tools/claude/deploy-guard.py <calea-catre>/Apps/.claude/hooks/deploy-guard.py
```
și în `Apps/.claude/settings.local.json`:
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "python \"<cale absoluta>/Apps/.claude/hooks/deploy-guard.py\"", "timeout": 10 }
] } ] } }
```

**De ce un hook și nu o regulă de permisiuni:** o regulă se potrivește pe PREFIXUL comenzii,
iar deploy-urile reale sunt compuse — `cd X && git commit ... && npx firebase deploy` începe
cu `cd` și ar trece nestingherit. Hook-ul citește tot șirul.

**De ce nu crede cuvântul „test":** un alias e doar un nume. Dacă cineva pune
`"test": "<id-ul live>"` în `.firebaserc`, guard-ul care s-ar fi luat după cuvânt ar fi lăsat
un deploy live să treacă tăcut. Verifică id-ul din spatele aliasului.

**Dacă fișierul lipsește** de pe mașina pe care lucrezi: nu e o plasă absentă în tăcere —
regula din `CLAUDE.md` spune ce să faci, adică să ceri confirmarea manual, la fiecare deploy.

`jq` nu e instalat pe mașina lui Andrei, deși toate exemplele de hook-uri din documentația
Claude Code îl folosesc. De-aia e scris în Python.
