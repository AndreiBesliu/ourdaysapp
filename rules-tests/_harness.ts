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

export async function startEnv(projectId: string): Promise<RulesTestEnvironment> {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
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

export const anon = (): Firestore => need().unauthenticatedContext().firestore();
