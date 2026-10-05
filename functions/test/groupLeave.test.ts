// functions/test/groupLeave.test.ts
//
// Somebody out of a group comes off its events still to come (Andrei, 05.10.2026), through the real
// handler and the real trigger, on the Firestore emulator. What and why: functions/src/leaverCore.ts.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Trigger = { run: (event: unknown) => Promise<unknown> };
let sweep: (groupId: string, nowMs?: number) => Promise<unknown>;
let trigger: Trigger;
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const GONE = 'uid-gone';
const AI = 'ai_assistant';
const G = 'aaaaaaaaaaaaaaaaaaa1';
const G2 = 'bbbbbbbbbbbbbbbbbbb2';

// The handler takes "now" as an argument: these dates are fixed against it, years away from the real
// clock, so a handler that ignored the argument could not pass by reading today's date instead.
const NOW = Date.UTC(2031, 2, 15, 18); // still the 15th at UTC−12
const day = (n: number) => new Date(Date.UTC(2031, 2, 15 + n)).toISOString().slice(0, 10);
const at = (d: string) => `${d}T00:00:00.000Z`;
// The trigger reads the real clock: its events are placed relative to it.
const fromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z';

const data = async (path: string) => (await db.doc(path).get()).data();
const membersChange = (before: string[], after: string[], groupId = G) => ({
  params: { groupId },
  data: { before: { data: () => ({ members: before }) }, after: { data: () => ({ members: after }) } },
});

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const index = (await import('../src/index')) as unknown as Record<string, Trigger>;
  trigger = index.onGroupMembersChanged;
  sweep = (await import('../src/groupLeave')).takeLeaversOffEvents;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  // Gina has just left G; she is still in G2.
  await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
  await db.doc(`groups/${G2}`).set({ ownerId: ALICE, members: [ALICE, GONE], name: 'Other' });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('the sweep of one group', () => {
  beforeEach(async () => {
    await db.doc('events/e-up').set({
      ownerId: ALICE, groupId: G, date: at(day(5)),
      assigneeIds: [BOB, GONE], assigneeId: BOB, rsvps: { [BOB]: 'yes', [GONE]: 'no' }, hiddenFrom: [GONE],
    });
    await db.doc('events/e-past').set({
      ownerId: ALICE, groupId: G, date: at(day(-15)), assigneeIds: [GONE], assigneeId: GONE, rsvps: { [GONE]: 'yes' },
    });
    // Started two months ago, weekly: still running, so the whole series counts.
    await db.doc('events/e-series').set({
      ownerId: ALICE, groupId: G, date: at(day(-65)), recurrenceRule: { frequency: 'weekly' },
      assigneeIds: [GONE, AI], assigneeId: GONE,
    });
    // One occurrence of it, moved: its own document, its own day.
    await db.doc('events/e-override').set({
      ownerId: ALICE, groupId: G, date: at(day(12)), overrideOfParent: 'e-series', overrideDate: day(12),
      assigneeIds: [GONE],
    });
    // Named only by her answer.
    await db.doc('events/e-rsvp-only').set({ ownerId: ALICE, groupId: G, date: at(day(15)), rsvps: { [GONE]: 'maybe', [ALICE]: 'yes' } });
    // A trip that started six days ago and ends tomorrow: still to come by its last day, not its first.
    await db.doc('events/e-trip').set({ ownerId: ALICE, groupId: G, date: at(day(-6)), endDayOffset: 7, assigneeIds: [GONE] });
    // One she created: stays hers, she only comes off it as an assignee.
    await db.doc('events/e-hers').set({ ownerId: GONE, groupId: G, date: at(day(7)), assigneeIds: [GONE], title: 'Her trip' });
    // Still a member there, and her own calendar: untouched.
    await db.doc('events/e-g2').set({ ownerId: ALICE, groupId: G2, date: at(day(5)), assigneeIds: [GONE] });
    await db.doc('events/e-personal').set({ ownerId: GONE, groupId: null, date: at(day(5)), assigneeIds: [GONE] });
  });

  it('takes her off the events still to come: assignee and answer, nothing else', async () => {
    const r = await sweep(G, NOW);
    expect(r).toEqual({ events: 7, changed: 6, unassigned: 5, rsvpsRemoved: 2 });

    expect(await data('events/e-up')).toEqual({
      ownerId: ALICE, groupId: G, date: at(day(5)),
      assigneeIds: [BOB], assigneeId: BOB, rsvps: { [BOB]: 'yes' },
      // A surprise hidden from her stays hidden if she comes back.
      hiddenFrom: [GONE],
    });
    expect(await data('events/e-series')).toMatchObject({ assigneeIds: [AI], assigneeId: AI, recurrenceRule: { frequency: 'weekly' } });
    expect(await data('events/e-override')).toMatchObject({ assigneeIds: [], overrideOfParent: 'e-series' });
    expect(await data('events/e-hers')).toEqual({ ownerId: GONE, groupId: G, date: at(day(7)), assigneeIds: [], title: 'Her trip' });
    expect((await data('events/e-rsvp-only'))!.rsvps).toEqual({ [ALICE]: 'yes' });
    expect((await data('events/e-trip'))!.assigneeIds).toEqual([]);
  });

  it('leaves what is over as it was, and every other group and her own calendar alone', async () => {
    await sweep(G, NOW);
    expect(await data('events/e-past')).toEqual({
      ownerId: ALICE, groupId: G, date: at(day(-15)), assigneeIds: [GONE], assigneeId: GONE, rsvps: { [GONE]: 'yes' },
    });
    expect(await data('events/e-g2')).toMatchObject({ assigneeIds: [GONE] });
    expect(await data('events/e-personal')).toMatchObject({ assigneeIds: [GONE] });
  });

  it('what is left passes the rule that froze the event: everybody named is a member or the assistant', async () => {
    await sweep(G, NOW);
    const members = new Set([ALICE, BOB, AI]);
    for (const id of ['e-up', 'e-series', 'e-override', 'e-hers']) {
      const ev = (await data(`events/${id}`))!;
      expect(ev.assigneeIds.every((u: string) => members.has(u)), id).toBe(true);
      expect(ev.assigneeId == null || members.has(ev.assigneeId), id).toBe(true);
    }
  });

  it('a second run changes nothing', async () => {
    await sweep(G, NOW);
    const before = await data('events/e-up');
    expect(await sweep(G, NOW)).toEqual({ events: 7, changed: 0, unassigned: 0, rsvpsRemoved: 0 });
    expect(await data('events/e-up')).toEqual(before);
  });

  it('somebody who came back before it ran is not touched', async () => {
    await db.doc(`groups/${G}`).update({ members: [ALICE, BOB, GONE] });
    expect(await sweep(G, NOW)).toEqual({ events: 7, changed: 0, unassigned: 0, rsvpsRemoved: 0 });
    expect(await data('events/e-up')).toMatchObject({ assigneeIds: [BOB, GONE] });
  });

  it('a deleted group, or one with no member list, is not judged: that would make everybody a leaver', async () => {
    await db.doc(`groups/${G}`).update({ members: [] });
    expect(await sweep(G, NOW)).toBeNull();
    await db.doc(`groups/${G}`).delete();
    expect(await sweep(G, NOW)).toBeNull();
    expect(await data('events/e-up')).toMatchObject({ assigneeIds: [BOB, GONE] });
  });

  it('an edit made while it runs is not undone: the single field follows the list as it is now', async () => {
    await db.doc('events/e-up').update({ assigneeIds: [GONE, BOB], assigneeId: GONE });
    const realTx = db.runTransaction.bind(db);
    let first = true;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any, ...rest: any[]) => {
      // Somebody swaps Bob for Ana on it after the sweep read the group's events.
      if (first) { first = false; await db.doc('events/e-up').update({ assigneeIds: [GONE, ALICE] }); }
      return realTx(fn, ...rest);
    });
    await sweep(G, NOW);
    expect(await data('events/e-up')).toMatchObject({ assigneeIds: [ALICE], assigneeId: ALICE });
  });

  it('an event moved to another calendar while it runs is judged there, not here', async () => {
    const realTx = db.runTransaction.bind(db);
    let first = true;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any, ...rest: any[]) => {
      if (first) { first = false; await db.doc('events/e-up').update({ groupId: G2 }); }
      return realTx(fn, ...rest);
    });
    await sweep(G, NOW);
    // In G2 Gina is a member: she stays.
    expect(await data('events/e-up')).toMatchObject({ groupId: G2, assigneeIds: [BOB, GONE], rsvps: { [GONE]: 'no' } });
  });

  it('somebody let back in while it runs is a member again for every event after that', async () => {
    const realTx = db.runTransaction.bind(db);
    let first = true;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any, ...rest: any[]) => {
      if (first) { first = false; await db.doc(`groups/${G}`).update({ members: [ALICE, BOB, GONE] }); }
      return realTx(fn, ...rest);
    });
    expect(await sweep(G, NOW)).toEqual({ events: 7, changed: 0, unassigned: 0, rsvpsRemoved: 0 });
    expect(await data('events/e-up')).toMatchObject({ assigneeIds: [BOB, GONE] });
  });

  it('an event deleted while it runs is not an error', async () => {
    const realTx = db.runTransaction.bind(db);
    let first = true;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any, ...rest: any[]) => {
      if (first) { first = false; await db.doc('events/e-up').delete(); }
      return realTx(fn, ...rest);
    });
    const r = await sweep(G, NOW) as { changed: number };
    expect(r.changed).toBe(5);
    expect((await db.doc('events/e-up').get()).exists).toBe(false);
  });
});

describe('the trigger on the group', () => {
  beforeEach(async () => {
    await db.doc('events/e-soon').set({ ownerId: ALICE, groupId: G, date: fromToday(7), assigneeIds: [BOB, GONE], rsvps: { [GONE]: 'yes' } });
    // Over for ten days: the trigger must judge it by today's date, and keep her name on it.
    await db.doc('events/e-done').set({ ownerId: ALICE, groupId: G, date: fromToday(-10), assigneeIds: [GONE] });
  });

  it('runs the sweep when the member list lost somebody (leaving, or the owner taking them off)', async () => {
    await trigger.run(membersChange([ALICE, BOB, GONE], [ALICE, BOB]));
    const ev = (await data('events/e-soon'))!;
    expect(ev.assigneeIds).toEqual([BOB]);
    expect(ev.rsvps).toEqual({});
    expect(await data('events/e-done')).toMatchObject({ assigneeIds: [GONE] });
  });

  it('does nothing on any other write: a chat preview, a rename, somebody joining', async () => {
    // Gina is not a member and is still named: only a departure starts the sweep.
    await trigger.run(membersChange([ALICE, BOB], [ALICE, BOB]));
    await trigger.run(membersChange([ALICE], [ALICE, BOB]));
    await trigger.run({ params: { groupId: G }, data: undefined });
    expect(await data('events/e-soon')).toMatchObject({ assigneeIds: [BOB, GONE], rsvps: { [GONE]: 'yes' } });
  });

  it('a failure is logged and thrown, so the platform runs it again', async () => {
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('sweep failed'));
    await expect(trigger.run(membersChange([ALICE, BOB, GONE], [ALICE, BOB]))).rejects.toThrow('sweep failed');
    const rows = (await db.collection('errorLogs').get()).docs.map((d) => d.data());
    expect(rows).toEqual([expect.objectContaining({ message: `sweep failed (group ${G})`, context: 'groupLeave:takeLeaversOffEvents', source: 'server' })]);
    // The next run makes it good.
    await trigger.run(membersChange([ALICE, BOB, GONE], [ALICE, BOB]));
    expect(await data('events/e-soon')).toMatchObject({ assigneeIds: [BOB] });
  });

  it('is retried by the platform when it throws', () => {
    const ep = (trigger as unknown as { __endpoint: { eventTrigger: { retry?: boolean; eventFilters: unknown } } }).__endpoint;
    expect(ep.eventTrigger.retry).toBe(true);
  });
});
