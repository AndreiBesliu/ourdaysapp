// src/components/SeriesScopeDialog.test.ts
//
// A tap on the dialog's backdrop must close THIS dialog and nothing else.
//
// The dialog is rendered inside EventDetailsModal, whose own backdrop is `onClick={onClose}`. React
// bubbles a click through the component tree, so a backdrop tap that did not stop there went on to
// close the event window too — you tapped beside "delete only this one?" and lost the event you
// were looking at. Found by the pre-deploy review of 24.09.2026. The lightbox in the same modal
// already stopped the click; this dialog did not.
//
// There is no DOM in this suite, so this calls the REAL component (with `useDialog`, its only
// hook, stubbed) and dispatches a click through the element tree it returns: from the element
// tapped up to the root, stopping where a handler stops it. Whatever is left reaches the parent.

import { describe, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement, Children } from 'react';

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ dialogRef: { current: null }, dialogProps: {} }),
}));

const { default: SeriesScopeDialog } = await import('./SeriesScopeDialog');
const { t } = await import('../utils/i18n');

type El = ReactElement<{ onClick?: (e: unknown) => void; children?: ReactNode; className?: string }>;

/** The chain of elements from the root down to the first one `pick` accepts. */
function pathTo(root: El, pick: (el: El) => boolean): El[] | null {
  if (pick(root)) return [root];
  for (const child of Children.toArray(root.props.children)) {
    if (!isValidElement(child)) continue;
    const rest = pathTo(child as El, pick);
    if (rest) return [root, ...rest];
  }
  return null;
}

/** Click the element `pick` selects; true when the click got past the dialog to its parent. */
function tap(root: El, pick: (el: El) => boolean): boolean {
  const path = pathTo(root, pick);
  if (!path) throw new Error('no such element in the dialog');
  let stopped = false;
  const event = { stopPropagation: () => { stopped = true; } };
  for (const el of [...path].reverse()) {
    el.props.onClick?.(event);
    if (stopped) return false;
  }
  return true;
}

function open() {
  const onChoose = vi.fn();
  const root = SeriesScopeDialog({ isOpen: true, language: 'en', onChoose }) as El;
  return { root, onChoose };
}

const text = (s: string) => (el: El) => Children.toArray(el.props.children).some((c) => typeof c === 'string' && c === s);

describe('a tap on the backdrop', () => {
  it('cancels, and does not reach the event window behind it', () => {
    const { root, onChoose } = open();
    const reachedParent = tap(root, (el) => el === root);
    expect(onChoose).toHaveBeenCalledWith('cancel');
    expect(reachedParent).toBe(false);
  });
});

describe('the X', () => {
  it('cancels, and stays inside the dialog', () => {
    const { root, onChoose } = open();
    const x = (el: El) => (el.props as Record<string, unknown>)['aria-label'] === t('closeAction', 'en');
    expect(tap(root, x)).toBe(false);
    expect(onChoose).toHaveBeenCalledWith('cancel');
  });
});

describe('taps inside the dialog', () => {
  it('reach nobody outside it either', () => {
    const { root, onChoose } = open();
    // The question text: a tap on it does nothing at all.
    expect(tap(root, (el) => el.type === 'p')).toBe(false);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('and each answer reports what it says', () => {
    const answers = [
      [t('deleteOnlyThisOccurrence', 'en'), 'one'],
      [t('deleteWholeSeries', 'en'), 'series'],
      [t('cancel', 'en'), 'cancel'],
    ] as const;
    for (const [label, scope] of answers) {
      const { root, onChoose } = open();
      expect(tap(root, text(label))).toBe(false);
      expect(onChoose).toHaveBeenCalledWith(scope);
    }
  });
});
