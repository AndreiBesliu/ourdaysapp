// scripts/predeploy-measure.mjs
//
// Read-only measurements that decide whether a change is safe to deploy on the data that is
// ACTUALLY on live, rather than on the data a test imagines. Prints COUNTS only — never an id, a
// name, a title or a date.
//
// Written for the pre-deploy review of 24.09.2026, which asked, among other things:
//   * do stored recurrence exceptions still land on an occurrence under the new recurrence core?
//   * are there series whose stored start is not midnight UTC (the old DST-shifted move)?
//   * does any chat message already hold a duplicated `seenBy` (which the new guard would freeze)?
//   * does the owner's `admins/{uid}` record exist (the Admin entry now depends on it)?
//
//   node scripts/predeploy-measure.mjs
//
// It imports the recurrence core from its TypeScript source, so it needs a Node that strips types
// by default (23.6 or later; run on 26). The key is the read-only one outside the repository; the
// script refuses a key inside it. Measured 24.09.2026: 27 events, 1 series, 0 exception keys, 0
// overrides, 47 messages with 0 padded or non-list `seenBy`, 1 admin record (bootstrapped).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { seriesStartDay, occurrenceDaysInWindow, isFrequency, horizonEndDay } from '../src/utils/recurrenceCore.ts';

const KEY = process.env.OURDAYS_SA_KEY
  || resolve(process.env.USERPROFILE || process.env.HOME || '', '.ourdays', 'service-account.json');
if (!existsSync(KEY)) { console.error(`No service-account key at ${KEY}.`); process.exit(2); }
const repo = resolve(process.cwd());
if (resolve(KEY).startsWith(repo + sep)) { console.error('REFUSING: the key is inside the repository.'); process.exit(2); }

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const admin = require(resolve(repo, 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(KEY, 'utf8'))) });
const db = admin.firestore();

const plus = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── recurrence ──
const events = (await db.collection('events').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const series = events.filter((e) => e.recurrenceRule && isFrequency(e.recurrenceRule.frequency));
const r = {
  events: events.length, series: series.length, byFrequency: {},
  startNotMidnightUtc: 0, startInDstRepairWindow: 0,
  monthlyOrYearlyOnDay29to31: 0,
  exceptionKeys: 0, exceptionsOnNewOccurrence: 0, exceptionsOffByOneOnly: 0, exceptionsOrphaned: 0,
  overridesWithoutOverrideDate: 0, overridesWithOverrideDate: 0,
};
for (const s of series) {
  const f = s.recurrenceRule.frequency;
  r.byFrequency[f] = (r.byFrequency[f] || 0) + 1;
  const ms = Date.parse(s.date);
  if (Number.isFinite(ms) && ms % 86_400_000 !== 0) {
    r.startNotMidnightUtc++;
    if (ms % 86_400_000 >= 22 * 3_600_000) r.startInDstRepairWindow++;
  }
  const start = seriesStartDay(s.date);
  if (!start) continue;
  if ((f === 'monthly' || f === 'yearly') && Number(start.slice(8, 10)) >= 29) r.monthlyOrYearlyOnDay29to31++;
  const end = horizonEndDay(start, f);
  const days = new Set(occurrenceDaysInWindow(start, f, start, end || start));
  for (const key of Array.isArray(s.recurrenceExceptions) ? s.recurrenceExceptions : []) {
    if (typeof key !== 'string') continue;
    r.exceptionKeys++;
    if (days.has(key)) r.exceptionsOnNewOccurrence++;
    else if (days.has(plus(key, -1)) || days.has(plus(key, 1))) r.exceptionsOffByOneOnly++;
    else r.exceptionsOrphaned++;
  }
}
for (const e of events) {
  if (typeof e.overrideOfParent !== 'string') continue;
  if (typeof e.overrideDate === 'string') r.overridesWithOverrideDate++; else r.overridesWithoutOverrideDate++;
}

// ── seenBy duplicates, every chat ──
const msgs = await db.collectionGroup('messages').get();
const m = { messages: msgs.size, seenByDuplicated: 0, seenByNotAList: 0 };
for (const d of msgs.docs) {
  const v = d.data().seenBy;
  if (v === undefined) continue;
  if (!Array.isArray(v)) { m.seenByNotAList++; continue; }
  if (new Set(v).size !== v.length) m.seenByDuplicated++;
}

// ── admins ──
const admins = await db.collection('admins').get();
const a = { adminRecords: admins.size, bootstrapped: admins.docs.filter((d) => d.data().addedBy === 'bootstrap').length };

console.log(JSON.stringify({ recurrence: r, messages: m, admins: a }, null, 2));
