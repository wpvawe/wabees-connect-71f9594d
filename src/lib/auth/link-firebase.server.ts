/**
 * Server-only helpers for linking Firebase ↔ Supabase identities.
 * Always loaded via dynamic import inside server-fn handlers.
 */
import { randomBytes } from "node:crypto";

/**
 * Ensure a Supabase auth user exists for this email and is linked to the
 * given Firebase uid. Returns the Supabase user id.
 */
export async function linkOrCreateSupabaseUser(opts: {
  email: string;
  password: string;
  firebaseUid: string;
  displayName?: string;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. Look for existing Supabase user by email.
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === opts.email.toLowerCase());

  if (existing) {
    // Reset password so the user can sign in with what they just typed.
    await supabaseAdmin.auth.admin.updateUserById(existing.id, { password: opts.password, email_confirm: true });
    await supabaseAdmin
      .from("profiles")
      .update({ firebase_uid: opts.firebaseUid, display_name: opts.displayName ?? null })
      .eq("id", existing.id);
    return existing.id;
  }

  // 2. Create new Supabase user (auto-confirmed since Firebase already trusts the email).
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { display_name: opts.displayName, firebase_uid: opts.firebaseUid },
  });
  if (createErr || !created.user) throw createErr ?? new Error("Could not create user");

  // 3. Persist firebase_uid on profile (trigger created the row).
  await supabaseAdmin
    .from("profiles")
    .update({ firebase_uid: opts.firebaseUid, display_name: opts.displayName ?? null })
    .eq("id", created.user.id);

  return created.user.id;
}

export function randomPassword(): string {
  return randomBytes(24).toString("base64url");
}