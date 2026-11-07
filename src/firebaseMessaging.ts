// src/firebaseMessaging.ts
//
// Firebase Messaging (web push), apart from src/firebase.ts (07.11.2026), so it is no longer in the chunk every person
// loads at boot. Two modules use it, both loaded on demand: the calendar's push registration (utils/webPushStart.ts,
// asked for once the calendar is mounted and the browser is online) and sign-out in Settings (`deleteToken`).
// `scripts/check-split.mjs` refuses a build that brings it back into boot.
//
// Made only where web push can work (review of 07.11.2026). `getMessaging` checks support by itself, in a promise
// nobody can catch, and rejects it with "messaging/unsupported-browser": in the APK's WebView, an iPhone's Safari outside
// an installed app, a private Firefox window. At boot that rejection came before anybody was signed in, so the error
// log dropped it; here it would come after, and file a row on every visit. So the SDK's own check is asked first, and
// those browsers get null, as the server did: no permission prompt, no token, nothing to report.

import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';
import { app } from './firebase';
import { reportError } from './reportError';
import { describeThrown } from './utils/describeThrown';

/**
 * This browser's Messaging, once its support is known; null where web push cannot work. Never rejects: the support
 * check does not, and a Messaging that cannot be made where it is supported is reported, then null.
 */
export const messagingReady: Promise<Messaging | null> = typeof window === 'undefined'
  ? Promise.resolve(null)
  : isSupported().then((ok) => (ok ? getMessaging(app) : null)).catch((error: unknown) => {
    const thrown = describeThrown(error);
    reportError(thrown.message, { stack: thrown.stack || undefined, context: 'fcm.init' });
    return null;
  });
