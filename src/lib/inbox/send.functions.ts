/**
 * Send an outgoing WhatsApp message via Meta Graph API, then mirror the
 * message + conversation into Firestore so both web (realtime) and the
 * Flutter app see it immediately.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeError } from "@/lib/security/safe-error";

const schema = z.object({
  phone: z.string().min(8).max(20),
  message: z.string().min(1).max(4096),
});

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => schema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
      await assertRateLimit("send:message", context.userId, 60, 60);

      // 1. Look up firebase_uid + decrypted access token
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("firebase_uid")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");

      const { data: cfg } = await context.supabase
        .from("whatsapp_config")
        .select("phone_number_id, access_token_encrypted, token_iv, token_tag")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!cfg?.phone_number_id || !cfg.access_token_encrypted) {
        throw new Error("Not connected: connect WhatsApp first");
      }

      const { decryptToken } = await import("@/lib/security/crypto.server");
      const accessToken = decryptToken({
        ciphertext: cfg.access_token_encrypted,
        iv: cfg.token_iv!,
        tag: cfg.token_tag!,
      });

      // 2. Normalize phone: strip +/spaces for Meta, keep + for Firestore doc id
      const digits = data.phone.replace(/[^0-9]/g, "");
      if (digits.length < 8) throw new Error("Invalid phone");
      const phoneKey = `+${digits}`;

      // 3. POST to Meta Graph
      const version = process.env.META_GRAPH_VERSION ?? "v21.0";
      const url = `https://graph.facebook.com/${version}/${cfg.phone_number_id}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: digits,
          type: "text",
          text: { body: data.message },
        }),
      });
      const respText = await res.text();
      let respJson: { messages?: Array<{ id: string }>; error?: { message?: string } } = {};
      try {
        respJson = JSON.parse(respText);
      } catch {
        /* keep empty */
      }
      if (!res.ok) {
        const errMsg = respJson.error?.message ?? `Meta API error ${res.status}`;
        throw new Error(`Invalid: ${errMsg}`);
      }
      const whatsappMessageId = respJson.messages?.[0]?.id ?? null;

      // 4. Mirror to Firestore (message + conversation)
      const { firestoreCreateDoc, firestoreSetDoc } = await import(
        "@/integrations/firebase/admin.server"
      );
      const nowIso = new Date().toISOString();
      await firestoreCreateDoc(`users/${profile.firebase_uid}/messages`, {
        contactPhone: phoneKey,
        contactName: phoneKey,
        type: "text",
        direction: "outgoing",
        status: "sent",
        body: data.message,
        whatsappMessageId,
        createdAt: new Date(),
        sentVia: "web",
      });
      await firestoreSetDoc(`users/${profile.firebase_uid}/conversations/${phoneKey}`, {
        contactPhone: phoneKey,
        contactName: phoneKey,
        lastMessage: data.message.slice(0, 100),
        lastMessageType: "text",
        lastMessageAt: new Date(),
      });

      return { ok: true as const, whatsappMessageId };
    } catch (err) {
      throw safeError(err, "Could not send message");
    }
  });