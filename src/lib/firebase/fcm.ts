/**
 * Firebase Cloud Messaging — browser push notifications.
 * Requests permission, registers SW, gets token, saves under
 * users/{uid}.fcmToken so the PHP backend webhook can target it.
 * Foreground messages surface as toasts + native browser notifications.
 * Gracefully no-ops when VAPID key is missing or messaging unsupported.
 */
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { toast } from "sonner";
import { playNotificationChime } from "@/lib/notification-sound";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let listening = false;
let lastSavedKey = "";

type InitFcmInput = {
  uid: string;
  effectiveUid?: string | null;
  dataOwner?: string | null;
};

function postFirebaseConfig(reg: ServiceWorkerRegistration) {
  const message = {
    type: "FIREBASE_CONFIG",
    config: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    },
  };
  reg.active?.postMessage(message);
  reg.waiting?.postMessage(message);
  reg.installing?.postMessage(message);
}

async function saveFcmToken(input: InitFcmInput, token: string) {
  const db = fbDb();
  const tokenData = {
    fcmToken: token,
    fcmTokenUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Own user doc is what the webhook reads for owners, and it also keeps the
  // browser token with the signed-in account even if this account is an agent.
  await setDoc(doc(db, "users", input.uid), tokenData, { merge: true });

  // For agent accounts, the PHP webhook reads users/{owner}/agents/{agent}.fcmToken.
  // Mirror the browser token there so agents receive pushes too.
  const ownerUid = input.dataOwner || input.effectiveUid;
  if (ownerUid && ownerUid !== input.uid) {
    await setDoc(
      doc(db, "users", ownerUid, "agents", input.uid),
      {
        fcmToken: token,
        fcmTokenUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => undefined);
  }
}

export async function initFcm(input: InitFcmInput): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!("Notification" in window)) return;
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
    const readyReg = await navigator.serviceWorker.ready;
    postFirebaseConfig(reg);
    postFirebaseConfig(readyReg);
    // Main Firebase app is already initialized in
    // `integrations/firebase/client.ts` — no re-init needed.
    const messaging = getMessaging();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: readyReg,
    });
    if (token) {
      try {
        const saveKey = `${input.uid}:${input.effectiveUid || ""}:${input.dataOwner || ""}:${token}`;
        if (saveKey !== lastSavedKey) {
          await saveFcmToken(input, token);
          lastSavedKey = saveKey;
        }
      } catch {
        /* rules may block in edge cases; push is best-effort */
      }
    }
    if (listening) return;
    onMessage(messaging, (payload) => {
      const title =
        payload.notification?.title ||
        (payload.data?.title as string | undefined) ||
        "New message";
      const body =
        payload.notification?.body || (payload.data?.body as string | undefined) || "";
      toast(title, { description: body });
      // Only fire the system-level Notification when the tab is hidden.
      // Otherwise the user sees BOTH a toast and an OS popup for the same
      // message — jarring and easy to mis-click.
      const hidden =
        typeof document !== "undefined" && document.visibilityState === "hidden";
      if (hidden && Notification.permission === "granted") {
        try {
          new Notification(title, {
            body,
            icon: "/wabees-icon.png",
            badge: "/wabees-icon.png",
            tag: (payload.data?.tag as string | undefined) || "wabees-message",
            data: payload.data || {},
          });
        } catch {
          /* ignore */
        }
      }
      // Play a short ping for new-message feel. Uses the WebAudio-based
      // notification chime so we never depend on a real audio source (the old
      // inline base64 MP3 was an empty ID3 header that some browsers reject
      // with NotSupportedError, polluting the console).
      playNotificationChime();
    });
    listening = true;
  } catch {
    /* swallow — push is best-effort */
  }
}