/**
 * Sync WhatsApp Business message templates from Meta into the user's
 * Firestore so both the web inbox + Flutter app see the same list.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeError } from "@/lib/security/safe-error";

type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  quality_score?: { score?: string };
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text?: string; url?: string; phone_number?: string }>;
  }>;
};

function extractVariables(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)) {
    const v = m[1];
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export const syncTemplatesFromMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
      await assertRateLimit("templates:sync", context.userId, 10, 600);

      const { data: profile } = await context.supabase
        .from("profiles")
        .select("firebase_uid")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile?.firebase_uid) throw new Error("Not configured: no firebase_uid");

      const { data: cfg } = await context.supabase
        .from("whatsapp_config")
        .select("waba_id, access_token_encrypted, token_iv, token_tag")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!cfg?.waba_id || !cfg.access_token_encrypted) {
        throw new Error("Not connected: connect WhatsApp first");
      }

      const { decryptToken } = await import("@/lib/security/crypto.server");
      const accessToken = decryptToken({
        ciphertext: cfg.access_token_encrypted,
        iv: cfg.token_iv!,
        tag: cfg.token_tag!,
      });

      const version = process.env.META_GRAPH_VERSION ?? "v21.0";
      const url = `https://graph.facebook.com/${version}/${cfg.waba_id}/message_templates?limit=200&fields=id,name,language,category,status,quality_score,components`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`Meta API error ${res.status}`);
      const json = (await res.json()) as { data?: MetaTemplate[] };
      const items = json.data ?? [];

      const { firestoreSetDoc } = await import("@/integrations/firebase/admin.server");
      let synced = 0;
      for (const t of items) {
        const bodyComp = t.components?.find((c) => c.type === "BODY");
        const headerComp = t.components?.find((c) => c.type === "HEADER");
        const footerComp = t.components?.find((c) => c.type === "FOOTER");
        const buttonsComp = t.components?.find((c) => c.type === "BUTTONS");
        const body = bodyComp?.text ?? "";
        await firestoreSetDoc(`users/${profile.firebase_uid}/templates/${t.id}`, {
          metaTemplateId: t.id,
          name: t.name,
          category: (t.category ?? "UTILITY").toUpperCase(),
          languageCode: t.language,
          body,
          header: headerComp?.text ?? null,
          footer: footerComp?.text ?? null,
          buttons: (buttonsComp?.buttons ?? []).map((b) => ({
            type: b.type,
            text: b.text ?? null,
            url: b.url ?? null,
            phone_number: b.phone_number ?? null,
          })),
          variables: extractVariables(body),
          status: (t.status ?? "PENDING").toUpperCase(),
          isSynced: true,
          qualityScore: t.quality_score?.score ?? null,
          updatedAt: new Date(),
        });
        synced += 1;
      }

      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: context.userId, action: "templates.sync", meta: { count: synced } });
      return { ok: true as const, synced };
    } catch (err) {
      throw safeError(err, "Could not sync templates");
    }
  });