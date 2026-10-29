// src/components/lazyClient.test.tsx
//
// A chunk that cannot load, on a REAL client root (29.10.2026). The first form of the on-demand windows
// swapped the lazy for a fresh one when its load failed, meant as a retry. On the server renderer that
// looked right (a later render loaded again), so two tests passed — but the server renderer never
// retries a suspended tree, and the client does: on each retry React rendered the swapped lazy, asked
// for the chunk again, and never let the failure reach the boundary. A review reproduced it on React's
// client with a few lines of DOM: tens of loads a second, nothing caught, nothing on screen, nothing
// reported. So these run the client itself, on the same few lines of DOM, and count the loads.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, lazy, Suspense } from 'react';

const reportError = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

// ── The DOM React's client needs to mount, render text and unmount: no layout, no events. ──
class MiniNode {
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  nodeValue: string | null = null;
  ownerDocument: unknown;
  constructor(public nodeType: number) { this.ownerDocument = (globalThis as { document?: unknown }).document; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const c = this.parentNode?.childNodes ?? []; return c[c.indexOf(this) + 1] ?? null; }
  appendChild(n: MiniNode) { n.parentNode?.removeChild(n); this.childNodes.push(n); n.parentNode = this; return n; }
  insertBefore(n: MiniNode, ref: MiniNode | null) {
    if (!ref) return this.appendChild(n);
    n.parentNode?.removeChild(n);
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, n);
    n.parentNode = this;
    return n;
  }
  removeChild(n: MiniNode) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  addEventListener() {}
  removeEventListener() {}
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue ?? '' : this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.childNodes = []; if (v) this.appendChild(Object.assign(new MiniNode(3), { nodeValue: v, nodeName: '#text' })); }
}
class MiniElement extends MiniNode {
  attrs: Record<string, string> = {};
  style = { setProperty() {}, removeProperty() {} };
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  tagName: string;
  nodeName: string;
  localName: string;
  constructor(tag: string) { super(1); this.localName = tag; this.tagName = this.nodeName = tag.toUpperCase(); }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k: string) { return k in this.attrs; }
}

let createRoot: typeof import('react-dom/client').createRoot;
let LazyAssetBarcode: typeof import('./LazyAssetBarcode');
let ErrorBoundary: typeof import('./ErrorBoundary').default;
const roots: Array<{ unmount(): void }> = [];

beforeAll(async () => {
  const doc = {
    nodeType: 9,
    createElement: (t: string) => new MiniElement(t),
    createElementNS: (_: string, t: string) => new MiniElement(t),
    createTextNode: (v: string) => Object.assign(new MiniNode(3), { nodeValue: v, nodeName: '#text' }),
    createComment: (v: string) => Object.assign(new MiniNode(8), { nodeValue: v }),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
  } as Record<string, unknown>;
  Object.assign(doc, { documentElement: new MiniElement('html'), head: new MiniElement('head'), body: new MiniElement('body') });
  const g = globalThis as Record<string, unknown>;
  g.document = doc;
  g.window = globalThis;
  if (!('navigator' in g)) g.navigator = { userAgent: 'node' }; // Node has its own since 21, read-only
  g.HTMLIFrameElement = function HTMLIFrameElement() {};
  ({ createRoot } = await import('react-dom/client'));
  LazyAssetBarcode = await import('./LazyAssetBarcode');
  ErrorBoundary = (await import('./ErrorBoundary')).default;
});
afterEach(() => { while (roots.length) roots.pop()!.unmount(); reportError.mockReset(); });

/** Mount `tree`, let the client run for `ms` (React holds a revealed Suspense ~300 ms), and return what it shows. */
async function mount(tree: Parameters<ReturnType<typeof createRoot>['render']>[0], ms = 1000) {
  const container = new MiniElement('div');
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  root.render(tree);
  await new Promise((r) => setTimeout(r, ms));
  return container.textContent;
}

const CHUNK_FAILED = 'Failed to fetch dynamically imported module: /assets/AddEventModal-old.js';
/** A load that fails as a real one does: at once (a cached failure), or after a round trip. */
function failing(afterMs: number) {
  const load = vi.fn(() => afterMs < 0
    ? Promise.reject(new TypeError(CHUNK_FAILED))
    : new Promise<never>((_, reject) => setTimeout(() => reject(new TypeError(CHUNK_FAILED)), afterMs)));
  return load;
}

describe('the card code, when its chunk cannot load', () => {
  for (const afterMs of [-1, 20]) {
    it(`shows the card's number and reports once, with ONE load (${afterMs < 0 ? 'at once' : 'after a round trip'})`, async () => {
      const load = failing(afterMs);
      const Code = LazyAssetBarcode.lazyCode(load as never);
      const text = await mount(createElement(Code, { value: '5901234123457', format: 'EAN_13', size: 'sm' }));
      expect(load).toHaveBeenCalledTimes(1);
      expect(text).toContain('5901234123457');
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError.mock.calls[0][1]).toMatchObject({ context: 'StaleChunk' });
    });
  }
});

describe('a window, when its chunk cannot load', () => {
  it('reaches its boundary with ONE load, told it was a chunk, and the window says so', async () => {
    const load = failing(20);
    const Window = lazy(load as never);
    const seen: boolean[] = [];
    const text = await mount(createElement(ErrorBoundary, {
      context: 'Window',
      fallback: ({ chunk }: { chunk: boolean }) => { seen.push(chunk); return chunk ? 'reload the page' : 'could not be shown'; },
      children: createElement(Suspense, { fallback: null }, createElement(Window)),
    }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(text).toBe('reload the page');
    expect(seen.every((c) => c === true)).toBe(true);
  });

  it('a window that crashes on its data is not "a chunk": it says it could not be shown', async () => {
    const Broken = () => { throw new Error('Cannot read properties of undefined'); };
    const text = await mount(createElement(ErrorBoundary, {
      context: 'Window',
      fallback: ({ chunk }: { chunk: boolean }) => (chunk ? 'reload the page' : 'could not be shown'),
      children: createElement(Broken),
    }), 200);
    expect(text).toBe('could not be shown');
  });

  it('a chunk that loads shows the window, with one load', async () => {
    const load = vi.fn(() => Promise.resolve({ default: () => createElement('p', null, 'the window') }));
    const Window = lazy(load);
    const text = await mount(createElement(ErrorBoundary, { fallback: 'x', children: createElement(Suspense, { fallback: null }, createElement(Window)) }));
    expect(text).toBe('the window');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
