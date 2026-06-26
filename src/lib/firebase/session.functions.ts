/**
 * Server functions that bootstrap the Firebase Web SDK session for the
 * currently signed-in Supabase user. Returns public Firebase config + a
 * short-lived custom token scoped to the user's firebase_uid.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeError } from "@/lib/security/safe-error";

export const getFirebaseSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("firebase_uid")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile?.firebase_uid) {
        return { ready: false as const, reason: "no_firebase_uid" };
      }

      const apiKey = process.env.FIREBASE_WEB_API_KEY;
      const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
      const appId = process.env.FIREBASE_WEB_APP_ID;
      if (!apiKey || !authDomain || !appId) {
        return { ready: false as const, reason: "firebase_web_not_configured" };
      }

      const { mintCustomToken, firebaseProjectId } = await import("@/integrations/firebase/admin.server");
      const token = await mintCustomToken(profile.firebase_uid);
      return {
        ready: true as const,
        token,
        uid: profile.firebase_uid,
        config: { apiKey, authDomain, projectId: firebaseProjectId(), appId },
      };
    } catch (err) {
      throw safeError(err, "Could not start Firebase session");
    }
  });