// src/utils/errorRetention.test.ts
//
// How long an error row lives, and that the TTL policy watches the field the code writes. A policy
// on the wrong field, or `ttl: "true"` as a string (the form in the first snippet of Firebase's own
// reference, which the CLI rejects), deletes nothing and says nothing. See
// functions/src/errorRetention.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ERROR_LOG_RETENTION_DAYS, ERROR_LOG_TTL_FIELD, errorLogExpiryMs,
} from '../../functions/src/errorRetention';

describe('the retention', () => {
  it('is 90 days, anchored on paper: 25 Sep + 90 days = 24 Dec (5 + 31 + 30 + 24)', () => {
    expect(ERROR_LOG_RETENTION_DAYS).toBe(90);
    expect(errorLogExpiryMs(Date.parse('2026-09-25T12:00:00Z'))).toBe(Date.parse('2026-12-24T12:00:00Z'));
  });

  it('refuses to invent an expiry from nonsense', () => {
    for (const bad of [NaN, Infinity]) expect(() => errorLogExpiryMs(bad)).toThrow(RangeError);
    expect(() => errorLogExpiryMs(0, 0)).toThrow(RangeError);
    expect(() => errorLogExpiryMs(0, -1)).toThrow(RangeError);
  });
});

describe('the deployed policy watches the field the code writes', () => {
  const spec = JSON.parse(readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8')) as {
    fieldOverrides?: Array<{ collectionGroup: string; fieldPath: string; ttl?: unknown; indexes?: unknown[] }>;
  };
  const policies = (spec.fieldOverrides ?? []).filter((o) => o.collectionGroup === 'errorLogs' && o.ttl);

  it('exactly one TTL policy on errorLogs, on ERROR_LOG_TTL_FIELD, with a BOOLEAN ttl', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].fieldPath).toBe(ERROR_LOG_TTL_FIELD);
    expect(typeof policies[0].ttl).toBe('boolean');
    // Exempt from indexing, as the TTL docs advise; nothing queries on it.
    expect(policies[0].indexes).toEqual([]);
  });
});
