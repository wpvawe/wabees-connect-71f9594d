import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";

export async function upsertContact(
  uid: string,
  input: { id?: string; name: string; phone: string; email?: string; company?: string; notes?: string; tags?: string[]; group?: string },
): Promise<{ id: string }> {
  const db = fbDb();
  const ref = input.id
    ? doc(db, "users", uid, "contacts", input.id)
    : doc(collection(db, "users", uid, "contacts"));
  await setDoc(
    ref,
    {
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      company: input.company ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      group: input.group ?? null,
      totalMessages: 0,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
  return { id: ref.id };
}

export async function deleteContact(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "contacts", id));
}

export async function bulkImportContacts(
  uid: string,
  rows: Array<{ name: string; phone: string; email?: string; company?: string; tags?: string[] }>,
): Promise<{ imported: number }> {
  if (rows.length === 0) return { imported: 0 };
  const db = fbDb();
  // Firestore batches max 500 writes.
  let imported = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const r of chunk) {
      const ref = doc(collection(db, "users", uid, "contacts"));
      batch.set(ref, {
        name: r.name,
        phone: r.phone,
        email: r.email ?? null,
        company: r.company ?? null,
        tags: r.tags ?? [],
        totalMessages: 0,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
    imported += chunk.length;
  }
  return { imported };
}