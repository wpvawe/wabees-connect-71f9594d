import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
  return { id: ref.id };
}

export async function deleteCampaign(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), "users", uid, "campaigns", id));
}

/**
 * Send to every audience phone sequentially via the PHP backend, writing a
 * log row per attempt. Updates campaign counters as it goes. Mirrors the
 * Flutter app's campaign runner.
 */
export async function runCampaign(
  uid: string,
  id: string,
  audience: string[],
  messageBody: string,
): Promise<{ sent: number; failed: number }> {
  const creds = await loadWaCredentials(uid);
  if (!creds) throw new Error("Connect WhatsApp first");
  const db = fbDb();
  const campaignRef = doc(db, "users", uid, "campaigns", id);
  await updateDoc(campaignRef, { status: "running", startedAt: serverTimestamp() });

  let sent = 0;
  let failed = 0;
  for (const phone of audience) {
    const to = phone.replace(/[^0-9]/g, "");
    const res = await sendTextMessage({
      phone_number_id: creds.phone_number_id,
      access_token: creds.access_token,
      to,
      message: messageBody,
    });
    const ok = res.success;
    if (ok) sent++;
    else failed++;
    await setDoc(doc(collection(campaignRef, "logs")), {
      phone: to,
      status: ok ? "sent" : "failed",
      error: ok ? null : (res.message ?? "Unknown error"),
      createdAt: serverTimestamp(),
    });
    await updateDoc(campaignRef, { sentCount: sent, failedCount: failed });
  }

  await updateDoc(campaignRef, { status: "completed", completedAt: serverTimestamp() });
  return { sent, failed };
}