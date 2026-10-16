// functions/test/watchReads.ts
//
// What every read during a call brought, for the tests that pin a function to reading only the fields
// it uses (deletionReads.test.ts, groupDigestRead.test.ts). Moved here from deletionReads.test.ts on
// 16.10.2026, when the second one needed it.

import { vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { DocumentSnapshot, Firestore, Query } from 'firebase-admin/firestore';

export interface Reads {
  /** Every document a read brought with its `pad`. */
  pads: string[];
  /** Every document any read brought, with fields or as a reference. */
  paths: string[];
  /** The most documents carrying any field that one query page brought. */
  largestFieldPage: number;
  /** How many query pages brought fields, and how many brought references only. */
  fieldPages: number;
  refPages: number;
}

/**
 * What every read during `call` brought: the queries (`Query.get`) and the documents read by their path
 * (`Firestore.getAll`, which `DocumentReference.get` goes through). Watched on what was FETCHED, not on
 * what the code then looked at: a document fetched whole costs its memory whether or not it is read.
 * A transaction's own read of one document goes neither way.
 */
export async function watchReads(call: () => Promise<unknown>): Promise<Reads> {
  const realGet = Query.prototype.get;
  const realGetAll = Firestore.prototype.getAll;
  const realData = DocumentSnapshot.prototype.data;
  const pads = new Set<string>();
  const paths = new Set<string>();
  const out: Reads = { pads: [], paths: [], largestFieldPage: 0, fieldPages: 0, refPages: 0 };
  const withFields = (doc: DocumentSnapshot): boolean => {
    paths.add(doc.ref.path);
    const d = realData.call(doc);
    if (d && Object.prototype.hasOwnProperty.call(d, 'pad')) pads.add(doc.ref.path);
    return !!d && Object.keys(d).length > 0;
  };
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    const n = snap.docs.filter(withFields).length;
    if (n > 0) out.fieldPages++;
    else if (snap.size > 0) out.refPages++;
    out.largestFieldPage = Math.max(out.largestFieldPage, n);
    return snap;
  } as never);
  vi.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (this: Firestore, ...args: unknown[]) {
    const snaps = await (realGetAll as (...a: unknown[]) => Promise<DocumentSnapshot[]>).apply(this, args);
    for (const s of snaps) if (s.exists) withFields(s);
    return snaps;
  } as never);
  try {
    await call();
  } finally {
    vi.restoreAllMocks();
  }
  out.pads = [...pads].sort();
  out.paths = [...paths].sort();
  return out;
}
