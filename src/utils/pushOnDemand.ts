// src/utils/pushOnDemand.ts
//
// How the calendar starts web push since 07.11.2026, when the code that does it (utils/webPushStart.ts) and Firebase
// Messaging left the chunk every person loads at boot. Pure of Firebase: the loader and the reporter are given, so the
// order is tested here (pushOnDemand.test.ts) without a browser.
//
//   * Asked for once the calendar is mounted AND the browser is online. On Chromium a module fetch that failed stays
//     failed for the life of the page (utils/routeWarmup.ts), so one spent offline would leave the whole visit without
//     the token refresh and the foreground notifications. Offline, it waits for the `online` event.
//   * Started only if the calendar is still there when the code arrives; stopped (the foreground handler) when it goes.
//   * A load that fails is reported ONCE per page: a failed chunk fails again at once on every later mount (Chromium),
//     and each would otherwise file the same row. A tab older than a deploy is reported as one ('StaleChunk').

import { whenOnline, type OnlineEnv } from './routeWarmup';
import { isStaleChunkError } from './appVersion';
import { describeThrown } from './describeThrown';

export interface WebPushModule { startWebPush(): () => void }
export type Report = (message: string, opts: { stack?: string; context: string }) => void;

/** One per page: what the calendar calls on mount; it returns what the calendar calls on unmount. */
export function webPushOnDemand(load: () => Promise<WebPushModule>, report: Report) {
  let loadFailureReported = false;
  return function startWhenOnline(env: OnlineEnv): () => void {
    let gone = false;
    let stop: (() => void) | null = null;
    const stopWaiting = whenOnline(() => {
      load().then(
        (module) => {
          if (gone) return;
          try {
            stop = module.startWebPush();
          } catch (error) {
            const thrown = describeThrown(error);
            report(thrown.message, { stack: thrown.stack || undefined, context: 'fcm.start' });
          }
        },
        (error: unknown) => {
          if (loadFailureReported) return;
          loadFailureReported = true;
          const thrown = describeThrown(error);
          report(thrown.message, { stack: thrown.stack || undefined, context: isStaleChunkError(thrown.message) ? 'StaleChunk' : 'fcm.load' });
        },
      );
    }, env);
    return () => {
      gone = true;
      stopWaiting();
      stop?.();
      stop = null;
    };
  };
}
