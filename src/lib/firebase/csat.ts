/**
 * Batch F16 — Customer Satisfaction (CSAT) surveys.
 *
 * When an agent resolves a conversation, the workspace can automatically
 * ship a WhatsApp Interactive List message with 5 rating rows (⭐ 1..5).
 * A survey doc under `users/{uid}/csat_surveys/{id}` tracks the send +
 * incoming rating so the workload dashboard can compute team CSAT.
 *
 * Row IDs sent to WhatsApp are `csat:{surveyId}:{rating}` — inbound
 * messages captured by the webhook carry this back as `buttonReplyId`,
 * which the capture hook uses to close the loop.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { normalizePhone, phoneDocId, whatsappRecipientId } from "@/lib/firebase/normalizers";
import { sendListMessage, sendTextMessage } from "@/lib/wabees/api";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { incrementMessagesUsed } from "@/lib/plans/limits";

export const CSAT_ROW_PREFIX = "csat:";

export type CsatSettings = {
  enabled: boolean;
  autoOnResolve: boolean;
  question: string;
  footer: string;
  askComment: boolean;
  commentPrompt: string;
};

export const DEFAULT_CSAT: CsatSettings = {
  enabled: false,
  autoOnResolve: true,
  question:
    "Thanks for chatting with us! How would you rate your experience today?",
  footer: "Tap a star to rate",
  askComment: true,
  commentPrompt:
    "Thanks for your rating! Feel free to share any additional feedback.",
};

export function csatSettingsPath(uid: string): string {
  return `users/${uid}/settings/csat`;
}

export async function saveCsatSettings(
  uid: string,
  s: CsatSettings,
): Promise<void> {
  await setDoc(
    doc(fbDb(), csatSettingsPath(uid)),
    { ...s, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export type CsatSurvey = {
  id: string;
  phone: string;
  conversationId: string;
  sentAt: string | null;
  sentByUid: string | null;
  sentByEmail: string | null;
  agentId: string | null;
  agentEmail: string | null;
  wamid: string | null;
  status: "pending" | "responded" | "expired" | "failed";
  rating: number | null;
  comment: string | null;
  respondedAt: string | null;
  error?: string | null;
};

/**
 * Send a CSAT list survey to `phone` and record the survey doc. Returns
 * the created survey id, or null on hard failure.
 */
export async function sendCsatSurvey(args: {
  ownerUid: string;
  phone: string;
  settings: CsatSettings;
  actor: { uid: string; email: string | null };
  assignedAgentId?: string | null;
  assignedAgentEmail?: string | null;
  /**
   * If provided, skip sending when the conversation received a CSAT survey
   * within this many milliseconds. Prevents auto-resolve loops from spamming
   * the same contact.
   */
  cooldownMs?: number;
}): Promise<string | null> {
  const { ownerUid, phone, settings, actor } = args;
  const canonical = phoneDocId(phone);
  // Cooldown check — protects against a resolve/reopen ping-pong sending
  // multiple surveys to the same contact in quick succession.
  const convRef = doc(fbDb(), `users/${ownerUid}/conversations/${canonical}`);
  if (args.cooldownMs && args.cooldownMs > 0) {
    try {
      const convSnap = await getDoc(convRef);
      const data = convSnap.exists() ? (convSnap.data() as Record<string, unknown>) : null;
      const raw = data?.csatLastSentAt;
      const lastMs =
        typeof raw === "string"
          ? Date.parse(raw)
          : raw && typeof raw === "object" && "toDate" in (raw as object)
            ? (raw as { toDate: () => Date }).toDate().getTime()
            : NaN;
      if (Number.isFinite(lastMs) && Date.now() - lastMs < args.cooldownMs) {
        return null;
      }
    } catch {
      // Non-fatal — proceed with send.
    }
  }
  // Create the survey doc first so the row id can reference it.
  const surveyRef = await addDoc(collection(fbDb(), `users/${ownerUid}/csat_surveys`), {
    phone: normalizePhone(phone),
    conversationId: canonical,
    sentAt: serverTimestamp(),
    sentByUid: actor.uid,
    sentByEmail: actor.email,
    agentId: args.assignedAgentId ?? null,
    agentEmail: args.assignedAgentEmail ?? null,
    status: "pending",
    rating: null,
    comment: null,
    respondedAt: null,
  });

  const creds = await loadWaConnection(ownerUid).catch(() => null);
  if (!creds?.phone_number_id) {
    await updateDoc(surveyRef, {
      status: "failed",
      error: "WhatsApp not connected",
    });
    return null;
  }

  const stars = ["⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"];
  const labels = ["Very poor", "Poor", "Okay", "Good", "Excellent"];
  const rows = [1, 2, 3, 4, 5].map((r) => ({
    id: `${CSAT_ROW_PREFIX}${surveyRef.id}:${r}`,
    title: `${stars[r - 1]} ${r}`,
    description: labels[r - 1],
  }));

  const res = await sendListMessage({
    phone_number_id: creds.phone_number_id,
    access_token: "",
    to: whatsappRecipientId(phone),
    body_text: settings.question || DEFAULT_CSAT.question,
    button_text: "Rate 1–5",
    footer_text: settings.footer || DEFAULT_CSAT.footer,
    sections: [{ title: "Your rating", rows }],
  }).catch((e: unknown) => ({
    success: false,
    message: e instanceof Error ? e.message : "send failed",
    raw: {} as Record<string, unknown>,
  }));

  const wamid = (() => {
    const raw = res.raw ?? {};
    const msgs = Array.isArray(raw.messages) ? raw.messages : null;
    const first = msgs && msgs[0] && typeof msgs[0] === "object"
      ? (msgs[0] as { id?: unknown })
      : null;
    return typeof first?.id === "string" ? first.id : null;
  })();

  if (!res.success) {
    await updateDoc(surveyRef, {
      status: "failed",
      error: res.message || "send failed",
    });
    return null;
  }
  await updateDoc(surveyRef, { wamid });
  // CSAT list message is a real outbound WhatsApp send — count it (B-3).
  await incrementMessagesUsed(ownerUid, 1);
  // Stamp the conversation so cooldown-aware auto-sends can skip repeats.
  try {
    await setDoc(convRef, { csatLastSentAt: serverTimestamp() }, { merge: true });
  } catch {
    // Non-fatal — cooldown is best-effort.
  }
  return surveyRef.id;
}

/** Parse a WhatsApp inbound reply id / body into a CSAT rating hit. */
export function parseCsatReply(input: {
  buttonReplyId?: string | null;
  body?: string | null;
}): { surveyId: string; rating: number } | null {
  const id = input.buttonReplyId?.trim() ?? "";
  if (id.startsWith(CSAT_ROW_PREFIX)) {
    const parts = id.slice(CSAT_ROW_PREFIX.length).split(":");
    if (parts.length === 2) {
      const r = Number(parts[1]);
      if (Number.isInteger(r) && r >= 1 && r <= 5) {
        return { surveyId: parts[0], rating: r };
      }
    }
  }
  return null;
}

/** Record a rating on a pending survey and, when configured, ask for a comment. */
export async function recordCsatRating(args: {
  ownerUid: string;
  surveyId: string;
  rating: number;
  phone: string;
  askComment: boolean;
  commentPrompt: string;
}): Promise<void> {
  const { ownerUid, surveyId, rating, phone, askComment, commentPrompt } = args;
  await updateDoc(doc(fbDb(), `users/${ownerUid}/csat_surveys/${surveyId}`), {
    rating,
    status: "responded",
    respondedAt: serverTimestamp(),
  });
  if (!askComment) return;
  const creds = await loadWaConnection(ownerUid).catch(() => null);
  if (!creds?.phone_number_id) return;
  await sendTextMessage({
    phone_number_id: creds.phone_number_id,
    access_token: "",
    to: whatsappRecipientId(phone),
    message: commentPrompt || DEFAULT_CSAT.commentPrompt,
  })
    .then((r) => {
      // Only count when Meta actually accepted the message.
      if (r?.success) void incrementMessagesUsed(ownerUid, 1);
    })
    .catch(() => {});
}

/** Attach a customer's free-text comment to the most recent responded survey. */
export async function attachCsatComment(args: {
  ownerUid: string;
  surveyId: string;
  comment: string;
}): Promise<void> {
  await updateDoc(
    doc(fbDb(), `users/${args.ownerUid}/csat_surveys/${args.surveyId}`),
    { comment: args.comment.slice(0, 500) },
  );
}