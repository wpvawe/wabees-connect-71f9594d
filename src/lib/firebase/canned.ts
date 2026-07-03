/**
 * Canned responses (quick replies) — per-owner library of reusable message
 * bodies that agents can trigger from the composer with a `/shortcut`.
 *
 * Storage: `users/{ownerUid}/canned/{id}` — the owner writes, all agents
 * under that owner read (rules match the contacts / templates pattern).
 *
 * Body supports `{{name}}` and `{{phone}}` placeholders which are expanded
 * client-side when the reply is inserted (never stored in the message doc).
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

export type CannedResponse = {
  id: string;
  shortcut: string; // e.g. "hi" — matched after "/"
  title: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function createCanned(
  ownerUid: string,
  input: { shortcut: string; title: string; body: string },
): Promise<string> {
  const db = fbDb();
  const ref = await addDoc(collection(db, `users/${ownerUid}/canned`), {
    shortcut: slug(input.shortcut || input.title),
    title: input.title.trim(),
    body: input.body,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCanned(
  ownerUid: string,
  id: string,
  patch: Partial<Pick<CannedResponse, "shortcut" | "title" | "body">>,
): Promise<void> {
  const db = fbDb();
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.shortcut !== undefined) payload.shortcut = slug(patch.shortcut);
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.body !== undefined) payload.body = patch.body;
  await updateDoc(doc(db, `users/${ownerUid}/canned/${id}`), payload);
}

export async function deleteCanned(ownerUid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), `users/${ownerUid}/canned/${id}`));
}

/**
 * Expand `{{name}}` / `{{phone}}` in the body with the recipient's live
 * details. Unknown tokens are left untouched so the agent can spot them
 * before hitting send.
 */
export function expandCanned(
  body: string,
  ctx: { name?: string | null; phone?: string | null },
): string {
  return body
    .replace(/\{\{\s*name\s*\}\}/gi, (ctx.name ?? "").trim() || "there")
    .replace(/\{\{\s*phone\s*\}\}/gi, (ctx.phone ?? "").trim());
}

/**
 * Rank matches for a `/query` prompt. Prefix match on shortcut wins,
 * then substring on shortcut, then substring on title/body.
 */
export function filterCanned(
  list: CannedResponse[],
  query: string,
): CannedResponse[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, 8);
  const scored = list
    .map((c) => {
      const sc = c.shortcut.toLowerCase();
      const ti = c.title.toLowerCase();
      const bo = c.body.toLowerCase();
      let score = 0;
      if (sc.startsWith(q)) score += 100;
      else if (sc.includes(q)) score += 50;
      if (ti.startsWith(q)) score += 30;
      else if (ti.includes(q)) score += 15;
      if (bo.includes(q)) score += 5;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.c);
  return scored;
}