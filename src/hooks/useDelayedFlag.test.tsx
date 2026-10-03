// src/hooks/useDelayedFlag.test.tsx — "Not sent yet" is mounted late, not merely shown late.
//
// A static render runs the hook's first pass and no effect, which is exactly the moment that matters:
// a write just issued must not render the mark (it took its line and moved the page, review 03.10).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useDelayedFlag } from './useDelayedFlag';

function Probe({ on }: { on: boolean }) {
  return <span>{useDelayedFlag(on, 1200) ? 'shown' : 'hidden'}</span>;
}

describe('useDelayedFlag', () => {
  it('not on the first render after it turns on', () => {
    expect(renderToStaticMarkup(<Probe on />)).toContain('hidden');
  });
  it('off is off', () => {
    expect(renderToStaticMarkup(<Probe on={false} />)).toContain('hidden');
  });
});
