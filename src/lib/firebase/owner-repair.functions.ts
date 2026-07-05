import { createServerFn } from "@tanstack/react-start";

type RepairInput = {
  idToken: string;
  phoneNumberId: string;
  accessToken?: string;
  businessAccountId?: string;
  displayPhone?: string;
  businessName?: string;
  qualityRating?: string;
  connectedVia?: "embedded_signup" | "manual";
};

type RepairResult = {
  ownerId: string | null;
  repaired: boolean;
  candidates: string[];
};

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: FsFields };
  arrayValue?: { values?: FsValue[] };
};

type FsFields = Record<string, FsValue>;
type Candidate = {
  id: string;
  fields: FsFields;
  fromTopLevel?: boolean;
  fromConfig?: boolean;
  fromToken?: boolean;
  fromMapOwner?: boolean;
  fromMapUsers?: boolean;
  fromEmail?: boolean;
  samples?: Record<string, number>;
};

function readRuntimeEnv(...keys: string[]): string {
  const runtimeBindings = (
    globalThis as typeof globalThis & {
      __WABEES_RUNTIME_ENV__?: Record<string, unknown>;
    }
  ).__WABEES_RUNTIME_ENV__;
  const processEnv = typeof process !== "undefined" ? process.env : undefined;
  const viteEnv = import.meta.env as Record<string, unknown>;
  for (const key of keys) {
    const value = runtimeBindings?.[key] ?? processEnv?.[key] ?? viteEnv[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeWabeesApiBase(value: string): string {
  const base = (value || "https://api.wabees.live").replace(/\/+$/, "");
  if (/^https:\/\/api\.wabees\.live\/api$/i.test(base)) return "https://api.wabees.live";
  return base;
}

function parseInput(raw: unknown): RepairInput {
  const data = raw as Partial<RepairInput> | null;
  const idToken = typeof data?.idToken === "string" ? data.idToken.trim() : "";
  const phoneNumberId = typeof data?.phoneNumberId === "string" ? data.phoneNumberId.trim() : "";
  if (!idToken || !phoneNumberId) throw new Error("Missing Firebase session or phone number id");
  return {
    idToken,
    phoneNumberId,
    accessToken: typeof data?.accessToken === "string" ? data.accessToken.trim() : undefined,
    businessAccountId:
      typeof data?.businessAccountId === "string" ? data.businessAccountId.trim() : undefined,
    displayPhone: typeof data?.displayPhone === "string" ? data.displayPhone.trim() : undefined,
    businessName: typeof data?.businessName === "string" ? data.businessName.trim() : undefined,
    qualityRating: typeof data?.qualityRating === "string" ? data.qualityRating.trim() : undefined,
    connectedVia: data?.connectedVia === "embedded_signup" ? "embedded_signup" : "manual",
  };
}

function getString(fields: FsFields | undefined, key: string): string {
  return fields?.[key]?.stringValue?.trim() ?? "";
}

function getBool(fields: FsFields | undefined, key: string): boolean {
  return fields?.[key]?.booleanValue === true;
}

function getNumber(fields: FsFields | undefined, key: string): number {
  const value = fields?.[key];
  if (!value) return 0;
  if (typeof value.doubleValue === "number" && Number.isFinite(value.doubleValue))
    return value.doubleValue;
  if (typeof value.integerValue === "string") {
    const n = Number(value.integerValue);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function hasString(fields: FsFields | undefined, key: string): boolean {
  return Boolean(getString(fields, key));
}

function stringValue(value: string | null | undefined): FsValue {
  return value ? { stringValue: value } : { nullValue: null };
}

function boolValue(value: boolean): FsValue {
  return { booleanValue: value };
}

function timestampValue(date = new Date()): FsValue {
  return { timestampValue: date.toISOString() };
}

function userArrayValue(ids: string[]): FsValue {
  return {
    arrayValue: {
      values: Array.from(new Set(ids.filter(Boolean))).map((id) => ({
        mapValue: { fields: { userId: { stringValue: id } } },
      })),
    },
  };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function base64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function readServiceAccount(): ServiceAccount {
  const raw = readRuntimeEnv(
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "FIREBASE_SERVICE_ACCOUNT",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  );
  if (!raw) throw new Error("Firebase backend credentials are not configured");
  const normalized = raw.startsWith("{")
    ? raw
    : raw.startsWith("'") && raw.endsWith("'")
      ? raw.slice(1, -1)
      : raw;
  const account = JSON.parse(normalized) as ServiceAccount;
  if (!account.client_email || !account.private_key || !account.project_id) {
    throw new Error("Firebase backend credentials are incomplete");
  }
  account.private_key = account.private_key.replace(/\\n/g, "\n");
  return account;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key!),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64Url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token)
    throw new Error(json.error_description ?? "Could not authorize Firebase backend");
  return json.access_token;
}

async function verifyFirebaseUser(idToken: string): Promise<{ uid: string; email: string | null }> {
  const apiKey = readRuntimeEnv("FIREBASE_WEB_API_KEY", "VITE_FIREBASE_API_KEY");
  if (!apiKey) throw new Error("Firebase web API key is not configured");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    users?: Array<{ localId?: string; email?: string }>;
  };
  const user = json.users?.[0];
  if (!res.ok || !user?.localId) throw new Error("Firebase session could not be verified");
  return { uid: user.localId, email: user.email ?? null };
}

async function firestoreFetch(
  projectId: string,
  accessToken: string,
  path: string,
  init: RequestInit = {},
) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
}

async function getDocFields(
  projectId: string,
  accessToken: string,
  path: string,
): Promise<FsFields | null> {
  const res = await firestoreFetch(projectId, accessToken, `/${encodePath(path)}`);
  if (res.status === 404) return null;
  const json = (await res.json().catch(() => ({}))) as { fields?: FsFields };
  if (!res.ok) return null;
  return json.fields ?? {};
}

async function patchDoc(
  projectId: string,
  accessToken: string,
  path: string,
  fields: FsFields,
): Promise<void> {
  const mask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  const res = await firestoreFetch(projectId, accessToken, `/${encodePath(path)}?${mask}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Could not write ${path}`);
  }
}

async function listDocs(
  projectId: string,
  accessToken: string,
  path: string,
  pageSize = 100,
): Promise<Array<{ id: string; fields: FsFields }>> {
  const rows: Array<{ id: string; fields: FsFields }> = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await firestoreFetch(
      projectId,
      accessToken,
      `/${encodePath(path)}?${qs.toString()}`,
    );
    if (!res.ok) return rows;
    const json = (await res.json().catch(() => ({}))) as {
      documents?: Array<{ name?: string; fields?: FsFields }>;
      nextPageToken?: string;
    };
    for (const doc of json.documents ?? []) {
      const id = doc.name?.split("/").pop();
      if (id) rows.push({ id, fields: doc.fields ?? {} });
    }
    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return rows;
}

async function mergeDataIsland(
  projectId: string,
  accessToken: string,
  sourceUid: string,
  ownerUid: string,
): Promise<void> {
  const collections = ["conversations", "messages", "contacts", "templates", "bots", "campaigns"];
  for (const collectionId of collections) {
    const docs = await listDocs(projectId, accessToken, `users/${sourceUid}/${collectionId}`, 100);
    await Promise.all(
      docs.map((row) =>
        patchDoc(projectId, accessToken, `users/${ownerUid}/${collectionId}/${row.id}`, {
          ...row.fields,
          migratedFromUid: { stringValue: sourceUid },
          migratedAt: timestampValue(),
        }).catch(() => undefined),
      ),
    );
  }
}

async function runQuery(
  projectId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Array<{ name: string; fields: FsFields }>> {
  const res = await firestoreFetch(projectId, accessToken, ":runQuery", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => [])) as Array<{
    document?: { name?: string; fields?: FsFields };
  }>;
  if (!res.ok || !Array.isArray(json)) return [];
  return json
    .map((row) => row.document)
    .filter((doc): doc is { name: string; fields: FsFields } => Boolean(doc?.name))
    .map((doc) => ({ name: doc.name, fields: doc.fields ?? {} }));
}

async function queryUsersByTopLevelPhone(
  projectId: string,
  accessToken: string,
  phoneNumberId: string,
) {
  return runQuery(projectId, accessToken, {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "whatsappPhoneNumberId" },
          op: "EQUAL",
          value: { stringValue: phoneNumberId },
        },
      },
      limit: 20,
    },
  });
}

async function queryUsersByConfigPhone(
  projectId: string,
  accessToken: string,
  phoneNumberId: string,
) {
  return runQuery(projectId, accessToken, {
    structuredQuery: {
      from: [{ collectionId: "whatsapp_config", allDescendants: true }],
      where: {
        fieldFilter: {
          field: { fieldPath: "phoneNumberId" },
          op: "EQUAL",
          value: { stringValue: phoneNumberId },
        },
      },
      limit: 20,
    },
  });
}

async function queryUsersByTopLevelAccessToken(
  projectId: string,
  accessToken: string,
  whatsappAccessToken: string,
) {
  if (!whatsappAccessToken) return [];
  return runQuery(projectId, accessToken, {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "whatsappAccessToken" },
          op: "EQUAL",
          value: { stringValue: whatsappAccessToken },
        },
      },
      limit: 20,
    },
  });
}

async function queryUsersByConfigAccessToken(
  projectId: string,
  accessToken: string,
  whatsappAccessToken: string,
) {
  if (!whatsappAccessToken) return [];
  return runQuery(projectId, accessToken, {
    structuredQuery: {
      from: [{ collectionId: "whatsapp_config", allDescendants: true }],
      where: {
        fieldFilter: {
          field: { fieldPath: "accessToken" },
          op: "EQUAL",
          value: { stringValue: whatsappAccessToken },
        },
      },
      limit: 20,
    },
  });
}

async function queryUsersByEmail(projectId: string, accessToken: string, email: string | null) {
  if (!email) return [];
  return runQuery(projectId, accessToken, {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "email" },
          op: "EQUAL",
          value: { stringValue: email },
        },
      },
      limit: 20,
    },
  });
}

function uidFromUserDocName(name: string): string | null {
  return name.match(/\/users\/([^/]+)$/)?.[1] ?? null;
}

function uidFromConfigDocName(name: string): string | null {
  return name.match(/\/users\/([^/]+)\/whatsapp_config\//)?.[1] ?? null;
}

function mergeCandidate(map: Map<string, Candidate>, id: string, patch: Partial<Candidate>) {
  const existing = map.get(id) ?? { id, fields: {} };
  map.set(id, { ...existing, ...patch, fields: { ...existing.fields, ...(patch.fields ?? {}) } });
}

function mapUserIds(fields: FsFields | null): { owners: string[]; users: string[] } {
  const owners = [
    getString(fields ?? undefined, "ownerId"),
    getString(fields ?? undefined, "userId"),
  ].filter(Boolean);
  const values = fields?.users?.arrayValue?.values ?? [];
  const users = values
    .map((entry) => getString(entry.mapValue?.fields, "userId") || entry.stringValue || "")
    .filter(Boolean);
  return { owners, users };
}

async function countCollection(
  projectId: string,
  accessToken: string,
  path: string,
  max = 500,
): Promise<number> {
  let count = 0;
  let pageToken = "";
  for (let page = 0; page < 5 && count < max; page += 1) {
    const qs = new URLSearchParams({ pageSize: String(Math.min(100, max - count)) });
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await firestoreFetch(
      projectId,
      accessToken,
      `/${encodePath(path)}?${qs.toString()}`,
    );
    if (!res.ok) return count;
    const json = (await res.json().catch(() => ({}))) as {
      documents?: unknown[];
      nextPageToken?: string;
    };
    count += Array.isArray(json.documents) ? json.documents.length : 0;
    pageToken = json.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return count;
}

async function enrichCandidates(
  projectId: string,
  accessToken: string,
  candidates: Map<string, Candidate>,
) {
  await Promise.all(
    Array.from(candidates.values()).map(async (candidate) => {
      const fields = await getDocFields(projectId, accessToken, `users/${candidate.id}`);
      if (fields) candidate.fields = { ...candidate.fields, ...fields };
      const [conversations, messages, contacts, bots, campaigns, templates] = await Promise.all([
        countCollection(projectId, accessToken, `users/${candidate.id}/conversations`),
        countCollection(projectId, accessToken, `users/${candidate.id}/messages`),
        countCollection(projectId, accessToken, `users/${candidate.id}/contacts`),
        countCollection(projectId, accessToken, `users/${candidate.id}/bots`),
        countCollection(projectId, accessToken, `users/${candidate.id}/campaigns`),
        countCollection(projectId, accessToken, `users/${candidate.id}/templates`),
      ]);
      candidate.samples = { conversations, messages, contacts, bots, campaigns, templates };
    }),
  );
}

function scoreCandidate(candidate: Candidate, selfUid: string): number {
  const fields = candidate.fields;
  const samples = candidate.samples ?? {};
  const dataOwner = getString(fields, "dataOwner");
  let score = 0;
  const hasPhoneMatch = Boolean(
    candidate.fromTopLevel ||
    candidate.fromConfig ||
    candidate.fromMapOwner ||
    candidate.fromMapUsers,
  );
  const hasOwnershipSignal = Boolean(hasPhoneMatch || candidate.fromToken);
  if (candidate.id !== selfUid) score += 400;
  // An email match only proves the same login, not ownership of this WhatsApp
  // phone. Do not let a fresh website UID win over the historical phone owner.
  if (candidate.fromEmail && !hasOwnershipSignal) score -= 2_000;
  if (!dataOwner) score += 500;
  else score -= 300;
  if (candidate.fromMapOwner) score += 120;
  if (candidate.fromMapUsers) score += 180;
  if (candidate.fromTopLevel) score += 150;
  if (candidate.fromConfig) score += 150;
  // Same permanent token is a strong fallback when older mobile-app docs did
  // not persist whatsappPhoneNumberId, or wa_map was already hijacked by a
  // website reconnect. Prefer the older data-rich UID over the fresh caller.
  if (candidate.fromToken) score += 140;
  if (getBool(fields, "whatsappConnected")) score += 120;
  if (hasString(fields, "whatsappAccessToken")) score += 80;
  score += getNumber(fields, "totalMessages") * 8;
  score += getNumber(fields, "totalContacts") * 10;
  score += getNumber(fields, "totalBots") * 25;
  score += getNumber(fields, "totalCampaigns") * 25;
  score += (samples.conversations ?? 0) * 350;
  score += (samples.messages ?? 0) * 120;
  score += (samples.contacts ?? 0) * 180;
  score += (samples.bots ?? 0) * 220;
  score += (samples.campaigns ?? 0) * 220;
  score += (samples.templates ?? 0) * 120;
  return score;
}

function chooseOwner(candidates: Map<string, Candidate>, selfUid: string): Candidate | null {
  const rows = Array.from(candidates.values()).filter((row) => {
    const mapOnly =
      Boolean(row.fromMapOwner || row.fromMapUsers) &&
      !row.fromTopLevel &&
      !row.fromConfig &&
      !row.fromToken;
    return !(
      mapOnly &&
      !getBool(row.fields, "whatsappConnected") &&
      !hasString(row.fields, "whatsappAccessToken") &&
      !hasString(row.fields, "whatsappPhoneNumberId")
    );
  });
  if (rows.length === 0) return null;
  // Flutter's connect flow treats an existing wa_map/top-level phone owner as
  // authoritative: a second email that connects the same phone becomes an
  // agent. If a previous bad web reconnect already hijacked wa_map to self,
  // the old mobile-app owner still appears as a non-agent top/config match.
  // Prefer that owner over the just-connected self, then use score only to
  // break ties between multiple historical owners.
  const phoneLinkedRows = rows.filter(
    (row) =>
      row.fromTopLevel || row.fromConfig || row.fromMapOwner || row.fromMapUsers || row.fromToken,
  );
  const historicalOwners = phoneLinkedRows.filter(
    (row) => row.id !== selfUid && !getString(row.fields, "dataOwner"),
  );
  if (historicalOwners.length > 0) {
    historicalOwners.sort((a, b) => scoreCandidate(b, selfUid) - scoreCandidate(a, selfUid));
    return historicalOwners[0] ?? null;
  }
  const ownerPool = phoneLinkedRows.length > 0 ? phoneLinkedRows : rows;
  ownerPool.sort((a, b) => scoreCandidate(b, selfUid) - scoreCandidate(a, selfUid));
  return ownerPool[0] ?? null;
}

function readCredentials(
  input: RepairInput,
  userFields: FsFields | null,
  cfgFields: FsFields | null,
): FsFields {
  const accessToken =
    input.accessToken ||
    getString(cfgFields ?? undefined, "accessToken") ||
    getString(userFields ?? undefined, "whatsappAccessToken");
  const businessAccountId =
    input.businessAccountId ||
    getString(cfgFields ?? undefined, "businessAccountId") ||
    getString(userFields ?? undefined, "whatsappBusinessAccountId");
  const displayPhone =
    input.displayPhone ||
    getString(cfgFields ?? undefined, "displayPhoneNumber") ||
    getString(userFields ?? undefined, "whatsappDisplayPhone");
  const businessName =
    input.businessName ||
    getString(cfgFields ?? undefined, "businessName") ||
    getString(userFields ?? undefined, "businessName");
  const qualityRating =
    input.qualityRating ||
    getString(cfgFields ?? undefined, "qualityRating") ||
    getString(userFields ?? undefined, "whatsappQualityRating");
  return {
    phoneNumberId: { stringValue: input.phoneNumberId },
    accessToken: { stringValue: accessToken },
    businessAccountId: { stringValue: businessAccountId },
    webhookVerifyToken: { stringValue: "" },
    displayPhoneNumber: stringValue(displayPhone),
    businessName: stringValue(businessName),
    qualityRating: stringValue(qualityRating),
    isConnected: boolValue(Boolean(accessToken)),
    connectedVia: { stringValue: input.connectedVia ?? "manual" },
    connectedAt: timestampValue(),
    lastVerifiedAt: timestampValue(),
  };
}

function topLevelWhatsAppPatch(input: RepairInput, cfgPatch: FsFields): FsFields {
  return {
    whatsappPhoneNumberId: { stringValue: input.phoneNumberId },
    whatsappAccessToken: cfgPatch.accessToken,
    whatsappBusinessAccountId: cfgPatch.businessAccountId,
    whatsappDisplayPhone: cfgPatch.displayPhoneNumber,
    whatsappQualityRating: cfgPatch.qualityRating,
    whatsappConnected: boolValue(Boolean(cfgPatch.accessToken.stringValue)),
    updatedAt: timestampValue(),
  };
}

async function clearRemoteCache(phoneNumberId: string) {
  const base = normalizeWabeesApiBase(
    readRuntimeEnv("WABEES_API_BASE", "VITE_WABEES_API_BASE") || "https://api.wabees.live",
  );
  const url = new URL(`${base.replace(/\/$/, "")}/clear-cache.php`);
  url.searchParams.set("phone_number_id", phoneNumberId);
  url.searchParams.set("secret", "wabees_cache_clear_2024");
  await fetch(url.toString()).catch(() => undefined);
}

async function subscribeWebhook(phoneNumberId: string, accessToken: string) {
  if (!accessToken) return;
  const base = normalizeWabeesApiBase(
    readRuntimeEnv("WABEES_API_BASE", "VITE_WABEES_API_BASE") || "https://api.wabees.live",
  );
  await fetch(`${base.replace(/\/$/, "")}/subscribe-webhook.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number_id: phoneNumberId, access_token: accessToken }),
  }).catch(() => undefined);
}

/**
 * Post an in-app notification to the workspace owner when a new email joins
 * their WhatsApp workspace as an agent via the connect flow. This is a
 * security signal — the owner should always know when a second account is
 * given access. Written from the server with admin credentials because
 * Firestore rules do not let the joining agent write to the owner tree yet.
 */
async function notifyOwnerOfAgentJoin(
  projectId: string,
  accessToken: string,
  ownerId: string,
  agentUid: string,
  agentEmail: string | null,
  phoneNumberId: string,
): Promise<void> {
  const displayEmail = agentEmail || agentUid;
  const body =
    `${displayEmail} connected the same WhatsApp number to your workspace and now has agent access. ` +
    `If you did not authorize this, remove them from Team settings and rotate your WhatsApp access token.`;
  const notifId = `agent_join_${agentUid}_${Date.now()}`;
  const res = await firestoreFetch(
    projectId,
    accessToken,
    `/${encodePath(`users/${ownerId}/notifications/${notifId}`)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          type: { stringValue: "security_agent_joined" },
          title: { stringValue: "New device joined your WhatsApp workspace" },
          body: { stringValue: body },
          read: boolValue(false),
          createdAt: timestampValue(),
          data: {
            mapValue: {
              fields: {
                agentUid: { stringValue: agentUid },
                agentEmail: stringValue(agentEmail),
                phoneNumberId: { stringValue: phoneNumberId },
              },
            },
          },
        },
      }),
    },
  );
  if (!res.ok) {
    // Non-fatal — log to console only. Never surface to caller.
    console.warn(
      "[owner-repair] failed to write owner notification",
      res.status,
      await res.text().catch(() => ""),
    );
  }
}

// ==================== check-only preview (consent screen) ====================

type CheckInput = { idToken: string; phoneNumberId: string };
type CheckResult = {
  existingOwnerId: string | null;
  existingOwnerEmail: string | null;
  existingOwnerBusinessName: string | null;
  isSelf: boolean;
  activity: { conversations: number; messages: number; contacts: number } | null;
};

function parseCheckInput(raw: unknown): CheckInput {
  const data = raw as Partial<CheckInput> | null;
  const idToken = typeof data?.idToken === "string" ? data.idToken.trim() : "";
  const phoneNumberId = typeof data?.phoneNumberId === "string" ? data.phoneNumberId.trim() : "";
  if (!idToken || !phoneNumberId) throw new Error("Missing session or phone number id");
  return { idToken, phoneNumberId };
}

export const checkExistingWhatsAppOwner = createServerFn({ method: "POST" })
  .inputValidator(parseCheckInput)
  .handler(async ({ data }): Promise<CheckResult> => {
    const account = readServiceAccount();
    const projectId = account.project_id!;
    const [{ uid }, accessToken] = await Promise.all([
      verifyFirebaseUser(data.idToken),
      getAccessToken(account),
    ]);

    const candidates = new Map<string, Candidate>();
    const [topLevelMatches, configMatches, waMapFields] = await Promise.all([
      queryUsersByTopLevelPhone(projectId, accessToken, data.phoneNumberId),
      queryUsersByConfigPhone(projectId, accessToken, data.phoneNumberId),
      getDocFields(projectId, accessToken, `wa_map/${data.phoneNumberId}`),
    ]);
    for (const row of topLevelMatches) {
      if (row.fields?.whatsappConnected?.booleanValue === false) continue;
      const id = uidFromUserDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromTopLevel: true });
    }
    for (const row of configMatches) {
      if (row.fields?.isConnected?.booleanValue === false) continue;
      const id = uidFromConfigDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromConfig: true });
    }
    const mapIds = mapUserIds(waMapFields);
    for (const id of mapIds.owners) mergeCandidate(candidates, id, { fromMapOwner: true });
    for (const id of mapIds.users) mergeCandidate(candidates, id, { fromMapUsers: true });

    if (candidates.size === 0) {
      return {
        existingOwnerId: null,
        existingOwnerEmail: null,
        existingOwnerBusinessName: null,
        isSelf: false,
        activity: null,
      };
    }
    await enrichCandidates(projectId, accessToken, candidates);
    const owner = chooseOwner(candidates, uid);
    if (!owner) {
      return {
        existingOwnerId: null,
        existingOwnerEmail: null,
        existingOwnerBusinessName: null,
        isSelf: false,
        activity: null,
      };
    }
    const samples = owner.samples ?? {};
    return {
      existingOwnerId: owner.id,
      existingOwnerEmail: getString(owner.fields, "email") || null,
      existingOwnerBusinessName: getString(owner.fields, "businessName") || null,
      isSelf: owner.id === uid,
      activity: {
        conversations: samples.conversations ?? 0,
        messages: samples.messages ?? 0,
        contacts: samples.contacts ?? 0,
      },
    };
  });

export const repairWhatsAppOwnerServer = createServerFn({ method: "POST" })
  .inputValidator(parseInput)
  .handler(async ({ data }): Promise<RepairResult> => {
    const account = readServiceAccount();
    const projectId = account.project_id!;
    const [{ uid, email }, accessToken] = await Promise.all([
      verifyFirebaseUser(data.idToken),
      getAccessToken(account),
    ]);

    const [callerUserFields, callerCfgFields] = await Promise.all([
      getDocFields(projectId, accessToken, `users/${uid}`),
      getDocFields(projectId, accessToken, `users/${uid}/whatsapp_config/config`),
    ]);
    const callerPhone =
      getString(callerUserFields ?? undefined, "whatsappPhoneNumberId") ||
      getString(callerCfgFields ?? undefined, "phoneNumberId");
    if (!data.accessToken && callerPhone && callerPhone !== data.phoneNumberId) {
      throw new Error("This WhatsApp number is not connected on the signed-in account");
    }

    const candidates = new Map<string, Candidate>();
    const callerAccessToken =
      getString(callerCfgFields ?? undefined, "accessToken") ||
      getString(callerUserFields ?? undefined, "whatsappAccessToken");
    const lookupAccessToken = data.accessToken || callerAccessToken;

    const [
      topLevelMatches,
      configMatches,
      topLevelTokenMatches,
      configTokenMatches,
      emailMatches,
      waMapFields,
    ] = await Promise.all([
      queryUsersByTopLevelPhone(projectId, accessToken, data.phoneNumberId),
      queryUsersByConfigPhone(projectId, accessToken, data.phoneNumberId),
      queryUsersByTopLevelAccessToken(projectId, accessToken, lookupAccessToken),
      queryUsersByConfigAccessToken(projectId, accessToken, lookupAccessToken),
      queryUsersByEmail(projectId, accessToken, email),
      getDocFields(projectId, accessToken, `wa_map/${data.phoneNumberId}`),
    ]);

    // Collect prior-owner UIDs that once had this phone connected (even if
    // currently disconnected). Used to migrate historical data into the new
    // owner when this reconnect makes the caller the fresh workspace owner.
    const priorOwnerCandidates = new Map<string, Candidate>();
    for (const row of topLevelMatches) {
      const id = uidFromUserDocName(row.name);
      if (id) mergeCandidate(priorOwnerCandidates, id, { fields: row.fields, fromTopLevel: true });
    }
    for (const row of configMatches) {
      const id = uidFromConfigDocName(row.name);
      if (id) mergeCandidate(priorOwnerCandidates, id, { fields: row.fields, fromConfig: true });
    }

    for (const row of topLevelMatches) {
      if (row.fields?.whatsappConnected?.booleanValue === false) continue;
      const id = uidFromUserDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromTopLevel: true });
    }
    for (const row of configMatches) {
      if (row.fields?.isConnected?.booleanValue === false) continue;
      const id = uidFromConfigDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromConfig: true });
    }
    for (const row of topLevelTokenMatches) {
      if (row.fields?.whatsappConnected?.booleanValue === false) continue;
      const id = uidFromUserDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromToken: true });
    }
    for (const row of configTokenMatches) {
      if (row.fields?.isConnected?.booleanValue === false) continue;
      const id = uidFromConfigDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromToken: true });
    }
    for (const row of emailMatches) {
      const id = uidFromUserDocName(row.name);
      if (id) mergeCandidate(candidates, id, { fields: row.fields, fromEmail: true });
    }
    const mapIds = mapUserIds(waMapFields);
    for (const id of mapIds.owners) mergeCandidate(candidates, id, { fromMapOwner: true });
    for (const id of mapIds.users) mergeCandidate(candidates, id, { fromMapUsers: true });
    // Only let a brand-new caller become a candidate when no historical owner
    // exists. If we add the caller before resolution, a new website email can
    // win the score simply because it just saved fresh credentials, hijacking
    // webhook routing away from the mobile app's original owner.
    if (
      callerPhone === data.phoneNumberId ||
      getString(callerUserFields ?? undefined, "dataOwner")
    ) {
      mergeCandidate(candidates, uid, {
        fields: callerUserFields ?? {},
        fromTopLevel: callerPhone === data.phoneNumberId,
      });
    }

    await enrichCandidates(projectId, accessToken, candidates);
    const owner = chooseOwner(candidates, uid);
    const ownerId = owner?.id ?? uid;
    const allIds = Array.from(new Set([ownerId, uid, ...Array.from(candidates.keys())]));
    const cfgPatch = readCredentials(data, callerUserFields, callerCfgFields);
    const topPatch = topLevelWhatsAppPatch(data, cfgPatch);

    if (ownerId !== uid) {
      // SECURITY: joining an existing owner's workspace by connecting the
      // same WhatsApp number is NOT an implicit invite. The caller must
      // already be an active agent under `ownerId` (i.e. accepted an invite
      // in a prior session). If the agent doc is missing, `revoked`, or
      // `left`, refuse the auto-join so a previously-removed user cannot
      // silently re-gain access by reconnecting the same number.
      const existingAgent = await getDocFields(
        projectId,
        accessToken,
        `users/${ownerId}/agents/${uid}`,
      );
      const existingStatus = getString(existingAgent ?? undefined, "status") || (existingAgent ? "active" : "missing");
      if (existingStatus === "revoked" || existingStatus === "left" || existingStatus === "missing") {
        throw new Error(
          "This WhatsApp number is already connected to another workspace. Ask that workspace's owner to send you a new invite before reconnecting.",
        );
      }
      await Promise.all([
        patchDoc(projectId, accessToken, `users/${uid}`, {
          ...topPatch,
          dataOwner: { stringValue: ownerId },
        }),
        patchDoc(projectId, accessToken, `users/${uid}/whatsapp_config/config`, cfgPatch),
        patchDoc(projectId, accessToken, `users/${ownerId}`, topPatch),
        patchDoc(projectId, accessToken, `users/${ownerId}/whatsapp_config/config`, cfgPatch),
        patchDoc(projectId, accessToken, `users/${ownerId}/agents/${uid}`, {
          email: stringValue(email),
          joinedAt: timestampValue(),
          repairedByWebsite: boolValue(true),
        }),
        patchDoc(projectId, accessToken, `wa_map/${data.phoneNumberId}`, {
          ownerId: { stringValue: ownerId },
          userId: { stringValue: ownerId },
          users: userArrayValue(allIds),
          active: boolValue(true),
          updatedAt: timestampValue(),
        }),
      ]);
      await mergeDataIsland(projectId, accessToken, uid, ownerId);
      await subscribeWebhook(data.phoneNumberId, getString(cfgPatch, "accessToken"));
      await clearRemoteCache(data.phoneNumberId);
      // Security-alert the workspace owner that a new device joined.
      await notifyOwnerOfAgentJoin(
        projectId,
        accessToken,
        ownerId,
        uid,
        email,
        data.phoneNumberId,
      ).catch(() => undefined);
      return { ownerId, repaired: true, candidates: allIds };
    }

    await Promise.all([
      patchDoc(projectId, accessToken, `users/${uid}`, topPatch),
      patchDoc(projectId, accessToken, `users/${uid}/whatsapp_config/config`, cfgPatch),
    ]);
    await patchDoc(projectId, accessToken, `wa_map/${data.phoneNumberId}`, {
      ownerId: { stringValue: uid },
      userId: { stringValue: uid },
      users: userArrayValue(allIds),
      active: boolValue(true),
      updatedAt: timestampValue(),
    });
    // Fresh takeover: no active historical owner picked, but this phone may
    // have had a prior (now-disconnected) owner whose Firestore subtree still
    // holds conversations/messages/contacts/templates/bots/campaigns. Move
    // that data under the new caller so the workspace picks up where it left
    // off, matching the "data follows the phone" contract.
    priorOwnerCandidates.delete(uid);
    if (priorOwnerCandidates.size > 0) {
      await enrichCandidates(projectId, accessToken, priorOwnerCandidates);
      const best = Array.from(priorOwnerCandidates.values())
        .filter((c) => {
          const s = c.samples ?? {};
          return (
            (s.conversations ?? 0) +
              (s.messages ?? 0) +
              (s.contacts ?? 0) +
              (s.templates ?? 0) +
              (s.bots ?? 0) +
              (s.campaigns ?? 0) >
            0
          );
        })
        .sort((a, b) => {
          const sa = a.samples ?? {};
          const sb = b.samples ?? {};
          const na =
            (sa.conversations ?? 0) * 5 + (sa.messages ?? 0) + (sa.contacts ?? 0) * 3;
          const nb =
            (sb.conversations ?? 0) * 5 + (sb.messages ?? 0) + (sb.contacts ?? 0) * 3;
          return nb - na;
        })[0];
      if (best) {
        await mergeDataIsland(projectId, accessToken, best.id, uid).catch(() => undefined);
      }
    }
    const ownAccessToken = getString(cfgPatch, "accessToken");
    await subscribeWebhook(data.phoneNumberId, ownAccessToken);
    await clearRemoteCache(data.phoneNumberId);
    return { ownerId: uid, repaired: false, candidates: allIds };
  });
