/**
 * Auto-triage settings + write helpers.
 *
 * Owner enables AI triage of new inbound messages. When enabled, the client
 * runs a small Lovable AI classifier that returns intent, sentiment, a short
 * summary, suggested tags, and a priority. Results are stamped onto the
 * conversation doc (owner-only, per Firestore rules).
 */
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { resolveConversationDocId, PRIORITY_META, type ConvPriority } from "@/lib/firebase/conversations";

export type AutoTriageSettings = {
  enabled: boolean;
  autoApplyTags: boolean;
  autoSetPriority: boolean;
  /** Tag catalog the AI is allowed to pick from. */
  categories: string[];
};

export const DEFAULT_TRIAGE: AutoTriageSettings = {
  enabled: false,
  autoApplyTags: true,
  autoSetPriority: true,
  categories: ["Sales", "Support", "Billing", "Complaint", "Feedback", "Spam"],
};

export function triageDocPath(uid: string): string {
  return `users/${uid}/settings/autoTriage`;
}

export async function saveTriageSettings(uid: string, s: AutoTriageSettings): Promise<void> {
  await setDoc(
    doc(fbDb(), triageDocPath(uid)),
    {
      enabled: Boolean(s.enabled),
      autoApplyTags: Boolean(s.autoApplyTags),
      autoSetPriority: Boolean(s.autoSetPriority),
      categories: (s.categories ?? [])
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 25),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export type TriageResult = {
  intent: string;
  sentiment: "positive" | "neutral" | "negative";
  priority: ConvPriority;
  summary: string;
  tags: string[];
  confidence: number;
};

export const SENTIMENT_META: Record<TriageResult["sentiment"], { label: string; color: string; emoji: string }> = {
  positive: { label: "Positive", color: "#16a34a", emoji: "🙂" },
  neutral: { label: "Neutral", color: "#64748b", emoji: "😐" },
  negative: { label: "Negative", color: "#dc2626", emoji: "😠" },
};

/**
 * Merge triage output into a conversation doc. Never downgrades manually-set
 * priority: if a human already set urgent/high, we leave it alone.
 */
export async function applyTriageToConversation(
  uid: string,
  phone: string,
  messageId: string,
  messageIso: string,
  result: TriageResult,
  opts: { autoApplyTags: boolean; autoSetPriority: boolean },
): Promise<void> {
  const db = fbDb();
  const convId = await resolveConversationDocId(uid, phone);
  const ref = doc(db, `users/${uid}/conversations/${convId}`);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data() as Record<string, unknown>) : {};

  const existingTags: string[] = Array.isArray(current.tags) ? (current.tags as string[]) : [];
  const nextTags = opts.autoApplyTags
    ? Array.from(new Set([...existingTags, ...result.tags.map((t) => t.trim()).filter(Boolean)])).slice(0, 20)
    : existingTags;

  const payload: Record<string, unknown> = {
    aiIntent: result.intent,
    aiSentiment: result.sentiment,
    aiSummary: result.summary,
    aiConfidence: result.confidence,
    aiTriageAt: messageIso,
    aiTriageMsgId: messageId,
    aiSuggestedTags: result.tags,
    aiSuggestedPriority: result.priority,
    tags: nextTags,
    updatedAt: serverTimestamp(),
  };

  if (opts.autoSetPriority) {
    const currentPri = typeof current.priority === "string" ? (current.priority as ConvPriority) : null;
    // Never downgrade a human-set high/urgent. Otherwise apply AI priority.
    const canOverride = !currentPri || currentPri === "normal" || currentPri === "low";
    const suggested = result.priority;
    const shouldSet = canOverride || (suggested === "urgent" && currentPri !== "urgent");
    if (shouldSet) {
      payload.priority = suggested;
      payload.priorityRank = PRIORITY_META[suggested].rank;
    }
  }

  await setDoc(ref, payload, { merge: true });
}