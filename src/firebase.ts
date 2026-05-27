import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
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
// Storage and the callable Gemini functions from abuse. Only initialised when a
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
export const db = getFirestore(app);

// Enable Offline Mode
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == 'failed-precondition') {
    console.warn('Multiple tabs open, offline mode disabled.');
  } else if (err.code == 'unimplemented') {
    console.warn('Current browser does not support offline mode.');
  }
});

export const storage = getStorage(app);
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;
