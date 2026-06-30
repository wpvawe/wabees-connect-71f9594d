import { useEffect, useRef } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { playNotificationChime } from "@/lib/notification-sound";
import { toast } from "sonner";
import { useRouterState } from "@tanstack/react-router";
import { normalizePhone } from "@/lib/firebase/normalizers";

/**
 * Global subscriber: any new incoming WhatsApp message (across all chats)
 * fires a chime + toast. Skips when the user is already viewing that thread.
 */
export function useIncomingMessageAlerts() {
  const uid = useEffectiveUid();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const seen = new Set<string>();
    let first = true;
    // M-7 fix: capture subscription start so re-seeds after reconnect only
    // suppress messages older than this listener, not arbitrary recent ones.
    const subscribedAt = Date.now();
    const q = query(
      collection(db, `users/${uid}/messages`),
      where("direction", "==", "incoming"),
      orderBy("createdAt", "desc"),
      limit(20),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs;
        if (first) {
          for (const d of docs) seen.add(d.id);
          first = false;
          return;
        }
        for (const d of docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          const x = d.data() as Record<string, unknown>;
          const phone = String(x.contactPhone ?? "");
          const name = String(x.contactName ?? phone);
          const body = String(x.body ?? "");
          const type = String(x.type ?? "text");
          // Skip silent system docs.
          if (type === "reaction" && !x.mediaUrl) continue;
          // M-7 fix: don't chime for messages that pre-date this listener.
          const created = (x.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
          if (created && created.getTime() < subscribedAt - 5000) continue;
          // H-2 fix: route uses normalized +E.164 but stored contactPhone
          // can be bare digits. Compare normalized forms on both sides.
          const normPhone = normalizePhone(phone);
          const path = pathRef.current;
          const pathPhone = path.startsWith("/inbox/")
            ? decodeURIComponent(path.slice("/inbox/".length).split(/[/?#]/)[0])
            : "";
          if (pathPhone && normalizePhone(pathPhone) === normPhone) continue;
          playNotificationChime();
          toast(name || "New message", {
            description: body || `[${type}]`,
          });
        }
      },
      () => {},
    );
    return () => unsub();
  }, [uid]);
}