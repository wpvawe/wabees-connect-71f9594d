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
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { phoneDocId } from "@/lib/firebase/normalizers";

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
  const ref = await addDoc(
    collection(db, `users/${uid}/conversations/${phoneDocId(phone)}/notes`),
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
  await updateDoc(
    doc(db, `users/${uid}/conversations/${phoneDocId(phone)}/notes/${noteId}`),
    { body: body.trim(), updatedAt: serverTimestamp() },
  );
}

export async function deleteNote(
  uid: string,
  phone: string,
  noteId: string,
): Promise<void> {
  const db = fbDb();
  await deleteDoc(
    doc(db, `users/${uid}/conversations/${phoneDocId(phone)}/notes/${noteId}`),
  );
}