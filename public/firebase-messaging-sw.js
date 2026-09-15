importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCvf0UH3U9LWoLA85dyvR1zAqLbixWSQ58",
  authDomain: "our-days-2a939.firebaseapp.com",
  projectId: "our-days-2a939",
  storageBucket: "our-days-2a939.firebasestorage.app",
  messagingSenderId: "1041245506351",
  appId: "1:1041245506351:web:e44a8c985842a67e2cafda",
  measurementId: "G-SJMJJNPLCF"
});

const messaging = firebase.messaging();

// Deliberately NO showNotification here.
//
// When a push carrying a `notification` block arrives in the background, the Firebase SDK's own
// push handler displays it first and THEN calls this hook (onPush in @firebase/messaging's SW
// build: `if (internalPayload.notification) await showNotification(...)`, then
// `onBackgroundMessageHandler(payload)`). A handler that called showNotification too produced
// two notifications from one delivery — measured on 15 Sept 2026: the panel reported "pushed to
// 1 device" and the lock screen showed the same message twice.
//
// The icon this handler used to add now travels in the server payload (webpush.notification in
// functions/src/notify.ts), where the SDK's display honours it, along with a tag and a link.
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] background message displayed by the SDK', payload && payload.data);
});
