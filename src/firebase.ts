import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCvf0UH3U9LWoLA85dyvR1zAqLbixWSQ58",
  authDomain: "our-days-2a939.firebaseapp.com",
  projectId: "our-days-2a939",
  storageBucket: "our-days-2a939.firebasestorage.app",
  messagingSenderId: "1041245506351",
  appId: "1:1041245506351:web:e44a8c985842a67e2cafda",
  measurementId: "G-SJMJJNPLCF"
};

const app = initializeApp(firebaseConfig);
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
