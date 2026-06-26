import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeError } from "@/lib/security/safe-error";

/**
 * Pull WhatsApp connection from Firestore (Flutter app data) into Supabase
 * if web doesn't have one yet. Idempotent — safe to call on every dashboard
 * mount.
 */
export const syncWhatsAppFromFirebase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      // Skip if we already have a WA row.
      const { data: existing } = await context.supabase
        .from("whatsapp_config")
        .select("user_id")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (existing) return { synced: false, reason: "already_connected" };

      const { data: profile } = await context.supabase
        .from("profiles")
        .select("firebase_uid")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile?.firebase_uid) return { synced: false, reason: "no_firebase_uid" };

      const { firestoreGetDoc } = await import("@/integrations/firebase/admin.server");
      // The Flutter app stores WhatsApp config under users/{uid} (top-level fields).
      const doc = await firestoreGetDoc(`users/${profile.firebase_uid}`);
      if (!doc) return { synced: false, reason: "no_firestore_doc" };

      const phoneNumberId = (doc.phone_number_id ?? doc.phoneNumberId) as string | undefined;
      const wabaId = (doc.waba_id ?? doc.wabaId) as string | undefined;
      const accessToken = (doc.access_token ?? doc.accessToken) as string | undefined;
      if (!phoneNumberId || !wabaId || !accessToken) {
        return { synced: false, reason: "incomplete_firestore_doc" };
      }

      const { encryptToken } = await import("@/lib/security/crypto.server");
      const enc = encryptToken(accessToken);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("whatsapp_config").upsert({
        user_id: context.userId,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        display_phone: (doc.display_phone ?? doc.displayPhone ?? null) as string | null,
        business_name: (doc.business_name ?? doc.businessName ?? null) as string | null,
        quality_rating: (doc.quality_rating ?? doc.qualityRating ?? null) as string | null,
        access_token_encrypted: enc.ciphertext,
        token_iv: enc.iv,
        token_tag: enc.tag,
        method: "app_synced",
        source: "app",
        synced_at: new Date().toISOString(),
        connected_at: new Date().toISOString(),
      });
      if (error) throw error;

      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: context.userId, action: "whatsapp.sync.from_app" });
      return { synced: true };
    } catch (err) {
      throw safeError(err, "Could not sync WhatsApp from app");
    }
  });

/**
 * Mirror a web-side WA config back to Firestore so the Flutter app picks it
 * up immediately. Server-only helper used by connect.functions.ts.
 */
export async function writeWhatsAppToFirestore(opts: {
  firebaseUid: string;
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  display_phone?: string | null;
  business_name?: string | null;
  quality_rating?: string | null;
}): Promise<void> {
  const { firestoreSetDoc } = await import("@/integrations/firebase/admin.server");
  await firestoreSetDoc(`users/${opts.firebaseUid}`, {
    phone_number_id: opts.phone_number_id,
    waba_id: opts.waba_id,
    access_token: opts.access_token,
    display_phone: opts.display_phone ?? null,
    business_name: opts.business_name ?? null,
    quality_rating: opts.quality_rating ?? null,
    connected_at: new Date().toISOString(),
    source: "web",
  });
}