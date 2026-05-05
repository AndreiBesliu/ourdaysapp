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

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icons.svg'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
