import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { fbDbOrNull, fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import {
  normalizePhone,
  phoneDocId,
  str,
  strOrNull,
  toIso,
  whatsappRecipientId,
} from "@/lib/firebase/normalizers";
import { extractWamid, sendTextMessage } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import type { ScheduledMessage } from "@/lib/firebase/scheduled";

export function useScheduledMessages(phone?: string): {
  data: ScheduledMessage[] | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<ScheduledMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const base = collection(db, `users/${uid}/scheduled_messages`);
    const q = phone
      ? query(base, where("contactPhone", "==", normalizePhone(phone)))
      : query(base, orderBy("scheduledFor", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            contactPhone: str(x.contactPhone),
            body: str(x.body),
            scheduledFor: toIso(x.scheduledFor),
            status: (str(x.status, "pending") as ScheduledMessage["status"]),
            errorReason: strOrNull(x.errorReason),
            createdAt: toIso(x.createdAt),
            sentMessageId: strOrNull(x.sentMessageId),
          } satisfies ScheduledMessage;
        });
        rows.sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, phone]);

  return { data, error };
}

/**
 * Client-side dispatcher. Polls scheduled_messages every 30s and sends any
 * pending row whose scheduledFor is due. Best-effort: only runs while a tab
 * is open, so long-horizon reliability requires a server cron (Phase 4).
 */
export function useScheduledDispatcher() {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();

  useEffect(() => {
    if (!uid || !selfUid) return;
    const db = fbDbOrNull();
    if (!db) return;
    let alive = true;
    let busy = false;

    async function tick() {
      if (!alive || busy) return;
      busy = true;
      try {
        const nowMs = Date.now();
        // Pull the ordered pending list once per tick. Small enough for a
        // full snapshot read; ordered so we send oldest-first.
        const snapRef = query(
          collection(db!, `users/${uid}/scheduled_messages`),
          where("status", "==", "pending"),
        );
        const snap = await getDocs(snapRef);
        if (!alive) return;
        const creds = await loadWaCredentials(selfUid!).catch(() => null);
        if (!creds) return;
        for (const d of snap.docs) {
            const x = d.data() as Record<string, unknown>;
            const iso = toIso(x.scheduledFor);
            if (!iso) continue;
            if (new Date(iso).getTime() > nowMs) continue;
            const phone = str(x.contactPhone);
            const body = str(x.body);
            if (!phone || !body) continue;
            // Claim it first so parallel tabs don't double-send.
            try {
              await updateDoc(d.ref, { status: "sending" });
            } catch {
              continue;
            }
            try {
              const res = await sendTextMessage({
                phone_number_id: creds.phone_number_id,
                access_token: creds.access_token,
                to: whatsappRecipientId(phone),
                message: body,
              });
              const wamid = extractWamid(res.raw);
              if (!res.success) {
                await updateDoc(d.ref, {
                  status: "failed",
                  errorReason: res.message ?? "Send failed",
                });
                continue;
              }
              // Write into the main messages stream so the inbox shows it.
              const msgRef = await addDoc(collection(db!, `users/${uid}/messages`), {
                contactPhone: phone,
                contactName: phone,
                type: "text",
                direction: "outgoing",
                status: "sent",
                body,
                whatsappMessageId: wamid,
                sentVia: "scheduled",
                createdAt: serverTimestamp(),
              });
              await setDoc(
                doc(db!, `users/${uid}/conversations/${phoneDocId(phone)}`),
                {
                  contactPhone: phone,
                  lastMessage: body,
                  lastMessageType: "text",
                  lastMessageAt: serverTimestamp(),
                },
                { merge: true },
              );
              await updateDoc(d.ref, {
                status: "sent",
                sentMessageId: msgRef.id,
              });
              await updateDoc(doc(db!, `users/${uid}`), {
                totalMessages: increment(1),
              }).catch(() => {});
            } catch (e) {
              await updateDoc(d.ref, {
                status: "failed",
                errorReason: e instanceof Error ? e.message : "Send failed",
              }).catch(() => {});
            }
        }
      } finally {
        busy = false;
      }
    }

    // First tick shortly after mount, then every 30s.
    const first = setTimeout(tick, 2000);
    const iv = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [uid, selfUid]);
}