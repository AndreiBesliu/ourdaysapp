// src/utils/qrInterop.test.ts
//
// react-qr-code must be imported by NAME. It is CommonJS with `__esModule` + `exports.default`, and this
// package is "type": "module": the production bundler's Node-style interop gives a DEFAULT import the
// whole `exports` object, and React throws #130 when a QR is rendered. Vitest's own interop differs,
// so rendering here would pass either way — the rule is held on the source, and the runtime shape the
// rule relies on is checked on the package itself. Found 28.09.2026 by the offline Cards probe.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const SRC = resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'warlord') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('react-qr-code', () => {
  it('is imported by name everywhere, never by default', () => {
    const offenders: string[] = [];
    let named = 0;
    for (const f of walk(SRC)) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(/^\s*import\s+([^;]*?)\s+from\s+['"]react-qr-code['"]/gm)) {
        if (/^\{[^}]*\bQRCode\b[^}]*\}$/.test(m[1].trim())) named++;
        else offenders.push(`${f.slice(SRC.length + 1)}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(named).toBeGreaterThanOrEqual(2); // AssetBarcode and InviteFamilyModal
  });

  it('the package really exports the component by name — a forwardRef element type, unlike the exports object', () => {
    const lib = createRequire(import.meta.url)('react-qr-code');
    expect(lib.__esModule).toBe(true);
    expect(lib.QRCode.$$typeof).toBe(Symbol.for('react.forward_ref'));
    expect(lib.default).toBe(lib.QRCode);
    // What a Node-style default import hands React: the exports object, which is no element type.
    expect(lib.$$typeof).toBeUndefined();
  });
});
