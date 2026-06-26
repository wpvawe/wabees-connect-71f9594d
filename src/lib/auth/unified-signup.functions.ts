import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { safeError } from "@/lib/security/safe-error";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
  display_name: z.string().trim().min(2).max(60),
});

/**
 * Unified sign-up: refuse if a Firebase (Flutter) user already exists for
 * this email — they should sign in instead. Otherwise create both Supabase
 * and Firebase users with the same credentials.
 */
export const unifiedSignUp = createServerFn({ method: "POST" })
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data }) => {
    const { assertRateLimit } = await import("@/lib/security/rate-limit.server");
    await assertRateLimit("auth:signup", data.email, 3, 600);

    try {
      const { getFirebaseUserByEmail, createFirebaseUser } = await import(
        "@/integrations/firebase/admin.server"
      );

      const existingFb = await getFirebaseUserByEmail(data.email).catch(() => null);
      if (existingFb) {
        throw new Error("Account already exists — please sign in instead");
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { display_name: data.display_name },
      });
      if (createErr || !created.user) throw createErr ?? new Error("Could not create account");

      let firebaseUid: string | null = null;
      try {
        firebaseUid = await createFirebaseUser(data.email, data.password, data.display_name);
      } catch {
        // Non-fatal: web account still works; cross-platform link will heal on next sign-in.
      }

      await supabaseAdmin
        .from("profiles")
        .update({ firebase_uid: firebaseUid, display_name: data.display_name })
        .eq("id", created.user.id);

      const { logAudit } = await import("@/lib/security/audit.server");
      await logAudit({ userId: created.user.id, action: "auth.signup", meta: { firebase_uid: firebaseUid } });

      return { ok: true };
    } catch (err) {
      throw safeError(err, "Could not create account");
    }
  });