/**
 * Shared boilerplate used by every Composer send path (text, media,
 * template). Keeps the three send flows in `Composer.tsx` behaviourally
 * identical while removing ~50 lines of duplicated try/catch + dynamic
 * import scaffolding. Pure helpers — no React, safe to unit test.
 */
import {
  doc,
  getDoc,
  updateDoc,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";

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
 * Atomic quota reservation. Throws with a user-friendly message when the
 * plan cap is reached so the caller can surface it via `toast.error`.
 */
export async function reserveMessageQuota(uid: string): Promise<void> {
  const { reserveQuota } = await import("@/lib/plans/limits");
  await reserveQuota(uid, "messages", 1);
}

/**
 * Refund a previously reserved slot. Swallows all errors — a failed
 * refund must never mask the original send outcome.
 */
export async function refundMessageQuota(uid: string): Promise<void> {
  try {
    const { releaseQuota } = await import("@/lib/plans/limits");
    await releaseQuota(uid, "messages", 1);
  } catch {
    /* swallow — refund is best-effort */
  }
}

/**
 * Mark an optimistic message doc as failed. Swallows update errors so a
 * transient Firestore hiccup doesn't turn into an unhandled rejection.
 */
export async function markSendFailed(
  msgRef: DocumentReference,
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