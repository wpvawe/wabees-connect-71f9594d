import { useEffect, useRef } from "react";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { playNotificationChime } from "@/lib/notification-sound";
import { toast } from "sonner";
import { useRouterState } from "@tanstack/react-router";
import { normalizePhone } from "@/lib/firebase/normalizers";
import { subscribeIncomingMessages } from "@/lib/firebase/messagesBroker";

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
    const subscribedAt = Date.now();
    return subscribeIncomingMessages(uid, (msg) => {
      const x = msg.data;
      const phone = String(x.contactPhone ?? "");
      const name = String(x.contactName ?? phone);
      const body = String(x.body ?? "");
      const type = String(x.type ?? "text");
      if (type === "reaction" && !x.mediaUrl) return;
      if (msg.createdAtMs < subscribedAt - 5000) return;
      const normPhone = normalizePhone(phone);
      const path = pathRef.current;
      const pathPhone = path.startsWith("/inbox/")
        ? decodeURIComponent(path.slice("/inbox/".length).split(/[/?#]/)[0])
        : "";
      if (pathPhone && normalizePhone(pathPhone) === normPhone) return;
      playNotificationChime();
      toast(name || "New message", { description: body || `[${type}]` });
    });
  }, [uid]);
}