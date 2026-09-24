// src/utils/deleteScope.test.ts
//
// Cancel on "delete this repeating event?" used to DELETE the occurrence: the question had three
// answers and was asked with a two-button `window.confirm`. See the header of `deleteScope.ts`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deletePlanFor } from './deleteScope';

describe('what a choice commits to', () => {
  it('the two explicit choices, and only those, delete', () => {
    expect(deletePlanFor('one')).toBe('add-exception');
    expect(deletePlanFor('series')).toBe('delete-series');
  });

  it('cancel writes nothing — which is the whole point', () => {
    expect(deletePlanFor('cancel')).toBe('nothing');
  });

  it('so does anything that is not an explicit choice', () => {
    // `false` is what the old `window.confirm` returned for Cancel, and it deleted. It must land
    // on the safe side now, along with everything else a careless caller might pass.
    for (const v of [false, true, undefined, null, '', 'ONE', 'all', 0, 1, {}, []]) {
      expect(deletePlanFor(v), JSON.stringify(v)).toBe('nothing');
    }
  });
});

describe('the dialog cannot be dismissed into a delete', () => {
  // A source check, and a weaker kind of net than the run above: the decision is tested by
  // running it, but WHICH answer a dismissal reports lives in three lines of JSX that no test here
  // can mount. These pin those three lines.
  const dialog = readFileSync(resolve(process.cwd(), 'src/components/SeriesScopeDialog.tsx'), 'utf8');
  const modal = readFileSync(resolve(process.cwd(), 'src/components/EventDetailsModal.tsx'), 'utf8');

  it('reports every dismissal as cancel', () => {
    expect(dialog).toMatch(/const dismiss = \(\) => onChoose\('cancel'\);/);
    // Escape and the Back button come through useDialog's onClose, which only this can see. The
    // backdrop, the X and the three answers are clicked for real in SeriesScopeDialog.test.ts —
    // since 24.09.2026, when the backdrop had to stop its click and stopped matching a count here.
    expect(dialog).toMatch(/useDialog\(isOpen, dismiss,/);
  });

  it('and the modal no longer asks a three-answer question with a two-button confirm', () => {
    expect(modal).not.toMatch(/confirm\(t\('deleteSeriesScope'/);
    expect(modal).toMatch(/<SeriesScopeDialog[^>]*onChoose=\{deleteOccurrence\}/);
  });
});
