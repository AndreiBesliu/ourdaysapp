"""Tabelul gardianului de deploy: comandă → decizie, pe proiectele reale din Apps.

Rulare:  python .claude/hooks/test_deploy_guard.py      (din Apps)

Fiecare rând „ask” e o cale prin care o comandă ajunge la un proiect live; fiecare rând „allow” e o comandă de zi cu
zi (sau o publicare pe test, numită explicit) pe care gardianul n-are voie s-o încurce. Rândurile marcate GAURA erau
lăsate să treacă de gardianul vechi (16.08) și sunt motivul rescrierii din 08.10.2026.
"""
import importlib.util
import io
import json
import os
import subprocess
import sys
import unittest

AICI = os.path.dirname(os.path.abspath(__file__))
APPS = os.path.normpath(os.path.join(AICI, '..', '..'))
# Căile absolute din tabel se derivă din Apps: copia canonică stă într-un repo public.
APPS_FWD = APPS.replace('\\', '/')
APPS_BASH = '/' + APPS[0].lower() + APPS_FWD[2:]
spec = importlib.util.spec_from_file_location('deploy_guard', os.path.join(AICI, 'deploy-guard.py'))
dg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dg)

CNCVS = os.path.join(APPS, 'CNCVectorStudio')
CNCVS2 = os.path.join(APPS, 'cncvs2')
DATAREAD = os.path.join(APPS, 'DataRead')
PRESTO = os.path.join(APPS, 'PrestoConstruct')
OURDAYS = os.path.join(APPS, 'OurDaysApp')

ASK, ALLOW = 'ask', None

# (comanda, directorul sesiunii, decizia)
CAZURI = [
    # ── deploy, ca înainte ──
    ('firebase deploy', OURDAYS, ASK),
    ('npx firebase deploy --only hosting', OURDAYS, ASK),
    (f'cd "{APPS_FWD}/OurDaysApp" && git commit -q -m x && npx firebase deploy --only hosting', APPS, ASK),
    ('firebase deploy --project live --only hosting', DATAREAD, ASK),
    ('firebase deploy --project test --only hosting', CNCVS, ALLOW),
    ('firebase deploy --project cncvectorstudio-test --only hosting', CNCVS, ALLOW),
    ('firebase deploy --project cncvectorstudio --only hosting', CNCVS, ASK),
    # Aliasul „test” fără proiect de test în spate (DataRead n-are): cere.
    ('firebase deploy --project test', DATAREAD, ASK),
    # ── GAURA: flagurile globale înaintea comenzii ──
    ('firebase --project live deploy --only hosting', DATAREAD, ASK),
    ('firebase -P live deploy', DATAREAD, ASK),
    ('firebase --non-interactive deploy', OURDAYS, ASK),
    ('firebase -P test deploy --only hosting', CNCVS, ALLOW),
    # ── GAURA: alte forme de a porni CLI-ul ──
    ('npx -y firebase-tools@latest deploy --only hosting', OURDAYS, ASK),
    ('npx --yes firebase-tools@14.2.0 deploy', OURDAYS, ASK),
    ('npx -p firebase-tools firebase deploy', OURDAYS, ASK),
    ('firebase.cmd deploy', OURDAYS, ASK),
    ('node node_modules/firebase-tools/lib/bin/firebase.js deploy', OURDAYS, ASK),
    ('FIREBASE_TOKEN=x firebase deploy', OURDAYS, ASK),
    ('bash -c "cd DataRead && firebase deploy"', APPS, ASK),
    ('cmd /c "firebase deploy --only hosting"', OURDAYS, ASK),
    ('powershell -Command "firebase deploy"', OURDAYS, ASK),
    # ── GAURA: hosting:clone publică direct pe live ──
    ('firebase hosting:clone cncvectorstudio-test:etapa-01 cncvectorstudio:live', CNCVS, ASK),
    ('firebase hosting:clone cncvectorstudio-test:etapa-01 cncvectorstudio', CNCVS, ASK),
    ('firebase hosting:clone cncvectorstudio-test:etapa-01 cncvectorstudio:previzualizare', CNCVS, ASK),
    ('npx firebase hosting:clone prestoconshop:x prestoconshop:live', PRESTO, ASK),
    ('firebase hosting:clone cncvectorstudio-test:etapa-01 cncvectorstudio-test:live', CNCVS, ALLOW),
    ('firebase hosting:clone cncvectorstudio-test:a cncvectorstudio-test:b --project test', CNCVS, ALLOW),
    # ── GAURA: canalele de previzualizare și restul comenzilor hosting care scriu ──
    ('firebase hosting:channel:deploy pr-1 --project live', DATAREAD, ASK),
    ('firebase hosting:channel:deploy pr-1', OURDAYS, ASK),
    ('firebase hosting:channel:deploy etapa-01 --project test --expires 30d', CNCVS2, ALLOW),
    ('firebase hosting:disable --project live', OURDAYS, ASK),
    ('firebase hosting:disable --project test', CNCVS, ALLOW),
    ('firebase hosting:channel:delete pr-1 --project live --force', DATAREAD, ASK),
    ('firebase hosting:sites:delete prestoconshop', PRESTO, ASK),
    # Doar citire: trec.
    ('firebase hosting:channel:list --project live', DATAREAD, ALLOW),
    ('firebase hosting:sites:list', OURDAYS, ALLOW),
    ('firebase projects:list', APPS, ALLOW),
    ('npx firebase --version', APPS, ALLOW),
    ('firebase functions:log --only logErrorDigest --project live', OURDAYS, ALLOW),
    # ── scripturile npm: se citește corpul lor din package.json ──
    ('npm run deploy', DATAREAD, ASK),
    ('npm run deploy:functions', PRESTO, ASK),
    ('npm run deploy:live', CNCVS, ASK),
    ('npm run deploy:storage', CNCVS, ASK),
    # GAURA: npm cu flaguri înaintea lui `run`.
    ('npm --prefix DataRead run deploy', APPS, ASK),
    ('npm --prefix PrestoConstruct run deploy:functions', APPS, ASK),
    ('npm run-script deploy', DATAREAD, ASK),
    ('cd PrestoConstruct && npm run deploy', APPS, ASK),
    # Scripturi care nu publică: trec.
    ('npm run build', CNCVS2, ALLOW),
    ('npm run build:site', DATAREAD, ALLOW),
    ('npm test', CNCVS2, ALLOW),
    ('npm run rapid', CNCVS2, ALLOW),
    ('npm --prefix CNCVectorStudio run test:instanta', APPS, ALLOW),
    # ── scripturi node care pornesc CLI-ul: se citește codul lor ──
    ('npm run build && node scripts/publica-canal.ts etapa-01', CNCVS2, ALLOW),
    (f'cd {APPS_BASH}/cncvs2 && node scripts/publica-canal.ts etapa-01', APPS, ALLOW),
    # ── aceleași căi, cu ținta de test numită: trec (altfel gardianul doar „cere tot”, iar căile nu sunt probate) ──
    ('firebase --non-interactive --project test deploy --only hosting', CNCVS, ALLOW),
    ('npx -y firebase-tools@latest deploy --project test', CNCVS, ALLOW),
    ('bash -c "cd cncvs2 && firebase deploy --project test"', APPS, ALLOW),
    # Scripturile vechi de publicare ale CNCVectorStudio pornesc lanțuri adânci (porți care lansează alte scripturi, build-ul
    # întregii aplicații): peste limita de extindere nu pot dovedi nimic, deci cer. Direcția sigură; căile simple de test
    # (`npm --prefix X run deploy:t`) sunt probate pe arborele-fixtură.
    ('npm --prefix CNCVectorStudio run deploy:test', APPS, ASK),
    ('npm run deploy:storage:test', CNCVS, ASK),
    ('node scripts/gate-publica.mjs stare --tinta live', CNCVS, ASK),
    # ── zi de zi: nimic de cerut ──
    ('git status --short', CNCVS2, ALLOW),
    ('git commit -q -m "repara deploy-ul pe live"', CNCVS2, ALLOW),
    ('ls -la', APPS, ALLOW),
    ('node --test test/unit/job.test.ts', CNCVS2, ALLOW),
    ('gh run list --workflow rapid.yml --branch main --limit 1', CNCVS2, ALLOW),
    # Un text care doar pomenește comanda, fără s-o ruleze: cere (o tastă în plus, nu o publicare scăpată).
    ('echo "firebase deploy --project live"', APPS, ASK),
    # Ocolire prin variabilă: cuvintele sunt acolo, structura nu se vede.
    ('fb=firebase; $fb deploy', OURDAYS, ASK),
    ('$fb = "firebase"; & $fb deploy --only hosting', OURDAYS, ASK),
    # PowerShell: Set-Location și `;`.
    (f'Set-Location {APPS}\\DataRead; npm run deploy', APPS, ASK),
    (f'Set-Location {APPS}\\cncvs2; node scripts/publica-canal.ts etapa-01', APPS, ALLOW),
]


class Tabel(unittest.TestCase):
    def test_tabelul(self):
        gresite = []
        for comanda, cwd, asteptat in CAZURI:
            decizie, motive = dg.decide(comanda, cwd)
            if decizie != asteptat:
                gresite.append(f'{asteptat or "allow"} ≠ {decizie or "allow"}: {comanda}  [{cwd}]  {motive}')
        self.assertEqual(gresite, [], '\n' + '\n'.join(gresite))

    def test_arbore_fixtura(self):
        """Un Apps în miniatură: aliasul `test` greșit spre proiectul live, și scripturi node care pornesc CLI-ul."""
        import tempfile
        radacina = tempfile.mkdtemp(prefix='garda-')
        a, b = os.path.join(radacina, 'A'), os.path.join(radacina, 'B')
        os.makedirs(a)
        os.makedirs(b)
        fisiere = {
            os.path.join(a, '.firebaserc'): '{"projects": {"live": "a-prod", "test": "a-prod"}}',
            os.path.join(b, '.firebaserc'): '{"projects": {"test": "b-test", "live": "b-prod"}}',
            os.path.join(b, 'live.mjs'): "import { execFileSync } from 'node:child_process';\nexecFileSync('firebase', ['deploy', '--only', 'hosting']);\n",
            os.path.join(b, 'test.mjs'): "import { execFileSync as r } from 'node:child_process';\nr('firebase', ['deploy', '--project', 'test']);\n",
            os.path.join(b, 'dinamic.mjs'): "const p = process.argv[2];\nrequire('node:child_process').execSync(`firebase deploy --project ${p}`);\n",
            os.path.join(b, 'variabila.mjs'): "const p = 'live';\nrequire('node:child_process').spawnSync('npx', ['firebase', 'hosting:clone', 'x:y', 'b-prod:live', '--project', p]);\n",
            os.path.join(b, 'clone.mjs'): "require('node:child_process').execFileSync('firebase', ['hosting:clone', 'b-test:x', 'b-prod:live', '--project', 'test']);\n",
            os.path.join(b, 'mesaj.mjs'): "console.log('rulează firebase deploy când e gata');\nconst f = 'firebase.json';\n",
        }
        for cale, text in fisiere.items():
            with io.open(cale, 'w', encoding='utf-8') as f:
                f.write(text)
        vechi = dg.APPS
        dg.APPS = radacina
        dg._IDURI = None
        try:
            for comanda, cwd, asteptat in [
                ('firebase deploy --project test', a, ASK),      # aliasul e doar un nume: în spate e a-prod, live
                ('firebase deploy --project a-prod', a, ASK),
                ('firebase deploy --project test', b, ALLOW),
                ('firebase deploy --project b-test', b, ALLOW),
                ('firebase deploy --project b-prod', b, ASK),
                ('node live.mjs', b, ASK),
                ('node test.mjs', b, ALLOW),
                ('node dinamic.mjs test', b, ASK),
                ('node variabila.mjs', b, ASK),
                ('node clone.mjs', b, ASK),          # --project test, dar ținta clone-ului e site-ul live
                ('node mesaj.mjs', b, ALLOW),
            ]:
                self.assertEqual(dg.decide(comanda, cwd)[0], asteptat, f'{comanda} în {os.path.basename(cwd)}')
        finally:
            dg.APPS = vechi
            dg._IDURI = None

    def test_cale_reala_stdin(self):
        """Hook-ul rulat ca proces, cu JSON-ul pe care îl trimite Claude Code, pentru Bash și pentru PowerShell."""
        # Mediul real: fără variabilele care forțează UTF-8. Cu ele, testul a trecut, iar hook-ul real cădea pe `ă`
        # (cp1252), adică eroare neblocantă, adică publicarea trecea.
        mediu = {k: v for k, v in os.environ.items() if k not in ('PYTHONIOENCODING', 'PYTHONUTF8')}
        for tool, comanda, cere in [
            ('Bash', 'firebase hosting:clone a:b cncvectorstudio:live', True),
            ('PowerShell', 'firebase --project live deploy', True),
            ('Bash', 'cd DataRead && git commit -m "publică pe live" && npx firebase deploy', True),
            ('Bash', 'git status', False),
            ('Bash', 'git commit -m "corectură în ședință"', False),
        ]:
            intrare = json.dumps({'tool_name': tool, 'tool_input': {'command': comanda}, 'cwd': CNCVS}, ensure_ascii=False)
            r = subprocess.run([sys.executable, os.path.join(AICI, 'deploy-guard.py')], input=intrare.encode('utf-8'),
                               capture_output=True, timeout=20, env=mediu)
            r.stdout = r.stdout.decode('ascii')
            r.stderr = r.stderr.decode('utf-8', errors='replace')
            self.assertEqual(r.returncode, 0, r.stderr)
            if cere:
                iesire = json.loads(r.stdout)
                self.assertEqual(iesire['hookSpecificOutput']['permissionDecision'], 'ask', comanda)
            else:
                self.assertEqual(r.stdout.strip(), '', comanda)

    def test_buget_de_timp(self):
        """Peste bugetul de timp (Drive rece), o comandă care pornește scripturi cere: n-am văzut tot ce pornește."""
        vechi = dg.LIMITA_SECUNDE
        try:
            dg.LIMITA_SECUNDE = -1
            self.assertEqual(dg.decide('npm run build', CNCVS2)[0], 'ask')
            # Una care nu pornește nimic nu atinge bugetul.
            self.assertIsNone(dg.decide('git status', CNCVS2)[0])
        finally:
            dg.LIMITA_SECUNDE = vechi

    def test_eroare_interna_cere(self):
        """Dacă judecata cade, o comandă care pomenește deploy cere (o eroare de hook ar lăsa-o să treacă); restul tace."""
        vechi_decide, vechi_stdin, vechi_stdout = dg.decide, sys.stdin, sys.stdout
        try:
            def cade(*_):
                raise RuntimeError('defect intern')
            dg.decide = cade
            for comanda, cere in [('npx firebase deploy', True), ('git status', False)]:
                sys.stdin = io.TextIOWrapper(io.BytesIO(json.dumps({'tool_input': {'command': comanda}}).encode('utf-8')))
                sys.stdout = io.TextIOWrapper(io.BytesIO(), encoding='ascii')
                self.assertEqual(dg.main(), 0)
                sys.stdout.flush()
                iesire = sys.stdout.buffer.getvalue().decode('ascii')
                sys.stdout = vechi_stdout
                self.assertEqual('"ask"' in iesire, cere, comanda)
        finally:
            dg.decide, sys.stdin, sys.stdout = vechi_decide, vechi_stdin, vechi_stdout

    def test_intrare_stricata_nu_blocheaza(self):
        r = subprocess.run([sys.executable, os.path.join(AICI, 'deploy-guard.py')], input='nu e json',
                           capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, ''))


if __name__ == '__main__':
    unittest.main(verbosity=1)
