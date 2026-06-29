import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { clearWebhookOwnerCache } from "@/lib/wabees/api";

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function mapUserIds(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  const ids = new Set<string>();
  for (const id of [data.ownerId, data.userId]) {
    const s = firstString(id);
    if (s) ids.add(s);
  }
  const users = Array.isArray(data.users) ? data.users : [];
  for (const entry of users) {
    if (typeof entry === "string" && entry.trim()) ids.add(entry.trim());
    else if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const id = firstString(obj.userId, obj.uid, obj.id, obj.ownerId);
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function businessDataScore(id: string, data: Record<string, unknown> | null, selfUid?: string): number {
  if (!data) return id === selfUid ? -50 : 25;
  const isAgent = hasString(data.dataOwner);
  let score = 0;
  if (id !== selfUid) score += 250;
  if (!isAgent) score += 2_000;
  else score -= 2_000;
  if (data.whatsappConnected === true) score += 120;
  if (hasString(data.whatsappAccessToken)) score += 80;
  if (hasString(data.whatsappPhoneNumberId)) score += 80;
  score += num(data.totalMessages) * 10;
  score += num(data.totalContacts) * 8;
  score += num(data.totalBots) * 12;
  score += num(data.totalCampaigns) * 12;
  return score;
}

async function fetchUserData(id: string): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(fbDb(), "users", id));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function chooseBestOwner(ids: string[], selfUid?: string): Promise<string | null> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return null;
  const rows = await Promise.all(unique.map(async (id) => ({ id, data: await fetchUserData(id) })));
  rows.sort((a, b) => businessDataScore(b.id, b.data, selfUid) - businessDataScore(a.id, a.data, selfUid));
  const best = rows[0];
  if (!best) return null;
  return best.id;
}

/**
 * Resolve the Flutter app's WhatsApp owner mapping before the website decides
 * which `users/{uid}` tree to read/write.
 *
 * Resolution order (most authoritative first):
 *  1. `users` collection — any user whose `whatsappPhoneNumberId == phone`
 *     AND has no `dataOwner` set is the *real* owner. This survives even when
 *     a previous website reconnect mistakenly overwrote `wa_map.ownerId` to
 *     the website UID.
 *  2. Any other matching user (an agent / secondary account).
 *  3. `wa_map/{phoneNumberId}.ownerId` (may be stale).
 *  4. PHP backend `clear-cache.php` (also derives from wa_map server-side).
 */
export async function resolveExistingOwnerForPhone(phoneNumberId: string, selfUid?: string): Promise<string | null> {
  const phone = phoneNumberId.trim();
  if (!phone) return null;
  const db = fbDb();
  const candidateIds = new Set<string>();

  // 1 + 2: users collection query — authoritative because the owner doc
  // itself records `whatsappPhoneNumberId` and only the real owner has
  // no `dataOwner` field.
  try {
    const matches = await getDocs(query(collection(db, "users"), where("whatsappPhoneNumberId", "==", phone), limit(10)));
    const candidates = matches.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    for (const c of candidates) candidateIds.add(c.id);
    const scored = candidates
      .slice()
      .sort((a, b) => businessDataScore(b.id, b.data, selfUid) - businessDataScore(a.id, a.data, selfUid));
    const best = scored[0];
    if (best) return best.id;
  } catch {
    // Rules may block listing users — fall through to wa_map / backend.
  }

  try {
    const mapSnap = await getDoc(doc(db, "wa_map", phone));
    if (mapSnap.exists()) {
      for (const id of mapUserIds(mapSnap.data() as Record<string, unknown>)) candidateIds.add(id);
      const best = await chooseBestOwner(Array.from(candidateIds), selfUid);
      if (best && best !== selfUid) return best;
      if (best) candidateIds.add(best);
    }
  } catch {
    // Firestore rules may block cross-owner map reads; try backend + legacy query.
  }

  try {
    const { ownerId } = await clearWebhookOwnerCache(phone);
    if (ownerId) candidateIds.add(ownerId);
    const best = await chooseBestOwner(Array.from(candidateIds), selfUid);
    if (best) return best;
  } catch {
    // Non-fatal fallback below.
  }

  return candidateIds.has(selfUid ?? "") ? (selfUid ?? null) : (Array.from(candidateIds)[0] ?? null);
}
