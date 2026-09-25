// scripts/bundleSplit.test.mjs
//
// The split guard's decision on fixtures shaped like a real Vite manifest. See bundleSplit.mjs.

import { describe, it, expect } from 'vitest';
import { splitProblems, bootFiles, LAZY_SCREENS } from './bundleSplit.mjs';

/** A manifest where every lazy screen is its own dynamic entry and the scanner lives in Wallet. */
function goodBuild() {
  const manifest = {
    'index.html': { file: 'assets/index-a.js', isEntry: true, imports: ['_jsx-runtime.js'] },
    '_jsx-runtime.js': { file: 'assets/jsx-runtime-b.js' },
  };
  const code = { 'assets/index-a.js': 'boot', 'assets/jsx-runtime-b.js': 'react' };
  for (const s of LAZY_SCREENS) {
    const file = `assets/${s.split('/').pop().replace('.tsx', '')}-x.js`;
    manifest[s] = { file, isDynamicEntry: true, imports: ['_jsx-runtime.js'] };
    code[file] = s.includes('Wallet') ? 'new Html5Qrcode(el)' : 'screen';
  }
  return { manifest, code };
}

describe('the split guard', () => {
  it('passes a build where every lazy screen is out of the boot set', () => {
    const r = splitProblems(goodBuild());
    expect(r.fatal).toEqual([]);
    expect(r.verified).toHaveLength(LAZY_SCREENS.length + 1);
  });

  it('refuses a screen with no chunk of its own — a static import bundled it into the entry', () => {
    const b = goodBuild();
    delete b.manifest['src/screens/Wallet.tsx'];
    expect(splitProblems(b).fatal.join()).toMatch(/Wallet\.tsx has no chunk/);
  });

  it('refuses a screen the entry imports statically', () => {
    const b = goodBuild();
    b.manifest['index.html'].imports.push('src/screens/Chat.tsx');
    expect(splitProblems(b).fatal.join()).toMatch(/Chat\.tsx is in the boot set/);
  });

  it('refuses the scanner in boot code even when Wallet is still its own chunk', () => {
    // Measured: a stray import in EventDetailsModal did exactly this, and a manifest-only check
    // stayed green.
    const b = goodBuild();
    b.code['assets/index-a.js'] += ' Html5Qrcode';
    expect(splitProblems(b).fatal.join()).toMatch(/html5-qrcode .* is in the boot set/);
  });

  it('follows the boot set through shared chunks, not just the entry', () => {
    const b = goodBuild();
    b.manifest['_jsx-runtime.js'].imports = ['_deep.js'];
    b.manifest['_deep.js'] = { file: 'assets/deep-c.js' };
    b.code['assets/deep-c.js'] = 'Html5Qrcode';
    expect(bootFiles(b.manifest).has('assets/deep-c.js')).toBe(true);
    expect(splitProblems(b).fatal.join()).toMatch(/is in the boot set/);
  });

  it('refuses a marker found nowhere — a check that can no longer see is not a pass', () => {
    const b = goodBuild();
    for (const f of Object.keys(b.code)) b.code[f] = b.code[f].replace('Html5Qrcode', 'Scanner');
    expect(splitProblems(b).fatal.join()).toMatch(/gone stale/);
  });

  it('refuses a manifest without exactly one entry', () => {
    const b = goodBuild();
    b.manifest['other.html'] = { file: 'assets/other.js', isEntry: true };
    expect(splitProblems(b).fatal).toEqual(['the manifest does not have exactly one entry chunk']);
  });
});
