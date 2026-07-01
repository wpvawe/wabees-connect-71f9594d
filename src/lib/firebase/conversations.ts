/**
 * Conversation-level actions: pin (max 3), tag add/remove, delete, tag CRUD.
 * Mirrors Flutter's message_repository (togglePin / addTag / removeTag /
 * deleteConversation / tag collection) so app & website stay in sync.
 */
import {
  addDoc,
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
async function resolveConvDocId(uid: string, phone: string): Promise<string> {
  const db = fbDb();
  for (const c of phoneQueryCandidates(phone)) {
    const s = await getDoc(doc(db, `users/${uid}/conversations/${c}`)).catch(() => null);
    if (s && s.exists()) return c;
  }
  return phoneDocId(phone);
}

/** Toggle pinned state. Returns false when max pinned limit is already reached. */
export async function togglePin(uid: string, phone: string): Promise<boolean> {
  const db = fbDb();
  const id = await resolveConvDocId(uid, phone);
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
  const id = await resolveConvDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${id}`);
  const snap = await getDoc(ref);
  const existing: string[] = Array.isArray(snap.data()?.tags) ? snap.data()!.tags : [];
  if (existing.includes(tag)) return;
  await setDoc(ref, { tags: [...existing, tag] }, { merge: true });
}

export async function removeTag(uid: string, phone: string, tag: string): Promise<void> {
  const db = fbDb();
  const id = await resolveConvDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${id}`);
  const snap = await getDoc(ref);
  const existing: string[] = Array.isArray(snap.data()?.tags) ? snap.data()!.tags : [];
  await setDoc(ref, { tags: existing.filter((t) => t !== tag) }, { merge: true });
}

/**
 * Delete a conversation from the user's inbox. Also bulk-deletes the
 * associated messages (all phone-candidate keys) so it stays gone after refresh.
 * WhatsApp side is untouched — Meta does not expose a way to hide from customer.
 */
export async function deleteConversation(uid: string, phone: string): Promise<void> {
  const db = fbDb();
  // Delete every candidate conversation doc (normalized + raw variants).
  for (const c of phoneQueryCandidates(phone)) {
    await deleteDoc(doc(db, `users/${uid}/conversations/${c}`)).catch(() => {});
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
    for (const d of snap.docs.slice(i, i + CHUNK)) batch.delete(d.ref);
    await batch.commit().catch(() => {});
  }
}

/** Tag catalog under users/{uid}/tags. */
export type TagDef = { id: string; name: string; color: string; createdAt?: string };

export async function createTag(uid: string, name: string, color: string): Promise<string> {
  const db = fbDb();
  const ref = await addDoc(collection(db, `users/${uid}/tags`), {
    name,
    color,
    createdAt: serverTimestamp(),
  });
  return ref.id;
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
    await updateDoc(d.ref, { tags: t.filter((x) => x !== name) }).catch(() => {});
  }
}