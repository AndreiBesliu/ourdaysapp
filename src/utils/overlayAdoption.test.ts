// src/utils/overlayAdoption.test.ts
//
// Nets on the SOURCE, for the parts of the overlay work that no unit test in this repo can reach.
//
// `dialogStack` and `menuNav` are pure and tested properly. What is NOT decidable that way is
// whether a component WIRED the primitive correctly, and each of the three checks below stands for
// a defect that has either happened here or came within one line of shipping:
//
//  1. A `useMenu` caller that forgets `triggerRef`. The press that opens the menu is then also a
//     press outside it, so the menu closes in the same gesture it opened — and what the user
//     reports is "the button does nothing".
//  2. A hand-rolled window `keydown` listener for Escape. That is the exact habit the primitives
//     replaced: a window listener cannot know it is not the only one, and one Escape closed two
//     overlays at once for months.
//  3. The calendar's arrow-key navigation standing down for overlays by SNIFFING for a CSS class.
//     A menu is not `.fixed.inset-0`, so an arrow key aimed at a menu also stepped the calendar a
//     week, and Enter on a menu item opened the day panel behind it.
//
// A source check is a weaker kind of net than a run — it is satisfied by the right text rather
// than the right behaviour. It is used here only where the behaviour needs a browser, and the
// browser bench that DID exercise it was temporary by design.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    // The Warlord submodule is another product with its own rules, and node_modules is nobody's.
    if (name === 'warlord' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({ path: p.slice(SRC.length + 1).split(sep).join('/'), text: readFileSync(p, 'utf8') }));

describe('the scan itself is looking at the app', () => {
  it('found the primitives and a healthy number of files', () => {
    // Without this, a moved directory would make every assertion below vacuously true.
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES.map((f) => f.path)).toContain('hooks/useMenu.ts');
    expect(FILES.map((f) => f.path)).toContain('hooks/useDialog.ts');
  });
});

describe('every menu is wired to its trigger', () => {
  const callers = FILES.filter((f) => f.path !== 'hooks/useMenu.ts' && /\buseMenu\s*\(/.test(f.text));

  it('finds the callers', () => {
    expect(callers.length).toBeGreaterThanOrEqual(5);
  });

  it('ATTACHES a trigger ref and a panel ref for every call', () => {
    // A menu with no trigger ref closes itself on the press that opened it: the outside-press
    // listener cannot tell the trigger from the rest of the page.
    //
    // The first version of this asked whether the file MENTIONED `triggerRef`, and a mutation run
    // showed it slept through the ref being deleted — the word survives in the destructuring
    // whether or not anything is wired to it. So it counts `ref={…triggerRef}` instead, and the
    // counts have to move together with the number of calls.
    const count = (text: string, re: RegExp) => (text.match(re) || []).length;
    for (const f of callers) {
      const calls = count(f.text, /\buseMenu\s*(?:<[^>]*>\s*)?\(/g);
      expect(count(f.text, /ref=\{[^}]*triggerRef/g), `${f.path}: ${calls} useMenu call(s), trigger refs attached`).toBe(calls);
      expect(count(f.text, /ref=\{[^}]*menuRef/g), `${f.path}: ${calls} useMenu call(s), panel refs attached`).toBe(calls);
    }
  });
});

describe('nothing hand-rolls the listeners the primitives own', () => {
  /**
   * The declared exceptions, each with the reason it is one. Anything else that starts listening
   * for keys on `window` has to be added here deliberately — which is the point.
   */
  const ALLOWED = new Set([
    'hooks/useDialog.ts',      // the primitive
    'hooks/useMenu.ts',        // the primitive
    'components/CalendarGrid.tsx', // arrow-key date navigation; stands down via dialogDepth()
    // The chat pane EMBEDDED is the screen, not an overlay, so there is nothing to hang Escape on.
    // The floating pane goes through useMenu's onEscape instead.
    'components/GroupChatWidget.tsx',
  ]);

  it('leaves window keydown to them', () => {
    const offenders = FILES
      .filter((f) => /addEventListener\(\s*['"]keydown['"]/.test(f.text))
      .map((f) => f.path)
      .filter((p) => !ALLOWED.has(p));
    expect(offenders).toEqual([]);
  });

  it('leaves history to useOverlayHistory', () => {
    // Two overlays each pushing and popping their own entry, with no shared notion of whose pop
    // it is, is how the back button used to walk the app out of the calendar.
    const offenders = FILES
      .filter((f) => /addEventListener\(\s*['"]popstate['"]/.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'hooks/useOverlayHistory.ts');
    expect(offenders).toEqual([]);
  });

  it('leaves outside-press dismissal to useMenu', () => {
    const offenders = FILES
      .filter((f) => /addEventListener\(\s*['"](?:mousedown|pointerdown)['"]/.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'hooks/useMenu.ts');
    expect(offenders).toEqual([]);
  });
});

describe('the calendar stands down for overlays by asking the stack', () => {
  const grid = FILES.find((f) => f.path === 'components/CalendarGrid.tsx')!;

  it('asks the stack, and asks where focus is, before moving the selected day', () => {
    // Sniffing the DOM for `.fixed.inset-0` was the whole bug: a menu does not match it, so the
    // arrow keys moved the calendar under an open menu and Enter opened the day panel behind it.
    // Two questions, because standing down for EVERY open overlay would kill the calendar's
    // keyboard for as long as the chat pane is open, which is minutes at a time.
    expect(grid.text).toMatch(/modalDepth\(\)\s*>\s*0/);
    expect(grid.text).toMatch(/activeElement\?\.closest\(/);
    expect(grid.text).toMatch(/from '\.\.\/utils\/dialogStack'/);
  });
});
