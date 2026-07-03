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
import { normalizePhone, phoneQueryCandidates, phoneDocId } from "@/lib/firebase/normalizers";

export const MAX_PINNED = 3;

export type ConvPriority = "urgent" | "high" | "normal" | "low";

export const PRIORITY_META: Record<ConvPriority, { label: string; color: string; rank: number }> = {
  urgent: { label: "Urgent", color: "#dc2626", rank: 3 },
  high: { label: "High", color: "#f59e0b", rank: 2 },
  normal: { label: "Normal", color: "#64748b", rank: 1 },
  low: { label: "Low", color: "#94a3b8", rank: 0 },
};

export async function setPriority(uid: string, phone: string, priority: ConvPriority): Promise<void> {
  await setConversationVariants(uid, phone, {
    priority,
    priorityRank: PRIORITY_META[priority].rank,
  });
}

/**
 * Find the actual doc ID that holds this conversation. Older webhook writes
 * may have used a non-canonical form (digits-only, or raw as-received) so we
 * probe every candidate; fall back to the canonical +E.164 id.
 */
export async function resolveConversationDocId(uid: string, phone: string): Promise<string> {
  const db = fbDb();
  // Parallel probes — was up to 10 sequential reads per call.
  const candidates = phoneQueryCandidates(phone);
  const snaps = await Promise.all(
    candidates.map((c) =>
      getDoc(doc(db, `users/${uid}/conversations/${c}`))
        .then((s) => ({ c, exists: s.exists() }))
        .catch(() => ({ c, exists: false })),
    ),
  );
  const hit = snaps.find((s) => s.exists);
  return hit ? hit.c : phoneDocId(phone);
}

export async function resolveConversationDocIds(uid: string, phone: string): Promise<string[]> {
  const db = fbDb();
  const candidates = phoneQueryCandidates(phone);
  const snaps = await Promise.all(
    candidates.map((c) =>
      getDoc(doc(db, `users/${uid}/conversations/${c}`))
        .then((s) => (s.exists() ? c : null))
        .catch(() => null),
    ),
  );
  const found = snaps.filter((c): c is string => c !== null);
  const canonical = phoneDocId(phone);
  if (!found.includes(canonical)) found.push(canonical);
  return found;
}

async function setConversationVariants(
  uid: string,
  phone: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = fbDb();
  const ids = await resolveConversationDocIds(uid, phone);
  await Promise.all(
    ids.map((id) =>
      setDoc(
        doc(db, `users/${uid}/conversations/${id}`),
        { contactPhone: normalizePhone(phone), ...data, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    ),
  );
}

export async function ensureConversationDoc(uid: string, phone: string): Promise<string> {
  const db = fbDb();
  const id = phoneDocId(phone);
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
  const ids = await resolveConversationDocIds(uid, phone);
  const snaps = await Promise.all(
    ids.map((id) => getDoc(doc(db, `users/${uid}/conversations/${id}`)).catch(() => null)),
  );
  const currentlyPinned = snaps.some((snap) => Boolean(snap?.data()?.isPinned));
  if (!currentlyPinned) {
    const pinned = await getDocs(
      query(collection(db, `users/${uid}/conversations`), where("isPinned", "==", true)),
    );
    const uniquePinned = new Set(
      pinned.docs.map((d) => normalizePhone((d.data().contactPhone as string | undefined) || d.id)),
    );
    if (!uniquePinned.has(normalizePhone(phone)) && uniquePinned.size >= MAX_PINNED) return false;
    await setConversationVariants(uid, phone, { isPinned: true, pinOrder: Date.now() });
  } else {
    await setConversationVariants(uid, phone, { isPinned: false, pinOrder: 0 });
  }
  return true;
}

export async function addTag(uid: string, phone: string, tag: string): Promise<void> {
  await setConversationVariants(uid, phone, { tags: arrayUnion(tag.trim()) });
}

export async function removeTag(uid: string, phone: string, tag: string): Promise<void> {
  await setConversationVariants(uid, phone, { tags: arrayRemove(tag) });
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