// src/utils/webPushStart.ts
//
// The calendar's web push, loaded on demand (07.11.2026): asking for permission, registering this browser's token, and
// showing a push that arrives while the app is in the foreground. With it goes Firebase Messaging, which sat in the chunk
// every person loads at boot. The calendar asks for this module once it is mounted and the browser is online
// (utils/pushOnDemand.ts). Until 07.11.2026 this was the effect in CalendarHome.tsx; the code is the same, moved, with
// one difference: it waits for Messaging's support check (src/firebaseMessaging.ts), and where web push cannot work (the
// APK's WebView, an iPhone's Safari outside an installed app) it does nothing. There it used to ask
// `Notification.requestPermission()` of a browser with no `Notification`, and file the ReferenceError on every mount.
//
// Accepted (reverify of 07.11.2026): a push that arrives while the page is visible but before `onMessage` has run here is
// not shown. The FCM worker hands a push to a visible page instead of showing it, and the page has no handler yet. That
// was already so from boot to the calendar's mount; loading on demand adds the fetch of this chunk and of Messaging's.

import { getToken, onMessage, type Messaging } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { messagingReady } from '../firebaseMessaging';
import { reportError } from '../reportError';
import { vapidKeyProblem } from './webPush';
import { rememberPushToken } from './pushRelease';

/**
 * Request notification permission, save the FCM token, and show foreground pushes, once Messaging's support is known.
 * Returns what stops the latter; called before support is known, it means nothing starts.
 */
export function startWebPush(): () => void {
  if (!auth.currentUser) return () => {};
  let stopped = false;
  let stopForeground: (() => void) | null = null;
  void messagingReady.then((fcm) => {
    if (stopped || !fcm) return;
    stopForeground = startWith(fcm);
  }).catch((error: unknown) => {
    reportError(error instanceof Error ? error.message : String(error), { context: 'fcm.start' });
  });
  return () => {
    stopped = true;
    stopForeground?.();
    stopForeground = null;
  };
}

function startWith(fcm: Messaging): () => void {
  const requestPermission = async () => {
    // This registration had been failing on every browser, for every account, since May. The key
    // below used to be a hard-coded 44-character string where a Web Push application server key
    // must be 87 — so `subscribe()` rejected every time, the `updateDoc` never ran, and
    // `users/{uid}.fcmTokens` was never written on a single one of the eight accounts. Every push
    // the app has ever tried to send skipped every recipient for want of a token, including the
    // reminders whose entire purpose is to reach a phone.
    //
    // Nothing said so. The catch wrote to the console rather than the error log, and the browser
    // still showed the permission prompt, so even the user's own feedback said it had worked.
    const problem = vapidKeyProblem(import.meta.env.VITE_FIREBASE_VAPID_KEY);
    if (problem) {
      // Reported, never merely logged: a configuration fault that reaches only the console is a
      // fault nobody learns about, which is exactly how this survived four months.
      reportError(`Web push is not configured: ${problem}`, { context: 'fcm.token.web' });
      return;
    }

    try {
      // Asked AFTER the key is known good. Prompting first would burn the single chance to ask
      // somebody for notification permission on a registration that cannot succeed anyway.
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const token = await getToken(fcm, {
          vapidKey: String(import.meta.env.VITE_FIREBASE_VAPID_KEY).trim(),
        });
        if (token) {
          await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
            fcmTokens: arrayUnion(token)
          });
          // So sign-out knows which token THIS device added, and for whom.
          rememberPushToken(auth.currentUser!.uid, token);
        }
      }
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'fcm.token.web' });
    }
  };

  requestPermission();

  // A push that arrives while the app is in the FOREGROUND is not shown by the service worker;
  // it is handed to the page, and a page with no handler drops it on the floor. That is what
  // happened to the very first test: the broadcast was sent from inside the app.
  //
  // Shown through the FCM worker's registration when it can be found, so the notification is
  // owned by the same worker that shows background pushes. It is asked for by SCOPE: the SDK
  // registers firebase-messaging-sw.js under '/firebase-cloud-messaging-push-scope', while
  // `navigator.serviceWorker.ready` resolves to the PWA worker at '/' — a first draft used
  // `.ready` and claimed otherwise in this comment. (Review finding.) Any registration can show
  // a notification, so `.ready` remains the fallback.
  return onMessage(fcm, (payload) => {
    const title = payload.notification?.title || payload.data?.title;
    if (!title) return;
    const body = payload.notification?.body || payload.data?.body || '';
    void (async () => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      try {
        const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
        const reg = sw
          ? (await sw.getRegistration('/firebase-cloud-messaging-push-scope')) || (await sw.ready)
          : null;
        // Same icon and the same collapsing `tag` the server puts on the background copy, so a
        // device holding two subscriptions shows one notification, not one per subscription.
        const tag = payload.data?.tag;
        const options: NotificationOptions = { body, icon: '/icons.svg', data: payload.data, ...(tag ? { tag } : {}) };
        if (reg) await reg.showNotification(title, options);
        else new Notification(title, options);
      } catch (err) {
        reportError(err instanceof Error ? err.message : String(err), { context: 'fcm.foreground' });
      }
    })();
  });
}
