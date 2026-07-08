import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone } from "@/lib/firebase/normalizers";
import { incrementContactsUsed, releaseQuota, reserveQuota } from "@/lib/plans/limits";
import { bumpRefetch } from "@/lib/firebase/refetchBus";

export async function upsertContact(
  uid: string,
  input: {
    id?: string;
    name: string;
    phone: string;
    email?: string;
    company?: string;
    notes?: string;
    tags?: string[];
    group?: string;
  },
): Promise<{ id: string }> {
  const db = fbDb();
  const isUpdate = Boolean(input.id);
  let quotaReserved = false;
  if (!isUpdate) {
    await reserveQuota(uid, "contacts", 1);
    quotaReserved = true;
  }
  const ref = isUpdate
    ? doc(db, "users", uid, "contacts", input.id!)
    : doc(collection(db, "users", uid, "contacts"));
  // On update, only write fields the caller actually provided. Previously
  // `email: input.email ?? null` (etc.) would nuke existing values whenever a
  // form only edited "name" — the merge still overwrote email/company/notes
  // with null. On create we keep defaulting to null so the doc shape is stable.
  const payload: Record<string, unknown> = {
    name: input.name,
    phone: normalizePhone(input.phone),
  };
  const setIf = (key: string, val: unknown, defaultOnCreate: unknown = null) => {
    if (val !== undefined) payload[key] = val;
    else if (!isUpdate) payload[key] = defaultOnCreate;
  };
  setIf("email", input.email);
  setIf("company", input.company);
  setIf("notes", input.notes);
  setIf("tags", input.tags, []);
  setIf("group", input.group);
  if (!isUpdate) {
    payload.totalMessages = 0;
    payload.createdAt = serverTimestamp();
  }
  try {
    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    if (quotaReserved) await releaseQuota(uid, "contacts", 1).catch(() => {});
    throw err;
  }
  bumpRefetch("contacts");
  return { id: ref.id };
}

export async function deleteContact(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "contacts", id));
  // Decrement counters so users can free up cap slots by cleaning contacts.
  await incrementContactsUsed(uid, -1).catch(() => {});
  bumpRefetch("contacts");
}

export async function bulkImportContacts(
  uid: string,
  rows: Array<{
    name: string;
    phone: string;
    email?: string;
    company?: string;
    tags?: string[];
    group?: string;
    notes?: string;
  }>,
): Promise<{ imported: number; skipped: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0 };
  const db = fbDb();
  // Audit §3.4 — was "blind auto-ID create with zero de-dup", which allowed
  // the same CSV imported twice (or a CSV containing the same number twice)
  // to create duplicate contact records and re-message the same person from
  // later campaigns. Dedupe (a) within the incoming rows by normalized
  // phone and (b) against the existing collection.
  const seen = new Set<string>();
  const deduped: typeof rows = [];
  for (const r of rows) {
    const p = normalizePhone(r.phone);
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    deduped.push({ ...r, phone: p });
  }
  let existing = new Set<string>();
  try {
    const existingSnap = await getDocs(collection(db, "users", uid, "contacts"));
    existingSnap.forEach((d) => {
      const p = (d.data() as { phone?: string })?.phone;
      if (typeof p === "string" && p) existing.add(normalizePhone(p));
    });
  } catch {
    // If we can't read existing contacts, fall through — the in-CSV dedupe
    // above still prevents self-duplicates within this import.
    existing = new Set<string>();
  }
  const fresh = deduped.filter((r) => !existing.has(r.phone));
  const skipped = rows.length - fresh.length;
  if (fresh.length === 0) return { imported: 0, skipped };
  await reserveQuota(uid, "contacts", fresh.length);
  let imported = 0;
  try {
    for (let i = 0; i < fresh.length; i += 400) {
      const chunk = fresh.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const r of chunk) {
        // Use the normalized phone as the doc ID so re-imports are
        // structurally idempotent (setDoc merges instead of creating).
        const ref = doc(db, "users", uid, "contacts", r.phone);
        batch.set(ref, {
          name: r.name,
          phone: r.phone,
          email: r.email ?? null,
          company: r.company ?? null,
          notes: r.notes ?? null,
          tags: r.tags ?? [],
          group: r.group ?? null,
          totalMessages: 0,
          createdAt: serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      imported += chunk.length;
    }
  } catch (err) {
    const uncreated = Math.max(0, fresh.length - imported);
    if (uncreated > 0) await releaseQuota(uid, "contacts", uncreated).catch(() => {});
    throw err;
  }
  if (imported > 0) bumpRefetch("contacts");
  return { imported, skipped };
}
