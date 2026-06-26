import { getRequestHeader } from "@tanstack/react-start/server";
import { clientIp } from "./rate-limit.server";

export async function logAudit(opts: {
  userId: string | null;
  action: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      user_id: opts.userId,
      action: opts.action,
      ip: clientIp(),
      user_agent: getRequestHeader("user-agent") ?? null,
      meta: opts.meta ?? {},
    });
  } catch (e) {
    // never fail the calling fn on audit failure
    // eslint-disable-next-line no-console
    console.error("[audit] failed", e);
  }
}