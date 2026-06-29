export function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

/** Mirrors Flutter PhoneUtils.normalize: stored/keyed phones use +E.164. */
export function normalizePhone(phone: string): string {
  let cleaned = phone.trim().replace(/[\s\-().]/g, "");
  const hadPlus = cleaned.startsWith("+");
  if (hadPlus) cleaned = cleaned.slice(1);
  cleaned = cleaned.replace(/[^0-9]/g, "");
  if (!cleaned) return "";
  if (!hadPlus) {
    if (cleaned.startsWith("0") && cleaned.length === 11) cleaned = `92${cleaned.slice(1)}`;
    else if (cleaned.startsWith("3") && cleaned.length === 10) cleaned = `92${cleaned}`;
  }
  return `+${cleaned}`;
}

export function phoneQueryCandidates(phone: string): string[] {
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/[^0-9]/g, "");
  return Array.from(new Set([phone, normalized, digits].filter(Boolean))).slice(0, 10);
}

/**
 * Canonical Firestore document ID for a phone number.
 * Matches WhatsApp `wa_id` (digits only, no "+") used by the PHP webhook
 * and the Flutter app — keeps "+92xxx" and "92xxx" from forking into two docs.
 */
export function phoneDocId(phone: string): string {
  return normalizePhone(phone).replace(/[^0-9]/g, "");
}

export function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

export function strOrNull(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x : null;
}

export function listOfStrings(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}