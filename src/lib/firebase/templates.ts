import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { fetchMetaTemplates } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";

type MetaTemplate = {
  id?: string;
  name?: string;
  category?: string;
  language?: string;
  status?: string;
  components?: Array<{ type?: string; text?: string; format?: string; buttons?: Array<Record<string, unknown>> }>;
  quality_score?: { score?: string } | string;
};

function extractParts(components: MetaTemplate["components"]): {
  body: string;
  header: string | null;
  footer: string | null;
  buttons: Array<Record<string, unknown>>;
} {
  let body = "";
  let header: string | null = null;
  let footer: string | null = null;
  let buttons: Array<Record<string, unknown>> = [];
  for (const c of components ?? []) {
    if (c.type === "BODY" && c.text) body = c.text;
    else if (c.type === "HEADER" && c.format === "TEXT" && c.text) header = c.text;
    else if (c.type === "FOOTER" && c.text) footer = c.text;
    else if (c.type === "BUTTONS" && Array.isArray(c.buttons)) buttons = c.buttons;
  }
  return { body, header, footer, buttons };
}

function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{\s*(\d+|[a-zA-Z_][\w]*)\s*\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ""))));
}

export async function syncTemplatesFromMeta(uid: string, credentialUid = uid): Promise<{ synced: number }> {
  const creds = await loadWaCredentials(credentialUid);
  if (!creds) throw new Error("Connect WhatsApp first");
  // Load WABA id from the same config doc the Flutter app uses. The PHP
  // backend expects `business_account_id`; direct browser → Meta calls are
  // intentionally avoided so website behavior matches the app.
  const db = fbDb();
  const cfg = await getDoc(doc(db, "users", credentialUid, "whatsapp_config", "config"));
  const userDoc = await getDoc(doc(db, "users", credentialUid));
  const waba_id =
    (cfg.data()?.businessAccountId as string | undefined) ||
    (userDoc.data()?.whatsappBusinessAccountId as string | undefined) ||
    "";

  if (!waba_id) throw new Error("WABA ID missing — add it on Connect page to sync templates");

  const res = await fetchMetaTemplates({ business_account_id: waba_id, access_token: creds.access_token });
  if (res.raw.error && typeof res.raw.error === "object") {
    const msg = (res.raw.error as { message?: string }).message;
    throw new Error(msg ?? "Could not fetch templates");
  }
  const list =
    (res.raw.templates as MetaTemplate[] | undefined) ??
    (res.raw.data as MetaTemplate[] | undefined) ??
    [];
  if (list.length === 0) return { synced: 0 };

  const col = collection(db, "users", uid, "templates");
  const batch = writeBatch(db);
  for (const t of list) {
    if (!t.name) continue;
    const { body, header, footer, buttons } = extractParts(t.components);
    const qualityScore = typeof t.quality_score === "string" ? t.quality_score : t.quality_score?.score;
    const payload = {
      metaTemplateId: t.id ?? null,
      name: t.name,
      category: (t.category ?? "UTILITY").toUpperCase(),
      languageCode: t.language ?? "en_US",
      body,
      header,
      footer,
      buttons,
      variables: extractVariables(body),
      variableSamples: {},
      variableTypes: {},
      status: (t.status ?? "PENDING").toUpperCase(),
      isSynced: true,
      qualityScore: qualityScore ?? null,
      updatedAt: serverTimestamp(),
    };
    const existing = t.id
      ? await getDocs(query(col, where("metaTemplateId", "==", t.id), limit(1)))
      : await getDocs(query(col, where("name", "==", t.name), limit(1)));
    if (existing.empty) {
      batch.set(doc(col), { ...payload, createdAt: serverTimestamp() });
    } else {
      batch.update(existing.docs[0].ref, payload);
    }
  }
  await batch.commit();
  return { synced: list.length };
}