// src/utils/offlineWiring.test.ts
//
// Where the offline card copy is started and removed (28.09.2026). Held on the source: the app needs a
// signed-in Firebase to run, and this suite has no DOM. The behaviour itself is in offlineWallet.test.ts
// and offlineWalletSync.test.ts; this is only that it is connected, and connected in the safe places.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { offlineCardsEnabled } from './offlineCardsFlag';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('src/App.tsx');
const settings = read('src/screens/Settings.tsx');

describe('App', () => {
  it('forgets the copy whenever nobody is signed in — stopping the sync FIRST', () => {
    const signedOut = /\} else \{[\s\S]*?resetTheme\(\);[\s\S]*?stopOfflineWalletSync\(\);\s*forgetOfflineWallet\(\);\s*setUser\(null\);/.exec(app);
    expect(signedOut, 'the signed-out branch of onAuthStateChanged').toBeTruthy();
  });

  it("drops another account's copy the moment somebody is signed in, before the sync answers", () => {
    expect(app).toMatch(/if \(!user\) return;\s*[\s\S]{0,400}?const held = readOfflineWallet\(\);\s*if \(held && held\.uid !== user\.uid\) forgetOfflineWallet\(\);/);
  });

  it('starts the sync from an effect on the user (a function, not a rendered component), and stops it', () => {
    const effect = /useEffect\(\(\) => \{\s*if \(!offlineCardsEnabled\(\)\) \{ forgetOfflineWallet\(\); return; \}\s*if \(!user\) return;[\s\S]*?stop = startOfflineWalletSync\(user\.uid\);[\s\S]*?stop\?\.\(\);\s*\};\s*\}, \[user\]\);/.exec(app);
    expect(effect, 'the sync effect').toBeTruthy();
    expect(app).not.toMatch(/<OfflineWalletSync\b/);
  });

  it('the effect sits above the loading return, like every hook here', () => {
    expect(app.indexOf('startOfflineWalletSync(user.uid)')).toBeLessThan(app.indexOf('if (loading) {'));
  });
});

describe('Settings', () => {
  it('forgets the copy FIRST at sign-out, before anything that can hang offline', () => {
    const body = /const handleSignOut = async \(\) => \{([\s\S]*?)\n  \};/.exec(settings)![1];
    const stop = body.indexOf('stopOfflineWalletSync();');
    const forget = body.indexOf('forgetOfflineWallet();');
    const release = body.indexOf('await releasePushThenSignOut(');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(forget);
    expect(forget).toBeLessThan(release);
  });
});

describe('the offline page', () => {
  it("has a home-screen shortcut, inside the app's scope", () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    expect(manifest.shortcuts).toEqual(expect.arrayContaining([expect.objectContaining({ url: '/offline/cards.html' })]));
  });

  it('opens a card as the app opens every dialog (Back, Escape, focus), over the list that gets focus back', () => {
    const page = read('src/offline/OfflineCards.tsx');
    expect(page).toMatch(/useDialog\(open !== null, \(\) => setOpen\(null\)/);
    expect(page).toMatch(/ref=\{dialogRef\} \{\.\.\.dialogProps\}/);
    // An early `if (open) return` would unmount the card button that focus is given back to.
    expect(page).not.toMatch(/if \(open\) \{\s*return/);
  });

  it('declares the language it speaks and a translated title, before it renders', () => {
    const main = read('src/offline/main.tsx');
    const lang = main.indexOf('document.documentElement.lang = ');
    const title = main.indexOf("document.title = `Our Days — ${t('offlineCardsTitle', language)}`");
    const render = main.indexOf('createRoot(');
    expect(lang).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(-1);
    expect(Math.max(lang, title)).toBeLessThan(render);
  });
});

describe('the kill switch', () => {
  it("is off only for exactly '0'", () => {
    expect(offlineCardsEnabled(undefined)).toBe(true);
    expect(offlineCardsEnabled('1')).toBe(true);
    expect(offlineCardsEnabled('')).toBe(true);
    expect(offlineCardsEnabled('0')).toBe(false);
  });
});
