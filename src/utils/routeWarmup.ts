// src/utils/routeWarmup.ts
//
// Fetch lazy screens ahead of time, and never let a failure escape.
//
// Every rejection here must be swallowed: `reportError` listens for unhandled rejections and would
// file a failed warm-up (offline, or a chunk replaced by a deploy) in the error log as a crash. The
// real navigation later loads the chunk again and reports properly if it truly fails.

export async function warmRoutes(loaders: ReadonlyArray<() => Promise<unknown>>): Promise<void> {
  await Promise.allSettled(loaders.map((load) => {
    try { return load(); } catch (e) { return Promise.reject(e); }
  }));
}
