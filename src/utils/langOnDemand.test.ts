// src/utils/langOnDemand.test.ts
//
// Four of the six languages load on demand since 30.10.2026 (i18n.ts, `loadLanguage`), and the store
// only ever shows a language whose words are here (store.ts). What the boot chunk holds is judged on
// the real build by scripts/check-split.mjs; this holds the rest: what boot carries, how a language
// loads, and what a person sees while it does — at boot, after sign-in, from Settings.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const ON_DEMAND = ['fr-FR', 'es-ES', 'it-IT', 'de-DE'];

/** A fresh copy of the modules, with this device remembering `remembered` as its language. */
async function freshApp(remembered: string | null) {
  vi.resetModules();
  const store: Record<string, string> = remembered ? { 'ourdays.language': remembered } : {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  const i18n = await import('./i18n');
  const { useThemeStore, bootLanguageReady } = await import('../store');
  return { i18n, useThemeStore, bootLanguageReady, remembered: () => store['ourdays.language'] };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('what boot carries', () => {
  it('English and Romanian only; the other four are each a module of their own, loaded by import()', () => {
    const src = read('src/utils/i18n.ts');
    const blocks = [...src.matchAll(/^ {2}'([a-z]{2}-[A-Z]{2})': \{/gm)].map((m) => m[1]);
    expect(blocks).toEqual(['en-US', 'ro-RO']);
    for (const lang of ON_DEMAND) {
      expect(src, lang).toContain(`'${lang}': () => import('./lang/${lang}'),`);
      expect(read(`src/utils/lang/${lang}.ts`), lang).toMatch(/const dictionary: Dictionary = \{/);
    }
    expect(src).toMatch(/^import \{ enUS, ro \} from 'date-fns\/locale';$/m);
  });

  it('nothing the app loads at boot imports a language module or i18nAll; the offline page does', () => {
    const boot = ['src/main.tsx', 'src/App.tsx', 'src/store.ts', 'src/utils/i18n.ts', 'src/screens/CalendarHome.tsx', 'src/screens/Login.tsx'];
    for (const f of boot) expect(read(f), f).not.toMatch(/^import [^;]*from ['"][./]*(?:utils\/)?(?:lang\/|i18nAll)/m);
    expect(read('src/offline/main.tsx')).toMatch(/^import '\.\.\/utils\/i18nAll';$/m);
  });
});

describe('loading a language', () => {
  it('makes it ready, with its words and its dates; one load however many ask', async () => {
    const { i18n } = await freshApp(null);
    expect(i18n.isLanguageReady('de-DE')).toBe(false);
    expect(i18n.t('todayOverview', 'de-DE')).toBe(i18n.t('todayOverview', 'en-US'));
    const [a, b] = await Promise.all([i18n.loadLanguage('de-DE'), i18n.loadLanguage('de-DE')]);
    expect(a && b).toBe(true);
    expect(i18n.isLanguageReady('de-DE')).toBe(true);
    expect(i18n.t('todayOverview', 'de-DE')).toBe('Heute im Überblick');
    expect(i18n.getDateLocale('de-DE').code).toBe('de');
  });

  it('a language the app does not have is not ready, and nothing is loaded for it', async () => {
    const { i18n } = await freshApp(null);
    expect(await i18n.loadLanguage('xx-XX')).toBe(false);
    expect(await i18n.loadLanguage('constructor')).toBe(false);
    expect(i18n.isLanguageReady('constructor')).toBe(false);
  });

  it('English and Romanian are ready without loading anything', async () => {
    const { i18n } = await freshApp(null);
    expect(i18n.isLanguageReady('en-US') && i18n.isLanguageReady('ro-RO')).toBe(true);
    expect(i18n.getDateLocale('ro-RO').code).toBe('ro');
  });
});

describe('what a person sees', () => {
  it('at boot, a remembered French: English until its words are here, then French — never a mix', async () => {
    const { useThemeStore, bootLanguageReady } = await freshApp('fr-FR');
    expect(useThemeStore.getState().language).toBe('en-US');
    await bootLanguageReady;
    expect(useThemeStore.getState().language).toBe('fr-FR');
  });

  it('at boot, a remembered Romanian: Romanian at once', async () => {
    const { useThemeStore } = await freshApp('ro-RO');
    expect(useThemeStore.getState().language).toBe('ro-RO');
  });

  it('asked for Italian (Settings, or the profile after sign-in): the current language until it arrives, and remembered at once', async () => {
    const { useThemeStore, remembered } = await freshApp('ro-RO');
    useThemeStore.getState().setAdvancedTheme({ language: 'it-IT', soundEnabled: false });
    expect(useThemeStore.getState()).toMatchObject({ language: 'ro-RO', soundEnabled: false });
    expect(remembered()).toBe('it-IT');
    await vi.waitFor(() => expect(useThemeStore.getState().language).toBe('it-IT'));
  });

  it('the last ask wins: Spanish asked, then Romanian before Spanish arrives, stays Romanian', async () => {
    const { useThemeStore, i18n } = await freshApp('en-US');
    useThemeStore.getState().setAdvancedTheme({ language: 'es-ES' });
    useThemeStore.getState().setAdvancedTheme({ language: 'ro-RO' });
    expect(useThemeStore.getState().language).toBe('ro-RO');
    await i18n.loadLanguage('es-ES');
    await new Promise((r) => setTimeout(r, 0));
    expect(useThemeStore.getState().language).toBe('ro-RO');
  });

  it('a language that cannot load leaves the current one', async () => {
    const { useThemeStore } = await freshApp('ro-RO');
    useThemeStore.getState().setAdvancedTheme({ language: 'xx-XX' });
    await new Promise((r) => setTimeout(r, 0));
    expect(useThemeStore.getState().language).toBe('ro-RO');
  });

  it('the first paint waits for the language, but not past 1.5 s', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/Promise\.race\(\[bootLanguageReady, new Promise<void>\(\(resolve\) => setTimeout\(resolve, 1500\)\)\]\)\.then\(start\)/);
    expect(main).not.toMatch(/^await /m);
  });
});
