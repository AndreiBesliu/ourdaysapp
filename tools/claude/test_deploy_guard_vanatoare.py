"""Cazurile vânătorii adversariale din 08.10.2026: 161 de comenzi, dintre care 121 publicau pe live și treceau de
prima rescriere a gardianului. Rulare: `python .claude/hooks/test_deploy_guard_vanatoare.py` (din Apps).

`True` = trebuie să ceară. Câteva așteptări diferă de lista originală, cu motivul scris lângă rând. Nimic nu se execută:
testele doar apelează `decide()`.
"""
import importlib.util
import io
import os
import tempfile
import unittest

AICI = os.path.dirname(os.path.abspath(__file__))
APPS_REAL = os.path.normpath(os.path.join(AICI, '..', '..'))
spec = importlib.util.spec_from_file_location('deploy_guard', os.path.join(AICI, 'deploy-guard.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

APPS = APPS_REAL
CNCVS = os.path.join(APPS, 'CNCVectorStudio')
CNCVS2 = os.path.join(APPS, 'cncvs2')
DR = os.path.join(APPS, 'DataRead')
PR = os.path.join(APPS, 'PrestoConstruct')
OD = os.path.join(APPS, 'OurDaysApp')
ODF = os.path.join(OD, 'functions')

REALE = [
    # --- shell structure / grouping hides the program ---
    ('if-then', 'if npm run build:site; then npm run deploy; fi', DR, True),
    ('for-do', 'for i in 1; do npm run deploy:functions; done', PR, True),
    ('subshell', '( npm run deploy )', DR, True),
    ('subshell-cd', '(cd DataRead && npm run deploy)', APPS, True),
    ('brace', '{ npm run deploy; }', DR, True),
    ('dollar-paren', 'echo $(npm run deploy)', DR, True),
    ('backticks', 'echo `npm run deploy`', DR, True),
    ('bang', '! npm run deploy', DR, True),
    ('ps-if', 'if ($true) { npm run deploy }', DR, True),
    ('ps-try', 'try { npm run deploy:functions } catch { }', PR, True),
    ('ps-scriptblock', '& { npm run deploy }', DR, True),
    ('ps-dot-scriptblock', '. { npm run deploy }', DR, True),
    # --- wrappers not in the strip list ---
    ('timeout', 'timeout 900 npm run deploy', DR, True),
    ('cross-env', 'cross-env NODE_ENV=production npm run deploy', DR, True),
    ('npx-cross-env', 'npx cross-env CI=1 npm run deploy:functions', PR, True),
    ('nice', 'nice -n 10 npm run deploy', DR, True),
    ('winpty', 'winpty npm.cmd run deploy', DR, True),
    ('xargs', 'echo deploy | xargs npm run', DR, True),
    ('env-S', 'env -S "npm run deploy"', DR, True),
    ('bash-lc', 'bash -lc "cd DataRead && npm run deploy"', APPS, True),
    ('bash-ec', "bash -ec 'npm run deploy'", DR, True),
    ('sh-xc', "sh -xc 'npm run deploy:functions'", PR, True),
    ('powershell-noflag', 'powershell "npm run deploy"', DR, True),
    ('powershell-bare', 'powershell -NoProfile npm run deploy', DR, True),
    # Scriptul nu există de aici, dar numele sună a publicare: cere (poate fi generat înainte, în aceeași comandă).
    ('pwsh-file', 'pwsh -File .\\deploy.ps1', DR, True),
    ('iex', 'iex "npm run deploy"', DR, True),
    ('Invoke-Expression', 'Invoke-Expression "npm run deploy:functions"', PR, True),
    ('Start-Process', 'Start-Process npm -ArgumentList "run","deploy" -Wait -NoNewWindow', DR, True),
    ('cmd-start', 'cmd /c start /wait npm run deploy', DR, True),
    ('start', 'start npm run deploy', DR, True),
    ('corepack', 'corepack npm run deploy', DR, True),
    ('bun-run', 'bun run deploy', DR, True),
    ('npx-run-s', 'npx run-s deploy', DR, True),
    ('npx-npm-run-all', 'npx npm-run-all deploy', DR, True),
    ('npx-concurrently', 'npx concurrently "npm:deploy"', DR, True),
    # --- npm argument parsing ---
    ('npm-run-prefix-after-run', 'npm run --prefix DataRead deploy', APPS, True),
    ('npm-run-prefix-after-run-2', 'npm run --prefix PrestoConstruct deploy:functions', APPS, True),
    ('npm-run-ws', 'npm run -w functions deploy', OD, True),
    ('npm-exec-c', 'npm exec -c "firebase deploy"', OD, True),
    ('npm-x-c', "npm x -c 'firebase deploy --only hosting'", OD, True),
    ('npm-exec-package-space', 'npm exec --package firebase-tools -- firebase deploy', OD, True),
    ('npm-exec-p', 'npm exec -p firebase-tools firebase deploy', OD, True),
    ('npm-exec-package-eq', 'npm exec --package=firebase-tools -- firebase deploy', OD, True),
    ('yarn-bin', 'yarn firebase deploy', OD, True),
    ('pnpm-dlx-package', 'pnpm dlx --package firebase-tools firebase deploy', OD, True),
    # --- node invocation forms ---
    ('node-eval-eq', "node --eval=\"require('child_process').execFileSync('firebase',['deploy'],{stdio:'inherit'})\"", OD, True),
    ('node-e-cd-chain', "node -e \"require('child_process').execSync('cd . && firebase deploy',{stdio:'inherit'})\"", OD, True),
    ('node-e-npm-run', "node -e \"require('child_process').execSync('npm run deploy',{stdio:'inherit'})\"", DR, True),
    ('node-e-npx-p', "node -e \"require('child_process').execSync('npx -p firebase-tools firebase deploy')\"", OD, True),
    ('node-e-ternary', "node -e \"const c=process.platform==='win32'?'firebase.cmd':'firebase';require('child_process').spawnSync(c,['deploy'],{shell:true})\"", OD, True),
    ('node-e-const', "node -e \"const FB='firebase';require('child_process').execFileSync(FB,['deploy'],{shell:true})\"", OD, True),
    ('node-e-api-clone', "node -e \"require('firebase-tools').hosting.clone('cncvectorstudio-test:a','cncvectorstudio:live')\"", CNCVS, True),
    ('node-e-api-disable', "node -e \"require('firebase-tools').hosting.disable({project:'live',force:true})\"", DR, True),
    ('node-npmroot-unquoted', 'node $(npm root -g)/firebase-tools/lib/bin/firebase.js deploy --only hosting', OD, True),
    ('node-r-dotenv', 'node -r dotenv/config scripts/deploy-live.mjs', DR, True),
    ('node-import-tsx', 'node --import tsx scripts/deploy.ts', DR, True),
    ('node-stdin', 'node < scripts/deploy.mjs', DR, True),
    ('npx-tsx', 'npx tsx scripts/deploy.ts', DR, True),
    # --- firebase CLI argument semantics ---
    ('P-combo-override', 'firebase deploy --project test -Pcncvectorstudio --only hosting', CNCVS, True),
    ('P-combo-override-2', 'firebase -P test deploy -Pcncvectorstudio', CNCVS, True),
    ('disable-site-live', 'firebase hosting:disable --project test --site cncvectorstudio -f', CNCVS, True),
    ('disable-s-live', 'firebase hosting:disable -P test -s cncvectorstudio --force', CNCVS, True),
    ('chdel-site-live', 'firebase hosting:channel:delete pr-1 --project test --site cncvectorstudio --force', CNCVS, True),
    ('continuation-2nd-project', 'firebase deploy --project test \\\n  -Pcncvectorstudio', CNCVS, True),
    ('ps-backtick-2nd-project', 'firebase deploy --project test `\n  -Pcncvectorstudio', CNCVS, True),
    ('dashdash', 'firebase deploy -- --project test', CNCVS, True),  # CLI errors "Too many arguments"; info only
    # --- other live-writing subcommands not in SCRIU ---
    ('firestore-delete', 'firebase firestore:delete --all-collections --project live --force', DR, True),
    ('functions-delete', 'firebase functions:delete api --project live --force', DR, True),
    ('secrets-set', 'firebase functions:secrets:set STRIPE_KEY --project live', PR, True),
    ('database-remove', 'firebase database:remove / --project live --force', OD, True),
    ('auth-import', 'firebase auth:import users.json --project live', OD, True),
    ('channel-create', 'firebase hosting:channel:create pr-9 --project live', DR, True),
    ('remoteconfig-rollback', 'firebase remoteconfig:rollback -v 3 --project live --force', OD, True),
    ('ext-install', 'firebase ext:install firebase/delete-user-data --project live', OD, True),
    # --- quoting / obfuscation of the literal words ---
    ('split-quotes-word', 'fire""base deploy --only hosting', OD, True),
    ('split-quotes-sub', "firebase de''ploy --only hosting", OD, True),
    ('backslash-word', 'fire\\base deploy', OD, True),
    ('escaped-apostrophe', "echo can\\'t wait && npm run deploy", DR, True),
    ('comment-apostrophe', "# don't forget the build\nnpm run deploy", DR, True),
    ('heredoc-apostrophe', "cat > NOTE.txt <<'EOF'\nit's done\nEOF\nnpm run deploy:functions", PR, True),
    ('ps-backtick-apostrophe', "Write-Host can`'t; npm run deploy", DR, True),
    ('escaped-dquote', 'echo \\" ; npm run deploy ; echo \\"', DR, True),
    # --- git ---
    ('git-alias', 'git -c alias.d="!firebase deploy --only hosting" d', OD, True),
    # --- functions/ subfolder ---
    ('functions-npm-deploy', 'npm run deploy', ODF, True),
    ('functions-npm-deploy-project', 'npm run deploy -- --project live', ODF, True),
    # --- controls that should already ask ---
    ('ctrl-npx-c', 'npx -c "firebase deploy"', OD, True),
    ('ctrl-iex-fb', 'iex "firebase deploy"', OD, True),
    ('ctrl-startproc-fb', "Start-Process firebase -ArgumentList 'deploy'", OD, True),
    ('ctrl-bunx', 'bunx firebase-tools deploy', OD, True),
    ('ctrl-yarn-dlx', 'yarn dlx firebase-tools deploy', OD, True),
    ('ctrl-pnpm-dlx', 'pnpm dlx firebase-tools deploy', OD, True),
    ('ctrl-abs-path', '/c/Users/dev/AppData/Roaming/npm/firebase deploy', OD, True),
    ('ctrl-amp-quoted', "& 'C:\\Users\\dev\\AppData\\Roaming\\npm\\firebase.cmd' deploy", OD, True),
    ('ctrl-use-live-then-test', 'firebase use live && firebase deploy --project test', CNCVS, False),
    ('ctrl-upper', 'FIREBASE DEPLOY', OD, True),
    ('ctrl-project-eq', 'firebase deploy --project=cncvectorstudio', CNCVS, True),
    ('ctrl-clone-reverse', 'firebase hosting:clone cncvectorstudio:live cncvectorstudio-test:x', CNCVS, False),
    ('ctrl-npm-exec-dd', 'npm exec -- firebase deploy', OD, True),
    ('ctrl-cd-chain', 'cd ../PrestoConstruct && npm run deploy', DR, True),
    ('ctrl-node-dollar-quoted', 'node "$(npm root -g)/firebase-tools/lib/bin/firebase.js" deploy', OD, True),
    ('ctrl-node-pe', "node -pe \"require('child_process').execSync('firebase deploy')\"", OD, True),
    # --- daily-work false-positive candidates ---
    ('fp-grep', 'grep -rn "firebase deploy" docs/', CNCVS, False),
    ('fp-rg-deploy', 'rg "deploy" firebase.json', CNCVS, False),
    ('fp-git-log', 'git log --oneline -- firebase.json | head -5 ; echo deploy', CNCVS, False),
    ('fp-cat', 'cat .firebaserc && echo "next: deploy"', CNCVS, False),
    ('fp-continuation-test', 'firebase deploy \\\n  --only hosting \\\n  --project test', CNCVS, False),
    ('fp-heredoc-commit', 'git commit -F - <<\'EOF\'\nfirebase deploy guard: fix\nEOF', CNCVS, False),
    # Lanțul vechi al CNCVectorStudio depășește limita de extindere: nedovedit, deci cere (direcția sigură).
    ('fp-npm-deploy-test', 'npm run deploy:test', CNCVS, True),
    ('fp-gh-run', 'gh workflow view deploy.yml', CNCVS, False),
    ('fp-help', 'firebase help deploy', CNCVS, False),
    ('fp-deploy-dry', 'firebase deploy --only hosting --project test --dry-run', CNCVS, False),
    ('fp-staging-ok', 'firebase deploy --project cncvectorstudio-test', CNCVS2, False),
]


FIS = {
    # A: test-only project with an innocuous script name that targets test
    'A/.firebaserc': '{"projects": {"test": "a-test"}}',
    'A/firebase.json': '{"hosting": {"public": "dist"}}',
    'A/package.json': '{"scripts": {"ship": "firebase deploy --project test"}}',
    # B: test + live (default = live)
    'B/.firebaserc': '{"projects": {"default": "b-prod", "live": "b-prod", "test": "b-test"}}',
    'B/firebase.json': '{"hosting": {"public": "dist"}}',
    'B/.env': 'FOO=1\n',
    'B/package.json': '{"main": "scripts/ship.js", "scripts": {'
                      '"ship": "firebase deploy --only hosting",'
                      '"deploy:t": "firebase deploy --project test",'
                      '"release": "run-s build ship",'
                      '"release2": "npm-run-all build ship",'
                      '"release3": "concurrently \\"npm:ship\\"",'
                      '"build": "echo build",'
                      '"go": "node scripts/ship.mjs",'
                      '"go2": "bash scripts/ship.sh",'
                      '"go3": "tsx scripts/ship.ts"'
                      '}}',
    'B/scripts/ship.mjs': "import { execFileSync } from 'node:child_process';\nexecFileSync('firebase', ['deploy', '--only', 'hosting'], { stdio: 'inherit' });\n",
    'B/scripts/ship.js': "require('node:child_process').execFileSync('firebase', ['deploy'], { stdio: 'inherit' });\n",
    'B/scripts/ship.ts': "import { execFileSync } from 'node:child_process';\nexecFileSync('firebase', ['deploy'], { stdio: 'inherit' });\n",
    'B/scripts/ship.sh': '#!/bin/sh\nfirebase deploy --only hosting\n',
    'B/scripts/ship.ps1': 'firebase deploy --only hosting\n',
    'B/scripts/ship.bat': '@firebase deploy --only hosting\n',
    'B/scripts/ship.py': "import subprocess\nsubprocess.run(['firebase', 'deploy'], shell=True)\n",
    'B/scripts/publica.mjs': (
        "import { execFileSync } from 'node:child_process';\n"
        "const tinta = process.argv[2];\n"
        "const args = tinta === 'test' ? ['deploy', '--project', 'test'] : ['deploy', '--only', 'hosting'];\n"
        "execFileSync('firebase', args, { stdio: 'inherit' });\n"),
    'B/scripts/forward.mjs': (
        "import { execFileSync } from 'node:child_process';\n"
        "execFileSync('firebase', ['deploy', '--project', 'test', ...process.argv.slice(2)], { stdio: 'inherit' });\n"),
    'B/scripts/api.mjs': (
        "import client from 'firebase-tools';\n"
        "await client.deploy({ project: 'b-prod', only: 'hosting', cwd: process.cwd() });\n"),
    'B/scripts/lib/fb.mjs': "import { execFileSync } from 'node:child_process';\nexport function publica() { execFileSync('firebase', ['deploy']); }\n",
    'B/scripts/main.mjs': "import { publica } from './lib/fb.mjs';\npublica();\n",
    # Un `require` fără extensie: îl găsește doar urmărirea importurilor (un șir fără extensie nu e o cale citită).
    'B/scripts/main2.cjs': "const { publica } = require('./lib/fb2');\npublica();\n",
    'B/scripts/lib/fb2.js': "const { execFileSync } = require('node:child_process');\nexports.publica = () => execFileSync('firebase', ['deploy']);\n",
    'B/scripts/npmrun.mjs': "import { execSync } from 'node:child_process';\nexecSync('npm run ship', { stdio: 'inherit' });\n",
    'B/scripts/mixt.mjs': (
        "import { execFileSync } from 'node:child_process';\n"
        "execFileSync('firebase', ['hosting:channel:list', '--project', 'test']);\n"
        "execFileSync('firebase', ['deploy', '--only', 'hosting']);\n"),
    'B/scripts/run.mjs': "import { execSync } from 'node:child_process';\nexecSync(process.argv.slice(2).join(' '), { stdio: 'inherit' });\n",
    # A doua vânătoare: învelișurile din fața programului, într-un șir din cod.
    'B/scripts/token.mjs': "import { execSync } from 'node:child_process';\nexecSync('FIREBASE_TOKEN=xyz firebase deploy --only hosting', { stdio: 'inherit' });\n",
    'B/scripts/ci-npm.mjs': "import { execSync } from 'node:child_process';\nexecSync('CI=1 npm run ship', { stdio: 'inherit' });\n",
    'B/scripts/inv-nice.mjs': "import { execSync } from 'node:child_process';\nexecSync('nice -n 5 firebase deploy --only hosting');\n",
    'B/scripts/inv-sudo.mjs': "import { execSync } from 'node:child_process';\nexecSync('sudo -E -u deployer firebase deploy');\n",
    'B/scripts/inv-dotenv.mjs': "import { execSync } from 'node:child_process';\nexecSync('dotenv -e .env -- npm run ship');\n",
    'B/scripts/inv-necunoscut.mjs': "import { execSync } from 'node:child_process';\nexecSync('xvfb-run firebase deploy');\n",
    'B/scripts/mesaj-ship.mjs': "console.log('Gata. Urmeaza npm run ship, cu confirmare.');\n",
    'B/scripts/inv-env-s.mjs': "import { execSync } from 'node:child_process';\nexecSync('env -S \"npm run ship\"');\n",
    # git rulează GIT_SSH_COMMAND: programul (git) nu e un lansator, deci decide citirea de shell din filtrul de proză.
    'B/scripts/git-ssh.mjs': "import { execSync } from 'node:child_process';\nexecSync('GIT_SSH_COMMAND=\"firebase deploy\" git fetch');\n",
    'B/scripts/subshell.mjs':"import { execSync } from 'node:child_process';\nexecSync('(env FIREBASE_TOKEN=x firebase deploy)');\n",
    # O comandă scrisă între ghilimele în șir (ca argumentul lui `emulators:exec`): o vede doar citirea pe cuvinte.
    'B/scripts/citat.mjs': (
        "import { execSync } from 'node:child_process';\n"
        "const pas = '\"node scripts/ship.mjs\"';\n"
        "execSync('npx concurrently ' + pas);\n"),
    'B/sub/keep.txt': 'x',
    # G: monorepo npm, scriptul de publicare stă într-un pachet selectat după NUME (`-w @acme/deployer`).
    'G/.firebaserc': '{"projects": {"live": "g-prod", "test": "g-test"}}',
    'G/firebase.json': '{"hosting": {"public": "dist"}}',
    'G/package.json': '{"name": "monorepo", "private": true, "workspaces": ["packages/*"], "scripts": {"build": "echo build"}}',
    'G/packages/deployer/package.json': '{"name": "@acme/deployer", "scripts": {"deploy": "firebase deploy --only hosting", "build": "echo build"}}',
    'G/packages/web/package.json': '{"name": "web", "scripts": {"build": "echo web"}}',
    # H: monorepo pnpm (pnpm-workspace.yaml).
    'H/.firebaserc': '{"projects": {"live": "h-prod", "test": "h-test"}}',
    'H/firebase.json': '{"hosting": {"public": "dist"}}',
    'H/package.json': '{"name": "h", "scripts": {}}',
    'H/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    'H/apps/site/package.json': '{"name": "site", "scripts": {"deploy": "firebase deploy --only hosting"}}',
    # C: package.json saved with a UTF-8 BOM (PowerShell 5.1 Out-File / Set-Content -Encoding utf8)
    'C/.firebaserc': '{"projects": {"default": "c-prod", "live": "c-prod"}}',
    'C/firebase.json': '{"hosting": {"public": "dist"}}',
    'C/package.json': '\ufeff{"scripts": {"build": "echo build", "postbuild": "firebase deploy --only hosting"}}',
    # D: alias "test" mapped to the live id; used through --config from A
    'D/.firebaserc': '{"projects": {"live": "d-prod", "test": "d-prod"}}',
    'D/firebase.json': '{"hosting": {"public": "dist"}}',
    # E: stray .firebaserc in a subfolder without firebase.json (like cncvs2/.tmp/publicare)
    'E/.firebaserc': '{"projects": {"live": "e-prod", "test": "e-prod"}}',
    'E/firebase.json': '{"hosting": {"public": "dist"}}',
    'E/sub/.firebaserc': '{"projects": {"test": "b-test"}}',
    # nested project not seen by the one-level glob
    'games/Y/.firebaserc': '{"projects": {"default": "z-comun"}}',
    'F/.firebaserc': '{"projects": {"test": "z-comun"}}',
    'F/firebase.json': '{"hosting": {"public": "dist"}}',
    'games/Y/firebase.json': '{"hosting": {"public": "dist"}}',
}

# Forme de shell și PowerShell care ascundeau programul (prima rescriere le lăsa pe toate să treacă).
FORME = [
    ('npm run build:site; if ($?) { npm run deploy }', DR),
    ('npm run build:site; if ($LASTEXITCODE -eq 0) { npm run deploy:functions }', PR),
    ('npm run build:site && { npm run deploy; }', DR),
    ('npm test || exit 1; npm run deploy', DR),
    ('if ($?) { npm run deploy:live }', CNCVS),
    ('if ($?) { firebase deploy --only hosting }', DR),
    ('Set-Location DataRead; if ($?) { npm run deploy }', APPS),
    ('npm run build:site\nif [ $? -eq 0 ]; then npm run deploy; fi', DR),
    # Ieșirea unui vizualizator dată unui interpret: scutirea vizualizatorilor nu mai ține.
    ('grep -h "firebase deploy --only hosting" NOTES.md | sh', OD),
]

# Limite cunoscute, lăsate intenționat: ofuscare deliberată, nu o formă pe care o scrie cineva din greșeală.
LIMITARI = [
    ('F=fire; ${F}base deploy', OD),
]


class Vanatoare(unittest.TestCase):
    def verifica(self, cazuri):
        gresite = []
        for eticheta, comanda, cwd, cere in cazuri:
            decizie, motive = d.decide(comanda, cwd)
            if (decizie == 'ask') != cere:
                gresite.append(f'{eticheta}: {"trebuia să ceară" if cere else "trebuia să treacă"}: {comanda!r} '
                               f'[{os.path.basename(cwd)}] {motive[:1]}')
        self.assertEqual(gresite, [], '\n' + '\n'.join(gresite))

    def test_proiectele_reale(self):
        d.APPS, d._IDURI = APPS_REAL, None
        self.verifica(REALE)

    def test_forme(self):
        d.APPS, d._IDURI = APPS_REAL, None
        self.verifica([(c, c, w, True) for c, w in FORME])

    def test_limitari_cunoscute(self):
        d.APPS, d._IDURI = APPS_REAL, None
        for comanda, cwd in LIMITARI:
            self.assertIsNone(d.decide(comanda, cwd)[0], f's-a schimbat o limită cunoscută: {comanda}')

    def test_arbore_fixtura(self):
        global R, A, B, C, D, E, F, G, H, BS, ES, GY
        R = tempfile.mkdtemp(prefix='garda-vanatoare-')
        for rel, text in FIS.items():
            cale = os.path.join(R, *rel.split('/'))
            os.makedirs(os.path.dirname(cale), exist_ok=True)
            with io.open(cale, 'w', encoding='utf-8', newline='\n') as f:
                f.write(text)
        A, B, C, D, E, F, G, H = (os.path.join(R, x) for x in 'ABCDEFGH')
        BS, ES, GY = os.path.join(B, 'sub'), os.path.join(E, 'sub'), os.path.join(R, 'games', 'Y')
        vechi = d.APPS
        d.APPS, d._IDURI = R, None
        try:
            self.verifica(construieste_fixtura())
        finally:
            d.APPS, d._IDURI = vechi, None


def construieste_fixtura():
    FIXTURA = [
        # node scripts: the code check aggregates or misses
        ('F-mode-switch', 'node scripts/publica.mjs live', B, True),
        ('F-argv-forward', 'node scripts/forward.mjs -Pb-prod', B, True),
        ('F-argv-forward-2', 'node scripts/forward.mjs --project=b-prod', B, True),
        ('F-esm-api', 'node scripts/api.mjs', B, True),
        ('F-import-helper', 'node scripts/main.mjs', B, True),
        ('F-require-fara-extensie', 'node scripts/main2.cjs', B, True),
        ('F-no-extension', 'node scripts/ship', B, True),
        ('F-node-dot', 'node .', B, True),
        ('F-node-npm-run', 'node scripts/npmrun.mjs', B, True),
        ('F-mixed-calls', 'node scripts/mixt.mjs', B, True),
        ('F-generic-runner', 'node scripts/run.mjs firebase deploy', B, True),
        ('F-r-dotenv', 'node -r dotenv/config scripts/ship.mjs', B, True),
        ('F-env-file-space', 'node --env-file .env scripts/ship.mjs', B, True),
        ('F-import-flag', 'node --import ./scripts/lib/fb.mjs scripts/ship.ts', B, True),
        ('F-tsx', 'npx tsx scripts/ship.ts', B, True),
        ('F-stdin', 'node < scripts/ship.mjs', B, True),
        # npm
        ('F-npm-dashdash-P', 'npm run deploy:t -- -Pb-prod', B, True),
        ('F-npm-dashdash-project', 'npm run deploy:t -- --project b-prod', B, True),
        ('F-run-s', 'npm run release', B, True),
        ('F-npm-run-all', 'npm run release2', B, True),
        ('F-concurrently', 'npm run release3', B, True),
        ('F-prefix-after-name', 'npm run ship --prefix ../B', A, True),
        ('F-subfolder-cwd', 'npm run ship', BS, True),
        ('F-bom-postbuild', 'npm run build', C, True),
        ('F-npm-tsx', 'npm run go3', B, True),
        ('F-npm-bash', 'npm run go2', B, True),
        # shell / PowerShell script files
        ('F-bash-file', 'bash scripts/ship.sh', B, True),
        ('F-sh-file', 'sh scripts/ship.sh', B, True),
        ('F-dot-slash', './scripts/ship.sh', B, True),
        ('F-ps-file', 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\ship.ps1', B, True),
        ('F-ps-call', '& .\\scripts\\ship.ps1', B, True),
        ('F-ps-direct', '.\\scripts\\ship.ps1', B, True),
        ('F-bat', 'cmd /c scripts\\ship.bat', B, True),
        ('F-python', 'python scripts/ship.py', B, True),
        # .firebaserc resolution differs from the CLI
        ('F-config-other-rc', 'firebase deploy --project test --config ../D/firebase.json', A, True),
        ('F-stray-rc-subfolder', 'firebase deploy --project test', ES, True),
        ('F-nested-live-id', 'firebase deploy --project test', F, True),
        # A doua vânătoare (1): învelișurile din fața programului (`VAR=x`, `sudo -E`, `nice -n 5`, `dotenv … --`)
        ('F-cod-atribuire-firebase', 'node scripts/token.mjs', B, True),
        ('F-cod-atribuire-npm', 'node scripts/ci-npm.mjs', B, True),
        ('F-cod-nice', 'node scripts/inv-nice.mjs', B, True),
        ('F-cod-sudo', 'node scripts/inv-sudo.mjs', B, True),
        ('F-cod-dotenv-npm', 'node scripts/inv-dotenv.mjs', B, True),
        ('F-cod-env-S', 'node scripts/inv-env-s.mjs', B, True),
        ('F-cod-subshell', 'node scripts/subshell.mjs', B, True),
        ('F-cod-git-ssh', 'node scripts/git-ssh.mjs', B, True),
        ('F-cod-comanda-citata', 'node scripts/citat.mjs', B, True),
        ('F-shell-sudo-live', 'sudo -E firebase deploy --project b-prod', B, True),
        ('ctrl-shell-sudo-test', 'sudo -E firebase deploy --project test', B, False),
        ('ctrl-shell-timeout-test', 'timeout -s KILL 900 firebase deploy --project test', B, False),
        ('ctrl-shell-sudo-script', 'sudo ./publish firebase deploy --project test', B, True),
        ('ctrl-mesaj-cu-npm-run', 'node scripts/mesaj-ship.mjs', B, False),
        # Limită cunoscută: un înveliș pe care nu-l știu, într-un șir din cod, arată ca un mesaj.
        ('LIMITA-invelis-necunoscut', 'node scripts/inv-necunoscut.mjs', B, False),
        # A doua vânătoare (2): workspace-ul npm / yarn / pnpm selectat după nume
        ('F-ws-nume', 'npm run deploy -w @acme/deployer', G, True),
        ('F-ws-egal', 'npm run deploy --workspace=deployer', G, True),
        ('F-ws-toate', 'npm run deploy --workspaces', G, True),
        ('F-ws-yarn', 'yarn workspace @acme/deployer deploy', G, True),
        ('F-ws-pnpm-filter', 'pnpm --filter site deploy', H, True),
        ('F-ws-pnpm-r', 'pnpm -r run deploy', H, True),
        ('ctrl-ws-fara-selector', 'npm run deploy', G, False),
        ('ctrl-ws-build', 'npm run build -w web', G, False),
        # A doua vânătoare (3): corpul unui heredoc care pleacă spre ceva ce-l poate rula
        ('F-heredoc-pipe-sh', "cat <<'EOF' | sh\nfirebase deploy --only hosting\nEOF", B, True),
        ('F-heredoc-pipe-tee', "cat <<'EOF' | tee x.sh\nfirebase deploy --only hosting\nEOF\n./x.sh", B, True),
        ('ctrl-heredoc-corp-cu-bash', "git commit -F - <<'EOF'\nfirebase deploy --only hosting, din bash | sh\nEOF\ngit push", B, False),
        ('F-heredoc-in-fisier', "cat <<'EOF' > x.sh\nfirebase deploy --only hosting\nEOF\nchmod +x x.sh && ./x.sh", B, True),
        ('F-heredoc-tee', "tee x.sh >/dev/null <<'EOF'\nfirebase deploy --only hosting\nEOF\n./x.sh", B, True),
        ('F-heredoc-interpret-dupa', "git commit -F - <<'EOF'\nfirebase deploy --only hosting\nEOF\nbash -c \"$(git log -1 --format=%B)\"", B, True),
        ('ctrl-heredoc-commit', "git commit -F - <<'EOF'\nfirebase deploy --only hosting\nEOF\ngit push", B, False),
        ('ctrl-heredoc-commit-tail', "git commit -F - <<'EOF' 2>&1 | tail -3\nfirebase deploy --only hosting\nEOF", B, False),
        # controls
        ('ctrl-npm-go', 'npm run go', B, True),
        ('ctrl-node-ship', 'node scripts/ship.mjs', B, True),
        ('ctrl-test-ok', 'firebase deploy --project test', B, False),
        ('ctrl-a-ship', 'npm run ship', A, False),
    ]
    return FIXTURA


if __name__ == '__main__':
    unittest.main(verbosity=1)
