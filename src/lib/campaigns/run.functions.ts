/**
 * Campaign CRUD + execution. Stores under users/{uid}/campaigns/{id} and
 * mirrors per-recipient outcomes in /logs subcollection. Sequential send
 * with rate-limit pacing to stay below Meta tier limits.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeError } from "@/lib/security/safe-error";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  messageBody: z.string().min(1).max(4096),
  audiencePhones: z.array(z.string().min(8).max(20)).min(1).max(2000),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles").select("firebase_uid").eq("id", context.userId).maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");

      const { firestoreCreateDoc } = await import("@/integrations/firebase/admin.server");
      const id = await firestoreCreateDoc(`users/${profile.firebase_uid}/campaigns`, {
        name: data.name,
        description: data.description,
        status: "draft",
        messageType: "text",
        messageBody: data.messageBody,
        audiencePhones: data.audiencePhones,
        totalRecipients: data.audiencePhones.length,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        createdAt: new Date(),
      });
      return { id };
    } catch (err) {
      throw safeError(err, "Could not create campaign");
    }
  });

const idSchema = z.object({ id: z.string().min(1) });

export const startCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
      await assertRateLimit("campaigns:start", context.userId, 3, 60);

      const { data: profile } = await context.supabase
        .from("profiles").select("firebase_uid").eq("id", context.userId).maybeSingle();
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

      const { firestoreGetDoc, firestoreSetDoc, firestoreCreateDoc } = await import(
        "@/integrations/firebase/admin.server"
      );
      const path = `users/${profile.firebase_uid}/campaigns/${data.id}`;
      const camp = await firestoreGetDoc(path);
      if (!camp) throw new Error("Not found: campaign");
      const audience = (camp.audiencePhones as string[]) ?? [];
      const body = (camp.messageBody as string) ?? "";
      const phoneNumberId = cfg.phone_number_id;
      const version = process.env.META_GRAPH_VERSION ?? "v21.0";

      await firestoreSetDoc(path, { status: "running", startedAt: new Date() });

      let sent = 0;
      let failed = 0;
      // Cap to 500 inline; production scheduler would chunk. Pace ~5/sec.
      const list = audience.slice(0, 500);
      for (const raw of list) {
        const digits = raw.replace(/[^0-9]/g, "");
        if (digits.length < 8) {
          failed += 1;
          await firestoreCreateDoc(`${path}/logs`, {
            phone: raw, status: "failed", error: "invalid_phone", sentAt: new Date(),
          });
          continue;
        }
        try {
          const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: digits,
              type: "text",
              text: { body },
            }),
          });
          const ok = res.ok;
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          await firestoreCreateDoc(`${path}/logs`, {
            phone: `+${digits}`,
            status: ok ? "sent" : "failed",
            error: ok ? null : (json.error?.message ?? `http_${res.status}`),
            sentAt: new Date(),
          });
          if (ok) sent += 1; else failed += 1;
          // pacing
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) {
          failed += 1;
          await firestoreCreateDoc(`${path}/logs`, {
            phone: `+${digits}`, status: "failed",
            error: e instanceof Error ? e.message.slice(0, 200) : "network_error",
            sentAt: new Date(),
          });
        }
      }

      await firestoreSetDoc(path, {
        status: "completed",
        sentCount: sent,
        failedCount: failed,
        completedAt: new Date(),
      });

      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({
        userId: context.userId,
        action: "campaign.run",
        meta: { id: data.id, sent, failed, total: list.length },
      });
      return { ok: true as const, sent, failed };
    } catch (err) {
      throw safeError(err, "Could not start campaign");
    }
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles").select("firebase_uid").eq("id", context.userId).maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");
      const { firestoreDeleteDoc } = await import("@/integrations/firebase/admin.server");
      await firestoreDeleteDoc(`users/${profile.firebase_uid}/campaigns/${data.id}`);
      return { ok: true as const };
    } catch (err) {
      throw safeError(err, "Could not delete campaign");
    }
  });