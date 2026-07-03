/**
 * Owner-only utility: back-fills `firstResponseAt` / `firstResponseMs` on
 * historical conversations that pre-date SLA tracking so the Workload
 * dashboard can compute meaningful averages/medians without waiting for
 * new traffic.
 *
 * Strategy per conversation:
 * 1. Skip if `firstResponseMs` is already set.
 * 2. Require `lastIncomingMessageAt` — if none, there is nothing to
 *    measure a response against.
 * 3. Walk the `messages` subcollection for that contact ordered ascending
 *    and find the first inbound → outbound pair. Compute elapsed ms.
 * 4. Merge the pair back onto the conversation doc.
 *
 * Bounded to `MAX_CONVS` so a single click stays cheap.
 */
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { phoneQueryCandidates } from "@/lib/firebase/normalizers";

const MAX_CONVS = 200;

export type BackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
};

export async function backfillResponseTimes(uid: string): Promise<BackfillResult> {
  const db = fbDb();
  const convsSnap = await getDocs(
    query(
      collection(db, `users/${uid}/conversations`),
      orderBy("lastMessageAt", "desc"),
      limit(MAX_CONVS),
    ),
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const cDoc of convsSnap.docs) {
    scanned += 1;
    const data = cDoc.data() as Record<string, unknown>;
    if (typeof data.firstResponseMs === "number") {
      skipped += 1;
      continue;
    }
    const phone =
      typeof data.contactPhone === "string"
        ? data.contactPhone
        : cDoc.id;
    if (!phone) {
      skipped += 1;
      continue;
    }

    // Fetch up to 40 oldest messages for this contact.
    const candidates = phoneQueryCandidates(phone).slice(0, 10);
    const mSnap = await getDocs(
      query(
        collection(db, `users/${uid}/messages`),
        where("contactPhone", "in", candidates),
        orderBy("createdAt", "asc"),
        limit(40),
      ),
    ).catch(() => null);
    if (!mSnap) {
      skipped += 1;
      continue;
    }

    let firstInboundMs: number | null = null;
    let firstResponseMs: number | null = null;
    let firstResponseAtIso: string | null = null;
    for (const m of mSnap.docs) {
      const md = m.data() as Record<string, unknown>;
      const dir = md.direction;
      const createdRaw = md.createdAt;
      const created =
        createdRaw && typeof createdRaw === "object" && "toDate" in (createdRaw as object)
          ? (createdRaw as { toDate: () => Date }).toDate()
          : typeof createdRaw === "string"
            ? new Date(createdRaw)
            : null;
      if (!created) continue;
      const t = created.getTime();
      if (dir === "incoming" && firstInboundMs === null) {
        firstInboundMs = t;
      } else if (dir !== "incoming" && firstInboundMs !== null) {
        firstResponseMs = Math.max(0, t - firstInboundMs);
        firstResponseAtIso = created.toISOString();
        break;
      }
    }

    if (firstResponseMs === null || firstResponseAtIso === null) {
      skipped += 1;
      continue;
    }
    await setDoc(
      doc(db, `users/${uid}/conversations/${cDoc.id}`),
      {
        firstResponseAt: firstResponseAtIso,
        firstResponseMs,
        firstResponseBackfilledAt: serverTimestamp(),
      },
      { merge: true },
    );
    updated += 1;
  }

  return { scanned, updated, skipped };
}