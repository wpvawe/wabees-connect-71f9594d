/**
 * Owner-only background worker: listens for new inbound WhatsApp messages
 * and runs them through the DeepSeek triage classifier. Results are
 * merged into the conversation doc (tags, priority, intent, sentiment,
 * one-line summary). Agents/supervisors never run this — only the owner
 * client so a single classification runs per message.
 */
import { useEffect, useRef } from "react";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { fbDbOrNull, fbAuth } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { useTriageSettings } from "@/hooks/useTriageSettings";
import { classifyMessage } from "@/lib/ai/triage.functions";
import { applyTriageToConversation } from "@/lib/firebase/triage";

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
    let first = true;

    const q = query(
      collection(db, `users/${uid}/messages`),
      where("direction", "==", "incoming"),
      orderBy("createdAt", "desc"),
      limit(20),
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        if (first) {
          for (const d of snap.docs) seen.current.add(d.id);
          first = false;
          return;
        }

        for (const d of snap.docs) {
          if (seen.current.has(d.id) || inFlight.current.has(d.id)) continue;
          const x = d.data() as Record<string, unknown>;
          const type = typeof x.type === "string" ? x.type : "text";
          const body = typeof x.body === "string" ? x.body.trim() : "";
          const phone = typeof x.contactPhone === "string" ? x.contactPhone : "";
          const contactName = typeof x.contactName === "string" ? x.contactName : null;
          const created = (x.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
          const createdIso = created ? created.toISOString() : new Date().toISOString();

          // Skip anything without a phone or with no text worth classifying.
          if (!phone || !TRIAGEABLE_TYPES.has(type) || body.length < 2) {
            seen.current.add(d.id);
            continue;
          }
          // Skip messages that pre-date this listener (backfill guard).
          if (created && created.getTime() < subscribedAt - 5_000) {
            seen.current.add(d.id);
            continue;
          }
          const lastAt = lastByPhone.current.get(phone) ?? 0;
          if (Date.now() - lastAt < TRIAGE_THROTTLE_MS) {
            seen.current.add(d.id);
            continue;
          }

          seen.current.add(d.id);
          inFlight.current.add(d.id);
          // Fire and forget — the settings hook already restricts to owner,
          // and Firestore write is idempotent.
          void (async () => {
            try {
              // Persistent throttle: skip if this conversation was triaged
              // within TRIAGE_THROTTLE_MS by any past session.
              try {
                const convRef = doc(db, `users/${uid}/conversations/${phone}`);
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
              const idToken = await user.getIdToken();
              const result = await classifyMessage({
                data: {
                  idToken,
                  text: body,
                  categories: settings.categories,
                  contactName,
                },
              });
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
              // Silent — triage is best-effort. Errors log to console only.
              // eslint-disable-next-line no-console
              console.warn("auto-triage failed", err);
            } finally {
              inFlight.current.delete(d.id);
            }
          })();
        }
      },
      () => {},
    );

    return () => unsub();
  }, [enabled, isOwner, uid, settings.categories, settings.autoApplyTags, settings.autoSetPriority]);
}