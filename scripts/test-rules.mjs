// scripts/test-rules.mjs
// Run the security-rules suite against a real Firestore emulator.
//
// The emulator is a Java program and needs 11 or newer. This machine's `java` on PATH is 8, which
// is why the project had no rules tests at all for so long — but a JDK 21 was already sitting in
// Android Studio's install, shipped for the Capacitor Android build. So this script looks for a
// usable JDK instead of asking anybody to install one, and only complains if it finds none.
//
// Usage: npm run test:rules            (whole suite)
//        npm run test:rules -- -t foo  (extra args are passed through to vitest)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/** Major version of the JDK at `home`, or 0 if it is not a working JDK. */
function javaMajor(home) {
  const exe = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(exe)) return 0;
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  // `java -version` writes to stderr. It has done so since 1.8 and still does.
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return 0;
  const major = Number(m[1]);
  // 1.8 style: the real major is the second component.
  return major === 1 ? Number(m[2] || 0) : major;
}

const CANDIDATES = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  'C:\\Program Files\\Android\\Android Studio\\jre',
  join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr'),
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/usr/lib/jvm/default-java',
].filter(Boolean);

let chosen = null;
for (const home of CANDIDATES) {
  const major = javaMajor(home);
  if (major >= 11) { chosen = { home, major }; break; }
}

// Last resort: whatever `java` is on PATH, if it is new enough on its own.
if (!chosen) {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8', shell: true });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stdout || ''}${r.stderr || ''}`);
  const major = m ? (Number(m[1]) === 1 ? Number(m[2] || 0) : Number(m[1])) : 0;
  if (major >= 11) chosen = { home: null, major };
}

if (!chosen) {
  console.error(
    '\nNo JDK 11+ found, and the Firestore emulator needs one.\n' +
    'Looked at JAVA_HOME, Android Studio\'s bundled runtime, and `java` on PATH.\n' +
    'Set JAVA_HOME to a JDK 11+ and run this again.\n' +
    'The ordinary suite (`npm test`) does not need Java and is unaffected.\n'
  );
  process.exit(1);
}

const env = { ...process.env };

// A temp directory of this run's OWN. The Storage emulator keeps its blobs in
// <tmp>/firebase/storage/blobs and DELETES that directory when it stops (firebase-tools
// lib/emulator/storage/index.js, stop → persistence.deleteAll). Every emulator on the machine
// shares <tmp>, so any other one stopping — another project's session, or an earlier run of this
// one — pulled the directory out from under a running suite, which died mid-upload with ENOENT and
// left its Firestore emulator orphaned on the port (measured 25.09.2026, twice in ten minutes).
// And our own stop was doing the same to theirs.
const runTmp = join(os.tmpdir(), 'ourdays-emulators', String(process.pid));
mkdirSync(runTmp, { recursive: true });
env.TMP = runTmp;
env.TEMP = runTmp;
env.TMPDIR = runTmp;
if (chosen.home) {
  env.JAVA_HOME = chosen.home;
  env.PATH = `${join(chosen.home, 'bin')}${process.platform === 'win32' ? ';' : ':'}${env.PATH}`;
}
console.log(`Using JDK ${chosen.major}${chosen.home ? ` from ${chosen.home}` : ' from PATH'}\n`);

const passthrough = process.argv.slice(2);
const inner = ['npx', 'vitest', 'run', '--config', 'vitest.rules.config.ts', ...passthrough]
  .map((a) => (/\s/.test(a) ? `'${a}'` : a))
  .join(' ');

// ONE command string, not an argv array.
//
// `emulators:exec` takes its script as a single positional argument. Passing an array through
// `shell: true` lets the shell re-split it, so the inner command arrived as five separate
// arguments and firebase answered "Too many arguments" — a message about the wrapper, nothing to
// do with the rules. Single quotes inside, double outside, so neither layer eats the other.
//
// Storage runs alongside Firestore because `storage.rules` had no test of any kind until
// 19.09, and a storage rule that refuses is indistinguishable from a bug in the uploader.
//
// Auth runs too since 25.09: the invitation callables read the inviter's email from the Auth
// record (`authIdentityOf`), and without the emulator that call leaves the machine — and fails into
// "no email", so a test could not tell a real address from a forged one.
//
// A `demo-` prefixed project id makes the emulator skip credentials entirely, so this cannot be
// pointed at the real project even by accident.
const cmd = `npx firebase emulators:exec --only firestore,storage,auth --project demo-ourdays-rules "${inner}"`;
const r = spawnSync(cmd, {
  stdio: 'inherit', env, shell: true, cwd: join(import.meta.dirname, '..'),
});
try { rmSync(runTmp, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(r.status ?? 1);
