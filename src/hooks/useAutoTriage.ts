/**
 * Owner-only background worker: listens for new inbound WhatsApp messages
 * and runs them through the DeepSeek triage classifier. Results are
 * merged into the conversation doc (tags, priority, intent, sentiment,
 * one-line summary). Agents/supervisors never run this — only the owner
 * client so a single classification runs per message.
 */
import { useEffect, useRef } from "react";
import {
  doc,
  getDoc,
} from "firebase/firestore";
import { fbDbOrNull, fbAuth } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { useTriageSettings } from "@/hooks/useTriageSettings";
import { classifyMessage } from "@/lib/ai/triage.functions";
import { applyTriageToConversation } from "@/lib/firebase/triage";
import { subscribeIncomingMessages } from "@/lib/firebase/messagesBroker";
import { normalizePhone } from "@/lib/firebase/normalizers";

/** Only text-ish inbound messages are worth classifying. */
const TRIAGEABLE_TYPES = new Set(["text", "button", "interactive", "list"]);
/** Per-conversation cooldown between AI triage runs. */
const TRIAGE_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

export function useAutoTriage(): void {
  const session = useFirebaseSession();
  const settings = useTriageSettings();
  const enabled = settings.enabled;
  const isOwner = session.status === "ready" && session.dataOwner === null;
  const uid = session.status === "ready" ? session.uid : null;

  // Track messages already handled this session so a snapshot re-emit doesn't
  // re-classify. Also carries subscription start time so we skip the initial
  // backfill (only classify NEW inbound after mount).
  const seen = useRef<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  // P-perf — bounded FIFO so long-running tabs don't leak memory.
  const SEEN_CAP = 500;
  const rememberSeen = (id: string) => {
    const s = seen.current;
    if (s.size >= SEEN_CAP) {
      const first = s.values().next().value;
      if (first) s.delete(first);
    }
    s.add(id);
  };
  // Per-conversation throttle: once we classify a phone, skip further
  // messages from the same conversation for TRIAGE_THROTTLE_MS. Keeps
  // AI cost bounded on chatty threads.
  const lastByPhone = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled || !isOwner || !uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    if (settings.categories.length === 0) return;

    const subscribedAt = Date.now();
    // Bug fix: array/prop references from useTriageSettings snapshot re-fire
    // this effect on every settings snapshot even when values are identical.
    // Snapshot the categories inside the effect closure so equality churn is
    // driven by a stable key in the dep array below.
    return subscribeIncomingMessages(uid, (msg) => {
      void (async () => {
          const d = { id: msg.id };
          if (seen.current.has(d.id) || inFlight.current.has(d.id)) return;
          const x = msg.data;
          const type = typeof x.type === "string" ? x.type : "text";
          const body = typeof x.body === "string" ? x.body.trim() : "";
          const phone = typeof x.contactPhone === "string" ? x.contactPhone : "";
          const contactName = typeof x.contactName === "string" ? x.contactName : null;
          const createdIso = new Date(msg.createdAtMs).toISOString();

          // Skip anything without a phone or with no text worth classifying.
          if (!phone || !TRIAGEABLE_TYPES.has(type) || body.length < 2) {
            rememberSeen(d.id);
            return;
          }
          // Skip messages that pre-date this listener (backfill guard).
          if (msg.createdAtMs < subscribedAt - 5_000) {
            rememberSeen(d.id);
            return;
          }
          const lastAt = lastByPhone.current.get(phone) ?? 0;
          if (Date.now() - lastAt < TRIAGE_THROTTLE_MS) {
            rememberSeen(d.id);
            return;
          }

          rememberSeen(d.id);
          inFlight.current.add(d.id);
            try {
              // Persistent throttle: skip if this conversation was triaged
              // within TRIAGE_THROTTLE_MS by any past session.
              try {
                // Bug fix: conversation docs are keyed by normalized phone.
                // Using the raw contactPhone field misses the doc, bypasses
                // the persistent cooldown, and re-classifies (re-charging
                // AI quota) on every message.
                const convRef = doc(db, `users/${uid}/conversations/${normalizePhone(phone)}`);
                const convSnap = await getDoc(convRef);
                const raw = convSnap.exists()
                  ? ((convSnap.data() as Record<string, unknown>).aiTriageAt as unknown)
                  : null;
                const lastMs =
                  typeof raw === "string"
                    ? Date.parse(raw)
                    : raw && typeof raw === "object" && "toDate" in (raw as object)
                      ? (raw as { toDate: () => Date }).toDate().getTime()
                      : NaN;
                if (Number.isFinite(lastMs) && Date.now() - lastMs < TRIAGE_THROTTLE_MS) {
                  lastByPhone.current.set(phone, Date.now());
                  return;
                }
              } catch {
                // Non-fatal — proceed to classify.
              }
              lastByPhone.current.set(phone, Date.now());
              const user = fbAuth().currentUser;
              if (!user) return;
              let aiQuotaReserved = false;
              try {
                const { reserveQuota } = await import("@/lib/plans/limits");
                await reserveQuota(uid, "aiMessages", 1);
                aiQuotaReserved = true;
              } catch (limitErr) {
                // eslint-disable-next-line no-console
                console.warn("auto-triage skipped (plan limit)", limitErr);
                return;
              }
              const idToken = await user.getIdToken();
              let result;
              try {
                result = await classifyMessage({
                  data: {
                    idToken,
                    text: body,
                    categories: settings.categories,
                    contactName,
                  },
                });
              } catch (classifyErr) {
                if (aiQuotaReserved) {
                  const { releaseQuota } = await import("@/lib/plans/limits");
                  await releaseQuota(uid, "aiMessages", 1).catch(() => {});
                }
                throw classifyErr;
              }
              await applyTriageToConversation(
                uid,
                phone,
                d.id,
                createdIso,
                result,
                {
                  autoApplyTags: settings.autoApplyTags,
                  autoSetPriority: settings.autoSetPriority,
                },
              );
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn("auto-triage failed", err);
            } finally {
              inFlight.current.delete(d.id);
            }
      })();
    });
    // Bug fix: `settings.categories` is a new array reference on every
    // Firestore snapshot even when values are equal. Depend on a stable
    // joined key so the broker subscription doesn't churn.
  }, [
    enabled,
    isOwner,
    uid,
    settings.categories.join("|"),
    settings.autoApplyTags,
    settings.autoSetPriority,
  ]);
}