/**
 * Firebase Cloud Messaging — browser push notifications.
 * Requests permission, registers SW, gets token, saves under
 * users/{uid}.fcmToken so the PHP backend webhook can target it.
 * Foreground messages surface as toasts + native browser notifications.
 * Gracefully no-ops when VAPID key is missing or messaging unsupported.
 */
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { initializeApp, getApps } from "firebase/app";
import { toast } from "sonner";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let started = false;

export async function initFcm(uid: string): Promise<void> {
  if (started) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!VAPID_KEY) {
    // Silent: project hasn't configured a Web Push VAPID key yet.
    return;
  }
  try {
    const ok = await isSupported();
    if (!ok) return;
    if (Notification.permission === "denied") return;
    if (Notification.permission === "default") {
      const res = await Notification.requestPermission();
      if (res !== "granted") return;
    }
    // Ensure the messaging service worker is registered. It re-initializes
    // Firebase inside the worker scope using the same config.
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    // Pass config to the SW (in case it's a fresh install).
    reg.active?.postMessage({
      type: "FIREBASE_CONFIG",
      config: {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      },
    });
    if (getApps().length === 0) {
      initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
        appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
      });
    }
    const messaging = getMessaging();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (token) {
      // Match Flutter app: single `fcmToken` field on users/{uid}. The PHP
      // webhook reads exactly that field to target push notifications.
      try {
        await updateDoc(doc(fbDb(), "users", uid), {
          fcmToken: token,
          updatedAt: serverTimestamp(),
        });
      } catch {
        /* user doc may not exist yet; ignore */
      }
    }
    onMessage(messaging, (payload) => {
      const title =
        payload.notification?.title ||
        (payload.data?.title as string | undefined) ||
        "New message";
      const body =
        payload.notification?.body || (payload.data?.body as string | undefined) || "";
      toast(title, { description: body });
      // Play a short ping for new-message feel.
      try {
        const a = new Audio(
          "data:audio/mp3;base64,SUQzAwAAAAAAFlRJVDIAAAAGAAAAYWxlcnQAVENPTgAAAAYAAABTb3VuZAA=",
        );
        a.volume = 0.4;
        void a.play();
      } catch {
        /* ignore */
      }
    });
    started = true;
  } catch {
    /* swallow — push is best-effort */
  }
}