/**
 * Internal notes per conversation. Stored under
 * users/{uid}/conversations/{phoneDocId}/notes/{noteId}. These are private
 * to the team — never sent to WhatsApp. Mirrors CRM-style scratchpads.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  increment,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { ensureConversationDoc, resolveConversationDocId } from "@/lib/firebase/conversations";
import { phoneQueryCandidates } from "@/lib/firebase/normalizers";

export type ConvNote = {
  id: string;
  body: string;
  authorUid: string;
  authorEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  pinned: boolean;
};

export async function addNote(
  uid: string,
  phone: string,
  body: string,
  author: { uid: string; email: string | null },
): Promise<string> {
  const db = fbDb();
  const convId = await ensureConversationDoc(uid, phone);
  const ref = await addDoc(
    collection(db, `users/${uid}/conversations/${convId}/notes`),
    {
      body: body.trim(),
      authorUid: author.uid,
      authorEmail: author.email,
      pinned: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
  // Maintain a lightweight counter on the parent conversation doc so the
  // inbox list can show a note-count badge without reading the subcollection.
  await setDoc(
    doc(db, `users/${uid}/conversations/${convId}`),
    { notesCount: increment(1) },
    { merge: true },
  ).catch(() => {});
  return ref.id;
}

export async function updateNote(
  uid: string,
  phone: string,
  noteId: string,
  body: string,
): Promise<void> {
  const db = fbDb();
  const convId = await resolveConversationDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${convId}/notes/${noteId}`);
  const payload = { body: body.trim(), updatedAt: serverTimestamp() };
  try {
    await updateDoc(ref, payload);
    return;
  } catch {
    /* note may live under a legacy phone doc; update every matching candidate below */
  }
  await Promise.all(
    phoneQueryCandidates(phone).map((candidate) =>
      updateDoc(doc(db, `users/${uid}/conversations/${candidate}/notes/${noteId}`), payload).catch(() => {}),
    ),
  );
}

export async function pinNote(
  uid: string,
  phone: string,
  noteId: string,
  pinned: boolean,
): Promise<void> {
  const db = fbDb();
  const convId = await resolveConversationDocId(uid, phone).catch(() => null);
  const candidates = phoneQueryCandidates(phone);
  const ids = Array.from(new Set([convId, ...candidates].filter(Boolean) as string[]));
  const payload = { pinned, updatedAt: serverTimestamp() };
  await Promise.all(
    ids.map((id) =>
      updateDoc(doc(db, `users/${uid}/conversations/${id}/notes/${noteId}`), payload).catch(() => {}),
    ),
  );
}

export async function deleteNote(
  uid: string,
  phone: string,
  noteId: string,
): Promise<void> {
  const db = fbDb();
  const candidates = phoneQueryCandidates(phone);
  const resolved = await resolveConversationDocId(uid, phone).catch(() => null);
  const ids = Array.from(new Set([resolved, ...candidates].filter(Boolean) as string[]));
  let decremented = false;
  await Promise.all(
    ids.map(async (convId) => {
      const ref = doc(db, `users/${uid}/conversations/${convId}/notes/${noteId}`);
      const snap = await getDoc(ref).catch(() => null);
      if (!snap?.exists()) return;
      const wasActive = snap.data()?.isDeleted !== true;
      await deleteDoc(ref).catch(async () => {
        await setDoc(ref, { isDeleted: true, deletedAt: serverTimestamp() }, { merge: true });
      });
      if (wasActive && !decremented) {
        decremented = true;
        await setDoc(
          doc(db, `users/${uid}/conversations/${convId}`),
          { notesCount: increment(-1) },
          { merge: true },
        ).catch(() => {});
      }
    }),
  );
}