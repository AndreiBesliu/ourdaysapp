// src/offline/offlineView.test.tsx
//
// The offline Cards page (src/offline/): what it says about the copy, and that it draws a code from
// the copy alone — no network, no Firebase.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { bannerFor, rowsFor, whenLabel, STALE_AFTER_MS } from './offlineView';
import OfflineCards from './OfflineCards';
import AssetBarcode from '../components/AssetBarcode';
import type { OfflineWallet } from '../utils/offlineWallet';

const NOW = Date.UTC(2026, 8, 28, 12, 0);
const wallet = (over: Partial<OfflineWallet> = {}): OfflineWallet => ({
  v: 1, uid: 'me', savedAt: NOW, confirmedAt: NOW - 1000, pending: false,
  cards: [
    { id: '2', name: 'Lidl Plus', code: 'https://lidl.test/x', format: 'QR_CODE', shared: false },
    { id: '1', name: 'Carrefour', code: '5901234123457', format: 'EAN_13', shared: false },
    { id: '3', name: 'ID card', code: null, format: null, shared: true },
  ],
  ...over,
});

describe('bannerFor', () => {
  it('none, fresh, stale after a week, never confirmed', () => {
    expect(bannerFor(null, NOW)).toBe('none');
    expect(bannerFor(wallet(), NOW)).toBe('fresh');
    expect(bannerFor(wallet({ confirmedAt: NOW - STALE_AFTER_MS - 1 }), NOW)).toBe('stale');
    expect(bannerFor(wallet({ confirmedAt: NOW - STALE_AFTER_MS }), NOW)).toBe('fresh');
    expect(bannerFor(wallet({ confirmedAt: null }), NOW)).toBe('never');
  });
});

describe('rowsFor', () => {
  it('sorted by name; a card without a code cannot be opened', () => {
    expect(rowsFor(wallet(), 'en-US').map((r) => [r.name, r.openable])).toEqual([
      ['Carrefour', true], ['ID card', false], ['Lidl Plus', true],
    ]);
    expect(rowsFor(null)).toEqual([]);
  });
});

describe('whenLabel', () => {
  it('a date and a time, in the person\'s language', () => {
    expect(whenLabel(NOW, 'en-US')).toMatch(/2026/);
    expect(whenLabel(NOW, 'not a locale!!')).toMatch(/2026-09-28/);
  });
});

describe('the page', () => {
  it('lists the cards from the copy, marks the one with no code, and says when it was checked', () => {
    const html = renderToStaticMarkup(<OfflineCards initial={wallet()} />);
    for (const name of ['Carrefour', 'Lidl Plus', 'ID card']) expect(html).toContain(name);
    expect(html).toContain('No code saved');
    expect(html).toContain('Checked with the server');
    expect(html).toContain('Open the full app');
  });

  it('with no copy: says none are saved, and nothing else', () => {
    const html = renderToStaticMarkup(<OfflineCards initial={null} />);
    expect(html).toContain('No cards are saved here yet');
    expect(html).not.toContain('Checked with the server');
  });

  it('a pending change and a stale copy say so', () => {
    const html = renderToStaticMarkup(<OfflineCards initial={wallet({ pending: true, confirmedAt: NOW - STALE_AFTER_MS * 2 })} />);
    expect(html).toContain('not sent yet');
    expect(html).toContain('Last checked with the server');
  });

  it('draws a QR from the copy alone (SVG paths in the render itself), and gives an EAN-13 its SVG', () => {
    const [qr, ean] = [wallet().cards[0], wallet().cards[1]];
    const q = renderToStaticMarkup(<AssetBarcode value={qr.code} format={qr.format} size="lg" />);
    expect(q).toMatch(/<svg[\s\S]*<path/);
    // react-barcode draws the bars after mount (JsBarcode on the element), so a static render holds
    // the empty <svg>; the bars themselves are proven in the browser probe (DEVLOG 28.09).
    const e = renderToStaticMarkup(<AssetBarcode value={ean.code} format={ean.format} size="lg" />);
    expect(e).toMatch(/<svg/);
    expect(e).not.toContain('walletCodeNotDrawable');
  });
});
