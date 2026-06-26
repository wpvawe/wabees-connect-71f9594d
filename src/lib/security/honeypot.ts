/**
 * Honeypot: hidden field bots love to fill. Real users never see it.
 * Field name `company_url` chosen because it's plausible to autofill.
 */
export const HONEYPOT_FIELD = "company_url";

export function isBotSubmission(formValues: Record<string, unknown>): boolean {
  const v = formValues[HONEYPOT_FIELD];
  return typeof v === "string" && v.trim().length > 0;
}