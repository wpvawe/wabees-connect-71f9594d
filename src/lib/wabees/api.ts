/**
 * Client for the wabees.live PHP backend — same endpoints the Flutter app
 * uses (lib/data/datasources/api/whatsapp_api_ds.dart). Browser → PHP →
 * Meta Graph; PHP also writes outbound message rows to Firestore so the
 * realtime hooks pick them up automatically.
 */
import { WABEES_API_BASE } from "@/integrations/firebase/client";
import { fbAuth } from "@/integrations/firebase/client";
import { META_GRAPH_BASE_URL } from "@/lib/constants/meta";

export type WabeesApiResult<T = unknown> = {
  success: boolean;
  message?: string;
  data?: T;
  raw: Record<string, unknown>;
};

/**
 * Endpoints that were patched in Batch 5A to accept
 * `Authorization: Bearer <FirebaseIdToken>` and resolve
 * `phone_number_id` + `access_token` server-side from Firestore
 * (via `wa-bearer-auth.php::wabees_apply_bearer_auth`).
 *
 * For these endpoints the browser MUST NOT send the Meta access token in
 * the request body — PHP will pull it from Firestore using the verified
 * caller's `dataOwner`. This keeps the token out of DevTools, proxies,
 * and server logs while remaining backward-compatible: PHP still accepts
 * body creds when no bearer is present (Flutter path).
 */
const BEARER_AUTH_ENDPOINTS = new Set<string>([
  "send-message.php",
  "get-templates.php",
  "create-template.php",
  "edit-template.php",
  "delete-template.php",
  "business-profile.php",
  "verify-token.php",
  "phone-health.php",
  "send-interactive.php",
  "delete-message.php",
  "upload-media.php",
  "message-links.php",
  "subscribe-webhook.php",
]);

const CREDENTIAL_REQUIRED_ENDPOINTS = new Set<string>([
  "verify-token.php",
  "subscribe-webhook.php",
]);

/** Fields we scrub from the request body once a bearer token is attached. */
const SERVER_RESOLVED_FIELDS = [
  "access_token",
  "phone_number_id",
  "business_account_id",
  "waba_id",
] as const;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Accept every response shape used by the PHP endpoints and Meta directly. */
export function extractWamid(raw: Record<string, unknown> | undefined | null): string | null {
  if (!raw) return null;
  const direct =
    readString(raw.messageId) ??
    readString(raw.message_id) ??
    readString(raw.id) ??
    readString(raw.wamid);
  if (direct) return direct;

  const messages = Array.isArray(raw.messages) ? raw.messages : null;
  const firstMessage = readRecord(messages?.[0]);
  const fromMessages = readString(firstMessage?.id) ?? readString(firstMessage?.messageId);
  if (fromMessages) return fromMessages;

  const data = readRecord(raw.data);
  return data ? extractWamid(data) : null;
}

async function postJson<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<WabeesApiResult<T>> {
  const endpoint = path.replace(/^\//, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let outboundBody: Record<string, unknown> = body;

  if (BEARER_AUTH_ENDPOINTS.has(endpoint) && !CREDENTIAL_REQUIRED_ENDPOINTS.has(endpoint)) {
    const user = fbAuth().currentUser;
    if (user) {
      if (outboundBody.auth_uid === undefined) outboundBody = { ...outboundBody, auth_uid: user.uid };
      try {
        const idToken = await user.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
        // Strip server-resolved credentials from the wire once bearer is set.
        // PHP re-populates them from Firestore via the verified caller's dataOwner.
        const scrubbed: Record<string, unknown> = { ...outboundBody };
        for (const key of SERVER_RESOLVED_FIELDS) delete scrubbed[key];
        outboundBody = scrubbed;
      } catch {
        /* token fetch failure — PHP falls back to body creds */
      }
    }
  }

  const res = await fetch(`${WABEES_API_BASE}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(outboundBody),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const explicitSuccess = typeof raw.success === "boolean" ? raw.success : undefined;
  const rawError = raw.error;
  const errorMessage =
    typeof rawError === "string"
      ? rawError
      : rawError && typeof rawError === "object" && "message" in rawError
        ? String((rawError as { message?: unknown }).message ?? "")
        : undefined;
  return {
    success: explicitSuccess ?? (res.ok && !raw.error),
    message: (raw.message as string | undefined) ?? errorMessage,
    data: (raw.data ?? raw) as T | undefined,
    raw,
  };
}

export function verifyWhatsAppToken(args: { phone_number_id: string; access_token: string }) {
  return postJson("verify-token.php", args);
}

/**
 * Auto-detects WABA, business id/name, display phone, and quality rating
 * from just a phone_number_id + access_token. Mirrors the Flutter app's
 * "Smart Connect" flow (backend/api/whatsapp-smart-connect.php).
 */
export function smartConnectWhatsApp(args: { phone_number_id: string; access_token: string }) {
  return postJson<{
    phone?: {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    };
    waba_id?: string;
    business_id?: string;
    business_name?: string;
  }>("whatsapp-smart-connect.php", args);
}

export async function subscribeWhatsAppWebhook(args: {
  phone_number_id: string;
  access_token: string;
}) {
  return postJson("subscribe-webhook.php", args);
}

/**
 * Clears the PHP webhook owner's 24h cache after connect/reconnect. The PHP
 * backend already exposes this operational endpoint and reports the current
 * `wa_map/{phone_number_id}` owner, so we use it as a best-effort server-side
 * owner resolver when Firestore rules block direct client reads of another
 * owner's mapping.
 */
export async function clearWebhookOwnerCache(
  phoneNumberId: string,
): Promise<{ ownerId: string | null }> {
  // C-3 fix: authenticate with a Firebase ID token instead of shipping
  // the static secret in the client bundle. PHP verifies the token via
  // verify_firebase_id_token() in clear-cache.php.
  const idToken = (await fbAuth().currentUser?.getIdToken()) ?? "";
  const res = await fetch(`${WABEES_API_BASE}/clear-cache.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ phone_number_id: phoneNumberId, id_token: idToken }),
  });
  const raw = (await res.json().catch(() => ({}))) as {
    cleared?: unknown;
    ownerId?: unknown;
    userId?: unknown;
  };
  const directOwner =
    typeof raw.ownerId === "string"
      ? raw.ownerId
      : typeof raw.userId === "string"
        ? raw.userId
        : null;
  if (directOwner) return { ownerId: directOwner };
  const lines = Array.isArray(raw.cleared) ? raw.cleared.map(String) : [];
  const ownerLine = lines.find((line) =>
    /(?:ownerId|owner|userId|uid)\s*=\s*[A-Za-z0-9_-]+/i.test(line),
  );
  const ownerId =
    ownerLine?.match(/(?:ownerId|owner|userId|uid)\s*=\s*([A-Za-z0-9_-]+)/i)?.[1] ?? null;
  return { ownerId };
}

export async function repairWhatsAppConnect(args: {
  phone_number_id: string;
  access_token: string;
  waba_id?: string;
  display_phone?: string;
  business_name?: string;
  quality_rating?: string;
  connected_via?: "embedded_signup" | "manual";
}): Promise<WabeesApiResult<{ ownerId?: string; migratedFrom?: string | null }>> {
  const idToken = (await fbAuth().currentUser?.getIdToken()) ?? "";
  return postJson("whatsapp-connect-repair.php", {
    ...args,
    id_token: idToken,
  });
}

/**
 * Server-side exchange of a Meta Embedded Signup short-lived `code` for a
 * long-lived business access token + auto-discovered WABA / phone metadata.
 * Endpoint: backend/api/whatsapp-exchange-code.php (App Secret stays on the
 * Hostinger PHP server — never shipped to the browser).
 */
export function exchangeWhatsAppCode(args: { code: string }) {
  return postJson<{
    access_token: string;
    phone_number_id: string;
    waba_id: string;
    business_name?: string | null;
    display_phone?: string | null;
    quality_rating?: string | null;
  }>("whatsapp-exchange-code.php", args);
}

export type WabaPhoneOption = {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
};
export type WabaOption = {
  id: string;
  name: string;
  phones: WabaPhoneOption[];
};
export type BusinessOption = {
  id: string;
  name: string;
  wabas: WabaOption[];
};

/**
 * Multi-step account picker source. Lists every Business → WABA → Phone
 * reachable by an access token so the user can pick the right number when
 * their token grants access to more than one.
 */
export async function listWhatsAppAccounts(args: {
  access_token: string;
}): Promise<WabeesApiResult<{ businesses: BusinessOption[] }>> {
  const idToken = (await fbAuth().currentUser?.getIdToken()) ?? "";
  return postJson<{ businesses: BusinessOption[] }>("whatsapp-list-accounts.php", {
    id_token: idToken,
    access_token: args.access_token,
  });
}

export function sendTextMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  message: string;
  context_message_id?: string | null;
}) {
  return postJson("send-message.php", { ...args, type: "text" });
}

export function sendTemplateMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  template_name: string;
  language_code: string;
  components?: Array<Record<string, unknown>>;
}) {
  return postJson("send-message.php", { ...args, type: "template" });
}

/** Send a media message (image / video / document / audio) via PHP. */
export function sendMediaMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  type: "image" | "video" | "document" | "audio" | "sticker";
  media_url?: string;
  media_id?: string;
  caption?: string;
  filename?: string;
  is_voice?: boolean;
  context_message_id?: string | null;
}) {
  return postJson("send-message.php", args);
}

/** Send an emoji reaction to a specific WhatsApp message. Empty emoji removes. */
export function sendReactionMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  message_id: string;
  emoji: string;
}) {
  return postJson("send-message.php", { ...args, type: "reaction" });
}

/** Send a location pin. */
export function sendLocationMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  context_message_id?: string | null;
}) {
  return postJson("send-message.php", { ...args, type: "location" });
}

/** Up to 3 quick-reply buttons. WhatsApp shows them beneath the body text. */
export function sendReplyButtonsMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  body_text: string;
  header_text?: string;
  footer_text?: string;
  buttons: Array<{ id: string; title: string }>;
  context_message_id?: string | null;
}) {
  return postJson("send-message.php", {
    ...args,
    type: "interactive",
    interactive_type: "button",
  });
}

/** A single call-to-action URL button. */
export function sendCtaUrlMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  body_text: string;
  display_text: string;
  url: string;
  header_text?: string;
  footer_text?: string;
  context_message_id?: string | null;
}) {
  return postJson("send-message.php", {
    ...args,
    type: "interactive",
    interactive_type: "cta_url",
  });
}

/** List message with tappable rows grouped into sections. */
export function sendListMessage(args: {
  phone_number_id: string;
  access_token: string;
  to: string;
  body_text: string;
  button_text: string;
  header_text?: string;
  footer_text?: string;
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
  context_message_id?: string | null;
}) {
  return postJson("send-message.php", {
    ...args,
    type: "interactive",
    interactive_type: "list",
  });
}

/**
 * Mark an inbound WhatsApp message as read so the sender sees blue ticks.
 * Mirrors backend/api/mark-read.php on wabees.live.
 */
export function markMessageRead(args: {
  phone_number_id: string;
  access_token: string;
  message_id: string;
}) {
  return postJson("mark-read.php", args);
}

/**
 * Send a WhatsApp typing indicator to the customer.
 *
 * Per Meta: typing indicators ride along with a read receipt — they require
 * the wamid of an inbound message and stay visible for up to ~25s, dismissing
 * automatically when the next message is sent. Best-effort; ignore errors.
 */
export function sendTypingIndicator(args: {
  phone_number_id: string;
  access_token: string;
  message_id: string;
}) {
  return postJson("mark-read.php", { ...args, typing_indicator: "text" });
}

/**
 * Revoke a previously sent message ("delete for everyone") via the PHP
 * proxy. Only works for messages still inside Meta's revoke window
 * (~48h) and whose wamid we know.
 */
export function deleteWhatsAppMessage(args: {
  phone_number_id: string;
  access_token: string;
  message_id: string;
}) {
  return postJson("delete-message.php", args);
}

export function fetchMetaTemplates(args: { business_account_id: string; access_token: string }) {
  return postJson("get-templates.php", args);
}

/**
 * Delete a WhatsApp message template from Meta.
 *
 * Mirrors the Flutter app's behaviour (`whatsapp_api_ds.dart::deleteTemplate`)
 * which hits Meta Graph directly rather than routing through the PHP proxy —
 * some hosts don't yet ship a `delete-template.php`, and the direct DELETE
 * call needs no server changes. Access token stays scoped to the current
 * owner (already trusted in the browser for every other WhatsApp call).
 *
 * Also tries the PHP proxy first when available; falls back to Meta Graph
 * on 404 so newer backends can add auditing without breaking older ones.
 */
export async function deleteMetaTemplate(args: {
  business_account_id: string;
  access_token: string;
  name: string;
  hsm_id?: string | null;
}): Promise<WabeesApiResult> {
  // 1) PHP proxy (preferred — logs / rate-limits centrally). If it 404s
  // (endpoint not deployed on this host), fall through to Meta Graph.
  try {
    const proxied = await postJson("delete-template.php", args);
    const raw = proxied.raw ?? {};
    const errorObj = raw.error && typeof raw.error === "object" ? (raw.error as { code?: number; message?: string }) : null;
    const looksMissing =
      typeof raw.php_error === "string" ||
      (typeof raw.message === "string" && /not found|endpoint/i.test(raw.message));
    if (!looksMissing && (proxied.success || errorObj?.code !== 404)) {
      return proxied;
    }
  } catch {
    /* fall through to direct Graph call */
  }

  // 2) Direct Meta Graph (version from central constant) — matches Flutter app.
  const q = new URLSearchParams({
    name: args.name,
    access_token: args.access_token,
  });
  if (args.hsm_id) q.set("hsm_id", args.hsm_id);
  const url = `${META_GRAPH_BASE_URL}/${encodeURIComponent(args.business_account_id)}/message_templates?${q.toString()}`;
  const res = await fetch(url, { method: "DELETE" });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = raw.error && typeof raw.error === "object" ? (raw.error as { message?: string; code?: number }) : null;
  return {
    success: res.ok && !err,
    message: err?.message ?? (raw.success === true ? "Deleted" : undefined),
    raw,
  };
}

/**
 * Create a new WhatsApp message template on Meta. Mirrors
 * `backend/api/create-template.php` on wabees.live: the PHP proxy forwards
 * the payload to `POST /{waba-id}/message_templates` and returns Meta's
 * response (either an `id`+`status` on success or `error.message` on failure).
 *
 * Components follow the Meta shape:
 *   [{ type: "HEADER", format: "TEXT"|"IMAGE"|..., text?, example? },
 *    { type: "BODY",   text, example? },
 *    { type: "FOOTER", text },
 *    { type: "BUTTONS", buttons: [...] }]
 */
export function createMetaTemplate(args: {
  business_account_id: string;
  access_token: string;
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  components: Array<Record<string, unknown>>;
  allow_category_change?: boolean;
}) {
  return postJson<{ id?: string; status?: string; category?: string }>(
    "create-template.php",
    args,
  );
}

/**
 * Edit an existing WhatsApp message template. Meta permits changing only
 * `category` and `components` — name/language are immutable. Prefers the
 * PHP proxy for auditability; falls back to a direct Meta Graph POST on
 * older backends that don't ship `/edit-template.php`.
 */
export async function editMetaTemplate(args: {
  business_account_id: string;
  access_token: string;
  hsm_id: string;
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components?: Array<Record<string, unknown>>;
}): Promise<WabeesApiResult> {
  try {
    const proxied = await postJson("edit-template.php", args);
    const raw = proxied.raw ?? {};
    const errorObj =
      raw.error && typeof raw.error === "object"
        ? (raw.error as { code?: number; message?: string })
        : null;
    const looksMissing =
      typeof raw.php_error === "string" ||
      (typeof raw.message === "string" && /not found|endpoint/i.test(raw.message));
    if (!looksMissing && (proxied.success || errorObj?.code !== 404)) {
      return proxied;
    }
  } catch {
    /* fall through to direct Graph call */
  }

  const body: Record<string, unknown> = {};
  if (args.category) body.category = args.category;
  if (args.components) body.components = args.components;
  const url = `${META_GRAPH_BASE_URL}/${encodeURIComponent(args.hsm_id)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err =
    raw.error && typeof raw.error === "object"
      ? (raw.error as { message?: string; code?: number })
      : null;
  return {
    success: res.ok && !err,
    message: err?.message ?? (raw.success === true ? "Updated" : undefined),
    raw,
  };
}

export type MessageLink = {
  id: string;
  code: string;
  deep_link_url: string;
  prefilled_message: string;
  qr_image_url?: string;
};

export function listMessageLinks(args: { phone_number_id: string; access_token: string }) {
  return postJson<{ links?: MessageLink[]; total?: number }>("message-links.php", {
    action: "list",
    ...args,
  });
}

export function createMessageLink(args: {
  phone_number_id: string;
  access_token: string;
  prefilled_message: string;
}) {
  return postJson<{ link?: MessageLink }>("message-links.php", {
    action: "create",
    ...args,
  });
}

export function deleteMessageLink(args: {
  phone_number_id: string;
  access_token: string;
  link_id: string;
}) {
  return postJson<{ deleted?: boolean }>("message-links.php", {
    action: "delete",
    ...args,
  });
}

/**
 * Upload media via the PHP proxy. Returns the media URL/ID the backend
 * issues — store that in the Firestore message row.
 */
export async function uploadMedia(args: {
  phone_number_id: string;
  access_token: string;
  file: File;
  kind: "image" | "video" | "document" | "audio";
}): Promise<WabeesApiResult<{ url?: string; id?: string }>> {
  const fd = new FormData();
  fd.append("file", args.file);
  fd.append("type", args.kind);
  // Batch 5B — try bearer-authenticated upload first so the Meta access
  // token is not exposed in the multipart body. PHP resolves creds server
  // side from Firestore via the caller's dataOwner. Fall back to body-creds
  // only if we can't mint an ID token (e.g. signed-out edge case).
  const headers: Record<string, string> = {};
  const user = fbAuth().currentUser;
  let idToken: string | null = null;
  if (user) {
    try {
      idToken = await user.getIdToken();
      headers.Authorization = `Bearer ${idToken}`;
      fd.append("auth_uid", user.uid);
    } catch {
      idToken = null;
    }
  }
  if (!idToken) {
    fd.append("phone_number_id", args.phone_number_id);
    fd.append("access_token", args.access_token);
  }
  const res = await fetch(`${WABEES_API_BASE}/upload-media.php`, {
    method: "POST",
    headers,
    body: fd,
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    success: Boolean(raw.success),
    message: raw.message as string | undefined,
    data: { url: raw.url as string | undefined, id: raw.media_id as string | undefined },
    raw,
  };
}

/** Build a media-proxy URL for displaying app/webhook media in the inbox. */
export function mediaProxyUrl(mediaId: string, uid: string): string {
  return `${WABEES_API_BASE}/media-proxy.php?id=${encodeURIComponent(mediaId)}&uid=${encodeURIComponent(uid)}`;
}

/**
 * Send a transactional email through the PHP backend (send-email.php).
 * Used for agent invites and any other automated outbound email.
 */
export function sendEmail(args: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from_name?: string;
  reply_to?: string;
}) {
  return postJson<{ success?: boolean }>("send-email.php", args);
}
