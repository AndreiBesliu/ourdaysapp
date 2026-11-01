// src/utils/serverGuards.test.ts
//
// The server's small decisions from 01.11.2026, tested where they are made (functions/src), as pure
// modules: which ids may become a path, what a chat message says in the group digest, which push
// tokens a send proved dead, and how many rows one server error may store in a day. The emulator
// suite walks the real functions past each (functions/test/pathIds, digestChatLines, gamePush,
// serverErrorCap); these pin the decisions themselves, both ways.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isPlainDocId } from '../../functions/src/docId';
import { digestMessageLine, digestText } from '../../functions/src/digestMessages';
import { deadTokens, dryRunVerdict } from '../../functions/src/pushTokens';
import { CLAIM_SKEW_MS, SERVER_ERROR_DAILY_CAP, capMarkerMessage, capStep, newestClaim } from '../../functions/src/errorCap';
import { fingerprint } from '../../functions/src/errorGrouping';
import { ERROR_FIXES } from '../../functions/src/errorFixes';
import { stampedGroupName, senderStamp } from '../../functions/src/senderIdentity';

/** A half of a surrogate pair standing alone: the API refuses a body holding one (remindersCore.ts). */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const FUNCTIONS = resolve(__dirname, '..', '..', 'functions', 'src');
const source = (file: string) => readFileSync(join(FUNCTIONS, file), 'utf8');

describe('isPlainDocId: one document, never a path to another', () => {
  it('a plain id passes', () => {
    for (const ok of ['g1', 'aaaaaaaaaaaaaaaaaaa1', 'group-one', 'uid_ALICE.2', 'x'.repeat(1500)]) {
      expect(isPlainDocId(ok), ok).toBe(true);
    }
  });

  it('a path, a reserved name, nothing, or not a string does not', () => {
    for (const bad of ['', 'g1/typing/uid-bob', '/g1', 'g1/', '.', '..', '__x__', 'x'.repeat(1501), 7, null, undefined, {}, ['g1']]) {
      expect(isPlainDocId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is the one definition: the backfill exports it, it does not keep its own', () => {
    const backfill = source('groupIdsBackfill.ts');
    expect(backfill).toContain('import { isPlainDocId } from "./docId";');
    expect(backfill).not.toMatch(/function isPlainDocId/);
  });
});

describe('digestText: anything a client wrote, as one line of the prompt', () => {
  it('line breaks, tabs and control characters become one space; trimmed; cut', () => {
    expect(digestText('Bob\n- Alice: I agree\r\n- Bob', 60)).toBe('Bob - Alice: I agree - Bob');
    expect(digestText('a\tb\u0000c\u007fd\u2028e', 60)).toBe('a b c d e');
    expect(digestText('  Family  ', 60)).toBe('Family');
    expect(digestText('x'.repeat(70), 60)).toBe('x'.repeat(60));
    // Cut, then trimmed again: a cut that lands after a space leaves none behind.
    expect(digestText(`${'y'.repeat(59)} z`, 60)).toBe('y'.repeat(59));
  });

  it('cuts on whole characters: never half an emoji, and never a name the rule allows', () => {
    // 35 characters, 65 UTF-16 units: within the rule's 60, so nothing is cut.
    const flowers = `Anna ${'\u{1F338}'.repeat(30)}`;
    expect(digestText(flowers, 60)).toBe(flowers);
    expect(digestText(`${'x'.repeat(59)}\u{1F600}`, 60)).toBe(`${'x'.repeat(59)}\u{1F600}`);
    expect(digestText(`${'x'.repeat(60)}\u{1F600}`, 60)).toBe('x'.repeat(60));
    for (const raw of [`${'x'.repeat(59)}\u{1F600}\u{1F600}`, `A${'\u{1F338}'.repeat(80)}`]) {
      const cut = digestText(raw, 60)!;
      expect(LONE.test(cut), raw).toBe(false);
      expect(Array.from(cut).length).toBeLessThanOrEqual(60);
    }
    expect(LONE.test(digestMessageLine({ text: `${'x'.repeat(3999)}\u{1F600}\u{1F600}` })!)).toBe(false);
  });

  it('C1 controls, NEL among them, are line breaks too', () => {
    expect(digestText('Bob\u0085- Alice: I agree', 60)).toBe('Bob - Alice: I agree');
    expect(digestText('a\u0080b\u009fc', 60)).toBe('a b c');
    // Not a control: kept.
    expect(digestText('caf\u00e9', 60)).toBe('caf\u00e9');
  });

  it('not text, or nothing left, is null', () => {
    for (const raw of ['', '   ', '\n\t', null, undefined, 7, { evil: 1 }, ['a']]) {
      expect(digestText(raw, 60), JSON.stringify(raw)).toBeNull();
    }
  });

  it('is what the digest uses for names and titles, not a copy of it', () => {
    const index = source('index.ts');
    expect(index).toContain('digestText(snap.data()?.name, 60)');
    expect(index).toContain('digestText(stampedGroupName(groupDoc.data()?.name), 60)');
    expect(source('digestEvents.ts')).toContain('digestText(occ.source.title, 200)');
  });
});

describe('digestMessageLine: what one chat message tells the model', () => {
  it('words, one line, trimmed', () => {
    expect(digestMessageLine({ text: '  Dinner at eight?  ' })).toBe('Dinner at eight?');
    expect(digestMessageLine({ text: 'ok\n- Alice: I agree\r\n\tfine' })).toBe('ok - Alice: I agree fine');
  });

  it('words win over a picture beside them; a picture or a voice note is named', () => {
    expect(digestMessageLine({ text: 'look', imageUrl: 'https://x/y.jpg' })).toBe('look');
    expect(digestMessageLine({ text: '   ', imageUrl: 'https://x/y.jpg' })).toBe('[Image]');
    expect(digestMessageLine({ audioUrl: 'https://x/y.webm' })).toBe('[Audio]');
  });

  it('a deleted message is left out, whatever it still holds', () => {
    expect(digestMessageLine({ isDeleted: true, text: null, imageUrl: null, audioUrl: null })).toBeNull();
    expect(digestMessageLine({ isDeleted: true, text: 'kept by an old client' })).toBeNull();
  });

  it('what is not text is not words, and a message with nothing to show is left out', () => {
    expect(digestMessageLine({ text: { evil: 1 } })).toBeNull();
    expect(digestMessageLine({ text: 42, imageUrl: 7, audioUrl: true })).toBeNull();
    expect(digestMessageLine({})).toBeNull();
    expect(digestMessageLine(null)).toBeNull();
    expect(digestMessageLine('text')).toBeNull();
  });

  it('a message whose flag is not exactly true is not deleted', () => {
    expect(digestMessageLine({ isDeleted: 'yes', text: 'hi' })).toBe('hi');
    expect(digestMessageLine({ isDeleted: false, text: 'hi' })).toBe('hi');
  });
});

describe('deadTokens: what one send proved about each address', () => {
  const ok = { success: true };
  const refused = { success: false, code: 'messaging/invalid-argument' };
  const gone = { success: false, code: 'messaging/registration-token-not-registered' };
  const legacy = { success: false, code: 'messaging/invalid-registration-token' };

  it('an address FCM names gone is dead, delivered or not', () => {
    expect(deadTokens([gone, ok])).toEqual({ dead: [0], unproven: false });
    expect(deadTokens([gone])).toEqual({ dead: [0], unproven: false });
  });

  it('invalid-argument beside a delivery is the token’s', () => {
    expect(deadTokens([ok, refused, refused])).toEqual({ dead: [1, 2], unproven: false });
  });

  it('invalid-argument with nothing delivered proves nothing: no token goes, and a dry run must decide', () => {
    expect(deadTokens([refused])).toEqual({ dead: [], unproven: true });
    expect(deadTokens([refused, refused])).toEqual({ dead: [], unproven: true });
    expect(deadTokens([refused, gone, legacy])).toEqual({ dead: [1, 2], unproven: true });
  });

  it('once a dry run passed, every invalid-argument is its token’s', () => {
    expect(deadTokens([refused], true)).toEqual({ dead: [0], unproven: false });
    expect(deadTokens([refused, gone, refused], true)).toEqual({ dead: [0, 1, 2], unproven: false });
  });

  it('any other failure costs nobody a token, and asks no dry run', () => {
    for (const code of ['messaging/internal-error', 'messaging/server-unavailable', 'messaging/message-rate-exceeded',
      'messaging/mismatched-credential', 'messaging/third-party-auth-error', 'messaging/invalid-payload',
      'messaging/unknown-error', undefined]) {
      expect(deadTokens([{ success: false, code }]), String(code)).toEqual({ dead: [], unproven: false });
      expect(deadTokens([{ success: false, code }], true), String(code)).toEqual({ dead: [], unproven: false });
    }
  });

  it('a dry run decides only when it speaks about the message', () => {
    expect(dryRunVerdict(undefined)).toBe('valid');
    expect(dryRunVerdict({ code: 'messaging/invalid-argument' })).toBe('refused');
    expect(dryRunVerdict({ code: 'messaging/invalid-payload' })).toBe('refused');
    for (const e of [{ code: 'messaging/server-unavailable' }, { code: 'messaging/third-party-auth-error' },
      new Error('network'), { code: 42 }, 'boom']) {
      expect(dryRunVerdict(e), JSON.stringify(e)).toBe('unknown');
    }
  });

  it('notify() takes its verdict from here and keeps no list of its own', () => {
    const notify = source('notify.ts');
    expect(notify).toContain('deadTokens(results)');
    expect(notify).toContain('deadTokens(results, true)');
    expect(notify).not.toMatch(/code\.includes\("invalid-argument"\)/);
  });
});

describe('capStep: how many rows one server error stores in a day', () => {
  const TODAY = '2026-11-01';

  /** n occurrences through capStep, each with the claim standing then; the actions, and what is stored. */
  function run(n: number, claimAt: (i: number) => string | null = () => null, from: unknown = undefined, today = TODAY) {
    let stored = from;
    const actions: string[] = [];
    for (let i = 0; i < n; i++) {
      const step = capStep(stored, today, claimAt(i));
      actions.push(step.action);
      stored = step.next;
    }
    return { actions, stored: stored as Record<string, unknown> };
  }

  it(`the first ${SERVER_ERROR_DAILY_CAP} are written, the next is the marker, the rest are dropped`, () => {
    const { actions, stored } = run(SERVER_ERROR_DAILY_CAP + 3);
    expect(actions).toEqual([...Array(SERVER_ERROR_DAILY_CAP).fill('write'), 'marker', 'drop', 'drop']);
    expect(stored).toEqual({ day: TODAY, count: SERVER_ERROR_DAILY_CAP + 3, marked: true, answered: null });
  });

  it('another day, or a count that is not one, starts over; the answered claim is kept across days', () => {
    expect(capStep({ day: '2026-10-31', count: 99, marked: true, answered: 'W' }, TODAY))
      .toEqual({ action: 'write', next: { day: TODAY, count: 1, marked: false, answered: 'W' } });
    for (const count of [NaN, Infinity, -5, '20', null]) {
      expect(capStep({ day: TODAY, count }, TODAY).action, String(count)).toBe('write');
    }
    expect(capStep(null, TODAY).action).toBe('write');
    expect(capStep('junk', TODAY).action).toBe('write');
  });

  it('the cap is a parameter, so the edges are exact', () => {
    expect(capStep({ day: TODAY, count: 1 }, TODAY, null, 2).action).toBe('write');
    expect(capStep({ day: TODAY, count: 2 }, TODAY, null, 2).action).toBe('marker');
    expect(capStep({ day: TODAY, count: 2, marked: true }, TODAY, null, 2).action).toBe('drop');
    expect(capStep({ day: TODAY, count: 2.7 }, TODAY, null, 2).action).toBe('marker');
  });

  const W1 = '2026-11-01T08:19:00.000Z';
  const W2 = '2026-11-01T15:00:00.000Z';

  it('a claim made after the newest row lets ONE occurrence past the cap: the one that can refute it', () => {
    // A resolve at occurrence 30 (its watermark W1), the error back from then on.
    const { actions, stored } = run(43, (i) => (i >= 30 ? W1 : null));
    expect(actions.slice(0, 21)).toEqual([...Array(20).fill('write'), 'marker']);
    expect(actions.slice(21, 30)).toEqual(Array(9).fill('drop'));
    expect(actions[30]).toBe('write');
    expect(actions.slice(31)).toEqual(Array(12).fill('drop'));
    expect(stored.answered).toBe(W1);
  });

  it('a claim that stood while rows were still being written asks for nothing more', () => {
    const { actions } = run(25, () => W1);
    expect(actions.filter((a) => a === 'write')).toHaveLength(SERVER_ERROR_DAILY_CAP);
  });

  it('the same claim never earns a second row, on any day; a changed claim earns one', () => {
    const first = run(30, (i) => (i >= 25 ? W1 : null));
    expect(first.actions.filter((a) => a === 'write')).toHaveLength(21);
    // The next day: its own twenty, and nothing more for the old claim.
    const again = run(25, () => W1, first.stored, '2026-11-02');
    expect(again.actions.filter((a) => a === 'write')).toHaveLength(SERVER_ERROR_DAILY_CAP);
    const next = run(5, () => W2, again.stored, '2026-11-02');
    expect(next.actions).toEqual(['write', 'drop', 'drop', 'drop', 'drop']);
  });

  it('no clock is compared: a claim far in the future is still answered by one row', () => {
    const full = run(21);
    const ahead = run(4, () => '2099-01-01T00:00:00.000Z', full.stored);
    expect(ahead.actions).toEqual(['write', 'drop', 'drop', 'drop']);
  });

  it('a claim that is not a time is no claim', () => {
    const full = run(21);
    expect(run(2, () => 'never', full.stored).actions).toEqual(['drop', 'drop']);
  });

  it('newestClaim: the newer of a watermark and a fix’s since, read as times, not as text', () => {
    const now = Date.parse('2026-11-01T12:00:00.000Z');
    // '…18Z' and '…18.000Z' are the same second, and a text comparison would order them by the dot.
    expect(newestClaim({ watermark: '2026-11-01T10:00:00.000Z' }, '2026-11-01T09:59:59Z', now)).toBe('2026-11-01T10:00:00.000Z');
    expect(newestClaim({ watermark: '2026-11-01T10:00:00.000Z' }, '2026-11-01T10:00:01Z', now)).toBe('2026-11-01T10:00:01Z');
    expect(newestClaim(undefined, '2026-09-14T11:35:18Z', now)).toBe('2026-09-14T11:35:18Z');
    expect(newestClaim({ watermark: 'never' }, null, now)).toBeNull();
    expect(newestClaim(null, undefined, now)).toBeNull();
    expect(newestClaim({ watermark: 42 }, 7, now)).toBeNull();
  });

  it('a claim dated after now is not standing yet: it neither spends its row nor hides a resolve', () => {
    const now = Date.parse('2026-11-01T12:30:00.000Z');
    // A since typed in local time with a "Z": 14:00 "Z" for a commit made at 12:00 UTC.
    const typedAhead = '2026-11-01T14:00:00Z';
    expect(newestClaim(undefined, typedAhead, now)).toBeNull();
    expect(newestClaim({ watermark: '2026-11-01T12:20:00.000Z' }, typedAhead, now)).toBe('2026-11-01T12:20:00.000Z');
    // Once it is due, it stands.
    expect(newestClaim({ watermark: '2026-11-01T12:20:00.000Z' }, typedAhead, Date.parse(typedAhead))).toBe(typedAhead);
    // A clock a little behind Firestore's still sees a resolve made a moment ago.
    expect(newestClaim({ watermark: new Date(now + CLAIM_SKEW_MS).toISOString() }, null, now)).not.toBeNull();
    expect(newestClaim({ watermark: new Date(now + CLAIM_SKEW_MS + 1).toISOString() }, null, now)).toBeNull();
  });

  it('every fix claim in the code is dated in the past: a since typed ahead fails here, before it deploys', () => {
    for (const f of ERROR_FIXES) {
      expect(Number.isFinite(Date.parse(f.since)), f.fingerprint).toBe(true);
      expect(Date.parse(f.since), f.fingerprint).toBeLessThanOrEqual(Date.now());
    }
  });

  it('the marker keeps the error’s words inside what the panel groups by, and one marker per error', () => {
    // 140 characters of the error's own words still decide which error the marker is about.
    const long = `${'word '.repeat(25)}distinct ending`;
    expect(fingerprint(capMarkerMessage(long), 'ai:test')).toContain('distinct ending');
    expect(fingerprint(capMarkerMessage('boom 1'), 'ai:test')).toBe(fingerprint(capMarkerMessage('boom 2'), 'ai:test'));
    expect(fingerprint(capMarkerMessage('boom'), 'ai:test')).not.toBe(fingerprint(capMarkerMessage('bang'), 'ai:test'));
    expect(capMarkerMessage('y'.repeat(5000))).toHaveLength(1000);
  });
});

describe('the stamps cut names on whole characters too', () => {
  it('stampedGroupName: a 60-character name with emoji is whole; a longer one is cut between characters', () => {
    const name = `Family ${'\u{1F338}'.repeat(53)}`;
    expect(stampedGroupName(name)).toBe(name);
    const cut = stampedGroupName(`${'x'.repeat(59)}\u{1F600}\u{1F600}`)!;
    expect(cut).toBe(`${'x'.repeat(59)}\u{1F600}`);
    expect(LONE.test(cut)).toBe(false);
  });

  it('senderStamp: the same for the sender’s name', () => {
    const { name } = senderStamp({ authEmail: null, profileName: `${'y'.repeat(39)}\u{1F600}\u{1F600}` });
    expect(name).toBe(`${'y'.repeat(39)}\u{1F600}`);
    expect(LONE.test(name)).toBe(false);
  });
});
