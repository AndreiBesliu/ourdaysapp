import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export const app = initializeApp(firebaseConfig);

// ── App Check ──
// Attests that requests come from our genuine app, protecting Firestore,
// Storage and the callable AI functions from abuse. Only initialised when a
// reCAPTCHA v3 site key is configured (VITE_APPCHECK_RECAPTCHA_KEY), so local
// dev / builds without it keep working. Enforcement itself is toggled server-side
// (Firebase Console + the APPCHECK_ENFORCE function flag), so shipping this alone
// is non-breaking — it just starts attaching App Check tokens once a key is set.
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_RECAPTCHA_KEY;
if (typeof window !== "undefined" && appCheckSiteKey) {
  // In dev, print a debug token to the console to register under
  // App Check → Apps → Manage debug tokens (so localhost passes attestation).
  if (import.meta.env.DEV) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);

// ── The local cache: persistent, and shared by every tab ─────────────────────────────────────
//
// It was `enableIndexedDbPersistence`, which gives the cache to ONE tab. Every other tab of the app
// fell back to memory: no copy of anything at start, only the SDK's warning in the console
// ("Failed to obtain exclusive access to the persistence layer"). Reproduced 28.09.2026 against
// the emulator, two tabs, this very file: the second tab's first snapshot waited for the server.
// The same day, Andrei's retraction reports showed, at every start, a local copy of his account
// document without the birthday it has had on the server since the day before — consistent with a
// tab that has no persistent cache, though that part is inferred, not measured.
//
// The multi-tab manager lets every tab share one IndexedDB cache; the network is held by one of
// them and the others follow through it. Where IndexedDB is unavailable the SDK falls back to
// memory by itself, as before. It also ends the deprecation warning `enableIndexedDbPersistence`
// printed on every load.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;
