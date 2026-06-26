/**
 * Strip internal details from errors before returning to the client.
 * Logs the full error server-side, returns a generic message to the caller.
 */
export function safeError(err: unknown, fallback = "Something went wrong"): Error {
  // eslint-disable-next-line no-console
  console.error("[safeError]", err);
  if (err instanceof Error) {
    // allowlist a few user-friendly messages
    const allow = /^(Invalid|Unauthorized|Forbidden|Rate limit|Honeypot|Not found|Already connected|Token expired|Invalid token|Email already registered)/i;
    if (allow.test(err.message)) return new Error(err.message);
  }
  return new Error(fallback);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}