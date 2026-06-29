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
  const ref = isUpdate
    ? doc(db, "users", uid, "contacts", input.id!)
    : doc(collection(db, "users", uid, "contacts"));
  const payload: Record<string, unknown> = {
    name: input.name,
    phone: normalizePhone(input.phone),
    email: input.email ?? null,
    company: input.company ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    group: input.group ?? null,
  };
  if (!isUpdate) {
    payload.totalMessages = 0;
    payload.createdAt = serverTimestamp();
  }
  await setDoc(ref, payload, { merge: true });
  return { id: ref.id };
}

export async function deleteContact(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "contacts", id));
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
  const db = fbDb();
  let imported = 0;
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
  return { imported };
}
