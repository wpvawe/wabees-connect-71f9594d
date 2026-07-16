/**
 * Firebase Web SDK singleton. Auto-initialized from VITE_FIREBASE_* env vars.
 * Mirrors the Flutter app's Firebase project so app & website share the same
 * users and Firestore data.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, onIdTokenChanged, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

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
  if (!_auth) {
    _auth = getAuth(ensureApp());
    startIdTokenCache(_auth);
  }
  return _auth;
}

export function fbDb(): Firestore {
  if (!_db) {
    const app = ensureApp();
    if (typeof window !== "undefined") {
      // Persistent local cache: survives reloads and shares across tabs.
      // Cuts cold-start Firestore reads massively — see audit §1.8.
      try {
        _db = initializeFirestore(app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        });
      } catch {
        // initializeFirestore throws if already initialised (HMR); fall back.
        _db = getFirestore(app);
      }
    } else {
      _db = getFirestore(app);
    }
  }
  return _db;
}

/** Browser-only: returns the auth instance, or null when called during SSR. */
export function fbAuthOrNull(): Auth | null {
  if (typeof window === "undefined") return null;
  return fbAuth();
}

function normalizeWabeesApiBase(value: string | undefined): string {
  const base = (value || "https://api.wabees.live/api").replace(/\/+$/, "");
  // The `api.` subdomain serves PHP files at the root (no `/api` subfolder).
  // Strip a misconfigured trailing `/api` so requests hit the real files.
  if (/^https:\/\/api\.wabees\.live(\/api)?$/i.test(base)) {
    return "https://api.wabees.live";
  }
  return base;
}

export const WABEES_API_BASE = normalizeWabeesApiBase(
  import.meta.env.VITE_WABEES_API_BASE as string | undefined,
);

/** Browser-only: returns the Firestore instance, or null in SSR. */
export function fbDbOrNull(): Firestore | null {
  if (typeof window === "undefined") return null;
  return fbDb();
}

/**
 * Cached Firebase id token — kept fresh by `onIdTokenChanged` so synchronous
 * consumers (like `<img src>` URLs built by `mediaProxyUrl`) can attach the
 * bearer via query string without waiting on `getIdToken()`. Null before the
 * first sign-in / token fetch completes.
 */
let _cachedIdToken: string | null = null;
let _idTokenStarted = false;
function startIdTokenCache(auth: Auth): void {
  if (_idTokenStarted) return;
  _idTokenStarted = true;
  onIdTokenChanged(auth, (user) => {
    if (!user) {
      _cachedIdToken = null;
      return;
    }
    user
      .getIdToken()
      .then((t) => {
        _cachedIdToken = t || null;
      })
      .catch(() => {
        _cachedIdToken = null;
      });
  });
}
export function getCachedIdToken(): string | null {
  return _cachedIdToken;
}
