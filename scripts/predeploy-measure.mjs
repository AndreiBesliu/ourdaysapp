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

// ── 25.09: section B of the audit ─────────────────────────────────────────────────────────
// Everything below answers "is this change safe on the data that is actually there". Counts only.

const groupsSnap = await db.collection('groups').get();
const memberSet = new Map(groupsSnap.docs.map((d) => [d.id, new Set(Array.isArray(d.data().members) ? d.data().members : [])]));
const chatIds = new Set((await db.collection('chats').get()).docs.map((d) => d.id));

// Invitations: a status other than pending/accepted/declined becomes unanswerable under the new
// rule; accepted-but-not-a-member counts who could have walked back in (D2, D1).
const inv = { total: 0, byStatus: {}, acceptedNoToId: 0, acceptedToIdNotMemberInviterMember: 0 };
for (const d of (await db.collection('group_invites').get()).docs) {
  const x = d.data();
  inv.total++;
  const s = x.status === undefined ? '(missing)' : ['pending', 'accepted', 'declined'].includes(x.status) ? x.status : '(other)';
  inv.byStatus[s] = (inv.byStatus[s] || 0) + 1;
  if (x.status === 'accepted' && !x.toId) inv.acceptedNoToId++;
  const ms = typeof x.groupId === 'string' ? memberSet.get(x.groupId) : null;
  if (x.status === 'accepted' && x.toId && ms && !ms.has(x.toId) && ms.has(x.fromId)) inv.acceptedToIdNotMemberInviterMember++;
}
const links = { total: 0, groupLinks: 0, redeemersNoLongerMembersWhileCreatorIs: 0 };
for (const d of (await db.collection('invite_links').get()).docs) {
  const x = d.data();
  links.total++;
  const ms = typeof x.groupId === 'string' ? memberSet.get(x.groupId) : null;
  if (!ms) continue;
  links.groupLinks++;
  if (!ms.has(x.createdBy)) continue;
  for (const u of Array.isArray(x.redeemedBy) ? x.redeemedBy : []) if (!ms.has(u)) links.redeemersNoLongerMembersWhileCreatorIs++;
}

// Groups: the cascade's sweep guard assumes auto-ids; caps assume no group near them.
const grp = { groups: groupsSnap.size, idNotAutoShape: 0, idLikeDirectChat: 0, idEqualsAChat: 0, noOwnerId: 0, maxMessages: 0, groupsOver3000Messages: 0 };
for (const d of groupsSnap.docs) {
  if (!/^[A-Za-z0-9]{20}$/.test(d.id)) grp.idNotAutoShape++;
  if (d.id.includes('__')) grp.idLikeDirectChat++;
  if (chatIds.has(d.id)) grp.idEqualsAChat++;
  if (typeof d.data().ownerId !== 'string') grp.noOwnerId++;
  const n = (await d.ref.collection('messages').count().get()).data().count;
  grp.maxMessages = Math.max(grp.maxMessages, n);
  if (n > 3000) grp.groupsOver3000Messages++;
}
const perGroupEvents = new Map();
for (const e of events) if (typeof e.groupId === 'string') perGroupEvents.set(e.groupId, (perGroupEvents.get(e.groupId) || 0) + 1);
grp.maxEventsPerGroup = Math.max(0, ...perGroupEvents.values());
grp.eventsWithDeadGroupId = events.filter((e) => typeof e.groupId === 'string' && !memberSet.has(e.groupId)).length;

// Arcade games carrying a top-level `players` (the read rule grants on it to whoever it names).
const gm = { games: 0, warlord: 0, arcade: 0, arcadeWithPlayersKey: 0, arcadePlayersNamingNonMember: 0, arcadePlayersNotList: 0 };
for (const d of (await db.collection('games').get()).docs) {
  const x = d.data();
  gm.games++;
  if (x.gameType === 'warlord-battle') { gm.warlord++; continue; }
  gm.arcade++;
  if (!('players' in x)) continue;
  gm.arcadeWithPlayersKey++;
  if (!Array.isArray(x.players)) { gm.arcadePlayersNotList++; continue; }
  const ms = memberSet.get(x.groupId) || new Set();
  if (x.players.some((u) => !ms.has(u))) gm.arcadePlayersNamingNonMember++;
}

// Error log: how much a TTL would remove, and how old the panel's 500 rows are.
const DAY = 86_400_000;
const el = db.collection('errorLogs');
const cnt = async (q) => (await q.count().get()).data().count;
const now = Date.now();
const errs = {
  total: await cnt(el),
  withCreatedAt: await cnt(el.where('createdAt', '>=', new Date(0))),
  olderThan30d: await cnt(el.where('createdAt', '<', new Date(now - 30 * DAY))),
  olderThan90d: await cnt(el.where('createdAt', '<', new Date(now - 90 * DAY))),
  last7d: await cnt(el.where('createdAt', '>=', new Date(now - 7 * DAY))),
  client: await cnt(el.where('source', '==', 'client')),
  server: await cnt(el.where('source', '==', 'server')),
};
const oldest = (await el.orderBy('createdAt', 'asc').limit(1).get()).docs[0];
errs.oldestAgeDays = oldest ? Math.floor((now - oldest.data().createdAt.toMillis()) / DAY) : null;
const newest500 = (await el.orderBy('createdAt', 'desc').limit(500).get()).docs;
errs.age500thNewestDays = newest500.length === 500 ? Math.floor((now - newest500[499].data().createdAt.toMillis()) / DAY) : `(only ${newest500.length} rows)`;

// Storage: chat media by name shape, folder kind, and how long after an upload the message landed
// (the APK writes the message only after getDownloadURL, so this bounds the read window it needs).
const st = { readable: true };
try {
  const bucket = admin.storage().bucket('our-days-2a939.firebasestorage.app');
  for (const root of ['chat-images', 'chat-audio']) {
    const [files] = await bucket.getFiles({ prefix: `${root}/` });
    const s = { objects: files.length, uidNamed: 0, legacyNamed: 0, other: 0, legacyLast30d: 0, folderGroup: 0, folderChat: 0, folderNeither: 0 };
    for (const f of files) {
      const [, folder, name] = f.name.split('/');
      if (/^[A-Za-z0-9]{20,}_\d+_/.test(name) || /^[A-Za-z0-9]{20,}_\d+/.test(name)) s.uidNamed++;
      else if (/^\d+_/.test(name) || /^\d+\.webm$/.test(name)) {
        s.legacyNamed++;
        if (now - Date.parse(f.metadata.timeCreated) < 30 * DAY) s.legacyLast30d++;
      } else s.other++;
      if (memberSet.has(folder)) s.folderGroup++; else if (chatIds.has(folder)) s.folderChat++; else s.folderNeither++;
    }
    st[root] = s;
  }
  const created = new Map();
  const [imgs] = await bucket.getFiles({ prefix: 'chat-images/' });
  for (const f of imgs) created.set(f.name, Date.parse(f.metadata.timeCreated));
  const lat = { messagesWithImage: 0, matched: 0, maxSeconds: 0, over60s: 0, over10min: 0 };
  for (const d of msgs.docs) {
    const url = d.data().imageUrl;
    const at = d.data().createdAt;
    if (typeof url !== 'string' || !at || typeof at.toMillis !== 'function') continue;
    lat.messagesWithImage++;
    const m1 = /\/o\/([^?]+)/.exec(url);
    const path = m1 ? decodeURIComponent(m1[1]) : null;
    if (!path || !created.has(path)) continue;
    lat.matched++;
    const sec = Math.round((at.toMillis() - created.get(path)) / 1000);
    lat.maxSeconds = Math.max(lat.maxSeconds, sec);
    if (sec > 60) lat.over60s++;
    if (sec > 600) lat.over10min++;
  }
  st.uploadToMessageLatency = lat;
} catch (e) {
  st.readable = false;
  st.error = String(e?.code || e?.message || e).slice(0, 80);
}

console.log(JSON.stringify({ recurrence: r, messages: m, admins: a, invites: inv, inviteLinks: links, groups: grp, games: gm, errorLogs: errs, storage: st }, null, 2));
