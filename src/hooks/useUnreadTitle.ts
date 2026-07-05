/**
 * Prefix the browser tab title with the total unread conversation count.
 * Mirrors the WhatsApp-web behaviour so an agent working in another tab
 * sees new messages arrive without needing the inbox focused.
 */
import { useEffect } from "react";
import { useConversations } from "@/hooks/useConversations";

export function useUnreadTitle(): void {
  const { data } = useConversations();
  const total = (data ?? []).reduce(
    (acc, c) => acc + (c.state === "resolved" || c.state === "snoozed" ? 0 : c.unreadCount || 0),
    0,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const original = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${original}` : original;
  }, [total]);
}