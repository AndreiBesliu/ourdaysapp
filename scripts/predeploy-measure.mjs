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
import { ARCADE_GAME_TYPES } from '../src/utils/gameSession.ts';
import { eventFieldProblem } from '../src/utils/eventShape.ts';

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
  const days = new Set(occurrenceDaysInWindow(start, f, start, end || start, 0, s.recurrenceRule.onlyOn));
  if (s.recurrenceRule.onlyOn !== undefined) r.withDayFilter = (r.withDayFilter || 0) + 1;
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
// Since 08.10.2026 the rules type every field of a message; the screens hide or blank what is not
// of the kind the app writes. Every count below should be 0: a message counted here shows blank,
// or not at all, and one with a stored link outside the pattern cannot have its picture edited.
const MSG_KEYS = ['text', 'imageUrl', 'audioUrl', 'senderId', 'createdAt', 'seenBy', 'replyToId', 'isDeleted', 'isEdited', 'reactions', 'isPinned'];
const PALETTE = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
const linkOk = (u, folder, conv) => typeof u === 'string'
  && new RegExp(`^https://firebasestorage[.]googleapis[.]com/v0/b/our-days-2a939[.]firebasestorage[.]app/o/${folder}%2F[^/?#]+%2F[^/?#]+[?]alt=media&token=[-0-9A-Za-z]+$`).test(u)
  && u.split('%2F').length === 3 && u.split('%2F')[1] === conv;
const m = {
  messages: msgs.size, seenByDuplicated: 0, seenByNotAList: 0,
  keysNoClientWrites: 0, withIdField: 0, textNotTextOrOver4000: 0, createdAtNotTimestamp: 0,
  reactionsNotMap: 0, reactionKeyOutsideSix: 0, reactionValueBad: 0, linkOutsidePattern: 0, flagNotBoolean: 0,
};
for (const d of msgs.docs) {
  const x = d.data();
  const conv = d.ref.parent.parent?.id;
  const v = x.seenBy;
  if (Object.keys(x).some((k) => !MSG_KEYS.includes(k))) m.keysNoClientWrites++;
  if ('id' in x) m.withIdField++;
  if (x.text != null && (typeof x.text !== 'string' || x.text.length > 4000)) m.textNotTextOrOver4000++;
  if (x.createdAt != null && typeof x.createdAt?.toMillis !== 'function') m.createdAtNotTimestamp++;
  if (x.reactions !== undefined) {
    if (!x.reactions || typeof x.reactions !== 'object' || Array.isArray(x.reactions)) m.reactionsNotMap++;
    else for (const [e, us] of Object.entries(x.reactions)) {
      if (!PALETTE.includes(e)) m.reactionKeyOutsideSix++;
      if (!Array.isArray(us) || us.length === 0 || us.some((u) => typeof u !== 'string') || new Set(us).size !== us.length) m.reactionValueBad++;
    }
  }
  if ((x.imageUrl != null && !linkOk(x.imageUrl, 'chat-images', conv)) || (x.audioUrl != null && !linkOk(x.audioUrl, 'chat-audio', conv))) m.linkOutsidePattern++;
  if (['isPinned', 'isDeleted', 'isEdited'].some((f) => x[f] !== undefined && typeof x[f] !== 'boolean')) m.flagNotBoolean++;
  if (v === undefined) continue;
  if (!Array.isArray(v)) { m.seenByNotAList++; continue; }
  if (new Set(v).size !== v.length) m.seenByDuplicated++;
}
const typingDocs = await db.collectionGroup('typing').get();
m.typing = typingDocs.size;
m.typingNotJustATime = typingDocs.docs.filter((d) => Object.keys(d.data()).some((k) => k !== 'updatedAt') || typeof d.data().updatedAt?.toMillis !== 'function').length;

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
// Since 08.10.2026 the rules want an invitation's groupName and fromEmail to be text (or nothing) and
// no `id` field: the installed APK prints the first two at every launch. Counted, never printed.
const inv = {
  total: 0, byStatus: {}, acceptedNoToId: 0, acceptedToIdNotMemberInviterMember: 0,
  groupNameNotText: 0, groupNameOver60: 0, fromEmailNotText: 0, fromEmailOver254: 0, withIdField: 0,
};
for (const d of (await db.collection('group_invites').get()).docs) {
  const x = d.data();
  inv.total++;
  const s = x.status === undefined ? '(missing)' : ['pending', 'accepted', 'declined'].includes(x.status) ? x.status : '(other)';
  inv.byStatus[s] = (inv.byStatus[s] || 0) + 1;
  if (x.status === 'accepted' && !x.toId) inv.acceptedNoToId++;
  if (x.groupName != null && typeof x.groupName !== 'string') inv.groupNameNotText++;
  else if (typeof x.groupName === 'string' && x.groupName.length > 60) inv.groupNameOver60++;
  if (x.fromEmail != null && typeof x.fromEmail !== 'string') inv.fromEmailNotText++;
  else if (typeof x.fromEmail === 'string' && x.fromEmail.length > 254) inv.fromEmailOver254++;
  if ('id' in x) inv.withIdField++;
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
// Since 08.10.2026 a group's name is text of 1 to 60 characters and a client changes nothing but the
// name and the members. A group counted in the last three would show as "Group" on the web.
const GROUP_KEYS = ['name', 'ownerId', 'members', 'createdAt', 'lastMessageAt', 'lastMessageText', 'lastMessageBy', 'formerMembers'];
const grp = {
  groups: groupsSnap.size, idNotAutoShape: 0, idLikeDirectChat: 0, idEqualsAChat: 0, noOwnerId: 0, maxMessages: 0, groupsOver3000Messages: 0,
  nameNotText: 0, nameBlankOrOver60: 0, keysNoClientWrites: 0,
};
for (const d of groupsSnap.docs) {
  if (!/^[A-Za-z0-9]{20}$/.test(d.id)) grp.idNotAutoShape++;
  if (d.id.includes('__')) grp.idLikeDirectChat++;
  if (chatIds.has(d.id)) grp.idEqualsAChat++;
  if (typeof d.data().ownerId !== 'string') grp.noOwnerId++;
  const gname = d.data().name;
  if (typeof gname !== 'string') grp.nameNotText++;
  else if (!gname.trim() || gname.length > 60) grp.nameBlankOrOver60++;
  if (Object.keys(d.data()).some((k) => !GROUP_KEYS.includes(k))) grp.keysNoClientWrites++;
  const n = (await d.ref.collection('messages').count().get()).data().count;
  grp.maxMessages = Math.max(grp.maxMessages, n);
  if (n > 3000) grp.groupsOver3000Messages++;
}
const perGroupEvents = new Map();
for (const e of events) if (typeof e.groupId === 'string') perGroupEvents.set(e.groupId, (perGroupEvents.get(e.groupId) || 0) + 1);
grp.maxEventsPerGroup = Math.max(0, ...perGroupEvents.values());
grp.eventsWithDeadGroupId = events.filter((e) => typeof e.groupId === 'string' && !memberSet.has(e.groupId)).length;

// Since 08.10.2026 the rules type the shown fields of events, wallet cards and expenses
// (`eventFieldsOk`, `assetFieldsOk`, `expenseDescriptionOk`), judged on the keys a write changes. A row
// counted here is shown blank by the web (the normalisers), and an edit that touches the field repairs
// it; a group event counted here would also refuse a move into another group until fixed. All 0 on
// 08.10.2026.
const shown = {
  groupEventsBadField: 0, personalEventsBadField: 0, eventsAiNoteNotShowable: 0,
  cardsBadField: 0, sharedCardsBadField: 0, expensesDescriptionNotText: 0, expensesDescriptionOver200: 0,
};
for (const e of events) {
  if (eventFieldProblem(e)) { if (typeof e.groupId === 'string') shown.groupEventsBadField++; else shown.personalEventsBadField++; }
  if ('aiChecklist' in e && !(e.aiChecklist && typeof e.aiChecklist.status === 'string')) shown.eventsAiNoteNotShowable++;
}
const textUpTo = (v, n) => typeof v === 'string' && v.length <= n;
const orNull = (v, n) => v === null || v === undefined || textUpTo(v, n);
for (const d of (await db.collection('assets').get()).docs) {
  const a = d.data();
  const ok = (!('name' in a) || textUpTo(a.name, 1000)) && (!('category' in a) || textUpTo(a.category, 100))
    && (!('categories' in a) || (Array.isArray(a.categories) && a.categories.length <= 100))
    && orNull(a.imageUrl, 4096) && orNull(a.barcodeValue, 7089) && orNull(a.barcodeFormat, 64)
    && (!('sharedWithFamily' in a) || typeof a.sharedWithFamily === 'boolean');
  if (!ok) { shown.cardsBadField++; if (typeof a.sharedGroupId === 'string') shown.sharedCardsBadField++; }
}
for (const d of (await db.collection('expenses').get()).docs) {
  const x = d.data().description;
  if (x !== undefined && typeof x !== 'string') shown.expensesDescriptionNotText++;
  else if (typeof x === 'string' && x.length > 200) shown.expensesDescriptionOver200++;
}

// Arcade games carrying a top-level `players` (the read rule grants on it to whoever it names).
// And, since 06.10.2026, games whose `gameType` is not one of the arcade's: the create rule now
// refuses them, and the banner shows them as "Arcade". Counted, never printed.
// And what the rule `arcadeFieldsOk` (same day) wants of every arcade game a move touches: any
// game counted here would refuse every move until fixed. All must be 0 before the rules go out.
const gm = {
  games: 0, warlord: 0, arcade: 0, arcadeWithPlayersKey: 0, arcadePlayersNamingNonMember: 0, arcadePlayersNotList: 0,
  arcadeTypeNotInList: 0, arcadeTypeNotString: 0,
  arcadeStateNotMap: 0, arcadeSeatNotUid: 0, arcadePlayerIdsBad: 0, arcadeWinnerNotUid: 0, arcadeCreatedAtNotTimestamp: 0, withIdField: 0,
  arcadeRummyRowsBad: 0,
};
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function';
const uidOrEmpty = (v) => v === undefined || v === null || typeof v === 'string';
for (const d of (await db.collection('games').get()).docs) {
  const x = d.data();
  gm.games++;
  if (x.gameType === 'warlord-battle') { gm.warlord++; continue; }
  gm.arcade++;
  if (typeof x.gameType !== 'string') gm.arcadeTypeNotString++;
  else if (!ARCADE_GAME_TYPES.includes(x.gameType)) gm.arcadeTypeNotInList++;
  if ('id' in x) gm.withIdField++;
  const st = x.state === undefined ? {} : x.state;
  if (!isMap(st)) gm.arcadeStateNotMap++;
  else {
    const seats = st.players === undefined ? {} : st.players;
    if (!isMap(seats) || !['X', 'O', 'P1', 'P2'].every((k) => uidOrEmpty(seats[k]))) gm.arcadeSeatNotUid++;
    const ids = st.playerIds === undefined ? [] : st.playerIds;
    if (!Array.isArray(ids) || ids.length > 4 || ids.some((u) => typeof u !== 'string')) gm.arcadePlayerIdsBad++;
    else if (x.gameType === 'rummy-45' && isMap(seats) && (
      Object.keys(seats).some((k) => !ids.includes(k))
      || Object.values(seats).some((r) => !isMap(r) || ('uid' in r && typeof r.uid !== 'string') || ('score' in r && typeof r.score !== 'number'))
    )) gm.arcadeRummyRowsBad++;
  }
  if (!uidOrEmpty(x.winner)) gm.arcadeWinnerNotUid++;
  if (x.createdAt !== undefined && x.createdAt !== null && typeof x.createdAt?.toMillis !== 'function') gm.arcadeCreatedAtNotTimestamp++;
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

console.log(JSON.stringify({ recurrence: r, messages: m, admins: a, invites: inv, inviteLinks: links, groups: grp, shownFields: shown, games: gm, errorLogs: errs, storage: st }, null, 2));
