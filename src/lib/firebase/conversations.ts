/**
 * Conversation-level actions: pin (max 3), tag add/remove, delete, tag CRUD.
 * Mirrors Flutter's message_repository (togglePin / addTag / removeTag /
 * deleteConversation / tag collection) so app & website stay in sync.
 */
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { phoneQueryCandidates, phoneDocId } from "@/lib/firebase/normalizers";

export const MAX_PINNED = 3;

/**
 * Find the actual doc ID that holds this conversation. Older webhook writes
 * may have used a non-canonical form (digits-only, or raw as-received) so we
 * probe every candidate; fall back to the canonical +E.164 id.
 */
export async function resolveConversationDocId(uid: string, phone: string): Promise<string> {
  const db = fbDb();
  for (const c of phoneQueryCandidates(phone)) {
    const s = await getDoc(doc(db, `users/${uid}/conversations/${c}`)).catch(() => null);
    if (s && s.exists()) return c;
  }
  return phoneDocId(phone);
}

export async function ensureConversationDoc(uid: string, phone: string): Promise<string> {
  const db = fbDb();
  const id = await resolveConversationDocId(uid, phone);
  await setDoc(
    doc(db, `users/${uid}/conversations/${id}`),
    {
      contactPhone: phoneDocId(phone),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}

/** Toggle pinned state. Returns false when max pinned limit is already reached. */
export async function togglePin(uid: string, phone: string): Promise<boolean> {
  const db = fbDb();
  const id = await resolveConversationDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${id}`);
  const snap = await getDoc(ref);
  const currentlyPinned = Boolean(snap.data()?.isPinned);
  if (!currentlyPinned) {
    const pinned = await getDocs(
      query(collection(db, `users/${uid}/conversations`), where("isPinned", "==", true)),
    );
    if (pinned.size >= MAX_PINNED) return false;
    await setDoc(ref, { isPinned: true, pinOrder: Date.now() }, { merge: true });
  } else {
    await setDoc(ref, { isPinned: false, pinOrder: 0 }, { merge: true });
  }
  return true;
}

export async function addTag(uid: string, phone: string, tag: string): Promise<void> {
  const db = fbDb();
  const id = await ensureConversationDoc(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${id}`);
  await setDoc(ref, { tags: arrayUnion(tag.trim()) }, { merge: true });
}

export async function removeTag(uid: string, phone: string, tag: string): Promise<void> {
  const db = fbDb();
  const id = await resolveConversationDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${id}`);
  await setDoc(ref, { tags: arrayRemove(tag) }, { merge: true });
}

/**
 * Delete a conversation from the user's inbox. Also bulk-deletes the
 * associated messages (all phone-candidate keys) so it stays gone after refresh.
 * WhatsApp side is untouched — Meta does not expose a way to hide from customer.
 */
export async function deleteConversation(uid: string, phone: string): Promise<void> {
  const db = fbDb();
  let hardDeleted = false;
  // Delete every candidate conversation doc (normalized + raw variants).
  for (const c of phoneQueryCandidates(phone)) {
    try {
      await deleteDoc(doc(db, `users/${uid}/conversations/${c}`));
      hardDeleted = true;
    } catch {
      await setDoc(
        doc(db, `users/${uid}/conversations/${c}`),
        { isDeleted: true, deletedAt: serverTimestamp() },
        { merge: true },
      ).catch(() => {});
    }
  }
  // Delete matching messages in chunks (Firestore batches cap at 500).
  const candidates = phoneQueryCandidates(phone);
  const q = query(
    collection(db, `users/${uid}/messages`),
    candidates.length === 1
      ? where("contactPhone", "==", candidates[0])
      : where("contactPhone", "in", candidates.slice(0, 30)),
  );
  const snap = await getDocs(q);
  const CHUNK = 450;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(i, i + CHUNK)) {
      if (hardDeleted) batch.delete(d.ref);
      else batch.set(d.ref, { isDeleted: true, deletedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit().catch(() => {});
  }
}

/** Tag catalog under users/{uid}/tags. */
export type TagDef = { id: string; name: string; color: string; createdAt?: string };

export async function createTag(uid: string, name: string, color: string): Promise<string> {
  const db = fbDb();
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Tag name is required");
  const duplicate = await getDocs(
    query(collection(db, `users/${uid}/tags`), where("name", "==", cleanName)),
  );
  if (!duplicate.empty) return duplicate.docs[0].id;
  const ref = await addDoc(collection(db, `users/${uid}/tags`), {
    name: cleanName,
    color,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTag(
  uid: string,
  tagId: string,
  updates: { name: string; color: string },
): Promise<void> {
  const db = fbDb();
  const ref = doc(db, `users/${uid}/tags/${tagId}`);
  const snap = await getDoc(ref);
  const oldName = snap.data()?.name as string | undefined;
  const newName = updates.name.trim();
  if (!newName) throw new Error("Tag name is required");
  await setDoc(ref, { name: newName, color: updates.color, updatedAt: serverTimestamp() }, { merge: true });
  if (!oldName || oldName === newName) return;
  const tagged = await getDocs(
    query(collection(db, `users/${uid}/conversations`), where("tags", "array-contains", oldName)),
  ).catch(() => null);
  if (!tagged) return;
  const batch = writeBatch(db);
  for (const d of tagged.docs) {
    const tags: string[] = Array.isArray(d.data().tags) ? d.data().tags : [];
    batch.set(
      d.ref,
      { tags: Array.from(new Set(tags.map((t) => (t === oldName ? newName : t)))) },
      { merge: true },
    );
  }
  await batch.commit();
}

export async function deleteTag(uid: string, tagId: string): Promise<void> {
  const db = fbDb();
  const tagSnap = await getDoc(doc(db, `users/${uid}/tags/${tagId}`));
  const name = tagSnap.data()?.name as string | undefined;
  await deleteDoc(doc(db, `users/${uid}/tags/${tagId}`)).catch(() => {});
  if (!name) return;
  // Remove tag from any conversation that references it.
  const q = query(
    collection(db, `users/${uid}/conversations`),
    where("tags", "array-contains", name),
  );
  const snap = await getDocs(q).catch(() => null);
  if (!snap) return;
  for (const d of snap.docs) {
    const t: string[] = Array.isArray(d.data().tags) ? d.data().tags : [];
    await updateDoc(d.ref, { tags: t.filter((x) => x !== name) }).catch(() =>
      setDoc(d.ref, { tags: t.filter((x) => x !== name) }, { merge: true }).catch(() => {}),
    );
  }
}