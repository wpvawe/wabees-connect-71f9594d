/**
 * Client for the wabees.live PHP backend — same endpoints the Flutter app
 * uses (lib/data/datasources/api/whatsapp_api_ds.dart). Browser → PHP →
 * Meta Graph; PHP also writes outbound message rows to Firestore so the
 * realtime hooks pick them up automatically.
 */
import { WABEES_API_BASE } from "@/integrations/firebase/client";

export type WabeesApiResult<T = unknown> = {
  success: boolean;
  message?: string;
  data?: T;
  raw: Record<string, unknown>;
};

async function postJson<T = unknown>(path: string, body: Record<string, unknown>): Promise<WabeesApiResult<T>> {
  const res = await fetch(`${WABEES_API_BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    success: Boolean(raw.success),
    message: (raw.message as string | undefined) ?? (raw.error as string | undefined),
    data: raw.data as T | undefined,
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
    phone?: { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string };
    waba_id?: string;
    business_id?: string;
    business_name?: string;
  }>("whatsapp-smart-connect.php", args);
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

export function fetchMetaTemplates(args: { business_account_id: string; access_token: string }) {
  return postJson("get-templates.php", args);
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
    message: (raw.message as string | undefined),
    data: { url: raw.url as string | undefined, id: raw.media_id as string | undefined },
    raw,
  };
}

/** Build a media-proxy URL for displaying app/webhook media in the inbox. */
export function mediaProxyUrl(mediaId: string, uid: string): string {
  return `${WABEES_API_BASE}/media-proxy.php?id=${encodeURIComponent(mediaId)}&uid=${encodeURIComponent(uid)}`;
}