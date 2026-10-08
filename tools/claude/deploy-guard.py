#!/usr/bin/env python
"""Cere confirmare înainte de orice comandă care poate scrie pe un proiect Firebase LIVE.

Regula lui Andrei (15.08.2026): publicarea liberă, fără confirmare, e doar pe instanța de TEST; tot ce ajunge pe un
proiect LIVE se confirmă întâi. Hook `PreToolUse` pe `Bash|PowerShell`, în setările de UTILIZATOR (`~/.claude/
settings.json`), ca să ruleze oricare ar fi directorul în care pornește sesiunea.

Rescris de două ori pe 08.10.2026. Prima rescriere desfăcea comanda după forme cunoscute; o vânătoare adversarială a
găsit 121 de comenzi care publicau pe live și treceau, fiindcă orice formă necunoscută trecea (`A; if ($?) { npm run
deploy }`, `timeout 900 npm run deploy`, `bash scripts/ship.sh`, `node -r dotenv/config x.mjs`, un `'` neînchis…).
De aceea, acum, logica e inversată:

1. **Detectarea e pe cuvinte, nu pe forme.** Comanda se extinde cu tot ce poate porni: corpul scripturilor npm (orice
   cuvânt care e numele unui script, când apare un lansator npm / pnpm / yarn / bun / run-s / concurrently…, cu pre /
   post), fișierele numite (`.sh`, `.ps1`, `.bat`, `.js`, `.ts`, `.py`…, cu importurile relative ale codului), recursiv.
   Riscul există dacă undeva apare CLI-ul Firebase (`firebase`, `firebase-tools`) și undeva o scriere (`deploy`, o
   comandă Firebase care nu e pe lista de citiri, `firebase-tools` folosit ca bibliotecă).
2. **Trecerea cere dovadă pozitivă.** O comandă riscantă trece doar dacă FIECARE pomenire a CLI-ului e o invocare pe
   care o pot citi complet și care țintește explicit un proiect de test: `--project test` (aliasul din `.firebaserc`-ul
   proiectului, cu id-ul nenumit de niciun alias live din Apps), `--site` / ținta unui `hosting:clone` tot de test, fără
   `--config`, fără argumente trimise mai departe (`npm run x -- -Plive`). Altfel, cere.

Greșeala e împinsă spre a întreba: un fals pozitiv costă o tastă, un fals negativ publică pe un site live.
Rulează testele după orice schimbare: `python .claude/hooks/test_deploy_guard.py` (din Apps).
"""
import glob
import io
import json
import os
import re
import sys
import tempfile
import time

APPS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

# ── vocabularul ──

# CLI-ul: `firebase`, `firebase-tools`, `firebase-tools@14`, `firebase.cmd`, `…/firebase.js`. Nu `.firebaserc`,
# `firebase.json`, `firebase-admin`, `firebase-functions`.
FB = re.compile(r'(?<![A-Za-z0-9_])firebase(?:-tools)?(?:@[\w.^~-]+)?(?:\.(?:cmd|ps1|js|exe))?(?![\w.-])', re.IGNORECASE)
DEPLOY = re.compile(r'(?<![\w-])deploy(?![\w-])', re.IGNORECASE)
COMANDA_FB = re.compile(
    r'(?<![\w/.-])((?:hosting|firestore|functions|database|auth|remoteconfig|ext|extensions|storage|apphosting|'
    r'dataconnect|appdistribution|crashlytics|appcheck|apps|projects|emulators|target|experiments)(?::[A-Za-z][\w-]*)+)',
    re.IGNORECASE,
)
# Comenzile Firebase care doar citesc (sau scriu doar local). Orice altă comandă Firebase e tratată ca scriere.
CITIRI = {
    'hosting:channel:list', 'hosting:channel:open', 'hosting:sites:list', 'hosting:sites:get',
    'functions:log', 'functions:list', 'functions:secrets:access', 'functions:secrets:get', 'functions:config:get',
    'firestore:indexes', 'firestore:databases:list', 'firestore:databases:get', 'firestore:locations',
    'projects:list', 'apps:list', 'apps:sdkconfig', 'emulators:start', 'emulators:exec', 'emulators:export',
    'database:get', 'database:instances:list', 'database:profile', 'remoteconfig:get', 'remoteconfig:versions:list',
    'ext:list', 'ext:info', 'auth:export', 'appdistribution:testers:list', 'target', 'target:apply', 'target:clear',
}
SUBCOMENZI_CITIRE = CITIRI | {'help', 'login', 'logout', 'login:list', 'login:use', 'use', 'init', 'open', 'serve', 'setup:emulators:firestore'}
API_FIREBASE_TOOLS = re.compile(r'''(?:require\s*\(\s*|from\s+|import\s*\(\s*|import\s+)['"`]firebase-tools['"`]''')

ALIASURI_TEST = {'test', 'staging', 'dev'}
ALIASURI_LIVE = {'live', 'default', 'prod', 'production'}

# Lansatorii de scripturi din package.json.
LANSATORI = {'npm', 'pnpm', 'yarn', 'bun', 'bunx', 'corepack', 'run-s', 'run-p', 'npm-run-all', 'concurrently', 'nr',
             'turbo', 'lerna', 'nx', 'wireit'}
# Unde poate ajunge un `cd` / `--prefix`.
FLAGURI_DIRECTOR = {'cd', 'set-location', 'sl', 'pushd', 'push-location', 'chdir', '--prefix', '-c', '--cwd', '--dir',
                    '-workingdirectory', '--workspace', '-w'}
EXT_SHELL = {'.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd'}
EXT_COD = {'.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx'}
EXT_PY = {'.py'}
# Programele care doar afișează sau caută: textul lor nu e o invocare (un `grep "firebase deploy"` nu publică nimic).
VIZUALIZATOARE = {'grep', 'rg', 'findstr', 'select-string', 'sls', 'cat', 'type', 'get-content', 'gc', 'head', 'tail',
                  'wc', 'less', 'more', 'ls', 'dir', 'get-childitem', 'gci', 'sort', 'uniq', 'diff'}
GIT_CITIRE = {'commit', 'log', 'show', 'diff', 'status', 'grep', 'add', 'branch', 'tag', 'rev-parse', 'ls-files', 'blame',
              'restore', 'fetch', 'stash', 'switch', 'checkout'}
# Programele care pot executa text primit pe stdin sau ca argument: când apar, nicio bucată nu mai e scutită.
INTERPRETORI = {'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'iex', 'invoke-expression', 'xargs', 'source', 'eval',
                'node', 'python', 'python3', 'py'}
DATE_HEREDOC = {'git', 'cat', 'tee', 'wc', 'head', 'tail', 'sort', 'grep', 'rg', 'gh'}
# Programele care pornesc programul dat mai departe în aceeași comandă (`sudo -E firebase …`, `nice -n 5 npm …`).
# Nu `xargs`: el adaugă argumente citite de pe stdin, deci invocarea pe care o văd nu e cea care rulează.
INVELISURI = {'env', 'cross-env', 'cross-env-shell', 'dotenv', 'dotenvx', 'env-cmd', 'sudo', 'doas', 'nohup', 'exec',
              'time', 'timeout', 'gtimeout', 'nice', 'ionice', 'stdbuf', 'command', 'builtin', 'call', 'setsid',
              'unbuffer', 'chronic', 'op', 'doppler', 'infisical'}
CUVINTE_DE_CONTROL = {'if', 'then', 'do', 'else', 'elif', '{', '(', '!', 'try', '&'}
# Selectorii de pachet dintr-un monorepo: scriptul rulează din pachet, nu din rădăcină.
SELECTORI_PACHET = {'-w', '--workspace', '--workspaces', '-ws', 'workspace', 'workspaces', '--filter', '-F', '-r',
                    '--recursive'}

NUME_DE_PUBLICARE = re.compile(r'deploy|publi|release|ship|clone|live', re.IGNORECASE)
LIMITA_TEXTE = 120
# Importurile se urmează doar câteva niveluri de la scriptul lansat: dincolo e aplicația, nu un drum spre CLI.
LIMITA_IMPORTURI = 2
LIMITA_ADANCIME = 6
LIMITA_OCTETI = 400_000
# Sub timeout-ul hook-ului (10 s): peste el, Claude Code trece comanda nejudecată.
LIMITA_SECUNDE = 5.0
# Programele cu care începe un șir-comandă din cod (vezi `_e_comanda`).
_PROGRAME_COMANDA_BAZA = {'firebase', 'firebase-tools', 'cd', 'set-location', 'env', 'cross-env', 'timeout', 'git', 'gh'}
# Programele al căror prim argument e un fișier de rulat (căutat și fără extensie).
INTERPRETI_FISIER = {'node', 'tsx', 'ts-node', 'bun', 'deno', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'source',
                     'python', 'python3', 'py', 'cmd', 'call', 'start', 'start-process', 'npx', 'bunx'}

MOTIV = (
    "Comanda poate scrie pe un proiect Firebase LIVE (deploy, hosting:clone, un canal sau un site, sau alta comanda "
    "Firebase care nu doar citeste), direct sau prin scripturi. Confirma tinta inainte. Pe test trece fara intrebare doar "
    "cu tinta numita explicit (--project test) intr-o forma pe care gardianul o poate dovedi."
)


# ── text: curățări ──

def _fara_continuari(text: str) -> str:
    return re.sub(r'`\r?\n', ' ', re.sub(r'\\\r?\n', ' ', text))


def _strivit(text: str) -> str:
    """Fără ghilimele, backslash, caret și backtick: `fire""base de''ploy` devine `firebase deploy`."""
    return re.sub(r'[\'"`\\^]', '', text)


def _cuvinte(text: str) -> list:
    return re.findall(r'[^\s;&|(){}<>,`\'"=]+', text)


def _program(cuvant: str) -> str:
    nume = os.path.basename(cuvant.replace('\\', '/')).lower()
    nume = re.sub(r'@[^/]*$', '', nume)
    return re.sub(r'\.(cmd|exe|ps1|bat|js|mjs|cjs)$', '', nume)


def _bucati(comanda: str) -> list:
    """Bucățile unei comenzi compuse (`&&`, `||`, `;`, `|`, `&`, rând nou). Ghilimelele se respectă doar dacă se închid:
    un `'` neînchis (un apostrof într-un mesaj) nu înghite restul comenzii."""
    def taie(respecta: bool) -> list:
        bucati, curent, ghilimea, i = [], [], None, 0
        while i < len(comanda):
            c = comanda[i]
            if ghilimea:
                curent.append(c)
                if c == ghilimea:
                    ghilimea = None
            elif respecta and c in '"\'':
                ghilimea = c
                curent.append(c)
            elif c in ';|\n\r':
                bucati.append(''.join(curent))
                curent = []
                if c == '|' and comanda[i + 1:i + 2] == '|':
                    i += 1
            elif c == '&':
                if (i > 0 and comanda[i - 1] == '>') or comanda[i + 1:i + 2] == '>':
                    curent.append(c)
                else:
                    bucati.append(''.join(curent))
                    curent = []
                    if comanda[i + 1:i + 2] == '&':
                        i += 1
            else:
                curent.append(c)
            i += 1
        bucati.append(''.join(curent))
        return [b.strip() for b in bucati if b.strip()], ghilimea is not None
    bucati, deschisa = taie(True)
    return taie(False)[0] if deschisa else bucati


SIR_SHELL = re.compile(r'''(?:"[^"]*"|'[^']*'|[^\s"'])+''')


def _jetoane(bucata: str) -> list:
    """Cuvintele unei bucăți, cum le vede shell-ul: `FOO="a b"` rămâne un cuvânt, ghilimelele se scot (`-P"te"st`)."""
    return [re.sub(r'["\']', '', c) for c in SIR_SHELL.findall(bucata)]


def _fara_atribuiri(cuv: list) -> list:
    i = 0
    while i < len(cuv) and (re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', cuv[i]) or cuv[i].lower() in CUVINTE_DE_CONTROL):
        i += 1
    return cuv[i:]


def _invocare(bucata: str) -> list:
    """Programul pe care îl pornește o bucată de comandă, urmat de argumentele lui (gol dacă nu se vede). Sar atribuirile
    (`FOO=1`), cuvintele de control și învelișurile (`sudo -E`, `nice -n 5`, `timeout -s KILL 900`, `dotenv -e .env --`).
    Singura regulă de decojire: o folosesc și dovada, și filtrul de proză, și lansările din cod. Valoarea unei opțiuni
    de înveliș nu e programul, dar un program cunoscut nu e niciodată luat drept valoare."""
    cuv = _fara_atribuiri(_jetoane(bucata))
    while cuv and _program(cuv[0]) in INVELISURI:
        i, valoare = 1, False
        while i < len(cuv):
            c = cuv[i]
            if c == '--':
                i += 1
                break
            if c.startswith('-'):
                valoare = '=' not in c
            elif re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', c) or re.fullmatch(r'\d+(?:\.\d+)?[smhd]?', c):
                valoare = False
            elif _program(c) in PROGRAME_CUNOSCUTE:
                break
            elif valoare:
                valoare = False
            else:
                break
            i += 1
        cuv = _fara_atribuiri(cuv[i:])
    return cuv


def _fara_comentarii_js(s: str) -> str:
    """Comentariile `//` și `/* */` scoase doar în afara șirurilor: un `'http://…'` nu taie restul rândului."""
    out, i, n, q = [], 0, len(s), None
    while i < n:
        c = s[i]
        if q:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(s[i + 1])
                i += 2
                continue
            if c == q or (c == '\n' and q != '`'):
                q = None
            i += 1
            continue
        if c in '\'"`':
            q = c
            out.append(c)
        elif s.startswith('//', i):
            j = s.find('\n', i)
            i = n if j < 0 else j
            continue
        elif s.startswith('/*', i):
            j = s.find('*/', i + 2)
            i = n if j < 0 else j + 2
            out.append(' ')
            continue
        else:
            out.append(c)
        i += 1
    return ''.join(out)


PROGRAME_COMANDA = LANSATORI | INTERPRETI_FISIER | _PROGRAME_COMANDA_BAZA | INVELISURI
PROGRAME_CUNOSCUTE = PROGRAME_COMANDA | INTERPRETORI | VIZUALIZATOARE
FIREBASE = {'firebase', 'firebase-tools'}
SIR_COD = re.compile(r"""'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`""")


def _e_comanda(continut: str) -> bool:
    """Un șir din cod e o posibilă comandă dacă începe (după atribuiri, `FIREBASE_TOKEN=x firebase …`) cu un program
    cunoscut sau un înveliș, ori cu `${…}`, ori conține operatori de shell. Un mesaj („rulează firebase deploy când e
    gata”) nu e. Un înveliș pe care nu-l știu (`xvfb-run firebase deploy`) arată ca un mesaj: limită cunoscută."""
    c = continut.strip()
    if not c:
        return False
    if not re.search(r'\s', c):
        # Un singur cuvânt e un argument (`'deploy'` dintr-o listă), nu un mesaj: rămâne.
        return True
    if c.startswith('${') or re.search(r'&&|\|\||;|\|', c):
        return True
    # Ambele citiri: cea de shell (atribuirile sărite) și cea pe cuvinte (o comandă între ghilimele sau backtick-uri,
    # `"node x.mjs"`, rămâne comandă). Oricare ajunge.
    return any(cuv and _program(cuv[0]) in PROGRAME_COMANDA for cuv in (_fara_atribuiri(_jetoane(c)), _cuvinte(c)))


def _lansare_din_cod(s: str) -> bool:
    """Un șir din cod pornește un script sau CLI-ul dacă una dintre bucățile lui, după atribuiri și învelișuri, începe cu
    un lansator, un interpret sau firebase (`CI=1 npm run x`, `cd sub && npm run x`), ori dacă începe cu un înveliș și
    pomenește unul (`env -S "npm run x"`). Doar pomenirea unui nume de script într-un mesaj nu e o lansare."""
    cuv = _cuvinte(s)
    if cuv and _program(cuv[0]) in LANSATORI | INTERPRETI_FISIER | FIREBASE:
        # Citirea pe cuvinte: o comandă între ghilimele (`"node scripts/x.mjs"`, argumentul lui `emulators:exec`).
        return True
    for b in _bucati(s):
        cuv = _invocare(b)
        if cuv and _program(cuv[0]) in LANSATORI | INTERPRETI_FISIER | FIREBASE:
            return True
        brut = _fara_atribuiri(_jetoane(b))
        if brut and _program(brut[0]) in INVELISURI and {_program(c) for c in _cuvinte(b)} & (LANSATORI | FIREBASE):
            return True
    return False


def _fara_proza(cod: str) -> str:
    """Codul cu șirurile-mesaj golite: pomenirile din ele nu sunt invocări."""
    return SIR_COD.sub(lambda m: m.group(0) if _e_comanda(m.group(0)[1:-1]) else m.group(0)[0] + m.group(0)[0], cod)


def _cale(director: str, cale: str) -> str:
    cale = cale.strip().strip('"\'')
    m = re.match(r'^/([a-zA-Z])(/.*)?$', cale)  # Git Bash: /c/Users/... → C:/Users/...
    if m:
        cale = f'{m.group(1).upper()}:{m.group(2) or "/"}'
    if os.path.isabs(cale) or re.match(r'^[a-zA-Z]:', cale):
        return os.path.normpath(cale)
    return os.path.normpath(os.path.join(director or APPS, cale))


def _citeste(cale: str):
    try:
        if os.path.getsize(cale) > LIMITA_OCTETI:
            return None
        with io.open(cale, encoding='utf-8-sig', errors='replace') as f:
            return f.read()
    except Exception:
        return None


def _json(cale: str):
    try:
        with io.open(cale, encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return None


# ── proiectele: ce e test și ce e live ──

_IDURI = None


def _iduri():
    """Id-urile de test și de live din `.firebaserc`-urile din Apps, pe două niveluri (`Apps/X/` și `Apps/X/Y/`)."""
    global _IDURI
    if _IDURI is not None:
        return _IDURI
    test, live = set(), set()
    radacina = os.path.abspath(APPS)
    def citeste_rc(cale):
        proiecte = ((_json(cale) or {}).get('projects') or {})
        for alias, pid in proiecte.items():
            if isinstance(pid, str):
                if alias.lower() in ALIASURI_TEST:
                    test.add(pid)
                if alias.lower() in ALIASURI_LIVE:
                    live.add(pid)
    try:
        nivel1 = [os.path.join(radacina, x) for x in os.listdir(radacina) if not x.startswith('.')]
    except Exception:
        nivel1 = []
    for d in nivel1:
        if not os.path.isdir(d):
            continue
        cale = os.path.join(d, '.firebaserc')
        if os.path.isfile(cale):
            citeste_rc(cale)
        try:
            for y in os.listdir(d):
                if y.startswith('.') or y in ('node_modules', 'dist', 'build', 'src', 'lib', 'coverage', 'android', 'ios'):
                    continue
                c2 = os.path.join(d, y, '.firebaserc')
                if os.path.isfile(c2):
                    citeste_rc(c2)
        except Exception:
            pass
    _IDURI = (test, live)
    return _IDURI


def _radacina_firebase(director: str) -> str:
    """Directorul proiectului Firebase, cum îl găsește CLI-ul: primul cu `firebase.json`, urcând."""
    d = os.path.abspath(director or APPS)
    for _ in range(15):
        if os.path.isfile(os.path.join(d, 'firebase.json')):
            return d
        p = os.path.dirname(d)
        if p == d:
            break
        d = p
    return os.path.abspath(director or APPS)


def e_proiect_de_test(valoare: str, director: str) -> bool:
    if not valoare or re.search(r'[$%{}`()]', valoare):
        return False
    test, live = _iduri()
    proiecte = ((_json(os.path.join(_radacina_firebase(director), '.firebaserc')) or {}).get('projects') or {})
    pid = proiecte.get(valoare, valoare)
    return isinstance(pid, str) and pid in test and pid not in live


# ── extinderea: tot ce poate porni comanda ──

class Text:
    def __init__(self, fel, text, director, origine, inaintat=False, importuri=0):
        self.fel, self.text, self.director, self.origine, self.inaintat = fel, text, director, origine, inaintat
        self.importuri = importuri


class Extindere:
    """Tot ce poate porni o comandă: scripturile npm numite, fișierele numite, codul lor cu importurile relative și
    comenzile pe care codul le lansează. Cu un buget de timp: Drive-ul rece poate face un `isfile` să dureze zeci de ms,
    iar un hook care trece de timeout e o eroare neblocantă, adică o comandă nejudecată."""

    def __init__(self):
        self.texte = []
        self.vazute = set()
        self.probleme = []
        self.incomplet = False
        self.nevazute = []
        self.termen = time.monotonic() + LIMITA_SECUNDE
        self._fisiere_vazute = {}

    def exista(self, cale: str) -> bool:
        if cale not in self._fisiere_vazute:
            self._fisiere_vazute[cale] = os.path.isfile(cale)
        return self._fisiere_vazute[cale]

    def timp_depasit(self) -> bool:
        if not self.incomplet and time.monotonic() > self.termen:
            self.incomplet = True
            self.probleme.append('extinderea a depășit bugetul de timp, deci n-am văzut tot ce poate porni comanda')
        return self.incomplet

    def adauga(self, fel, text, director, origine, adancime, inaintat=False, importuri=0):
        cheie = (fel, text, os.path.normcase(director or ''))
        # Comanda însăși se judecă mereu; bugetul de timp oprește doar extinderile.
        if cheie in self.vazute or (adancime > 0 and self.timp_depasit()):
            return
        if len(self.texte) >= LIMITA_TEXTE or adancime > LIMITA_ADANCIME:
            self.probleme.append(f'{origine}: prea multe scripturi imbricate ca să le pot judeca')
            return
        self.vazute.add(cheie)
        if fel == 'shell':
            text = _heredoc(_fara_continuari(text))
        t = Text(fel, text, director, origine, inaintat, importuri)
        self.texte.append(t)
        if fel == 'shell':
            self._din_shell(t, adancime)
        elif fel == 'cod':
            self._din_cod(t, adancime)

    def _directoare(self, cuv: list, baza: str) -> list:
        dirs = [baza]
        for i, c in enumerate(cuv):
            if c.lower() in FLAGURI_DIRECTOR and i + 1 < len(cuv):
                v = cuv[i + 2] if cuv[i + 1].lower() == '/d' and i + 2 < len(cuv) else cuv[i + 1]
                for b in list(dirs):
                    p = _cale(b, v)
                    if p not in dirs and os.path.isdir(p):
                        dirs.append(p)
        return dirs

    def _scripturi(self, cuv: list, dirs: list, text: str, origine: str, adancime: int):
        programe = {_program(c) for c in cuv}
        if not (programe & LANSATORI or any(c.startswith(('npm:', 'yarn:', 'pnpm:')) for c in cuv)):
            return
        nume_cerute = {c.split(':', 1)[1] if c.startswith(('npm:', 'yarn:', 'pnpm:')) else c for c in cuv}
        if programe & {'npm', 'pnpm', 'yarn', 'bun'} and nume_cerute & {'install', 'i', 'ci', 'add', 'update'}:
            nume_cerute |= {'preinstall', 'install', 'postinstall', 'prepare'}
        if set(cuv) & SELECTORI_PACHET or programe & {'turbo', 'lerna', 'nx'}:
            # `npm run x -w <nume>` / `yarn workspace <nume> x` / `pnpm --filter <nume> x`: scriptul e al pachetului.
            for d in list(dirs):
                dirs += [p for p in _pachete_monorepo(d, self.exista) if p not in dirs]
        for d in dirs:
            pkg_dir = _package_json(d)
            if not pkg_dir:
                continue
            scripturi = ((_json(os.path.join(pkg_dir, 'package.json')) or {}).get('scripts') or {})
            for nume in sorted(nume_cerute):
                if not isinstance(scripturi.get(nume), str):
                    continue
                inaintat = _argumente_dupa(text, nume)
                for n in (f'pre{nume}', nume, f'post{nume}'):
                    if isinstance(scripturi.get(n), str):
                        self.adauga('shell', scripturi[n], pkg_dir, f'{origine} → npm run {n}', adancime + 1, inaintat)

    def _fisier(self, cale: str, director_shell: str, origine: str, adancime: int, importuri: int = 0):
        fel = _fel(cale)
        text = _citeste(cale) if fel else None
        if text is not None:
            # Un script shell rulează în directorul comenzii; codul își rezolvă importurile față de el însuși.
            self.adauga(fel, text, director_shell if fel == 'shell' else os.path.dirname(cale),
                        f'{origine} → {os.path.basename(cale)}', adancime + 1, importuri=importuri)

    def _din_shell(self, t: Text, adancime: int):
        cuv = _cuvinte(t.text)
        programe = {_program(c) for c in cuv}
        dirs = self._directoare(cuv, t.director)
        self._scripturi(cuv, dirs, t.text, t.origine, adancime)
        variante = bool(programe & INTERPRETI_FISIER)
        for c in cuv:
            if '://' in c:
                continue
            gasite = _fisiere(c, dirs, variante, self.exista)
            for cale in gasite:
                self._fisier(cale, t.director, t.origine, adancime)
            if not gasite and NUME_DE_PUBLICARE.search(os.path.basename(c)) and (
                    os.path.splitext(c)[1].lower() in EXT_SHELL | EXT_COD | EXT_PY or (variante and ('/' in c or '\\' in c))):
                # Un script cu nume de publicare pe care nu-l găsesc de aici (generat înainte, alt director): cere.
                self.nevazute.append(f'{t.origine}: {c} nu se poate citi de aici, iar numele lui sună a publicare')

    def _din_cod(self, t: Text, adancime: int):
        cod = _fara_comentarii_js(t.text)
        # Comenzile lansate din cod: un șir care începe cu un lansator (`execSync('npm run deploy')`), sau un lansator
        # urmat de lista lui de argumente (`spawnSync('npm', ['run', 'deploy'])`). Doar pomenirea unui nume de script
        # într-un mesaj nu e o lansare.
        for m in re.finditer(r"""'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`""", cod):
            s = next(g for g in m.groups() if g is not None)
            if _lansare_din_cod(s):
                self.adauga('shell', s, t.director, f'{t.origine} (comandă din cod)', adancime + 1)
            elif os.path.splitext(s)[1].lower() in EXT_SHELL | EXT_COD | EXT_PY and len(s) < 300:
                for cale in _fisiere(s, [t.director], False, self.exista):
                    self._fisier(cale, t.director, t.origine, adancime)
        for m in re.finditer(r"""\(\s*(['"])([\w.-]+)\1\s*,\s*\[([^\]]*)\]""", cod):
            if _program(m.group(2)) in LANSATORI | INTERPRETI_FISIER:
                elemente = [e.strip()[1:-1] for e in m.group(3).split(',') if re.fullmatch(r"\s*(['\"])[^'\"]*\1\s*", e)]
                self.adauga('shell', ' '.join([m.group(2)] + elemente), t.director, f'{t.origine} (comandă din cod)', adancime + 1)
        if t.importuri >= LIMITA_IMPORTURI:
            return
        for spec in re.findall(r'''(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.{1,2}/[^'"]+)['"]''', cod):
            for cale in _fisiere(spec, [t.director], True, self.exista):
                if _fel(cale) == 'cod':
                    self._fisier(cale, t.director, t.origine, adancime, importuri=t.importuri + 1)


def _package_json(director: str):
    d = os.path.abspath(director)
    for _ in range(12):
        if os.path.isfile(os.path.join(d, 'package.json')):
            return d
        p = os.path.dirname(d)
        if p == d:
            return None
        d = p
    return None


def _pachete_monorepo(director: str, exista) -> list:
    """Pachetele monorepo-ului din care face parte directorul (`workspaces` din package.json, sau pnpm-workspace.yaml).
    Le iau pe toate: un selector se potrivește cu numele, cu calea sau cu un tipar, prea multe feluri ca să-l rezolv."""
    d = os.path.abspath(director)
    for _ in range(12):
        tipare = []
        if exista(os.path.join(d, 'package.json')):
            ws = (_json(os.path.join(d, 'package.json')) or {}).get('workspaces')
            ws = ws.get('packages') if isinstance(ws, dict) else ws
            tipare += [t for t in ws if isinstance(t, str)] if isinstance(ws, list) else []
        if exista(os.path.join(d, 'pnpm-workspace.yaml')):
            yaml = _citeste(os.path.join(d, 'pnpm-workspace.yaml')) or ''
            tipare += re.findall(r'''^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$''', yaml, re.MULTILINE)
        if tipare:
            pachete = []
            for t in tipare:
                if t.startswith('!'):
                    continue
                for p in sorted(glob.glob(os.path.join(d, t.strip().rstrip('/')))):
                    p = os.path.normpath(p)
                    if 'node_modules' not in p.split(os.sep) and p not in pachete and exista(os.path.join(p, 'package.json')):
                        pachete.append(p)
            return pachete[:60]
        parinte = os.path.dirname(d)
        if parinte == d:
            return []
        d = parinte
    return []


def _fel(cale: str):
    ext = os.path.splitext(cale)[1].lower()
    return 'shell' if ext in EXT_SHELL else 'cod' if ext in EXT_COD else 'py' if ext in EXT_PY else None


def _fisiere(cuvant: str, dirs: list, variante: bool, exista) -> list:
    """Fișierele la care trimite un cuvânt. Cu extensie cunoscută: calea așa cum e. Fără extensie, doar când în comandă e
    un interpret (`node scripts/ship`): extensiile pe care le încearcă node, `index.*`, sau `.` (`main` din package.json).
    Nu din node_modules. Puține căi încercate: fiecare `isfile` pe Drive costă."""
    ext = os.path.splitext(cuvant)[1].lower()
    cunoscuta = ext in EXT_SHELL | EXT_COD | EXT_PY
    if not cunoscuta and not (variante and ('/' in cuvant or '\\' in cuvant or cuvant == '.')):
        return []
    gasite = []
    for d in dirs:
        baza = _cale(d, cuvant)
        if 'node_modules' in baza.replace('\\', '/').split('/'):
            continue
        if cuvant == '.':
            main = ((_json(os.path.join(baza, 'package.json')) or {}).get('main'))
            candidati = [os.path.join(baza, main)] if isinstance(main, str) else [os.path.join(baza, 'index.js')]
        elif cunoscuta:
            candidati = [baza]
        else:
            candidati = [baza + e for e in ('.js', '.mjs', '.cjs', '.ts', '.mts', '.sh', '.ps1')] + \
                [os.path.join(baza, f'index{e}') for e in ('.js', '.mjs', '.ts')]
        for c in candidati:
            if c not in gasite and exista(c):
                gasite.append(c)
                break
    return gasite


def _argumente_dupa(text: str, nume: str) -> bool:
    """Argumente după numele scriptului, în aceeași bucată: npm / yarn / pnpm le adaugă la ultima comandă a scriptului
    (`npm run deploy:t -- -Plive` publică pe live)."""
    for bucata in _bucati(text):
        cuv = _cuvinte(bucata)
        if nume in cuv and {_program(c) for c in cuv} & LANSATORI:
            rest = cuv[len(cuv) - 1 - cuv[::-1].index(nume) + 1:]
            rest = [c for c in rest if c not in ('--', 'nul', '/dev/null') and not re.fullmatch(r'\d', c)]
            if rest:
                return True
    return False


def _pleaca_prin_pipe(dupa: str) -> bool:
    """Textul de după `<<` trimite ieșirea, printr-un pipe, spre altceva decât un vizualizator (`| sh`, `| tee x.sh`)."""
    m = re.search(r'(?<!\|)\|(?!\|)', dupa)
    if not m:
        return False
    lant = re.split(r'&&|\|\||;', dupa[m.end():])[0]
    return any(_cuvinte(b) and _program(_cuvinte(b)[0]) not in VIZUALIZATOARE for b in lant.split('|'))


def _scrie_in_fisier(bucata: str) -> bool:
    """Bucata redirectează într-un fișier (`> x.sh`), pe care altă comandă l-ar putea rula. `2>&1` și `>/dev/null` nu."""
    for m in re.finditer(r'>>?\|?\s*(\S*)', bucata):
        if not re.fullmatch(r'&\d*|/dev/null|nul|\$null', m.group(1).strip('"\''), re.IGNORECASE):
            return True
    return False


def _heredoc(text: str) -> str:
    """Corpul unui heredoc dat unui program care doar îl citește ca date (`git commit -F - <<EOF`) nu e o comandă. Rămâne
    comandă dacă pleacă mai departe: printr-un pipe (`cat <<EOF | sh`), într-un fișier (`cat <<EOF > x.sh`, `tee`), sau
    dacă în rest e un interpret care poate rula orice text (`bash -c "$(git log -1 --format=%B)"`)."""
    linii = text.split('\n')
    heredocuri, i = [], 0
    while i < len(linii):
        m = re.search(r'<<-?\s*([\'"]?)([A-Za-z_]\w*)\1', linii[i])
        if m:
            inceput = i
            i += 1
            while i < len(linii) and linii[i].strip() != m.group(2):
                i += 1
            heredocuri.append((inceput, m.start(), i))
        i += 1
    if not heredocuri:
        return text
    corpuri = {j for antet, _, sfarsit in heredocuri for j in range(antet + 1, sfarsit)}
    restul = '\n'.join(l for j, l in enumerate(linii) if j not in corpuri)
    interpret = bool({_program(c) for c in _cuvinte(restul)} & INTERPRETORI)
    aruncate = set()
    for antet, pozitie, sfarsit in heredocuri:
        linie = linii[antet]
        bucata = next((b for b in _bucati(linie) if '<<' in b), linie)
        cuv = _cuvinte(bucata)
        date = (cuv and _program(cuv[0]) in DATE_HEREDOC - {'tee'} and not interpret
                and not _pleaca_prin_pipe(linie[pozitie:]) and not _scrie_in_fisier(bucata))
        if date:
            aruncate |= set(range(antet + 1, sfarsit))
    return '\n'.join(l for j, l in enumerate(linii) if j not in aruncate)


# ── detectarea ──

def _bucati_de_judecat(t: Text) -> list:
    if t.fel != 'shell':
        return [t.text]
    bucati = _bucati(t.text)
    programe = set()
    for b in bucati:
        programe |= {_program(c) for c in _cuvinte(b)}
    if programe & INTERPRETORI:
        return bucati
    ramase = []
    for b in bucati:
        cuv = [c for c in _cuvinte(b) if c.lower() not in ('if', 'then', '!', 'try', 'do', 'time')]
        if not cuv:
            continue
        p = _program(cuv[0])
        if p in VIZUALIZATOARE:
            continue
        if p == 'git' and len(cuv) > 1 and cuv[1].lower() in GIT_CITIRE and 'alias' not in b and '!' not in b:
            continue
        ramase.append(b)
    return ramase


def _are_fb(text: str) -> bool:
    return bool(FB.search(text) or FB.search(_strivit(text)))


def _scrie(text: str) -> bool:
    for t in (text, _strivit(text)):
        if DEPLOY.search(t) or API_FIREBASE_TOOLS.search(t):
            return True
        if any(c.lower() not in CITIRI for c in COMANDA_FB.findall(t)):
            return True
    return False


# ── dovada: fiecare pomenire a CLI-ului e o invocare de test ──

FLAGURI_CU_VALOARE = {'-p', '--project', '--config', '-c', '--token', '--account', '--only', '--except', '-m',
                      '--message', '--expires', '--site', '-s', '--force-alias'}
FLAGURI_NPX_CU_VALOARE = {'-p', '--package', '-c', '--call'}


def _judeca_argumente(args: list, director: str) -> list:
    """Argumentele unei invocări Firebase (fără programul însuși). Întoarce motivele pentru care nu e dovedită."""
    sub, proiecte, situri, pozitionale, motive, i = None, [], [], [], [], 0
    while i < len(args):
        a = args[i]
        al = a.lower() if a else a
        if a is None:
            if i > 0 and args[i - 1] and args[i - 1].lower() in FLAGURI_CU_VALOARE:
                motive.append('o valoare calculată după un flag')
            elif sub is None:
                sub = '?'
            else:
                pozitionale.append(None)
        elif a in ('-P', '--project') and i + 1 < len(args):
            proiecte.append(args[i + 1])
            i += 1
        elif re.match(r'^(?:--project|-P)=', a):
            proiecte.append(a.split('=', 1)[1])
        elif re.match(r'^-P.+', a):
            proiecte.append(a[2:])
        elif a in ('-s', '--site') and i + 1 < len(args):
            situri.append(args[i + 1])
            i += 1
        elif re.match(r'^(?:--site|-s)=', a):
            situri.append(a.split('=', 1)[1])
        elif al in ('-c', '--config') or al.startswith('--config='):
            motive.append('--config schimbă proiectul de referință')
            i += 1
        elif a == '--':
            # După `--`, nimic nu mai e opțiune: un `--project test` de acolo nu numește proiectul.
            pozitionale.extend(x for x in args[i + 1:])
            break
        elif a.startswith('-'):
            if al in FLAGURI_CU_VALOARE and '=' not in a:
                i += 1
        elif sub is None:
            sub = al
        else:
            pozitionale.append(a)
        i += 1
    if sub is None or sub in SUBCOMENZI_CITIRE or sub == '--version':
        return motive
    if not proiecte and sub != 'hosting:clone':
        motive.append(f'firebase {sub} fără --project (ținta vine tăcut din .firebaserc)')
    elif not all(p is not None and e_proiect_de_test(p, director) for p in proiecte):
        motive.append(f'firebase {sub} --project {"/".join(str(p) for p in proiecte)}: nu e un proiect de test')
    for s in situri:
        if not (s and e_proiect_de_test(s, director)):
            motive.append(f'firebase {sub} --site {s}: nu e un site de test')
    if sub == 'hosting:clone':
        tinta = pozitionale[1] if len(pozitionale) > 1 else None
        if not (tinta and e_proiect_de_test(tinta.split(':')[0], director)):
            motive.append(f'hosting:clone spre {tinta}: nu e un site de test')
    if sub == 'hosting:sites:delete':
        site = pozitionale[0] if pozitionale else None
        if not (site and e_proiect_de_test(site, director)):
            motive.append(f'hosting:sites:delete {site}: nu e un site de test')
    return motive


def _dovada_shell(text: str, director: str, motive: list, adancime: int = 0) -> int:
    """Invocările Firebase dintr-un text shell, în formele clare. Întoarce câte a recunoscut; motivele, în `motive`."""
    if adancime > 4:
        motive.append('prea adânc')
        return 0
    recunoscute = 0
    for bucata in _bucati(text):
        cuv = _invocare(bucata)
        if not cuv:
            continue
        p = _program(cuv[0])
        rest = cuv[1:]
        if p in ('cd', 'set-location', 'sl', 'pushd', 'push-location', 'chdir'):
            tinte = [a for a in rest if not a.startswith('-') and a.lower() != '/d']
            if tinte:
                director = _cale(director, tinte[0])
            continue
        if p in ('bash', 'sh', 'zsh') and rest and re.fullmatch(r'-\w*c', rest[0]) and len(rest) > 1:
            recunoscute += _dovada_shell(rest[1], director, motive, adancime + 1)
            continue
        if p == 'cmd' and rest and rest[0].lower() in ('/c', '/k'):
            recunoscute += _dovada_shell(' '.join(rest[1:]), director, motive, adancime + 1)
            continue
        if p == 'npx':
            i = 0
            while i < len(rest) and rest[i].startswith('-'):
                i += 2 if rest[i].lower() in FLAGURI_NPX_CU_VALOARE and '=' not in rest[i] else 1
            rest = rest[i:]
            if not rest:
                continue
            p, rest = _program(rest[0]), rest[1:]
        if p in ('firebase', 'firebase-tools'):
            recunoscute += 1
            motive.extend(_judeca_argumente(rest, director))
    return recunoscute


APEL_FIREBASE = re.compile(r'''[\w$.]+\s*\(\s*(['"])firebase(?:\.cmd)?\1\s*,\s*\[([^\]]*)\]''')


def _dovada_cod(text: str, director: str, motive: list):
    cod = _fara_proza(_fara_comentarii_js(text))
    if API_FIREBASE_TOOLS.search(cod):
        motive.append('firebase-tools folosit ca bibliotecă')
        return
    total = max(len(FB.findall(cod)), len(FB.findall(_strivit(cod))))
    acoperite = 0
    for m in APEL_FIREBASE.finditer(cod):
        args, bun = [], True
        for e in [e.strip() for e in m.group(2).split(',') if e.strip()]:
            if re.fullmatch(r"'[^'\\]*'|\"[^\"\\]*\"", e):
                args.append(e[1:-1])
            elif re.fullmatch(r'[A-Za-z_$][\w$]*', e):
                args.append(None)
            else:
                bun = False
        if not bun:
            motive.append('apel firebase cu argumente calculate')
            continue
        acoperite += 1
        motive.extend(_judeca_argumente(args, director))
    if acoperite < total:
        motive.append('firebase pomenit în cod în afara unui apel pe care să-l pot dovedi')


def _texte_de_judecat(t: Text) -> list:
    """Ce se judecă dintr-un text: bucățile shell nescutite, codul fără comentarii și fără șirurile-mesaj, scriptul
    Python întreg."""
    if t.fel == 'shell':
        return _bucati_de_judecat(t)
    if t.fel == 'cod':
        return [_fara_proza(_fara_comentarii_js(t.text))]
    return [t.text]


def decide(comanda: str, director: str):
    """('ask', motive) dacă trebuie confirmată, altfel (None, [])."""
    director = director or APPS
    ext = Extindere()
    ext.adauga('shell', comanda or '', director, 'comanda', 0)
    are_fb = scrie = False
    for t in ext.texte:
        for b in _texte_de_judecat(t):
            are_fb = are_fb or _are_fb(b)
            scrie = scrie or _scrie(b)
    if ext.nevazute:
        return 'ask', list(ext.nevazute)
    if not (are_fb and scrie):
        # N-am văzut tot ce poate porni comanda (bugetul de timp): nu pot spune că e sigură.
        return ('ask', list(ext.probleme)) if ext.incomplet else (None, [])
    # Riscant: trece doar dacă fiecare pomenire a CLI-ului e o invocare de test dovedită.
    motive = list(ext.probleme)
    for t in ext.texte:
        bucati = _texte_de_judecat(t)
        if not any(_are_fb(b) for b in bucati):
            continue
        m = []
        if t.fel == 'shell':
            n_fb = sum(max(len(FB.findall(b)), len(FB.findall(_strivit(b)))) for b in bucati)
            if _dovada_shell('\n'.join(bucati), t.director, m) < n_fb:
                m.append('firebase pomenit într-o formă pe care n-o pot dovedi')
        elif t.fel == 'cod':
            _dovada_cod(t.text, t.director, m)
        else:
            m.append('script Python care pomenește firebase')
        if t.inaintat:
            m.append('scriptul primește argumente în plus (pot schimba proiectul)')
        motive.extend(f'{t.origine}: {x}' for x in m)
    return ('ask', motive) if motive else (None, [])


# ── hook-ul ──

def _bataie_de_inima(unealta: str, decizie):
    """Proba că hook-ul chiar rulează (un hook care nu se declanșează e mai rău decât niciunul): ultima rulare, pe disc,
    câte un fișier pe unealtă (citirea lui dintr-o altă unealtă nu-l suprascrie)."""
    try:
        nume = re.sub(r'[^A-Za-z0-9_-]', '', unealta) or 'necunoscut'
        with io.open(os.path.join(tempfile.gettempdir(), f'deploy-guard-heartbeat-{nume}.json'), 'w', encoding='utf-8') as f:
            json.dump({'cand': time.strftime('%Y-%m-%d %H:%M:%S'), 'unealta': unealta, 'decizie': decizie or 'allow'}, f)
    except Exception:
        pass


def main() -> int:
    try:
        # Octeții, decodați UTF-8: consola Windows ar decoda cp1252 și ar strica diacriticele din comandă.
        payload = json.loads(sys.stdin.buffer.read().decode('utf-8', errors='replace'))
    except Exception:
        # Fără intrare citibilă, hook-ul nu blochează toate comenzile: decid regulile obișnuite de permisiuni.
        return 0
    comanda = (payload.get('tool_input') or {}).get('command') or ''
    try:
        decizie, motive = decide(comanda, payload.get('cwd') or os.getcwd())
    except Exception as e:
        # Un hook care cade e o eroare neblocantă, deci comanda ar trece nejudecată. Pe o comandă care pomenește
        # firebase / deploy / hosting, cere; pe restul, tace.
        if re.search(r'firebase|deploy|hosting', comanda, re.IGNORECASE):
            decizie, motive = 'ask', [f'gardianul a dat de o eroare ({type(e).__name__}) și cere, ca nimic să nu treacă nejudecat']
        else:
            decizie, motive = None, []
    _bataie_de_inima(payload.get('tool_name') or '?', decizie)
    if decizie:
        # Doar ASCII (`\uXXXX` pentru diacritice): cu ieșirea în cp1252, un `ă` scris direct arunca, hook-ul ieșea cu 1,
        # iar Claude Code tratează o eroare de hook ca neblocantă, deci comanda live ar fi trecut fără întrebare.
        iesire = json.dumps({
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'ask',
                'permissionDecisionReason': MOTIV + ' Vazut: ' + '; '.join(motive[:3]),
            }
        }, ensure_ascii=True)
        sys.stdout.buffer.write(iesire.encode('ascii') + b'\n')
        sys.stdout.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
