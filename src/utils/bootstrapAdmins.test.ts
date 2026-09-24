// src/utils/bootstrapAdmins.test.ts
//
// The bootstrap admin used to be an email literal, twice, in a PUBLIC repository. It now comes from
// `functions/.env` (gitignored). Audit C, 24.09.2026.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bootstrapAdminEmails } from '../../functions/src/bootstrapAdmins';

describe('reading the list from the environment', () => {
  it('comma-separated, trimmed, lower-cased', () => {
    expect(bootstrapAdminEmails(' A@Example.test , b@example.test ')).toEqual(['a@example.test', 'b@example.test']);
  });

  it('unset means no bootstrap at all \u2014 never a default address', () => {
    for (const v of [undefined, null, '', '   ', 42]) expect(bootstrapAdminEmails(v)).toEqual([]);
  });

  it('drops anything that is not an address', () => {
    expect(bootstrapAdminEmails('a@b.test,,not-an-email, @x, y@')).toEqual(['a@b.test']);
  });
});

describe('no personal email address is written into the shipped source', () => {
  // The repository is public. Test fixtures use `example.test`; anything at a real mail provider in
  // src/ or functions/src/ is somebody's address, published.
  const PROVIDERS = /[a-z0-9._%+-]+@(gmail|googlemail|yahoo|outlook|hotmail|icloud|live|proton(mail)?)\.[a-z.]+/i;

  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'warlord', 'lib'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  it('finds none', () => {
    const roots = [resolve(process.cwd(), 'src'), resolve(process.cwd(), 'functions/src')];
    const hits = roots.flatMap((r) => files(r))
      .filter((f) => PROVIDERS.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(process.cwd().length + 1).split('\\').join('/'));
    expect(hits, 'a real address in the source is published by this public repository').toEqual([]);
  });

  it('and the pattern would find one', () => {
    expect(PROVIDERS.test('const X = ["someone@gmail.com"];')).toBe(true);
    expect(PROVIDERS.test('owner: "a@example.test"')).toBe(false);
  });
});

describe('functions have a ceiling', () => {
  it('every function is capped by a global maxInstances', () => {
    const src = readFileSync(resolve(process.cwd(), 'functions/src/index.ts'), 'utf8');
    expect(src).toMatch(/setGlobalOptions\(\{\s*maxInstances:\s*\d+\s*\}\)/);
  });
});
