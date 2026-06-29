import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { sendTextMessage } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";

export async function createCampaign(
  uid: string,
  input: { name: string; description: string; messageBody: string; audiencePhones: string[] },
): Promise<{ id: string }> {
  const ref = await addDoc(collection(fbDb(), "users", uid, "campaigns"), {
    name: input.name,
    description: input.description,
    status: "draft",
    messageType: "text",
    messageBody: input.messageBody,
    audiencePhones: input.audiencePhones,
    audienceTags: [],
    audienceGroups: [],
    totalRecipients: input.audiencePhones.length,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(fbDb(), "users", uid), { totalCampaigns: increment(1) }).catch(() => {});
  return { id: ref.id };
}

export async function deleteCampaign(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "campaigns", id));
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