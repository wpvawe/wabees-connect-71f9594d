/**
 * Meta webhook configuration shared across the app.
 * These must match the values configured in Meta App Dashboard → WhatsApp → Configuration.
 * The verify token is intentionally non-secret (Meta echoes it publicly during handshake).
 */
import { WABEES_API_BASE } from "@/integrations/firebase/client";

export const META_WEBHOOK_CALLBACK_URL = `${WABEES_API_BASE}/webhook.php`;

export const META_WEBHOOK_VERIFY_TOKEN =
  (import.meta.env.VITE_META_VERIFY_TOKEN as string | undefined) ??
  "wabees_webhook_verify_2024";

/** Fields Meta must subscribe to for full inbox + status functionality. */
export const META_WEBHOOK_SUBSCRIBE_FIELDS = [
  "messages",
  "message_template_status_update",
  "message_template_quality_update",
  "phone_number_quality_update",
  "account_update",
] as const;