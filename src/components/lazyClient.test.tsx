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
import { renderToStaticMarkup } from 'react-dom/server';

const reportError = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
// What `import('../components/GroupChatWidget')` brings in this file: a stand-in (the real one needs Firebase), so the
// shipped wiring — lazyParts' loader, its `loaded`, and the wrapper's default export — runs as it is.
const widgetImports = vi.fn();
vi.mock('./GroupChatWidget', async () => {
  widgetImports();
  const { createElement: h } = await import('react');
  return { default: (p: { title: string }) => h('p', null, `wired ${p.title}`) };
});

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
let OnDemand: typeof import('./GroupChatWidgetOnDemand');
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
  OnDemand = await import('./GroupChatWidgetOnDemand');
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

describe('the calendar’s floating chat, drawn when its code arrives (06.11.2026)', () => {
  const PROPS = { convId: 'g1', convKind: 'group', title: 'Family', userMap: {} };
  const Widget = (p: { title: string }) => createElement('p', null, `chat ${p.title}`);

  it('nothing until it arrives, then the widget, with its props, and ONE load', async () => {
    let arrive!: (w: typeof Widget) => void;
    const load = vi.fn(() => new Promise<typeof Widget>((r) => { arrive = r; }));
    const Chat = OnDemand.onArrival(load as never, () => null);
    const container = new MiniElement('div');
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    root.render(createElement(Chat, PROPS as never));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe('');
    arrive(Widget);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe('chat Family');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('already here (the idle warm-up): drawn in the very render that mounts it, without a load', () => {
    const load = vi.fn(() => Promise.resolve(Widget));
    const Chat = OnDemand.onArrival(load as never, () => Widget as never);
    // The server renderer runs one render and no effects: what it shows is the first render.
    expect(renderToStaticMarkup(createElement(Chat, PROPS as never))).toBe('<p>chat Family</p>');
    expect(load).not.toHaveBeenCalled();
  });

  it('not here yet: the first render is empty, and it is the effect that asks for it', () => {
    const load = vi.fn(() => new Promise(() => {}));
    const Chat = OnDemand.onArrival(load as never, () => null);
    expect(renderToStaticMarkup(createElement(Chat, PROPS as never))).toBe('');
    expect(load).not.toHaveBeenCalled();
  });

  for (const afterMs of [-1, 20]) {
    it(`a chunk that cannot load reaches the boundary as a chunk, with ONE load, reported once (${afterMs < 0 ? 'at once' : 'after a round trip'})`, async () => {
      const load = failing(afterMs);
      const Chat = OnDemand.onArrival(load as never, () => null);
      const seen: boolean[] = [];
      const text = await mount(createElement(ErrorBoundary, {
        context: 'GroupChatWidget',
        fallback: ({ chunk }: { chunk: boolean }) => { seen.push(chunk); return chunk ? 'reload the page' : 'could not be shown'; },
        children: createElement(Chat, PROPS as never),
      }), 300);
      expect(text).toBe('reload the page');
      expect(seen.every((c) => c === true)).toBe(true);
      expect(load).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError.mock.calls[0][1]).toMatchObject({ context: 'StaleChunk' });
    });
  }

  it('unread counts from when the chat was SHOWN, not from when its code came (review of 06.11.2026)', async () => {
    let arrive!: (w: unknown) => void;
    const seen: Array<number | undefined> = [];
    const Probe = (p: { unreadSince?: number }) => { seen.push(p.unreadSince); return createElement('p', null, 'probe'); };
    const load = vi.fn(() => new Promise((r) => { arrive = r; }));
    const Chat = OnDemand.onArrival(load as never, () => null);
    const shownFrom = Date.now();
    const container = new MiniElement('div');
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    root.render(createElement(Chat, PROPS as never));
    await new Promise((r) => setTimeout(r, 30));
    const shownBy = Date.now();
    await new Promise((r) => setTimeout(r, 80));
    const arrivedAt = Date.now();
    arrive(Probe);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe('probe');
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s).toBeGreaterThanOrEqual(shownFrom);
      expect(s).toBeLessThanOrEqual(shownBy);
      expect(s!).toBeLessThan(arrivedAt);
    }
  });

  it('offline before the code came: no fetch spent, nothing drawn; back online: ONE load, and the chat', async () => {
    const listeners = new Set<() => void>();
    const env = {
      onLine: false as boolean | undefined,
      addEventListener: ((t: string, fn: () => void) => { if (t === 'online') listeners.add(fn); }) as never,
      removeEventListener: ((t: string, fn: () => void) => { if (t === 'online') listeners.delete(fn); }) as never,
    };
    const load = vi.fn(() => Promise.resolve(Widget));
    const Chat = OnDemand.onArrival(load as never, () => null, () => env);
    const container = new MiniElement('div');
    const root = createRoot(container as unknown as Element);
    roots.push(root);
    root.render(createElement(Chat, PROPS as never));
    await new Promise((r) => setTimeout(r, 50));
    expect(load).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
    env.onLine = true;
    for (const fn of [...listeners]) fn();
    await new Promise((r) => setTimeout(r, 50));
    expect(load).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('chat Family');
    expect(listeners.size).toBe(0);
  });

  it('offline, then the tab switched away: the wait ends with it, and nothing loads later', async () => {
    const listeners = new Set<() => void>();
    const env = {
      onLine: false as boolean | undefined,
      addEventListener: ((t: string, fn: () => void) => { if (t === 'online') listeners.add(fn); }) as never,
      removeEventListener: ((t: string, fn: () => void) => { if (t === 'online') listeners.delete(fn); }) as never,
    };
    const load = vi.fn(() => Promise.resolve(Widget));
    const Chat = OnDemand.onArrival(load as never, () => null, () => env);
    const container = new MiniElement('div');
    const root = createRoot(container as unknown as Element);
    root.render(createElement(Chat, PROPS as never));
    await new Promise((r) => setTimeout(r, 30));
    expect(listeners.size).toBe(1);
    root.unmount();
    expect(listeners.size).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('a time the caller gives wins over the time it was shown', () => {
    const seen: Array<number | undefined> = [];
    const Probe = (p: { unreadSince?: number }) => { seen.push(p.unreadSince); return null; };
    const Chat = OnDemand.onArrival((() => Promise.resolve(Probe)) as never, () => Probe as never);
    renderToStaticMarkup(createElement(Chat, { ...PROPS, unreadSince: 1234 } as never));
    expect(seen).toEqual([1234]);
  });

  it('the shipped wiring: the warm-up’s own loader fills what the first render reads, with one import', async () => {
    const parts = await import('../utils/lazyParts');
    expect(parts.loadedGroupChatWidget()).toBeNull();
    expect(renderToStaticMarkup(createElement(OnDemand.default, PROPS as never))).toBe('');
    // What App.tsx warms while idle: the very function in LAZY_PARTS.
    const warmed = parts.LAZY_PARTS.find((l) => l === parts.loadGroupChatWidget);
    expect(warmed).toBeDefined();
    await warmed!();
    expect(parts.loadedGroupChatWidget()).not.toBeNull();
    // The calendar's wrapper, as shipped, draws it in its first render now.
    expect(renderToStaticMarkup(createElement(OnDemand.default, PROPS as never))).toBe('<p>wired Family</p>');
    await parts.loadGroupChatWidget();
    expect(widgetImports).toHaveBeenCalledTimes(1);
  });
});
