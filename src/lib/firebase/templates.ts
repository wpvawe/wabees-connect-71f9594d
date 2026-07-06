import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { fetchMetaTemplates } from "@/lib/wabees/api";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { reserveQuota, releaseQuota } from "@/lib/plans/limits";

type MetaTemplate = {
  id?: string;
  name?: string;
  category?: string;
  language?: string;
  status?: string;
  components?: Array<{
    type?: string;
    text?: string;
    format?: string;
    buttons?: Array<Record<string, unknown>>;
  }>;
  quality_score?: { score?: string } | string;
};

function extractParts(components: MetaTemplate["components"]): {
  body: string;
  header: string | null;
  headerFormat: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  headerMediaUrl: string | null;
  footer: string | null;
  buttons: Array<Record<string, unknown>>;
} {
  let body = "";
  let header: string | null = null;
  let headerFormat: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null = null;
  let headerMediaUrl: string | null = null;
  let footer: string | null = null;
  let buttons: Array<Record<string, unknown>> = [];
  for (const c of components ?? []) {
    if (c.type === "BODY" && c.text) body = c.text;
    else if (c.type === "HEADER") {
      const fmt = (c.format ?? "TEXT").toUpperCase();
      if (fmt === "TEXT") {
        headerFormat = "TEXT";
        header = c.text ?? null;
      } else if (fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT") {
        headerFormat = fmt;
        const ex = (c as unknown as { example?: { header_handle?: string[] } }).example;
        headerMediaUrl = Array.isArray(ex?.header_handle) ? (ex!.header_handle![0] ?? null) : null;
      }
    } else if (c.type === "FOOTER" && c.text) footer = c.text;
    else if (c.type === "BUTTONS" && Array.isArray(c.buttons)) buttons = c.buttons;
  }
  return { body, header, headerFormat, headerMediaUrl, footer, buttons };
}

function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{\s*(\d+|[a-zA-Z_][\w]*)\s*\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ""))));
}

export async function syncTemplatesFromMeta(
  uid: string,
  credentialUid = uid,
): Promise<{ synced: number; deleted: number }> {
  const creds = await loadWaConnection(credentialUid);
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

  const res = await fetchMetaTemplates({
    business_account_id: waba_id,
    access_token: "",
  });
  if (res.raw.error && typeof res.raw.error === "object") {
    const msg = (res.raw.error as { message?: string }).message;
    throw new Error(msg ?? "Could not fetch templates");
  }
  const list =
    (res.raw.templates as MetaTemplate[] | undefined) ??
    (res.raw.data as MetaTemplate[] | undefined) ??
    [];
  if (list.length === 0) return { synced: 0, deleted: 0 };

  const col = collection(db, "users", uid, "templates");
  // One collection fetch instead of N+1 reads (50 templates = 50 lookups
  // before). Index by metaTemplateId AND name so both match paths work.
  const existingSnap = await getDocs(col);
  const byMetaId = new Map<string, { ref: typeof existingSnap.docs[number]["ref"] }>();
  const byName = new Map<string, { ref: typeof existingSnap.docs[number]["ref"] }>();
  const seenRefIds = new Set<string>();
  for (const d of existingSnap.docs) {
    const data = d.data() as { metaTemplateId?: string | null; name?: string };
    if (data.metaTemplateId) byMetaId.set(data.metaTemplateId, { ref: d.ref });
    if (data.name) byName.set(data.name, { ref: d.ref });
  }

  const incomingMetaIds = new Set<string>();
  const incomingNames = new Set<string>();
  const batch = writeBatch(db);
  let synced = 0;
  let newTemplates = 0;
  for (const t of list) {
    if (!t.name) continue;
    if (t.id) incomingMetaIds.add(t.id);
    incomingNames.add(t.name);
    const { body, header, headerFormat, headerMediaUrl, footer, buttons } = extractParts(t.components);
    const qualityScore =
      typeof t.quality_score === "string" ? t.quality_score : t.quality_score?.score;
    const payload = {
      metaTemplateId: t.id ?? null,
      name: t.name,
      category: (t.category ?? "UTILITY").toUpperCase(),
      languageCode: t.language ?? "en_US",
      body,
      header,
      headerFormat,
      headerMediaUrl,
      footer,
      buttons,
      variables: extractVariables(body),
      headerVariables: extractVariables(header ?? ""),
      variableSamples: {},
      variableTypes: {},
      status: (t.status ?? "PENDING").toUpperCase(),
      isSynced: true,
      isDeleted: false,
      qualityScore: qualityScore ?? null,
      updatedAt: serverTimestamp(),
    };
    const existing = (t.id && byMetaId.get(t.id)) || byName.get(t.name);
    if (existing) {
      batch.update(existing.ref, payload);
      seenRefIds.add(existing.ref.id);
    } else {
      newTemplates++;
      batch.set(doc(col), { ...payload, createdAt: serverTimestamp() });
    }
    synced++;
  }

  if (newTemplates > 0) {
    await reserveQuota(uid, "templates", newTemplates);
  }

  // Mark local templates that no longer exist upstream as deleted. Soft-flag
  // (not hard delete) so campaigns still resolve the historical row.
  let deleted = 0;
  for (const d of existingSnap.docs) {
    if (seenRefIds.has(d.id)) continue;
    const data = d.data() as { metaTemplateId?: string | null; name?: string; isDeleted?: boolean };
    const stillPresent =
      (data.metaTemplateId && incomingMetaIds.has(data.metaTemplateId)) ||
      (data.name && incomingNames.has(data.name));
    if (stillPresent || data.isDeleted) continue;
    batch.update(d.ref, { isDeleted: true, status: "DELETED", updatedAt: serverTimestamp() });
    deleted++;
  }

  try {
    await batch.commit();
  } catch (err) {
    if (newTemplates > 0) await releaseQuota(uid, "templates", newTemplates).catch(() => {});
    throw err;
  }
  // Meta removed these templates upstream — free the slots so the user's
  // plan cap reflects the current active count. Only released on successful
  // batch commit; soft-flagged rows stay in Firestore for campaign lookups.
  if (deleted > 0) await releaseQuota(uid, "templates", deleted).catch(() => {});
  return { synced, deleted };
}
