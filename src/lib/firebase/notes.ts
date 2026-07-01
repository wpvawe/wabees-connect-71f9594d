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
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { ensureConversationDoc, resolveConversationDocId } from "@/lib/firebase/conversations";

export type ConvNote = {
  id: string;
  body: string;
  authorUid: string;
  authorEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
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
  await updateDoc(ref, { body: body.trim(), updatedAt: serverTimestamp() }).catch(() =>
    setDoc(ref, { body: body.trim(), updatedAt: serverTimestamp() }, { merge: true }),
  );
}

export async function deleteNote(
  uid: string,
  phone: string,
  noteId: string,
): Promise<void> {
  const db = fbDb();
  const convId = await resolveConversationDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${convId}/notes/${noteId}`);
  await deleteDoc(ref).catch(async () => {
    const snap = await getDoc(ref).catch(() => null);
    if (snap?.exists()) await setDoc(ref, { isDeleted: true, deletedAt: serverTimestamp() }, { merge: true });
  });
}