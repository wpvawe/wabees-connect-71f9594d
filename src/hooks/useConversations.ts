import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

export type Conversation = {
  contactPhone: string;
  contactName: string;
  lastMessage: string;
  lastMessageType: string;
  lastMessageAt: string | null;
  unreadCount: number;
  profileImageUrl?: string | null;
  isPinned?: boolean;
  isBlocked?: boolean;
  tags?: string[];
};

export function useConversations(): { data: Conversation[] | null; error: string | null } {
  const uid = useFirebaseUid();
  const [data, setData] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    const q = query(collection(db, `users/${uid}/conversations`), orderBy("lastMessageAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Conversation[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const ts = x.lastMessageAt as { toDate?: () => Date } | string | undefined;
          let when: string | null = null;
          if (ts && typeof ts === "object" && typeof ts.toDate === "function") when = ts.toDate().toISOString();
          else if (typeof ts === "string") when = ts;
          return {
            contactPhone: d.id,
            contactName: (x.contactName as string) ?? d.id,
            lastMessage: (x.lastMessage as string) ?? "",
            lastMessageType: (x.lastMessageType as string) ?? "text",
            lastMessageAt: when,
            unreadCount: (x.unreadCount as number) ?? 0,
            profileImageUrl: (x.profileImageUrl as string | null) ?? null,
            isPinned: (x.isPinned as boolean) ?? false,
            isBlocked: (x.isBlocked as boolean) ?? false,
            tags: (x.tags as string[]) ?? [],
          };
        });
        setData(rows);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  return { data, error };
}