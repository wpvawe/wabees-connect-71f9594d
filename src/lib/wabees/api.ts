/**
 * Client for the wabees.live PHP backend — same endpoints the Flutter app
 * uses (lib/data/datasources/api/whatsapp_api_ds.dart). Browser → PHP →
 * Meta Graph; PHP also writes outbound message rows to Firestore so the
 * realtime hooks pick them up automatically.
 */
import { WABEES_API_BASE } from "@/integrations/firebase/client";
import { fbAuth } from "@/integrations/firebase/client";

export type WabeesApiResult<T = unknown> = {
  success: boolean;
  message?: string;
  data?: T;
  raw: Record<string, unknown>;
};

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
  const res = await fetch(`${WABEES_API_BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  fd.append("phone_number_id", args.phone_number_id);
  fd.append("access_token", args.access_token);
  const res = await fetch(`${WABEES_API_BASE}/upload-media.php`, { method: "POST", body: fd });
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
