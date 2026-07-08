/**
 * Shared boilerplate used by every Composer send path (text, media,
 * template). Keeps the three send flows in `Composer.tsx` behaviourally
 * identical while removing ~50 lines of duplicated try/catch + dynamic
 * import scaffolding. Pure helpers — no React, safe to unit test.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { extractWamid } from "@/lib/wabees/api";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { normalizePhone, phoneDocId } from "@/lib/firebase/normalizers";

/**
 * Best-effort lookup of the conversation's saved `contactName` so
 * optimistic writes don't flash the raw phone number before the real
 * contact record hydrates. Never throws — falls back to `fallback`.
 */
export async function resolveKnownContactName(
  db: Firestore,
  uid: string,
  convId: string,
  fallback: string,
): Promise<string> {
  try {
    const snap = await getDoc(doc(db, "users", uid, "conversations", convId));
    const existing = snap.data()?.contactName;
    if (typeof existing === "string" && existing && existing !== fallback) {
      return existing;
    }
  } catch {
    /* best-effort — fall through */
  }
  return fallback;
}

/**
 * Preflight plan-active + limit check for outgoing messages.
 *
 * BUG-09/BUG-16 fix — previously we reserved a quota slot on the client
 * AND PHP incremented on send, double-counting every message. Now the
 * client only does a **read-only** preflight (`assertWithinPlanLimit`
 * with kind="messages"). PHP `send-message.php` remains the single
 * authority for the actual increment. If the plan is over its limit,
 * PHP will reject the send and the UI shows that toast; this preflight
 * gives faster feedback without paying for a Firestore write.
 */
export async function reserveMessageQuota(uid: string): Promise<void> {
  const { assertWithinPlanLimit } = await import("@/lib/plans/limits");
  await assertWithinPlanLimit(uid, "messages", 1);
}

/**
 * No-op refund. PHP is authoritative for message counters (BUG-09), so
 * there is nothing to refund on the client. Kept as a stable export so
 * existing callers don't need to be touched in the same patch.
 */
export async function refundMessageQuota(_uid: string): Promise<void> {
  return;
}

/**
 * Mark an optimistic message doc as failed. Swallows update errors so a
 * transient Firestore hiccup doesn't turn into an unhandled rejection.
 */
export async function markSendFailed(
  msgRef: DocumentReference<unknown, DocumentData>,
  errorReason: string,
): Promise<void> {
  try {
    await updateDoc(msgRef, { status: "failed", errorReason });
  } catch {
    /* best-effort */
  }
}

export function errorMessageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Result of a Meta send call — shape returned by `sendTextMessage`,
 * `sendMediaMessage`, `sendTemplateMessage` in `lib/wabees/api`.
 */
export interface MetaSendResult {
  success: boolean;
  message?: string;
  raw: Record<string, unknown>;
}

export type WaCreds = { phone_number_id: string };

export interface SendPipelineConfig {
  db: Firestore;
  uid: string;
  selfUid: string;
  phone: string;
  /** Fields for the optimistic `messages` doc. `createdAt` is added automatically. */
  optimisticDoc: (knownName: string, normalizedPhone: string) => Record<string, unknown>;
  /** Fields merged into the `conversations/{convId}` summary. `lastMessageAt` is added. */
  summaryPatch: (knownName: string, normalizedPhone: string) => Record<string, unknown>;
  /** Runs the actual Meta call. Only invoked after reserve + optimistic write succeed. */
  sendToMeta: (creds: WaCreds) => Promise<MetaSendResult>;
  /**
   * Optional preflight (e.g. media upload) that runs AFTER quota reserve and
   * BEFORE the optimistic write. Throw to abort — the pipeline refunds the
   * quota and reports `errored` with the thrown message.
   */
  preflight?: (creds: WaCreds) => Promise<void>;
  /** Called after the optimistic write + summary, before the Meta call. */
  afterOptimistic?: () => void;
  /** Called after status flips to `sent`. */
  onSuccess?: () => void;
  /** Fallback text for toast when Meta returns no message / error is not an Error. */
  fallbackError?: string;
}

export type PipelineOutcome =
  | { status: "sent" }
  | { status: "no-creds" }
  | { status: "quota"; message: string }
  | { status: "meta-failed"; message: string }
  | { status: "errored"; message: string };

/**
 * Unified send pipeline shared by text / media / template flows in the
 * Composer. Encapsulates the reserve → optimistic write → summary →
 * Meta call → refund/mark-failed sequence so each variant only supplies
 * the doc shape + the Meta call. Preserves exact ordering of the
 * previous per-variant implementations.
 */
export async function runSendPipeline(
  cfg: SendPipelineConfig,
): Promise<PipelineOutcome> {
  const { db, uid, selfUid, phone } = cfg;
  const normalizedPhone = normalizePhone(phone);
  const convId = phoneDocId(phone);
  let msgRef: DocumentReference<unknown, DocumentData> | null = null;
  let quotaReserved = false;
  try {
    const creds = await loadWaConnection(selfUid);
    if (!creds) return { status: "no-creds" };
    try {
      await reserveMessageQuota(uid);
      quotaReserved = true;
    } catch (e) {
      return { status: "quota", message: errorMessageOf(e, "Message limit reached") };
    }
    if (cfg.preflight) {
      try {
        await cfg.preflight(creds);
      } catch (e) {
        if (quotaReserved) {
          await refundMessageQuota(uid);
          quotaReserved = false;
        }
        return { status: "errored", message: errorMessageOf(e, cfg.fallbackError ?? "Send failed") };
      }
    }
    const knownName = await resolveKnownContactName(db, uid, convId, normalizedPhone);
    msgRef = await addDoc(collection(db, "users", uid, "messages"), {
      ...cfg.optimisticDoc(knownName, normalizedPhone),
      createdAt: serverTimestamp(),
    });
    await setDoc(
      doc(db, "users", uid, "conversations", convId),
      {
        ...cfg.summaryPatch(knownName, normalizedPhone),
        lastMessageAt: serverTimestamp(),
      },
      { merge: true },
    );
    cfg.afterOptimistic?.();
    const res = await cfg.sendToMeta(creds);
    const wamid = extractWamid(res.raw);
    if (!res.success) {
      if (quotaReserved) {
        await refundMessageQuota(uid);
        quotaReserved = false;
      }
      await markSendFailed(msgRef, res.message ?? "Send failed");
      return {
        status: "meta-failed",
        message: res.message ?? cfg.fallbackError ?? "Send failed",
      };
    }
    if (quotaReserved) {
      await refundMessageQuota(uid);
      quotaReserved = false;
    }
    await updateDoc(msgRef, { status: "sent", whatsappMessageId: wamid });
    cfg.onSuccess?.();
    return { status: "sent" };
  } catch (err) {
    if (quotaReserved) {
      await refundMessageQuota(uid);
    }
    const message = errorMessageOf(err, cfg.fallbackError ?? "Send failed");
    if (msgRef) {
      await markSendFailed(msgRef, message);
    }
    return { status: "errored", message };
  }
}