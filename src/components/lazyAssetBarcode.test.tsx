// src/components/lazyAssetBarcode.test.tsx
//
// The card code in the event window loads on demand since 29.10.2026 (LazyAssetBarcode.tsx). What the
// boot chunk holds is judged on the real build by scripts/check-split.mjs; what is pinned here is the
// part a build cannot show: what a person sees while the chunk loads and when it cannot load. What boot
// imports, and the calendar's windows, are held in src/screens/lazyWindows.test.ts.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import LazyAssetBarcode, { lazyCode } from './LazyAssetBarcode';
import CodeNumber from './CodeNumber';
import { t } from '../utils/i18nAll';

describe('while the code loads', () => {
  it('a quiet placeholder of about the code’s height, at each of the three sizes', () => {
    for (const [size, height] of [['lg', 'min-h-[120px]'], ['md', 'min-h-[100px]'], ['sm', 'min-h-[64px]']] as const) {
      const html = renderToStaticMarkup(createElement(LazyAssetBarcode, { value: '5901234123457', format: 'EAN_13', size }));
      expect(html, size).toContain(height);
      expect(html, size).toContain('aria-busy="true"');
      expect(html, size).not.toContain('5901234123457');
    }
  });

  it('the default size is the wallet’s, as AssetBarcode’s is', () => {
    const Never = lazyCode(() => new Promise(() => {}));
    expect(renderToStaticMarkup(createElement(Never, { value: 'x', format: 'QR_CODE' }))).toContain('min-h-[120px]');
  });
});

describe('when the code cannot load', () => {
  it('the number, to read out or type in, with a line saying why', () => {
    const html = renderToStaticMarkup(createElement(CodeNumber, { value: '5901234123457', size: 'sm', reason: 'walletCodeNotLoaded' }));
    expect(html).toContain('5901234123457');
    expect(html).toContain('text-lg');
    expect(html).toContain(t('walletCodeNotLoaded', 'en-US').replace(/'/g, '&#x27;'));
  });

  it('a value that is not text shows a dash, never an object', () => {
    for (const value of [undefined, null, 7, { a: 1 }]) {
      expect(renderToStaticMarkup(createElement(CodeNumber, { value, size: 'md', reason: 'walletCodeNotLoaded' }))).toContain('—');
    }
  });

  it('the line exists in every language', () => {
    for (const lang of ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']) {
      expect(t('walletCodeNotLoaded', lang), lang).not.toBe('walletCodeNotLoaded');
      expect(t('inviteCouldNotOpen', lang), lang).not.toBe('inviteCouldNotOpen');
    }
    expect(t('walletCodeNotLoaded', 'ro-RO')).not.toBe(t('walletCodeNotLoaded', 'en-US'));
  });

  it('the wrapper’s own fallback shows THIS card’s number, at its size, in the person’s language', () => {
    // No DOM here, so the boundary cannot be made to fail; its fallback is rendered as the wrapper
    // builds it (review of 29.10.2026: a wrapper passing the format, or no language, stayed green).
    const Never = lazyCode(() => new Promise(() => {}));
    const element = (props: Parameters<typeof Never>[0]) =>
      (Never(props) as { props: { fallback: Parameters<typeof renderToStaticMarkup>[0] } }).props.fallback;
    const ro = renderToStaticMarkup(element({ value: '5901234123457', format: 'EAN_13', size: 'sm', language: 'ro-RO' }));
    expect(ro).toContain('5901234123457');
    expect(ro).not.toContain('EAN_13');
    expect(ro).toContain('text-lg');
    expect(ro).toContain(t('walletCodeNotLoaded', 'ro-RO'));
    expect(renderToStaticMarkup(element({ value: 'LOYALTY-1', format: 'CODE_128' }))).toContain('text-2xl');
  });
});
