import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { sendTextMessage } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";

export type CreateCampaignInput = {
  name: string;
  description: string;
  messageBody: string;
  audiencePhones: string[];
};

export type CampaignCreatePayload = {
  name: string;
  description: string;
  status: "draft";
  messageType: "text";
  messageBody: string;
  templateName: null;
  templateLanguage: null;
  selectedTemplateId: null;
  templateVariables: string[];
  variableSource: "static";
  staticVariableValues: Record<string, string>;
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
    messageType: "text",
    messageBody: input.messageBody,
    templateName: null,
    templateLanguage: null,
    selectedTemplateId: null,
    templateVariables: [],
    variableSource: "static",
    staticVariableValues: {},
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
      await setDoc(ref, payload);
      await updateDoc(doc(db, "users", uid), { totalCampaigns: increment(1) }).catch(() => {});
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
}

export async function pauseCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), { status: "paused" });
}

export async function resumeCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), { status: "running" });
}

export async function cancelCampaign(uid: string, id: string): Promise<void> {
  await updateDoc(doc(fbDb(), "users", uid, "campaigns", id), {
    status: "completed",
    completedAt: serverTimestamp(),
  });
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
}

export async function duplicateCampaign(uid: string, id: string): Promise<{ id: string }> {
  const src = await getDoc(doc(fbDb(), "users", uid, "campaigns", id));
  if (!src.exists()) throw new Error("Campaign not found");
  const data = src.data() as Record<string, unknown>;
  const db = fbDb();
  const ref = doc(collection(db, "users", uid, "campaigns"));
  const audiencePhones = (data.audiencePhones as string[] | undefined) ?? [];
  await setDoc(
    ref,
    buildCampaignCreatePayload({
      name: `${(data.name as string) ?? "Untitled"} (copy)`,
      description: (data.description as string) ?? "",
      messageBody: (data.messageBody as string) ?? "",
      audiencePhones,
    }),
  );
  await updateDoc(doc(db, "users", uid), { totalCampaigns: increment(1) }).catch(() => {});
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
): Promise<{ sent: number; failed: number }> {
  const creds = await loadWaCredentials(credentialUid);
  if (!creds) throw new Error("Connect WhatsApp first");
  const db = fbDb();
  const campaignRef = doc(db, "users", uid, "campaigns", id);
  await updateDoc(campaignRef, { status: "running", startedAt: serverTimestamp() });

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < audience.length; i++) {
    // Poll Firestore status every 5 messages to support pause/cancel from UI.
    if (i % 5 === 0) {
      const snap = await getDoc(campaignRef);
      const status = (snap.data()?.status as string) ?? "running";
      if (status === "paused") {
        // Wait until resumed or cancelled.
        while (true) {
          await new Promise((r) => setTimeout(r, 1500));
          const s2 = await getDoc(campaignRef);
          const st = (s2.data()?.status as string) ?? "running";
          if (st === "running") break;
          if (st === "completed" || st === "failed" || st === "draft") {
            return { sent, failed };
          }
        }
      } else if (status === "completed" || status === "failed" || status === "draft") {
        return { sent, failed };
      }
    }
    const phone = audience[i];
    const to = phone.replace(/[^0-9]/g, "");
    let res;
    try {
      res = await sendTextMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to,
        message: messageBody,
      });
    } catch (e) {
      res = { success: false, message: e instanceof Error ? e.message : "Network error", raw: {} };
    }
    const ok = res.success;
    if (ok) sent++;
    else failed++;
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
    await updateDoc(campaignRef, { sentCount: sent, failedCount: failed });
    // Rate limit: ~2 msg/sec, plus a 3s cooldown every 80 messages.
    if (i < audience.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
      if ((i + 1) % 80 === 0) await new Promise((r) => setTimeout(r, 3000));
    }
  }

  await updateDoc(campaignRef, { status: "completed", completedAt: serverTimestamp() });
  return { sent, failed };
}
