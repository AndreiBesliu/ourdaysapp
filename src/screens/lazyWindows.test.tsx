// src/screens/lazyWindows.test.tsx
//
// The calendar's windows load on demand since 29.10.2026: adding an event, an event's details, the
// arcade and the invitation, with what only they use (drag-and-drop, the date parser, the code
// libraries). What the boot chunk holds is judged on the real build by scripts/check-split.mjs; what is
// pinned here is what a build cannot show — how each window is mounted, what catches its chunk when it
// cannot load, and that the app fetches them all while idle. What a failed chunk does on the client
// itself is run in src/components/lazyClient.test.tsx.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { latchOpened, useOpenedOnce } from '../hooks/useOpenedOnce';
import { LAZY_PARTS } from '../utils/lazyParts';
import { t } from '../utils/i18n';

const read = (p: string) => readFileSync(p, 'utf8');
const HOME = read('src/screens/CalendarHome.tsx');

/** The JSX from `start` to the end of the element block that holds it: enough to read one mount. */
function block(start: string, end: string): string {
  const a = HOME.indexOf(start);
  expect(a, start).toBeGreaterThan(-1);
  return HOME.slice(a, HOME.indexOf(end, a) + end.length);
}

describe('a window is mounted from its first open, and kept', () => {
  it('the latch: shut stays unmounted, open mounts, shut again stays mounted', () => {
    expect(latchOpened(false, false)).toBe(false);
    expect(latchOpened(false, true)).toBe(true);
    expect(latchOpened(true, false)).toBe(true);
    expect(latchOpened(true, true)).toBe(true);
  });

  it('mounts in the same render that opens it, not one later', () => {
    function Probe({ open }: { open: boolean }) {
      return createElement('span', null, useOpenedOnce(open) ? 'mounted' : 'none');
    }
    expect(renderToStaticMarkup(createElement(Probe, { open: true }))).toContain('mounted');
    expect(renderToStaticMarkup(createElement(Probe, { open: false }))).toContain('none');
  });

  it('each of the three kept-mounted windows is behind its latch, inside its boundary', () => {
    for (const [name, open, latch] of [
      ['AddEventModal', 'isAddModalOpen', 'addEverOpened'],
      ['EventDetailsModal', 'selectedEvent !== null', 'detailsEverOpened'],
      ['GamesHubModal', 'isGamesHubOpen', 'gamesEverOpened'],
    ] as const) {
      expect(HOME, name).toContain(`const ${latch} = useOpenedOnce(${open});`);
      const mount = block(`{${latch} && (`, `<${name}`);
      expect(mount, name).toMatch(/<Suspense fallback=\{null\}>\s*<\w+$/);
      // The boundary that catches a chunk that cannot load: the window's own, around the latch.
      const boundary = HOME.lastIndexOf(`context="${name}"`, HOME.indexOf(`<${name}`));
      expect(boundary, name).toBeGreaterThan(-1);
    }
  });

  it('the arcade keeps its per-group key, now on its boundary, apart from the chat’s', () => {
    expect(block('{gamesEverOpened && (', 'context="GamesHubModal"')).toContain('key={`games-${activeGroupId}`}');
    expect(HOME).toContain('key={`chat-${activeGroupId}`}');
  });

  it('the invitation window, if its chunk cannot load, says so over the calendar instead of taking the app down', () => {
    const at = HOME.indexOf('<InviteFamilyModal');
    const boundary = HOME.lastIndexOf('<ErrorBoundary context="InviteFamilyModal"', at);
    expect(boundary).toBeGreaterThan(-1);
    expect(HOME.slice(boundary, at)).toMatch(/fallback=\{\s*<CouldNotShow messageKey="inviteCouldNotOpen"[\s\S]*<Suspense fallback=\{null\}>\s*$/);
    expect(HOME.slice(HOME.lastIndexOf('{isInviteModalOpen && (', boundary), boundary)).toMatch(/^\{isInviteModalOpen && \(\s*$/);
  });

  it('the arcade, which had no boundary, says so too', () => {
    expect(block('{gamesEverOpened && (', '<Suspense')).toMatch(/<CouldNotShow messageKey="windowCouldNotOpen"/);
    for (const lang of ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']) {
      expect(t('windowCouldNotOpen', lang), lang).not.toBe('windowCouldNotOpen');
    }
  });
});

describe('a window whose chunk cannot load', () => {
  it('is a plain React.lazy: its failure reaches the window’s boundary (a lazy swapped on failure looped)', () => {
    for (const name of ['AddEventModal', 'EventDetailsModal', 'GamesHubModal', 'InviteFamilyModal']) {
      expect(HOME, name).toContain(`const ${name} = lazy(load${name});`);
    }
    expect(HOME).not.toMatch(/lazyRetry|\.catch\([^)]*lazy\(/);
  });

  it('the add and details windows say "reload" when it was the chunk, and "could not be shown" when it was the event', () => {
    for (const name of ['AddEventModal', 'EventDetailsModal']) {
      const boundary = HOME.lastIndexOf('<ErrorBoundary', HOME.indexOf(`<${name}`));
      expect(HOME.slice(boundary, HOME.indexOf(`<${name}`)), name)
        .toMatch(/fallback=\{\(\{ chunk \}\) => [\s\S]*messageKey=\{chunk \? 'windowCouldNotOpen' : 'eventCouldNotShow'\}/);
    }
  });
});

describe('each window, as mounted', () => {
  /** The JSX of the boundary around `<name`: from its `<ErrorBoundary` to its own `</ErrorBoundary>`. */
  function around(name: string): string {
    const at = HOME.indexOf(`<${name}`);
    const open = HOME.lastIndexOf('<ErrorBoundary', at);
    const close = HOME.indexOf('</ErrorBoundary>', at);
    expect(open, name).toBeGreaterThan(-1);
    // Still open where the window is: a boundary closed before it does not hold it.
    expect(HOME.slice(open, at), name).not.toContain('</ErrorBoundary>');
    return HOME.slice(open, close);
  }

  it('sits inside its own boundary, behind its latch, opened by its own state', () => {
    for (const [name, latch, isOpen] of [
      ['AddEventModal', 'addEverOpened', 'isAddModalOpen'],
      ['EventDetailsModal', 'detailsEverOpened', 'selectedEvent !== null'],
      ['GamesHubModal', 'gamesEverOpened', 'isGamesHubOpen'],
    ] as const) {
      const jsx = around(name);
      expect(jsx, name).toContain(`context="${name}"`);
      // Inside the boundary (add, details), or around it (the arcade, keyed per group on the boundary).
      const at = HOME.indexOf(jsx);
      expect(HOME.slice(Math.max(0, at - 60), at + jsx.length), name).toContain(`{${latch} && (`);
      const own = jsx.slice(jsx.indexOf(`<${name}`));
      expect(own.match(/\sisOpen=\{([^}]*)\}/)?.[1], name).toBe(isOpen);
    }
  });

  it('the arcade’s boundary tries again on the next open, like the others', () => {
    expect(around('GamesHubModal')).toContain('resetOn={isGamesHubOpen}');
  });
});

describe('what boot imports never carries the windows or their libraries', () => {
  // The modules loaded at boot on the way to the windows. A static import of a window or of a library
  // only they use pulls it all back into boot (check-split refuses that build too).
  const BOOT = ['src/screens/CalendarHome.tsx', 'src/App.tsx', 'src/utils/lazyParts.ts',
    'src/hooks/useOpenedOnce.ts', 'src/components/LazyAssetBarcode.tsx', 'src/components/CodeNumber.tsx'];
  const WINDOWS = /^import (?!type\b)[^;]*from ['"][./]*(?:components\/)?(?:games\/)?(?:AssetBarcode|InviteFamilyModal|AddEventModal|EventDetailsModal|GamesHubModal)['"]/m;
  const LIBRARIES = /^import (?!type\b)[^;]*from ['"](?:react-barcode|react-qr-code|@hello-pangea\/dnd|chrono-node)['"]/m;

  it('no static import of a window or of a library only the windows use', () => {
    for (const f of BOOT) {
      const src = read(f);
      expect(src, f).not.toMatch(WINDOWS);
      expect(src, f).not.toMatch(LIBRARIES);
    }
  });

  it('they are reached through the loaders, and the app fetches every one of them while idle', () => {
    const parts = read('src/utils/lazyParts.ts');
    for (const [name, path] of [['AssetBarcode', 'components/AssetBarcode'], ['InviteFamilyModal', 'components/InviteFamilyModal'],
      ['AddEventModal', 'components/AddEventModal'], ['EventDetailsModal', 'components/EventDetailsModal'], ['GamesHubModal', 'components/games/GamesHubModal']]) {
      expect(parts, name).toContain(`export const load${name} = () => import('../${path}');`);
    }
    expect(LAZY_PARTS).toHaveLength(5);
    expect(new Set(LAZY_PARTS).size).toBe(5);
    expect(read('src/App.tsx')).toMatch(/warmRoutes\(\[loadWallet, loadChat, loadSettings, \.\.\.LAZY_PARTS\]\)/);
  });
});
