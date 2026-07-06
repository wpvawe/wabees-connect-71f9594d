import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone } from "@/lib/firebase/normalizers";
import { releaseQuota, reserveQuota } from "@/lib/plans/limits";

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
  return { id: ref.id };
}

export async function deleteContact(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "contacts", id));
  // Decrement counters so users can free up cap slots by cleaning contacts.
  await incrementContactsUsed(uid, -1).catch(() => {});
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
): Promise<{ imported: number }> {
  if (rows.length === 0) return { imported: 0 };
  await reserveQuota(uid, "contacts", rows.length);
  const db = fbDb();
  let imported = 0;
  try {
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const r of chunk) {
        const ref = doc(collection(db, "users", uid, "contacts"));
        batch.set(ref, {
          name: r.name,
          phone: normalizePhone(r.phone),
          email: r.email ?? null,
          company: r.company ?? null,
          notes: r.notes ?? null,
          tags: r.tags ?? [],
          group: r.group ?? null,
          totalMessages: 0,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      imported += chunk.length;
    }
  } catch (err) {
    const uncreated = Math.max(0, rows.length - imported);
    if (uncreated > 0) await releaseQuota(uid, "contacts", uncreated).catch(() => {});
    throw err;
  }
  return { imported };
}
