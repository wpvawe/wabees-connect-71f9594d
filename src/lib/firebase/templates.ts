import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { fetchMetaTemplates } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";

type MetaTemplate = {
  id?: string;
  name?: string;
  category?: string;
  language?: string;
  status?: string;
  components?: Array<{ type?: string; text?: string; format?: string }>;
};

function extractBody(components: MetaTemplate["components"]): { body: string; header: string | null; footer: string | null } {
  let body = "";
  let header: string | null = null;
  let footer: string | null = null;
  for (const c of components ?? []) {
    if (c.type === "BODY" && c.text) body = c.text;
    else if (c.type === "HEADER" && c.text) header = c.text;
    else if (c.type === "FOOTER" && c.text) footer = c.text;
  }
  return { body, header, footer };
}

function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{\s*(\d+|[a-zA-Z_][\w]*)\s*\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ""))));
}

export async function syncTemplatesFromMeta(uid: string): Promise<{ synced: number }> {
  const creds = await loadWaCredentials(uid);
  if (!creds) throw new Error("Connect WhatsApp first");
  // Load WABA id from the same config doc the Flutter app uses. The PHP
  // backend expects `business_account_id`; direct browser → Meta calls are
  // intentionally avoided so website behavior matches the app.
  const db = fbDb();
  const cfg = await getDoc(doc(db, "users", uid, "whatsapp_config", "config"));
  const userDoc = await getDoc(doc(db, "users", uid));
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
    const ref = doc(col, t.name);
    const { body, header, footer } = extractBody(t.components);
    batch.set(
      ref,
      {
        metaTemplateId: t.id ?? null,
        name: t.name,
        category: (t.category ?? "UTILITY").toUpperCase(),
        languageCode: t.language ?? "en_US",
        body,
        header,
        footer,
        variables: extractVariables(body),
        status: (t.status ?? "PENDING").toUpperCase(),
        isSynced: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  return { synced: list.length };
}