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
 * which `users/{uid}` tree to read/write. This mirrors the mobile connect flow:
 * `wa_map/{phoneNumberId}.ownerId/userId` is authoritative, with a users-query
 * fallback for older records that predate the map.
 */
export async function resolveExistingOwnerForPhone(phoneNumberId: string, selfUid?: string): Promise<string | null> {
  const phone = phoneNumberId.trim();
  if (!phone) return null;
  const db = fbDb();
  let sameUidOwner: string | null = null;

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

  try {
    const matches = await getDocs(query(collection(db, "users"), where("whatsappPhoneNumberId", "==", phone), limit(5)));
    const other = matches.docs.find((d) => d.id !== selfUid);
    if (other) return other.id;
    const same = matches.docs[0];
    if (same) return same.id;
  } catch {
    // Some rules do not allow users collection queries.
  }

  return sameUidOwner;
}
