// rules-tests/_harness.ts
// Shared setup for the security-rules suites.
//
// Not named `*.test.ts`, so Vitest does not collect it as a suite of its own.
//
// One world, described once: two groups, five people, and the memberships every collection's
// rules are written against. Each suite seeds its own documents on top with
// `seed()`, which runs with rules DISABLED — fixtures must not have to satisfy the very rules
// they exist to test, or a tightened rule silently empties the fixture and every assertion
// after it passes for the wrong reason.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';

/** Alice owns G1. Bob is in G1. Carol is in G2 only. Dave is in nothing. */
export const ALICE = 'uid-alice';
export const BOB = 'uid-bob';
export const CAROL = 'uid-carol';
export const DAVE = 'uid-dave';

export const G1 = 'group-one';
export const G2 = 'group-two';

export const EMAIL: Record<string, string> = {
  [ALICE]: 'alice@example.test',
  [BOB]: 'bob@example.test',
  [CAROL]: 'carol@example.test',
  [DAVE]: 'dave@example.test',
};

let env: RulesTestEnvironment | null = null;

/**
 * Where the emulator `emulators:exec` actually started, from the variable it sets for its child —
 * never a hard-coded port. Other projects on this machine run their own emulators, sometimes at the
 * same moment from a parallel session (CNCVectorStudio's held 8080, 9299 and 9499 on 24.09.2026), so this
 * suite has its own ports in firebase.json and follows whatever the CLI reports.
 */
export function emulatorAt(envVar: string, fallbackPort: number): { host: string; port: number } {
  const v = process.env[envVar];
  const m = typeof v === 'string' ? /^(.+):(\d+)$/.exec(v) : null;
  return m ? { host: m[1], port: Number(m[2]) } : { host: '127.0.0.1', port: fallbackPort };
}

export async function startEnv(projectId: string): Promise<RulesTestEnvironment> {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8'),
      ...emulatorAt('FIRESTORE_EMULATOR_HOST', 8380),
    },
    // Both, always. The storage emulator costs a second at startup and buys the only rules
    // file in the project that nothing had ever probed.
    storage: {
      rules: readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8'),
      ...emulatorAt('FIREBASE_STORAGE_EMULATOR_HOST', 9399),
    },
  });
  return env;
}

export async function stopEnv(): Promise<void> {
  await env?.cleanup();
  env = null;
}

function need(): RulesTestEnvironment {
  if (!env) throw new Error('startEnv() was not called — check the suite beforeAll');
  return env;
}

/** Clear everything, then re-create the two groups. Call from beforeEach. */
export async function resetWorld(): Promise<void> {
  const e = need();
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', G1), { name: 'Family', members: [ALICE, BOB], ownerId: ALICE });
    await setDoc(doc(db, 'groups', G2), { name: 'Others', members: [CAROL], ownerId: CAROL });
  });
}

/** Write fixtures with the rules off. */
export async function seed(fn: (db: Firestore) => Promise<void>): Promise<void> {
  await need().withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}

/**
 * A signed-in Firestore for `uid`, carrying that person's email.
 *
 * The email claim matters: `canAccessInvite` reads `request.auth.token.email`, so an invite
 * addressed to somebody would be unreadable by them without it — and the suite would "prove" a
 * restriction that does not exist.
 */
export const as = (uid: string): Firestore =>
  need().authenticatedContext(uid, { email: EMAIL[uid], email_verified: true }).firestore();

/**
 * The same person, with the address NOT yet proved.
 *
 * Everything above hands out `email_verified: true`, which is the right default — and is also
 * why nothing in this suite could see the hole it was covering for. An unverified account could
 * read every invitation addressed to an address it had merely typed.
 */
export const asUnverified = (uid: string): Firestore =>
  need().authenticatedContext(uid, { email: EMAIL[uid], email_verified: false }).firestore();

/** A verified account whose address is spelled differently from the stored, lowercased copy. */
export const asEmail = (uid: string, email: string): Firestore =>
  need().authenticatedContext(uid, { email, email_verified: true }).firestore();

/** Signed in with no email at all — the shape that made `null == null` a read. */
export const asNoEmail = (uid: string): Firestore =>
  need().authenticatedContext(uid, {}).firestore();

/** The same two identities, holding a bucket instead of a database. */
export const filesAs = (uid: string) =>
  need().authenticatedContext(uid, { email: EMAIL[uid], email_verified: true }).storage();

export const filesAnon = () => need().unauthenticatedContext().storage();

/**
 * Empty the bucket. Nothing else resets it between tests, and chat uploads are create-only.
 *
 * Not `clearStorage()`: it lists the bucket ROOT and deletes only the files sitting there — every
 * object this app writes is inside a folder, so it deleted nothing (measured 25.09: a path uploaded
 * in one test was still there in the next). This walks the folders.
 */
export async function resetBucket(): Promise<void> {
  await need().withSecurityRulesDisabled(async (ctx) => {
    // The compat API the environment hands out: `ref().listAll()` → { items, prefixes }.
    type Node = { listAll(): Promise<{ items: Array<{ delete(): Promise<void> }>; prefixes: Node[] }> };
    const walk = async (node: Node): Promise<void> => {
      const { items, prefixes } = await node.listAll();
      await Promise.all(items.map((i) => i.delete()));
      for (const p of prefixes) await walk(p);
    };
    await walk(ctx.storage().ref() as unknown as Node);
  });
}

export const anon = (): Firestore => need().unauthenticatedContext().firestore();
