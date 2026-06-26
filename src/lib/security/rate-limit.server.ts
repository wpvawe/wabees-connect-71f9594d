import { getRequestIP } from "@tanstack/react-start/server";

/**
 * Server-only sliding window rate limit, backed by public.check_rate_limit().
 * Throws Error('Rate limit exceeded') when over the cap.
 */
export async function assertRateLimit(
  scope: string,
  identifier: string,
  max: number,
  windowSec: number,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = `${scope}:${identifier}`;
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    _key: key,
    _max: max,
    _window_sec: windowSec,
  });
  if (error) throw new Error("Rate limit check failed");
  if (data === false) throw new Error("Rate limit exceeded, try again shortly");
}

export function clientIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) || "unknown";
  } catch {
    return "unknown";
  }
}