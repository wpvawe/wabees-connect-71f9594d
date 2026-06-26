/**
 * Server-only Firebase helpers. REST-based (no firebase-admin SDK) so it
 * runs anywhere — including Cloudflare Workers. Never import from client.
 */
import { createSign, createPrivateKey } from "node:crypto";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

let cachedSa: ServiceAccount | null = null;
let cachedAccessToken: { token: string; exp: number } | null = null;

function sa(): ServiceAccount {
  if (cachedSa) return cachedSa;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not set");
  const parsed = JSON.parse(raw) as ServiceAccount;
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  cachedSa = parsed;
  return parsed;
}

export function firebaseProjectId(): string {
  return sa().project_id;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Mint a Firebase custom token (1h validity) for a given uid. */
export async function mintCustomToken(uid: string): Promise<string> {
  const { client_email, private_key } = sa();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: client_email,
    sub: client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = createPrivateKey(private_key);
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key);
  return `${unsigned}.${b64url(sig)}`;
}

/** Mint OAuth2 access token for Google APIs using service account JWT. */
async function getAccessToken(scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.exp - 60 > now) return cachedAccessToken.token;
  const { client_email, private_key } = sa();
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = createPrivateKey(private_key);
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key);
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

/** Identity Toolkit: verify email+password. Returns Firebase uid or null. */
export async function verifyFirebasePassword(email: string, password: string): Promise<{ uid: string; displayName?: string; email: string } | null> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("FIREBASE_WEB_API_KEY not set");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { localId: string; displayName?: string; email: string };
  return { uid: json.localId, displayName: json.displayName, email: json.email };
}

/** Identity Toolkit: look up user by email via Admin API (service account). */
export async function getFirebaseUserByEmail(email: string): Promise<{ uid: string; displayName?: string } | null> {
  const token = await getAccessToken(["https://www.googleapis.com/auth/cloud-platform"]);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId()}/accounts:lookup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: [email] }),
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { users?: Array<{ localId: string; displayName?: string }> };
  const u = json.users?.[0];
  return u ? { uid: u.localId, displayName: u.displayName } : null;
}

/** Identity Toolkit: create a new Firebase user with email+password. */
export async function createFirebaseUser(email: string, password: string, displayName?: string): Promise<string> {
  const token = await getAccessToken(["https://www.googleapis.com/auth/cloud-platform"]);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId()}/accounts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, password, displayName, emailVerified: false }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firebase user create failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { localId: string };
  return json.localId;
}

/** Firestore REST: read a document. Returns parsed fields or null. */
export async function firestoreGetDoc(path: string): Promise<Record<string, unknown> | null> {
  const token = await getAccessToken(["https://www.googleapis.com/auth/datastore"]);
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseProjectId()}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status}`);
  const json = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  return json.fields ? decodeFields(json.fields) : null;
}

/** Firestore REST: write (patch) a document. Creates if missing. */
export async function firestoreSetDoc(path: string, data: Record<string, unknown>): Promise<void> {
  const token = await getAccessToken(["https://www.googleapis.com/auth/datastore"]);
  const fields = encodeFields(data);
  const updateMask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseProjectId()}/databases/(default)/documents/${path}?${updateMask}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields }),
    },
  );
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// --- Firestore value (de)serialization (minimal subset) ---
type FirestoreValue =
  | { stringValue: string } | { integerValue: string } | { doubleValue: number }
  | { booleanValue: boolean } | { nullValue: null } | { timestampValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } };

function encodeValue(v: unknown): FirestoreValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}
function encodeFields(o: Record<string, unknown>): Record<string, FirestoreValue> {
  const out: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(o)) out[k] = encodeValue(v);
  return out;
}
function decodeValue(v: FirestoreValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields ?? {});
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeValue);
  return null;
}
function decodeFields(f: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) out[k] = decodeValue(v);
  return out;
}