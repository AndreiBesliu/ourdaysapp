// src/components/lazyAssetBarcode.test.tsx
//
// The card code in the event window loads on demand since 29.10.2026 (LazyAssetBarcode.tsx). What the
// boot chunk holds is judged on the real build by scripts/check-split.mjs; what is pinned here is the
// part a build cannot show: what a person sees while the chunk loads, when it cannot load, and that the
// modules boot imports never import the code libraries or the renderer itself.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import LazyAssetBarcode, { lazyCode } from './LazyAssetBarcode';
import CodeNumber from './CodeNumber';
import { t } from '../utils/i18n';

const read = (p: string) => readFileSync(p, 'utf8');

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

  it('a failed load is not kept: the next render asks for the chunk again', async () => {
    let calls = 0;
    const Failing = lazyCode(() => { calls += 1; return Promise.reject(new Error('Failed to fetch dynamically imported module: x')); });
    const props = { value: '1', format: 'EAN_13', size: 'md' as const };
    renderToStaticMarkup(createElement(Failing, props));
    expect(calls).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    renderToStaticMarkup(createElement(Failing, props));
    expect(calls).toBe(2);
  });
});

describe('what boot imports never carries the code libraries', () => {
  // The modules the event window, the calendar and the app load at boot to reach the code and the
  // invitation window. A static import of the renderer or a library here pulls it all back into boot.
  const BOOT = ['src/components/LazyAssetBarcode.tsx', 'src/components/CodeNumber.tsx', 'src/utils/lazyParts.ts',
    'src/components/EventDetailsModal.tsx', 'src/screens/CalendarHome.tsx', 'src/App.tsx'];

  it('no static import of react-barcode, react-qr-code, AssetBarcode or InviteFamilyModal', () => {
    for (const f of BOOT) {
      const src = read(f);
      expect(src, f).not.toMatch(/^import (?!type\b)[^;]*from ['"](?:react-barcode|react-qr-code)['"]/m);
      expect(src, f).not.toMatch(/^import (?!type\b)[^;]*from ['"][./]*(?:components\/)?(?:AssetBarcode|InviteFamilyModal)['"]/m);
    }
  });

  it('they are reached through the two loaders, which the app also fetches while idle', () => {
    expect(read('src/utils/lazyParts.ts')).toContain("export const loadAssetBarcode = () => import('../components/AssetBarcode');");
    expect(read('src/utils/lazyParts.ts')).toContain("export const loadInviteFamilyModal = () => import('../components/InviteFamilyModal');");
    expect(read('src/App.tsx')).toMatch(/warmRoutes\(\[[^\]]*loadAssetBarcode[^\]]*loadInviteFamilyModal[^\]]*\]\)/);
    expect(read('src/screens/CalendarHome.tsx')).toContain('const InviteFamilyModal = lazy(loadInviteFamilyModal);');
  });

  it('the invitation window, if its chunk cannot load, says so over the calendar instead of taking the app down', () => {
    const src = read('src/screens/CalendarHome.tsx');
    const at = src.indexOf('<InviteFamilyModal');
    const boundary = src.lastIndexOf('<ErrorBoundary context="InviteFamilyModal"', at);
    expect(boundary).toBeGreaterThan(-1);
    expect(src.slice(boundary, at)).toMatch(/fallback=\{\s*<CouldNotShow messageKey="inviteCouldNotOpen"[\s\S]*<Suspense fallback=\{null\}>\s*$/);
    expect(src.slice(src.lastIndexOf('{isInviteModalOpen && (', boundary), boundary)).toMatch(/^\{isInviteModalOpen && \(\s*$/);
  });
});
