import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { clearWebhookOwnerCache } from "@/lib/wabees/api";

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function ownerFromMapData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const users = Array.isArray(data.users) ? data.users : [];
  return firstString(data.ownerId, data.userId, users[0]);
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
  let sameUidOwner: string | null = null;

  // 1 + 2: users collection query — authoritative because the owner doc
  // itself records `whatsappPhoneNumberId` and only the real owner has
  // no `dataOwner` field.
  try {
    const matches = await getDocs(query(collection(db, "users"), where("whatsappPhoneNumberId", "==", phone), limit(10)));
    const candidates = matches.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    const realOwner = candidates.find((c) => c.id !== selfUid && (typeof c.data.dataOwner !== "string" || !c.data.dataOwner));
    if (realOwner) return realOwner.id;
    const anyOther = candidates.find((c) => c.id !== selfUid);
    if (anyOther) return anyOther.id;
    const selfCandidate = candidates.find((c) => c.id === selfUid);
    if (selfCandidate) sameUidOwner = selfCandidate.id;
  } catch {
    // Rules may block listing users — fall through to wa_map / backend.
  }

  try {
    const mapSnap = await getDoc(doc(db, "wa_map", phone));
    if (mapSnap.exists()) {
      const owner = ownerFromMapData(mapSnap.data() as Record<string, unknown>);
      if (owner && owner !== selfUid) return owner;
      if (owner) sameUidOwner = owner;
    }
  } catch {
    // Firestore rules may block cross-owner map reads; try backend + legacy query.
  }

  try {
    const { ownerId } = await clearWebhookOwnerCache(phone);
    if (ownerId && ownerId !== selfUid) return ownerId;
    if (ownerId) sameUidOwner = ownerId;
  } catch {
    // Non-fatal fallback below.
  }

  return sameUidOwner;
}
