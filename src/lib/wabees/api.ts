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

export function fetchMetaTemplates(args: { phone_number_id: string; access_token: string }) {
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