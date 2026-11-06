// src/utils/routeWarmup.ts
//
// Fetch lazy screens ahead of time, and never let a failure escape.
//
// Every rejection here must be swallowed: `reportError` listens for unhandled rejections and would
// file a failed warm-up (offline, or a chunk replaced by a deploy) in the error log as a crash. The
// real navigation later loads the chunk again and reports properly if it truly fails.

/**
 * Run `run` now if the browser says it is online, else once it says so (06.11.2026). The warm-up's fetch of a chunk
 * is the one the page keeps: on Chromium a module fetch that failed stays failed until a reload, so spending it
 * offline turned the calendar's chat off for the whole visit. Returns what stops the wait (nothing to stop if it ran).
 * `navigator.onLine` false is reliable (no network at all); true is not a promise of a connection, so a fetch can
 * still fail, and the part then says to reload.
 */
export interface OnlineEnv {
  onLine: boolean | undefined;
  addEventListener: Window['addEventListener'];
  removeEventListener: Window['removeEventListener'];
}

/** This browser, read when asked: whether it is online now, and its `online` event. */
export function browserOnline(): OnlineEnv {
  return {
    onLine: typeof navigator === 'undefined' ? undefined : navigator.onLine,
    addEventListener: (...a: Parameters<Window['addEventListener']>) => window.addEventListener(...a),
    removeEventListener: (...a: Parameters<Window['removeEventListener']>) => window.removeEventListener(...a),
  };
}

export function whenOnline(run: () => void, env: OnlineEnv): () => void {
  if (env.onLine !== false) { run(); return () => {}; }
  const go = () => { env.removeEventListener('online', go); run(); };
  env.addEventListener('online', go);
  return () => env.removeEventListener('online', go);
}

export async function warmRoutes(loaders: ReadonlyArray<() => Promise<unknown>>): Promise<void> {
  await Promise.allSettled(loaders.map((load) => {
    try { return load(); } catch (e) { return Promise.reject(e); }
  }));
}
