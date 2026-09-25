// scripts/live-diff.mjs
//
// READ-ONLY: what is published on live, against what the next deploy would replace it with.
// Run it right before a deploy. It publishes nothing and writes nothing to the project.
//
//   node scripts/live-diff.mjs
//
// Prints names, counts and hashes only — never a secret or an environment variable's VALUE.
// (`functions:list --json` returns env values, including the old Gemini key; they are read in
// memory, reduced to their NAMES, and dropped.)
//
// How the published rules are read, and why not `--dry-run` (it only compiles): see the memory
// note "Ce e PUBLICAT: cum se citește". The CLI must be logged in on this machine.

import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const PROJECT = 'our-days-2a939';
const BUCKET = `${PROJECT}.firebasestorage.app`;
const repo = resolve(import.meta.dirname, '..');
const FT = join(process.env.APPDATA || join(os.homedir(), '.npm-global'), 'npm', 'node_modules', 'firebase-tools');
const require = createRequire(import.meta.url);

const sha = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
const out = {};

// ── Rules ──────────────────────────────────────────────────────────────────────────────────
{
  const auth = require(join(FT, 'lib', 'auth.js'));
  const rules = require(join(FT, 'lib', 'gcp', 'rules.js'));
  auth.setActiveAccount({ project: PROJECT, projectId: PROJECT }, auth.getGlobalDefaultAccount());
  const releases = await rules.listAllReleases(PROJECT);
  // The published copies go to a temp folder OUTSIDE the repo, for a human diff.
  const dir = join(os.tmpdir(), 'ourdays-live-diff');
  mkdirSync(dir, { recursive: true });
  for (const [label, service, resourceName, local] of [
    ['firestore.rules', 'cloud.firestore', undefined, 'firestore.rules'],
    ['storage.rules', 'firebase.storage', BUCKET, 'storage.rules'],
  ]) {
    const name = await rules.getLatestRulesetName(PROJECT, service, releases, resourceName);
    const release = releases.find((r) => r.rulesetName === name);
    if (!name) { out[label] = { published: null }; continue; }
    const files = await rules.getRulesetContent(name);
    const content = files.map((f) => f.content).join('\n');
    const mine = readFileSync(join(repo, local), 'utf8');
    writeFileSync(join(dir, `live-${label}`), content);
    out[label] = {
      same: sha(content) === sha(mine),
      liveSha: sha(content), localSha: sha(mine),
      liveLines: content.split('\n').length, localLines: mine.split('\n').length,
      publishedAt: release?.updateTime ?? null,
      liveCopy: join(dir, `live-${label}`),
    };
  }
}

// ── The CLI, for what it can read ──────────────────────────────────────────────────────────
function cli(args) {
  const r = spawnSync(`npx firebase ${args} --project ${PROJECT}`, { shell: true, encoding: 'utf8', cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ── Indexes (and field overrides: the TTL policy lives there) ─────────────────────────────
{
  const r = cli('firestore:indexes');
  // The trap: on failure this exits 1 and writes the error to STDOUT with stderr empty. Only the
  // exit code and a JSON that parses tell success from "zero indexes".
  let live = null;
  try { live = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { live = null; }
  if (!live || !Array.isArray(live.indexes)) {
    out.indexes = { readable: false, exit: r.status };
  } else {
    const local = JSON.parse(readFileSync(join(repo, 'firestore.indexes.json'), 'utf8'));
    const canon = (ix) => JSON.stringify({
      g: ix.collectionGroup, s: ix.queryScope || 'COLLECTION',
      f: (ix.fields || []).filter((f) => f.fieldPath !== '__name__').map((f) => [f.fieldPath, f.order || null, f.arrayConfig || null]),
    });
    const L = new Set(local.indexes.map(canon));
    const S = new Set(live.indexes.map(canon));
    const ov = (o) => `${o.collectionGroup}.${o.fieldPath}${o.ttl ? ' (ttl)' : ''}`;
    out.indexes = {
      live: live.indexes.length, local: local.indexes.length,
      onlyLive_wouldBeOfferedForDeletion: [...S].filter((x) => !L.has(x)),
      onlyLocal_toCreate: [...L].filter((x) => !S.has(x)),
      fieldOverridesLive: (live.fieldOverrides || []).map(ov),
      fieldOverridesLocal: (local.fieldOverrides || []).map(ov),
    };
  }
}

// ── Functions ──────────────────────────────────────────────────────────────────────────────
{
  const r = cli('functions:list --json');
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  const list = parsed?.result ?? parsed;
  if (r.status !== 0 || !Array.isArray(list)) {
    out.functions = { readable: false, exit: r.status };
  } else {
    // The local set, read the way the CLI reads it: the compiled lib, in discovery mode.
    const lib = join(repo, 'functions', 'lib', 'index.js').split('\\').join('/');
    const d = spawnSync(process.execPath, ['-e', `const m=require(${JSON.stringify(lib)});process.stdout.write(JSON.stringify(Object.entries(m).filter(([,f])=>typeof f==='function'&&f.__endpoint).map(([n])=>n)))`],
      { env: { ...process.env, FUNCTIONS_CONTROL_API: 'true' }, encoding: 'utf8' });
    const localNames = new Set(JSON.parse(d.stdout || '[]'));
    const liveNames = new Set(list.map((f) => f.id));
    const runtimes = {};
    for (const f of list) runtimes[f.runtime] = (runtimes[f.runtime] || 0) + 1;
    const envNameCounts = {};
    for (const f of list) for (const k of Object.keys(f.environmentVariables || {})) envNameCounts[k] = (envNameCounts[k] || 0) + 1;
    const secretBindings = {};
    for (const f of list) for (const s of f.secretEnvironmentVariables || []) secretBindings[`${s.key}@${s.version ?? 'latest'}`] = [...(secretBindings[`${s.key}@${s.version ?? 'latest'}`] || []), f.id];
    out.functions = {
      live: liveNames.size, local: localNames.size, runtimes,
      onlyLive_wouldBeDeleted: [...liveNames].filter((n) => !localNames.has(n)),
      onlyLocal_new: [...localNames].filter((n) => !liveNames.has(n)),
      envVarNamesOnLive: envNameCounts,
      // The OLD plain key: should be on no function once the Secret Manager deploy is out.
      geminiKeyVarOn: list.filter((f) => 'GEMINI_API_KEY_LOCAL' in (f.environmentVariables || {})).map((f) => f.id).sort(),
      secretBindingsOnLive: secretBindings,
    };
  }
}

// ── The secret the functions deploy needs (functions/src/geminiKey.ts) ──────────────────────
{
  const r = cli('functions:secrets:get GEMINI_KEY');
  // Prints versions and states only; never the value (that is `secrets:access`, never run here).
  const lines = (r.stdout + r.stderr).split('\n').map((l) => l.trim()).filter((l) => /^\d+\s|ENABLED|DISABLED|DESTROYED|not found|NOT_FOUND|does not exist/i.test(l));
  out.GEMINI_KEY = { exit: r.status, exists: r.status === 0, lines: lines.slice(0, 6) };
}

console.log(JSON.stringify(out, null, 2));
