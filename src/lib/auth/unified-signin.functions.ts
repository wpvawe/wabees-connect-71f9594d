import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { safeError } from "@/lib/security/safe-error";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(128),
});

export type UnifiedSignInResult =
  | { mode: "supabase" }
  | { mode: "linked"; access_token: string; refresh_token: string };

/**
 * Unified sign-in: try Supabase first; on failure, fall back to verifying
 * with Firebase (Flutter app users) and auto-link / auto-create the
 * Supabase user. Always returns a generic error on bad credentials.
 */
export const unifiedSignIn = createServerFn({ method: "POST" })
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data }): Promise<UnifiedSignInResult> => {
    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit("auth:signin", data.email, 10, 60);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Fast path — Supabase password sign-in via admin REST (no session persisted).
      //    We use the public client below to actually mint a session.
      const { createClient } = await import("@supabase/supabase-js");
      const pub = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      });
      const { data: supaSession, error: supaErr } = await pub.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (!supaErr && supaSession.session) {
        // Linked-account back-fill: ensure firebase_uid is set on profile.
        await backfillFirebaseLink(supabaseAdmin, supaSession.user.id, data.email);
        return { mode: "supabase" };
      }

      // 2. Fallback — verify against Firebase (Flutter app credentials).
      const { verifyFirebasePassword } = await import("@/integrations/firebase/admin.server");
      const fbUser = await verifyFirebasePassword(data.email, data.password);
      if (!fbUser) {
        throw new Error("Invalid email or password");
      }

      // 3. Link or create the matching Supabase user, then mint a session.
      const { linkOrCreateSupabaseUser } = await import("@/lib/auth/link-firebase.server");
      await linkOrCreateSupabaseUser({
        email: data.email,
        password: data.password,
        firebaseUid: fbUser.uid,
        displayName: fbUser.displayName,
      });

      const { data: linkedSession, error: linkedErr } = await pub.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (linkedErr || !linkedSession.session) throw linkedErr ?? new Error("Could not establish session");

      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: linkedSession.user.id, action: "auth.signin.linked", meta: { firebase_uid: fbUser.uid } });

      return {
        mode: "linked",
        access_token: linkedSession.session.access_token,
        refresh_token: linkedSession.session.refresh_token,
      };
    } catch (err) {
      throw safeError(err, "Invalid email or password");
    }
  });

async function backfillFirebaseLink(
  admin: Awaited<ReturnType<typeof getAdmin>>,
  userId: string,
  email: string,
) {
  const { data: profile } = await admin
    .from("profiles")
    .select("firebase_uid")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.firebase_uid) return;
  const { getFirebaseUserByEmail } = await import("@/integrations/firebase/admin.server");
  const fb = await getFirebaseUserByEmail(email).catch(() => null);
  if (fb) {
    await admin.from("profiles").update({ firebase_uid: fb.uid }).eq("id", userId);
  }
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}