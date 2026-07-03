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
  kind: "user" | "system" | "handoff";
  mentions: string[];
};

/**
 * Parse `@email` (or `@handle`) tokens out of a note body. Returns unique
 * lowercased identifiers. Called both when persisting a note (to store the
 * `mentions` field) and when rendering, so results MUST be deterministic.
 */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  const re = /(^|\s)@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.add(m[2].toLowerCase());
  return Array.from(out);
}

export async function addNote(
  uid: string,
  phone: string,
  body: string,
  author: { uid: string; email: string | null },
  options?: {
    kind?: "user" | "system" | "handoff";
    mentions?: string[];
  },
): Promise<string> {
  const db = fbDb();
  const convId = await ensureConversationDoc(uid, phone);
  const kind = options?.kind ?? "user";
  const mentions =
    options?.mentions !== undefined ? options.mentions : parseMentions(body);
  const ref = await addDoc(
    collection(db, `users/${uid}/conversations/${convId}/notes`),
    {
      body: body.trim(),
      authorUid: author.uid,
      authorEmail: author.email,
      pinned: false,
      kind,
      mentions,
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

/**
 * Convenience: append a system-generated note (handoff, state change,
 * automation, etc.). System notes render with distinct styling in the panel
 * and are never editable by the user.
 */
export async function addSystemNote(
  uid: string,
  phone: string,
  body: string,
  author: { uid: string; email: string | null },
  kind: "system" | "handoff" = "system",
): Promise<string> {
  return addNote(uid, phone, body, author, { kind, mentions: [] });
}

/**
 * Fire off a notification per mentioned agent so they see the mention in
 * their in-app tray. Notifications live under the OWNER's subtree — agents
 * share the owner's dataOwner subtree and can read it via `isAgentOf` rules.
 * The `targetAgentId` field lets the client-side hook narrow the list.
 */
export async function writeMentionNotifications(
  ownerUid: string,
  phone: string,
  mentions: string[],
  agents: { id: string; email: string | null }[],
  author: { uid: string; email: string | null },
  preview: string,
): Promise<void> {
  if (mentions.length === 0) return;
  const db = fbDb();
  const matched = agents.filter((a) =>
    mentions.some((m) => (a.email ?? "").toLowerCase() === m || a.id.toLowerCase() === m),
  );
  await Promise.all(
    matched
      .filter((a) => a.id !== author.uid)
      .map((a) =>
        addDoc(collection(db, `users/${ownerUid}/notifications`), {
          title: `${author.email || "A teammate"} mentioned you`,
          body: preview.slice(0, 160),
          type: "mention",
          read: false,
          targetAgentId: a.id,
          data: { phone, authorUid: author.uid, authorEmail: author.email },
          createdAt: serverTimestamp(),
        }).catch(() => null),
      ),
  );
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