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
          // Skip if user is already inside that thread.
          if (pathRef.current.includes(`/inbox/${phone}`)) continue;
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