/** Hidden-field spam check used in auth forms. Bots fill every input. */
export const HONEYPOT_FIELD = "company_website" as const;

export function isBotSubmission(values: Record<string, unknown>): boolean {
  const v = values[HONEYPOT_FIELD];
  return typeof v === "string" && v.trim().length > 0;
}
