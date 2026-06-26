/**
 * Firebase Web SDK singleton (auth + firestore only — tree-shaken).
 * Init is lazy: call `initFirebase(config)` once before using the helpers.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function initFirebase(config: FirebasePublicConfig): FirebaseApp {
  if (app) return app;
  const existing = getApps();
  app = existing[0] ?? initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  return app;
}

export function getFb(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!app || !auth || !db) throw new Error("Firebase not initialized — call initFirebase() first");
  return { app, auth, db };
}

export function fbAuthOrNull(): Auth | null {
  return auth;
}

export function fbDbOrNull(): Firestore | null {
  return db;
}