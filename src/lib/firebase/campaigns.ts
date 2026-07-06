import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { sendTextMessage, sendTemplateMessage } from "@/lib/wabees/api";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { releaseQuota, reserveQuota } from "@/lib/plans/limits";
import { bumpRefetch } from "@/lib/firebase/refetchBus";

export type VariableSource = "static" | "contact";

export type CreateCampaignInput = {
  name: string;
  description: string;
  messageType: "template" | "text";
  messageBody: string; // rendered body (for preview/text mode)
  templateName?: string | null;
  templateLanguage?: string | null;
  selectedTemplateId?: string | null;
  templateVariables?: string[];
  templateHeader?: string | null;
  templateHeaderFormat?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  templateHeaderMediaUrl?: string | null;
  templateFooter?: string | null;
  templateButtons?: Array<Record<string, unknown>>;
  variableSource?: VariableSource;
  staticVariableValues?: Record<string, string>;
  /** For "contact" source: variable name -> contact field key (name/phone/email/company). */
  contactFieldMap?: Record<string, string>;
  audiencePhones: string[];
};

export type CampaignCreatePayload = {
  name: string;
  description: string;
  status: "draft";
  messageType: "template" | "text";
  messageBody: string;
  templateName: string | null;
  templateLanguage: string | null;
  selectedTemplateId: string | null;
  templateVariables: string[];
  templateHeader: string | null;
  templateHeaderFormat: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  templateHeaderMediaUrl: string | null;
  templateFooter: string | null;
  templateButtons: Array<Record<string, unknown>>;
  variableSource: VariableSource;
  staticVariableValues: Record<string, string>;
  contactFieldMap: Record<string, string>;
  recipientData: Array<Record<string, string>>;
  audiencePhones: string[];
  audienceTags: string[];
  audienceGroups: string[];
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  scheduledAt: null;
  createdAt: Timestamp;
  startedAt: null;
  completedAt: null;
};

export function buildCampaignCreatePayload(input: CreateCampaignInput): CampaignCreatePayload {
  return {
    name: input.name,
    description: input.description,
    status: "draft",
    messageType: input.messageType,
    messageBody: input.messageBody,
    templateName: input.templateName ?? null,
    templateLanguage: input.templateLanguage ?? null,
    selectedTemplateId: input.selectedTemplateId ?? null,
    templateVariables: input.templateVariables ?? [],
    templateHeader: input.templateHeader ?? null,
    templateHeaderFormat: input.templateHeaderFormat ?? null,
    templateHeaderMediaUrl: input.templateHeaderMediaUrl ?? null,
    templateFooter: input.templateFooter ?? null,
    templateButtons: input.templateButtons ?? [],
    variableSource: input.variableSource ?? "static",
    staticVariableValues: input.staticVariableValues ?? {},
    contactFieldMap: input.contactFieldMap ?? {},
    recipientData: [],
    audiencePhones: input.audiencePhones,
    audienceTags: [],
    audienceGroups: [],
    totalRecipients: input.audiencePhones.length,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0,
    scheduledAt: null,
    createdAt: Timestamp.now(),
    startedAt: null,
    completedAt: null,
  };
}

export function firestoreDebugValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return {
      __firestoreType: "Timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
      iso: value.toDate().toISOString(),
    };
  }
  if (Array.isArray(value)) return value.map(firestoreDebugValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, firestoreDebugValue(v)]),
    );
  }
  return value;
}

export function prepareCampaignCreate(uid: string, input: CreateCampaignInput) {
  const db = fbDb();
  const ref = doc(collection(db, "users", uid, "campaigns"));
  const payload = buildCampaignCreatePayload(input);
  return {
    id: ref.id,
    path: `users/${uid}/campaigns/${ref.id}`,
    payload,
    debugPayload: firestoreDebugValue(payload) as Record<string, unknown>,
    async commit(): Promise<{ id: string }> {
      await reserveQuota(uid, "campaigns", 1);
      try {
        await setDoc(ref, payload);
      } catch (err) {
        await releaseQuota(uid, "campaigns", 1).catch(() => {});
        throw err;
      }
      bumpRefetch("campaigns");
      return { id: ref.id };
    },
  };
}

export async function createCampaign(
  uid: string,
  input: CreateCampaignInput,
): Promise<{ id: string }> {
  return prepareCampaignCreate(uid, input).commit();
}

export async function deleteCampaign(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "campaigns", id));
  await releaseQuota(uid, "campaigns", 1).catch(() => {});
  bumpRefetch("campaigns");
}

export async function pauseCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), { status: "paused" });
  bumpRefetch("campaigns");
}

export async function resumeCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), { status: "running" });
  bumpRefetch("campaigns");
}

export async function cancelCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), {
    status: "completed",
    completedAt: serverTimestamp(),
  });
  bumpRefetch("campaigns");
}

export async function restartCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), {
    status: "draft",
    sentCount: 0,
    failedCount: 0,
    deliveredCount: 0,
    readCount: 0,
    startedAt: null,
    completedAt: null,
  });
  bumpRefetch("campaigns");
}

export async function duplicateCampaign(uid: string, id: string): Promise<{ id: string }> {
  const src = await getDoc(doc(fbDb(), "users", uid, "campaigns", id));
  if (!src.exists()) throw new Error("Campaign not found");
  await reserveQuota(uid, "campaigns", 1);
  const data = src.data() as Record<string, unknown>;
  const db = fbDb();
  const ref = doc(collection(db, "users", uid, "campaigns"));
  const audiencePhones = (data.audiencePhones as string[] | undefined) ?? [];
  try {
    await setDoc(
      ref,
      buildCampaignCreatePayload({
        name: `${(data.name as string) ?? "Untitled"} (copy)`,
        description: (data.description as string) ?? "",
        messageType: ((data.messageType as string) ?? "text") as "text" | "template",
        messageBody: (data.messageBody as string) ?? "",
        templateName: (data.templateName as string | null) ?? null,
        templateLanguage: (data.templateLanguage as string | null) ?? null,
        selectedTemplateId: (data.selectedTemplateId as string | null) ?? null,
        templateVariables: (data.templateVariables as string[] | undefined) ?? [],
        variableSource: ((data.variableSource as string) ?? "static") as VariableSource,
        staticVariableValues:
          (data.staticVariableValues as Record<string, string> | undefined) ?? {},
        contactFieldMap: (data.contactFieldMap as Record<string, string> | undefined) ?? {},
        audiencePhones,
      }),
    );
  } catch (err) {
    await releaseQuota(uid, "campaigns", 1).catch(() => {});
    throw err;
  }
  return { id: ref.id };
}

/**
 * Send to every audience phone via the PHP backend, writing a log row per
 * attempt (field name `timestamp` to match the Flutter app's
 * `campaign_repository.dart`). Rate-limited to ~2 msg/sec with a brief pause
 * every 80 messages, mirroring `campaign_execution_service.dart`.
 */
export async function runCampaign(
  uid: string,
  credentialUid: string,
  id: string,
  audience: string[],
  messageBody: string,
  opts?: {
    messageType?: "text" | "template";
    templateName?: string | null;
    templateLanguage?: string | null;
    templateVariables?: string[];
    templateHeaderFormat?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
    templateHeaderMediaUrl?: string | null;
    variableSource?: VariableSource;
    staticVariableValues?: Record<string, string>;
    contactFieldMap?: Record<string, string>;
    /** phone (normalized) -> contact field map for variable resolution */
    contactsByPhone?: Record<string, Record<string, string>>;
  },
): Promise<{ sent: number; failed: number }> {
  const creds = await loadWaConnection(credentialUid);
  if (!creds) throw new Error("Connect WhatsApp first");
  const db = fbDb();
  const campaignRef = doc(db, "users", uid, "campaigns", id);
  await updateDoc(campaignRef, { status: "running", startedAt: serverTimestamp() });

  const isTemplate = opts?.messageType === "template" && opts?.templateName;
  const vars = opts?.templateVariables ?? [];

  // Live status via a single snapshot listener (free updates) instead of
  // polling getDoc every 5 messages. Saves ~N/5 reads per campaign run.
  let currentStatus: string = "running";
  const unsubStatus = onSnapshot(campaignRef, (snap) => {
    currentStatus = (snap.data()?.status as string) ?? "running";
  });
  const waitWhilePaused = async (): Promise<"continue" | "stop"> => {
    if (currentStatus === "paused") {
      while (currentStatus === "paused") {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (
      currentStatus === "completed" ||
      currentStatus === "failed" ||
      currentStatus === "draft"
    ) {
      return "stop";
    }
    return "continue";
  };

  // Resumable: skip phones that already have a "sent" log entry. If the tab
  // was closed mid-run, hitting Resume continues where it left off instead
  // of double-sending. Failed rows are retried.
  const alreadySent = new Set<string>();
  try {
    const logsSnap = await getDocs(collection(campaignRef, "logs"));
    logsSnap.forEach((d) => {
      const row = d.data() as { phone?: string; status?: string };
      if (row.status === "sent" && row.phone) alreadySent.add(row.phone);
    });
  } catch {
    // If logs read fails, fall through — worst case is a duplicate send.
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < audience.length; i++) {
    // Check live status (populated by snapshot listener above).
    const decision = await waitWhilePaused();
    if (decision === "stop") {
      unsubStatus();
      return { sent, failed };
    }
    const phone = audience[i];
    const to = phone.replace(/[^0-9]/g, "");
    if (alreadySent.has(to)) continue;
    let res;
    let quotaReserved = false;
    try {
      await reserveQuota(uid, "messages", 1);
      quotaReserved = true;
      if (isTemplate) {
        const values = vars.map((v) => resolveVar(v, opts, phone));
        const components: Array<Record<string, unknown>> = [];
        const hFmt = opts?.templateHeaderFormat;
        const hUrl = opts?.templateHeaderMediaUrl;
        if (hFmt && hFmt !== "TEXT" && hUrl) {
          const kind = hFmt.toLowerCase(); // image | video | document
          components.push({
            type: "header",
            parameters: [{ type: kind, [kind]: { link: hUrl } }],
          });
        }
        if (values.length) {
          components.push({
            type: "body",
            parameters: values.map((t) => ({ type: "text", text: t })),
          });
        }
        res = await sendTemplateMessage({
          phone_number_id: creds.phone_number_id,
          access_token: "",
          to,
          template_name: opts!.templateName!,
          language_code: opts?.templateLanguage || "en_US",
          components,
          quota_reserved: true,
        });
      } else {
        res = await sendTextMessage({
          phone_number_id: creds.phone_number_id,
          access_token: "",
          to,
          message: messageBody,
          quota_reserved: true,
        });
      }
    } catch (e) {
      if (quotaReserved) await releaseQuota(uid, "messages", 1).catch(() => {});
      quotaReserved = false;
      res = { success: false, message: e instanceof Error ? e.message : "Network error", raw: {} };
    }
    const ok = res.success;
    if (ok) sent++;
    else {
      failed++;
      if (quotaReserved) await releaseQuota(uid, "messages", 1).catch(() => {});
    }
    if (ok && quotaReserved) await releaseQuota(uid, "messages", 1).catch(() => {});
    const wamid = (res.raw?.messages as Array<{ id?: string }> | undefined)?.[0]?.id ?? null;
    await setDoc(doc(collection(campaignRef, "logs")), {
      phone: to,
      status: ok ? "sent" : "failed",
      reason: ok ? null : (res.message ?? "Unknown error"),
      wamid,
      timestamp: serverTimestamp(),
    });
    if (ok && wamid) {
      await setDoc(doc(db, "users", uid, "campaign_messages", wamid), {
        campaignId: id,
        phone: to,
        sentAt: serverTimestamp(),
      }).catch(() => {});
    }
    // Use atomic increments so multiple tabs / retries don't clobber each
    // other, and so the counters stay consistent with the webhook's
    // delivered/read increments.
    await updateDoc(campaignRef, {
      sentCount: increment(ok ? 1 : 0),
      failedCount: increment(ok ? 0 : 1),
    });
    // Rate limit: ~2 msg/sec, plus a 3s cooldown every 80 messages.
    if (i < audience.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
      if ((i + 1) % 80 === 0) await new Promise((r) => setTimeout(r, 3000));
    }
  }

  unsubStatus();
  await updateDoc(campaignRef, { status: "completed", completedAt: serverTimestamp() });
  return { sent, failed };
}

function resolveVar(
  varName: string,
  opts:
    | {
        variableSource?: VariableSource;
        staticVariableValues?: Record<string, string>;
        contactFieldMap?: Record<string, string>;
        contactsByPhone?: Record<string, Record<string, string>>;
      }
    | undefined,
  phone: string,
): string {
  if (!opts) return "";
  if (opts.variableSource === "contact") {
    const field = opts.contactFieldMap?.[varName];
    const contact = opts.contactsByPhone?.[phone];
    const v = field && contact ? contact[field] : "";
    return (v ?? "").toString().trim() || opts.staticVariableValues?.[varName] || "";
  }
  return (opts.staticVariableValues?.[varName] ?? "").toString();
}
