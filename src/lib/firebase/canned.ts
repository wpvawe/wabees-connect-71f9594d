/**
 * Canned responses (quick replies) — per-owner library of reusable message
 * bodies that agents can trigger from the composer with a `/shortcut`.
 *
 * Storage: `users/{ownerUid}/canned/{id}` — the owner writes, all agents
 * under that owner read (rules match the contacts / templates pattern).
 *
 * Body supports rich `{{variable}}` placeholders (name, first_name, phone,
 * email, company, agent, date, time) which are expanded client-side when
 * the reply is inserted (never stored in the message doc).
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

/** Context used to personalise a canned body at insert-time. */
export type CannedContext = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  agent?: string | null;
};

/** All supported placeholders, in the order shown to the user. */
export const CANNED_VARIABLES: ReadonlyArray<{
  token: string;
  label: string;
  hint: string;
}> = [
  { token: "{{name}}", label: "Contact name", hint: "Full contact name" },
  { token: "{{first_name}}", label: "First name", hint: "First word of the contact name" },
  { token: "{{phone}}", label: "Phone", hint: "Recipient phone (E.164)" },
  { token: "{{email}}", label: "Email", hint: "Contact email if saved" },
  { token: "{{company}}", label: "Company", hint: "Contact company if saved" },
  { token: "{{agent}}", label: "Your name", hint: "Signed-in agent's name" },
  { token: "{{date}}", label: "Today's date", hint: "Local date, e.g. Jul 3, 2026" },
  { token: "{{time}}", label: "Current time", hint: "Local time, e.g. 4:12 PM" },
];

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
export function expandCanned(body: string, ctx: CannedContext): string {
  const name = (ctx.name ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  const now = new Date();
  const date = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const map: Record<string, string> = {
    name: name || "there",
    first_name: firstName || "there",
    phone: (ctx.phone ?? "").trim(),
    email: (ctx.email ?? "").trim(),
    company: (ctx.company ?? "").trim(),
    agent: (ctx.agent ?? "").trim(),
    date,
    time,
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (raw, key: string) => {
    const k = key.toLowerCase();
    const val = map[k];
    // Unknown token → leave as-is so the agent can spot it before sending.
    if (val === undefined) return raw;
    return val;
  });
}

/**
 * Return the list of `{{var}}` tokens in `body` that would end up empty
 * for the given context — used by the composer to warn agents about
 * un-personalised placeholders before they hit send.
 */
export function findUnresolvedVars(body: string, ctx: CannedContext): string[] {
  const expanded = expandCanned(body, ctx);
  const missing = new Set<string>();
  // Unknown token still literal in expanded body.
  const unknown = expanded.match(/\{\{\s*[a-z_]+\s*\}\}/gi);
  if (unknown) for (const t of unknown) missing.add(t.replace(/\s+/g, ""));
  // Known-but-empty tokens (email/company/agent may be blank). We detect by
  // re-expanding with sentinel values and comparing lengths for each token.
  const knownTokens = body.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? [];
  for (const raw of knownTokens) {
    const key = raw.replace(/[^a-z_]/gi, "").toLowerCase();
    if (!["email", "company", "agent"].includes(key)) continue;
    const val = (ctx as Record<string, string | null | undefined>)[key];
    if (!val || String(val).trim() === "") missing.add(`{{${key}}}`);
  }
  return Array.from(missing);
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