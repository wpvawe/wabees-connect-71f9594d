import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { metaExchangeSchema, manualConnectSchema } from "@/lib/schemas/meta";
import { safeError } from "@/lib/security/safe-error";

type WhatsAppRow = {
  user_id: string;
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string | null;
  business_name: string | null;
  quality_rating: string | null;
  method: "embedded_signup" | "manual";
  connected_at: string | null;
};

/** Lightweight status: never returns the token. */
export const getConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppRow | null> => {
    const { data, error } = await context.supabase
      .from("whatsapp_config")
      .select("user_id, phone_number_id, waba_id, display_phone, business_name, quality_rating, method, connected_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw safeError(error);
    return (data as WhatsAppRow | null) ?? null;
  });

/** Exchange Embedded Signup code → long-lived token, encrypt, persist. */
export const exchangeMetaToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => metaExchangeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit("meta:exchange", context.userId, 5, 600);

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const version = process.env.META_GRAPH_VERSION ?? "v21.0";
    if (!appId || !appSecret) throw new Error("Meta App not configured on server");

    try {
      const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", appId);
      tokenUrl.searchParams.set("client_secret", appSecret);
      tokenUrl.searchParams.set("code", data.code);
      const tokenRes = await fetch(tokenUrl.toString());
      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      const accessToken = tokenJson.access_token;
      if (!accessToken) throw new Error("Token exchange did not return access_token");

      // Best-effort: subscribe our app to WABA webhooks
      await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(data.waba_id)}/subscribed_apps`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
      ).catch(() => undefined);

      // Best-effort: fetch phone display + quality rating
      let displayPhone: string | null = null;
      let qualityRating: string | null = null;
      try {
        const pn = await fetch(
          `https://graph.facebook.com/${version}/${encodeURIComponent(data.phone_number_id)}?fields=display_phone_number,quality_rating`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (pn.ok) {
          const pj = (await pn.json()) as { display_phone_number?: string; quality_rating?: string };
          displayPhone = pj.display_phone_number ?? null;
          qualityRating = pj.quality_rating ?? null;
        }
      } catch {
        /* non-fatal */
      }

      const { encryptToken } = await import("@/lib/security/crypto.server");
      const enc = encryptToken(accessToken);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: upErr } = await supabaseAdmin.from("whatsapp_config").upsert({
        user_id: context.userId,
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id,
        display_phone: displayPhone,
        quality_rating: qualityRating,
        access_token_encrypted: enc.ciphertext,
        token_iv: enc.iv,
        token_tag: enc.tag,
        method: "embedded_signup",
        connected_at: new Date().toISOString(),
      });
      if (upErr) throw upErr;

      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: context.userId, action: "whatsapp.connect.embedded", meta: { waba_id: data.waba_id } });
      return { ok: true };
    } catch (err) {
      throw safeError(err, "Could not connect WhatsApp. Try again.");
    }
  });

/** Manual fallback for users still in Meta App review. */
export const manualConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => manualConnectSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit("meta:manual", context.userId, 5, 600);
    try {
      const { encryptToken } = await import("@/lib/security/crypto.server");
      const enc = encryptToken(data.access_token);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("whatsapp_config").upsert({
        user_id: context.userId,
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id,
        display_phone: data.display_phone ?? null,
        business_name: data.business_name ?? null,
        access_token_encrypted: enc.ciphertext,
        token_iv: enc.iv,
        token_tag: enc.tag,
        method: "manual",
        connected_at: new Date().toISOString(),
      });
      if (error) throw error;
      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: context.userId, action: "whatsapp.connect.manual" });
      return { ok: true };
    } catch (err) {
      throw safeError(err, "Could not save connection.");
    }
  });

export const disconnectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { error } = await context.supabase.from("whatsapp_config").delete().eq("user_id", context.userId);
      if (error) throw error;
      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: context.userId, action: "whatsapp.disconnect" });
      return { ok: true };
    } catch (err) {
      throw safeError(err);
    }
  });