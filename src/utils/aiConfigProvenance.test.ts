// src/utils/aiConfigProvenance.test.ts
//
// The warning that says somebody changed the AI budget outside the admin. Its first version could
// not detect the case it existed for, which is the only reason this file is here.

import { describe, it, expect } from 'vitest';
import { changedOutsideAdmin } from '../../functions/src/aiConfigProvenance';

const V = (g: number, u: number, k = false) =>
  ({ globalDailyUsd: g, userDailyUsd: u, killSwitch: k });

describe('noticing a change the admin did not make', () => {
  it('catches a console edit that left the audit fields alone — THE case', () => {
    // Editing one number in the Firebase console does not touch `updatedBy` or `updatedAt`, so
    // the uid comparison this replaced saw nothing wrong and the screen then asserted
    // "Last changed <old date> by <old email>" — a false provenance stated with confidence.
    expect(changedOutsideAdmin(V(500, 0.25), V(50, 0.25))).toBe(true);
  });

  it('catches a console edit to the kill switch', () => {
    expect(changedOutsideAdmin(V(5, 0.25, false), V(5, 0.25, true))).toBe(true);
  });

  it('says nothing when the document is exactly what the callable wrote', () => {
    // A warning that fires on the ordinary path is a warning nobody reads.
    expect(changedOutsideAdmin(V(5, 0.25), V(5, 0.25))).toBe(false);
  });
});

describe('the states around it', () => {
  it('treats a document with NO log as unexplained', () => {
    // This is what a console-created document looks like, and the uid version called it fine.
    expect(changedOutsideAdmin(V(5, 0.25), null)).toBe(true);
    expect(changedOutsideAdmin(V(5, 0.25), undefined)).toBe(true);
  });

  it('says nothing when there is no document at all', () => {
    // The state on the day this ships: nothing saved, running on compiled defaults. There is no
    // provenance to doubt.
    expect(changedOutsideAdmin(null, null)).toBe(false);
    expect(changedOutsideAdmin(null, V(5, 0.25))).toBe(false);
    expect(changedOutsideAdmin(undefined, V(5, 0.25))).toBe(false);
  });

  it('compares strictly, so a string 5 is not the number 5', () => {
    // A console edit types text. `'5' == 5` would hide exactly the edit this is looking for.
    expect(changedOutsideAdmin({ globalDailyUsd: '5', userDailyUsd: 0.25, killSwitch: false },
                               V(5, 0.25))).toBe(true);
  });

  it('notices a field that went missing', () => {
    expect(changedOutsideAdmin({ globalDailyUsd: 5, userDailyUsd: 0.25 }, V(5, 0.25, false)))
      .toBe(true);
  });
});
