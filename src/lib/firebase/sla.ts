/**
 * SLA tracking — mirrors WhatsApp Business/Zendesk-style first response
 * targets. Owner sets a global target (minutes) at
 * users/{uid}/settings/sla. The conversation stamps `firstResponseAt` +
 * `firstResponseMs` the first time an agent replies to an unanswered
 * inbound. UI reads both to render live status.
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { resolveConversationDocId } from "@/lib/firebase/conversations";

export type SlaSettings = {
  /** First-response target, minutes. 0 disables SLA tracking. */
  firstResponseMinutes: number;
  /** Resolution target, minutes. 0 disables. */
  resolutionMinutes: number;
};

export const DEFAULT_SLA: SlaSettings = {
  firstResponseMinutes: 15,
  resolutionMinutes: 0,
};

export function slaDocPath(uid: string): string {
  return `users/${uid}/settings/sla`;
}

export async function saveSlaSettings(uid: string, s: SlaSettings): Promise<void> {
  const db = fbDb();
  await setDoc(
    doc(db, slaDocPath(uid)),
    {
      firstResponseMinutes: Math.max(0, Math.floor(s.firstResponseMinutes)),
      resolutionMinutes: Math.max(0, Math.floor(s.resolutionMinutes)),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Stamp `firstResponseAt` on a conversation the first time an agent replies
 * after an inbound message. Idempotent — no-op if already stamped since the
 * latest inbound. Safe to call unconditionally after every outbound send.
 */
// P-perf — session-scoped cache: once we've confirmed a conversation is
// stamped for the current inbound cycle we skip both the getDoc and setDoc
// on every subsequent outgoing send in this session. The cache key is
// `${uid}|${convId}`, value is the `lastIncomingMessageAt` ISO we last
// confirmed as "already answered". If a new inbound arrives, its
// `lastIncomingMessageAt` will be newer than the cached value so we
// correctly re-check exactly once for the new cycle. Cleared on tab reload.
const stampedFor = new Map<string, string>();

export async function markFirstResponseIfNeeded(
  uid: string,
  phone: string,
  agentUid: string,
): Promise<void> {
  try {
    const db = fbDb();
    const convId = await resolveConversationDocId(uid, phone);
    const cacheKey = `${uid}|${convId}`;
    const ref = doc(db, `users/${uid}/conversations/${convId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data() as Record<string, unknown>;
    const lastInbound = typeof data.lastIncomingMessageAt === "string"
      ? data.lastIncomingMessageAt
      : null;
    if (!lastInbound) return;
    // Fast path — already stamped for this inbound cycle in a prior send.
    if (stampedFor.get(cacheKey) === lastInbound) return;
    const already =
      typeof data.firstResponseAt === "string" ? data.firstResponseAt : null;
    // Already responded to this inbound cycle → skip.
    if (already && already >= lastInbound) {
      stampedFor.set(cacheKey, lastInbound);
      return;
    }
    const inboundMs = Date.parse(lastInbound);
    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - inboundMs);
    await setDoc(
      ref,
      {
        firstResponseAt: new Date(nowMs).toISOString(),
        firstResponseMs: elapsedMs,
        firstResponseByUid: agentUid,
      },
      { merge: true },
    );
    stampedFor.set(cacheKey, lastInbound);
  } catch {
    // Non-fatal — SLA is telemetry, not blocking.
  }
}

export type SlaStatus =
  | { kind: "none" }
  | { kind: "met"; ms: number }
  | { kind: "pending"; remainingMs: number; targetMs: number }
  | { kind: "breached"; overdueMs: number; targetMs: number };

export function evaluateSla(
  conv: {
    lastIncomingMessageAt?: string | null;
    firstResponseAt?: string | null;
    firstResponseMs?: number | null;
  },
  settings: SlaSettings | null,
  now: number = Date.now(),
): SlaStatus {
  const targetMin = settings?.firstResponseMinutes ?? 0;
  if (!targetMin) return { kind: "none" };
  const targetMs = targetMin * 60 * 1000;
  const lastInbound = conv.lastIncomingMessageAt
    ? Date.parse(conv.lastIncomingMessageAt)
    : NaN;
  if (!Number.isFinite(lastInbound)) return { kind: "none" };
  const respAt = conv.firstResponseAt ? Date.parse(conv.firstResponseAt) : NaN;
  const responded = Number.isFinite(respAt) && respAt >= lastInbound;
  if (responded) {
    const ms =
      typeof conv.firstResponseMs === "number" && conv.firstResponseMs >= 0
        ? conv.firstResponseMs
        : respAt - lastInbound;
    return { kind: "met", ms };
  }
  const elapsed = now - lastInbound;
  if (elapsed >= targetMs) {
    return { kind: "breached", overdueMs: elapsed - targetMs, targetMs };
  }
  return { kind: "pending", remainingMs: targetMs - elapsed, targetMs };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}