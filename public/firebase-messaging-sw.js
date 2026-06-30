/* eslint-disable */
// Firebase Cloud Messaging service worker for background notifications.
// The page posts FIREBASE_CONFIG to seed initializeApp; we keep a default
// fallback for first install before the page handshake completes.
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

let initialized = false;
const defaultFirebaseConfig = {
  apiKey: "AIzaSyCPERUDcrM-IUPqy9ZKjen9Hx5-y1X5pTA",
  authDomain: "wabees-app.firebaseapp.com",
  projectId: "wabees-app",
  appId: "1:221545100008:web:7e73a0122fb0884ba14f5d",
  messagingSenderId: "221545100008",
  storageBucket: "wabees-app.firebasestorage.app",
};

function init(config) {
  if (initialized) return;
  try {
    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const title =
        (payload.notification && payload.notification.title) ||
        (payload.data && payload.data.title) ||
        "Wabees";
      const body =
        (payload.notification && payload.notification.body) ||
        (payload.data && payload.data.body) ||
        "";
      self.registration.showNotification(title, {
        body,
        icon: "/wabees-icon.png",
        badge: "/favicon.ico",
        tag: (payload.data && payload.data.tag) || "wabees-message",
        renotify: true,
        data: payload.data || {},
      });
    });
    initialized = true;
  } catch (e) {
    /* ignore */
  }
}

// Critical for closed-tab/background delivery: the service worker may start
// without any page open, so no FIREBASE_CONFIG message can arrive first.
init(defaultFirebaseConfig);

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREBASE_CONFIG") {
    init(event.data.config);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const phone = event.notification.data && event.notification.data.contactPhone;
  const targetUrl = phone ? `/?contact=${encodeURIComponent(phone)}` : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    }),
  );
});