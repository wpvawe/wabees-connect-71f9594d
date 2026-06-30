/**
 * Firebase Web SDK singleton. Auto-initialized from VITE_FIREBASE_* env vars.
 * Mirrors the Flutter app's Firebase project so app & website share the same
 * users and Firestore data.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

function ensureApp(): FirebaseApp {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error("Firebase env vars missing (VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID)");
  }
  return initializeApp(firebaseConfig);
}

// SSR-safe lazy accessors — Firebase Auth touches `window`, so only run in browser.
let _auth: Auth | null = null;
let _db: Firestore | null = null;

export function fbAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error("fbAuth() called in non-browser context");
  }
  if (!_auth) _auth = getAuth(ensureApp());
  return _auth;
}

export function fbDb(): Firestore {
  if (!_db) _db = getFirestore(ensureApp());
  return _db;
}

/** Browser-only: returns the auth instance, or null when called during SSR. */
export function fbAuthOrNull(): Auth | null {
  if (typeof window === "undefined") return null;
  return fbAuth();
}

export const WABEES_API_BASE =
  (import.meta.env.VITE_WABEES_API_BASE as string | undefined) ?? "https://api.wabees.live";

/** Browser-only: returns the Firestore instance, or null in SSR. */
export function fbDbOrNull(): Firestore | null {
  if (typeof window === "undefined") return null;
  return fbDb();
}
