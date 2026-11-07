// src/screens/lazyWindows.test.tsx
//
// The calendar's windows load on demand since 29.10.2026: adding an event, an event's details, the
// arcade and the invitation, with what only they use (drag-and-drop, the date parser, the code
// libraries). What the boot chunk holds is judged on the real build by scripts/check-split.mjs; what is
// pinned here is what a build cannot show — how each window is mounted, what catches its chunk when it
// cannot load, and that the app fetches them all while idle. What a failed chunk does on the client
// itself is run in src/components/lazyClient.test.tsx.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { latchOpened, useOpenedOnce } from '../hooks/useOpenedOnce';
import { LAZY_PARTS, keptOnArrival, loadGroupChatWidget } from '../utils/lazyParts';
import { LAZY_SCREENS } from '../../scripts/bundleSplit.mjs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import CouldNotShow, { NOTES_ASKING_FOR_RELOAD } from '../components/CouldNotShow';
import { t } from '../utils/i18nAll';

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
    expect(HOME.slice(boundary, at)).toMatch(/fallback=\{\(\{ chunk \}\) =>\s*<CouldNotShow messageKey=\{chunk \? 'inviteCouldNotOpen' : 'windowCouldNotShow'\}[\s\S]*<Suspense fallback=\{null\}>\s*$/);
    expect(HOME.slice(HOME.lastIndexOf('{isInviteModalOpen && (', boundary), boundary)).toMatch(/^\{isInviteModalOpen && \(\s*$/);
  });

  it('the arcade, which had no boundary, says so too', () => {
    expect(block('{gamesEverOpened && (', '<Suspense')).toMatch(/<CouldNotShow messageKey=\{chunk \? 'windowCouldNotOpen' : 'windowCouldNotShow'\}/);
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

  it('each window says "reload" when it was the chunk, and "could not be shown" when it was its code (add and details since 29.10; the arcade and the invitation since 07.11.2026)', () => {
    for (const [name, onChunk, onCrash] of [
      // "This window": adding has no event yet (review of 07.11.2026); only the details show one.
      ['AddEventModal', 'windowCouldNotOpen', 'windowCouldNotShow'],
      ['EventDetailsModal', 'windowCouldNotOpen', 'eventCouldNotShow'],
      ['GamesHubModal', 'windowCouldNotOpen', 'windowCouldNotShow'],
      ['InviteFamilyModal', 'inviteCouldNotOpen', 'windowCouldNotShow'],
    ] as const) {
      const at = HOME.indexOf(`<${name}`);
      const fallback = HOME.slice(HOME.lastIndexOf('<ErrorBoundary', at), at);
      expect(fallback, name).toContain(`context="${name}"`);
      expect(fallback, name)
        .toMatch(new RegExp(`fallback=\\{\\(\\{ chunk \\}\\) =>[\\s\\S]*messageKey=\\{chunk \\? '${onChunk}' : '${onCrash}'\\}`));
    }
    for (const lang of ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']) {
      expect(t('windowCouldNotShow', lang), lang).not.toBe('windowCouldNotShow');
      // Its own text: not the event's, and not one that asks for a reload.
      expect(t('windowCouldNotShow', lang), lang).not.toBe(t('eventCouldNotShow', lang));
      expect(t('windowCouldNotShow', lang), lang).not.toBe(t('windowCouldNotOpen', lang));
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
    'src/hooks/useOpenedOnce.ts', 'src/components/LazyAssetBarcode.tsx', 'src/components/CodeNumber.tsx',
    'src/components/GroupChatWidgetOnDemand.tsx'];
  const WINDOWS = /^import (?!type\b)[^;]*from ['"][./]*(?:components\/)?(?:games\/)?(?:AssetBarcode|InviteFamilyModal|AddEventModal|EventDetailsModal|GamesHubModal|GroupChatWidget(?!OnDemand))['"]/m;
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
    expect(parts).toContain("const chatWidget = keptOnArrival(() => import('../components/GroupChatWidget'));");
    expect(LAZY_PARTS).toContain(loadGroupChatWidget);
    expect(LAZY_PARTS).toHaveLength(6);
    expect(new Set(LAZY_PARTS).size).toBe(6);
    expect(read('src/App.tsx')).toMatch(/warmRoutes\(\[loadWallet, loadChat, loadSettings, \.\.\.LAZY_PARTS\]\)/);
  });
});

describe('the calendar’s floating chat, loaded on demand (06.11.2026)', () => {
  it('the build guard holds it outside the boot set (scripts/check-split.mjs)', () => {
    expect(LAZY_SCREENS).toContain('src/components/GroupChatWidget.tsx');
  });

  it('unread counts from when the chat was shown: the widget starts its last-read time from `unreadSince`', () => {
    const widget = read('src/components/GroupChatWidget.tsx');
    expect(widget).toContain('const [lastRead, setLastRead] = useState<number>(() => unreadSince ?? Date.now());');
    // The chat screen gives none: there the widget mounts with the screen, as before.
    expect(read('src/screens/Chat.tsx')).not.toContain('unreadSince');
  });

  it('the warm-up waits for a connection (a fetch spent offline stays failed on Chromium)', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('stopWaiting = whenOnline(() => { void warmRoutes([loadWallet, loadChat, loadSettings, ...LAZY_PARTS]); }, browserOnline());');
    // Both ways the effect ends (idle callback, timer) stop the wait too: signed out offline, nothing warms later.
    expect(app).toContain('return () => { cic(id); stopWaiting(); };');
    expect(app).toContain('return () => { window.clearTimeout(id); stopWaiting(); };');
  });

  it('the calendar has the on-demand wrapper, under the widget’s name; the chat screen keeps the widget itself', () => {
    expect(HOME).toContain("import GroupChatWidget from '../components/GroupChatWidgetOnDemand';");
    expect(HOME).not.toMatch(/from '\.\.\/components\/GroupChatWidget';/);
    expect(read('src/screens/Chat.tsx')).toContain("import GroupChatWidget from '../components/GroupChatWidget';");
  });

  it('its boundary says to reload when it was the chunk, and offers it; "could not be shown" when it was the conversation', () => {
    const at = HOME.indexOf('<GroupChatWidget');
    const boundary = HOME.lastIndexOf('<ErrorBoundary', at);
    const fallback = HOME.slice(boundary, at);
    expect(fallback).toMatch(/fallback=\{\(\{ chunk \}\) => \([\s\S]*\{chunk \? t\('chatCouldNotLoad', language\) : t\('chatCouldNotShow', language\)\}/);
    // The reload, only for a chunk (on Chromium nothing else fetches it again), and only as an offer. The tag is written
    // `<(?:button)` so this file's text holds no literal opening tag for the button-coverage count (buttonNames.test.ts).
    expect(fallback).toMatch(/\{chunk && \(\s*<(?:button) type="button" onClick=\{\(\) => window\.location\.reload\(\)\}[^>]*>\s*\{t\('errorReload', language\)\}/);
    for (const lang of ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']) {
      expect(t('chatCouldNotLoad', lang), lang).not.toBe('chatCouldNotLoad');
      expect(t('chatCouldNotLoad', lang), lang).not.toBe(t('chatCouldNotShow', lang));
    }
  });
});

describe('keptOnArrival: a loader that keeps what it brought', () => {
  it('nothing before, the value after; later calls do not import again', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: 'W' }));
    const part = keptOnArrival(importer);
    expect(part.loaded()).toBeNull();
    expect(await part.load()).toBe('W');
    expect(part.loaded()).toBe('W');
    expect(await part.load()).toBe('W');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('calls while it loads share the one load', async () => {
    let resolve!: (m: { default: string }) => void;
    const importer = vi.fn(() => new Promise<{ default: string }>((r) => { resolve = r; }));
    const part = keptOnArrival(importer);
    const a = part.load();
    const b = part.load();
    resolve({ default: 'W' });
    expect(await Promise.all([a, b])).toEqual(['W', 'W']);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('a failed load is forgotten: the next call asks again, and nothing is kept', async () => {
    const importer = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')))
      .mockImplementationOnce(() => Promise.resolve({ default: 'W' }));
    const part = keptOnArrival(importer as () => Promise<{ default: string }>);
    await expect(part.load()).rejects.toThrow('Failed to fetch dynamically imported module');
    expect(part.loaded()).toBeNull();
    expect(await part.load()).toBe('W');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('a window note that says to reload offers the reload (07.11.2026)', () => {
  /** Every .tsx under src/, tests aside. */
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return tsxFiles(p);
      return p.endsWith('.tsx') && !p.includes('.test.') ? [p] : [];
    });
  }
  /** One `<CouldNotShow>` in the app: its key, or the choice between two, and its source back to its boundary. */
  interface NoteUse { where: string; keys: string[]; choice: string | null; boundary: string }
  function noteUses(): NoteUse[] {
    const uses: NoteUse[] = [];
    let calls = 0;
    for (const f of tsxFiles('src')) {
      const src = read(f);
      calls += (src.match(/<CouldNotShow\b/g) ?? []).length;
      for (const m of src.matchAll(/<CouldNotShow\s+messageKey=(?:"(\w+)"|\{([^}]*)\})/g)) {
        // A key the rules can read: literal, or the boundary's choice between two literals. A variable or a constant
        // would hide its key from every rule below (review of 07.11.2026).
        expect(m[1] !== undefined || /^chunk \? '\w+' : '\w+'$/.test(m[2] ?? ''),
          `${f}: messageKey={${m[2]}}: write the key literally, or as chunk ? '…' : '…'`).toBe(true);
        const from = src.lastIndexOf('<ErrorBoundary', m.index);
        uses.push({
          where: `${f}: ${m[1] ?? m[2]}`,
          keys: m[1] ? [m[1]] : [...(m[2] ?? '').matchAll(/'(\w+)'/g)].map((q) => q[1]),
          choice: m[2] ?? null,
          boundary: from < 0 ? '' : src.slice(from, m.index),
        });
      }
    }
    // Honest about its reach: every call is read, or the rules below would pass on the ones it skipped.
    expect(uses.length, 'a <CouldNotShow> written another way (props first, a variable): read it here').toBe(calls);
    return uses;
  }
  /** Every message key given to CouldNotShow anywhere in the app: literal, or each branch of a choice. */
  const noteKeys = () => new Set(noteUses().flatMap((use) => use.keys));

  it('a note that asks for a reload is shown only when it was the chunk, never for a crash of the code (07.11.2026)', () => {
    let chosen = 0;
    for (const use of noteUses()) {
      if (!use.keys.some((key) => NOTES_ASKING_FOR_RELOAD.includes(key))) continue;
      // Chosen by the flag the boundary passes its fallback: the reload note for the chunk, another for the rest.
      const branches = use.choice?.match(/^chunk \? '(\w+)' : '(\w+)'$/);
      expect(branches, use.where).toBeTruthy();
      expect(NOTES_ASKING_FOR_RELOAD.includes(branches![1]), use.where).toBe(true);
      expect(NOTES_ASKING_FOR_RELOAD.includes(branches![2]), use.where).toBe(false);
      // And `chunk` is that flag: the fallback it sits in is the boundary's, taking it.
      expect(use.boundary.slice(use.boundary.lastIndexOf('fallback={')), use.where).toMatch(/^fallback=\{\(\{ chunk \}\) =>/);
      chosen++;
    }
    // Adding, details, the arcade, the invitation.
    expect(chosen).toBe(4);
  });

  it('"this event could not be shown" only on the windows that show an event; the others say "this window" (07.11.2026)', () => {
    const contexts = new Map<string, string[]>();
    for (const use of noteUses()) {
      const context = use.boundary.match(/context="([\w.]+)"/)?.[1] ?? `(no boundary) ${use.where}`;
      for (const key of use.keys) contexts.set(key, [...(contexts.get(key) ?? []), context]);
    }
    expect(contexts.get('eventCouldNotShow')).toEqual(['EventDetailsModal']);
    expect(contexts.get('windowCouldNotShow')).toEqual(expect.arrayContaining(
      ['AddEventModal', 'GamesHubModal', 'InviteFamilyModal', 'LeaveGroupModal', 'RecurringEventsPanel']));
  });

  it('the button is on exactly the notes whose text asks for a reload, and each of those is in use', () => {
    const used = noteKeys();
    expect(used.size).toBeGreaterThanOrEqual(3);
    for (const key of used) {
      const asks = /reload/i.test(t(key, 'en-US'));
      expect(NOTES_ASKING_FOR_RELOAD.includes(key), `${key}: "${t(key, 'en-US')}"`).toBe(asks);
    }
    for (const key of NOTES_ASKING_FOR_RELOAD) expect(used.has(key), key).toBe(true);
  });

  it('drawn: "Reload" under the note that asks for it; none under one that does not', () => {
    const html = renderToStaticMarkup(createElement(CouldNotShow, { messageKey: 'windowCouldNotOpen', onClose: () => {} }));
    expect(html).toContain(`>${t('errorReload', 'en-US')}</button>`);
    // `<(?:button)`: no literal opening tag in this file's text for the button-coverage count (buttonNames.test.ts).
    expect(html).toMatch(/<(?:button) type="button"[^>]*min-h-\[44px\]/);
    for (const messageKey of ['eventCouldNotShow', 'windowCouldNotShow']) {
      const quiet = renderToStaticMarkup(createElement(CouldNotShow, { messageKey, onClose: () => {} }));
      expect(quiet, messageKey).toContain(t(messageKey, 'en-US'));
      expect(quiet, messageKey).not.toContain(t('errorReload', 'en-US'));
    }
    // In the reader's language: on a real client root (lazyClient.test.tsx), where the store's language applies.
    for (const lang of ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']) {
      expect(t('errorReload', lang), lang).not.toBe('errorReload');
    }
  });
});
