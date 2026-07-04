import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faShare, faCircleNotch, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { toast } from "sonner";
import { useContacts } from "@/hooks/useContacts";
import { useConversations } from "@/hooks/useConversations";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import {
  extractWamid,
  sendMediaMessage,
  sendTextMessage,
} from "@/lib/wabees/api";
import {
  normalizePhone,
  phoneDocId,
  whatsappRecipientId,
} from "@/lib/firebase/normalizers";
import type { Message } from "@/hooks/useMessages";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Target = { phone: string; name: string; photo?: string | null };

export function ForwardDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const { data: contacts } = useContacts();
  const { data: conversations } = useConversations();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, Target>>({});
  const [sending, setSending] = useState(false);

  const targets = useMemo<Target[]>(() => {
    const map = new Map<string, Target>();
    for (const c of contacts ?? []) {
      if (!c.phone) continue;
      map.set(c.phone, { phone: c.phone, name: c.name || c.phone, photo: c.profileImageUrl });
    }
    for (const c of conversations ?? []) {
      if (!c.contactPhone) continue;
      if (!map.has(c.contactPhone)) {
        map.set(c.contactPhone, {
          phone: c.contactPhone,
          name: c.contactName || c.contactPhone,
          photo: c.profileImageUrl,
        });
      }
    }
    const list = Array.from(map.values());
    const q = query.trim().toLowerCase();
    return q
      ? list.filter(
          (t) => t.name.toLowerCase().includes(q) || t.phone.toLowerCase().includes(q),
        )
      : list;
  }, [contacts, conversations, query]);

  const toggle = (t: Target) =>
    setSelected((s) => {
      const next = { ...s };
      if (next[t.phone]) delete next[t.phone];
      else next[t.phone] = t;
      return next;
    });

  async function forward() {
    const list = Object.values(selected);
    if (list.length === 0 || !uid || !selfUid) return;
    setSending(true);
    try {
      const creds = await loadWaCredentials(selfUid);
      if (!creds) {
        toast.error("Connect WhatsApp first");
        return;
      }
      try {
        const { assertWithinPlanLimit } = await import("@/lib/plans/limits");
        await assertWithinPlanLimit(uid, "messages", list.length);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
        return;
      }
      const db = fbDb();
      const hasMedia = !!message.mediaUrl || !!message.mediaId;
      const mediaKind = hasMedia
        ? (message.type as "image" | "video" | "audio" | "document" | "sticker")
        : null;
      const body = message.body || message.caption || "";
      const results = await Promise.allSettled(
        list.map(async (t) => {
          const normalized = normalizePhone(t.phone);
          const convId = phoneDocId(t.phone);
          const msgRef = await addDoc(collection(db, "users", uid, "messages"), {
            contactPhone: normalized,
            contactName: t.name || normalized,
            type: mediaKind ?? "text",
            direction: "outgoing",
            status: "pending",
            body: hasMedia ? "" : body,
            caption: hasMedia ? body : null,
            mediaUrl: message.mediaUrl ?? null,
            mediaId: message.mediaId ?? null,
            mimeType: message.mimeType ?? null,
            fileName: message.fileName ?? null,
            fileSize: message.fileSize ?? null,
            forwarded: true,
            createdAt: serverTimestamp(),
          });
          await setDoc(
            doc(db, "users", uid, "conversations", convId),
            {
              contactPhone: normalized,
              contactName: t.name || normalized,
              lastMessage: mediaKind ? (body || `[${mediaKind}]`) : body,
              lastMessageType: mediaKind ?? "text",
              lastMessageAt: serverTimestamp(),
            },
            { merge: true },
          );
          const to = whatsappRecipientId(t.phone);
          const res = mediaKind
            ? await sendMediaMessage({
                phone_number_id: creds.phone_number_id,
                access_token: creds.access_token,
                to,
                type: mediaKind,
                ...(message.mediaId
                  ? { media_id: message.mediaId }
                  : message.mediaUrl
                    ? { media_url: message.mediaUrl }
                    : {}),
                ...(body && mediaKind !== "audio" && mediaKind !== "sticker" ? { caption: body } : {}),
                ...(mediaKind === "document" && message.fileName ? { filename: message.fileName } : {}),
              })
            : await sendTextMessage({
                phone_number_id: creds.phone_number_id,
                access_token: creds.access_token,
                to,
                message: body,
              });
          if (!res.success) {
            await updateDoc(msgRef, {
              status: "failed",
              errorReason: res.message ?? "Send failed",
            });
            throw new Error(res.message ?? "Send failed");
          }
          await updateDoc(msgRef, {
            status: "sent",
            whatsappMessageId: extractWamid(res.raw),
          });
        }),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const bad = results.length - ok;
      // Bump plan counter for every successfully forwarded message so
      // forwards don't silently bypass the messagesUsed quota (B-1).
      if (ok > 0) {
        const { incrementMessagesUsed } = await import("@/lib/plans/limits");
        await incrementMessagesUsed(uid, ok);
      }
      if (ok) toast.success(`Forwarded to ${ok} chat${ok > 1 ? "s" : ""}`);
      if (bad) toast.error(`${bad} forward${bad > 1 ? "s" : ""} failed`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Forward failed");
    } finally {
      setSending(false);
    }
  }

  const count = Object.keys(selected).length;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Forward message</p>
            <p className="text-xs text-muted-foreground">
              {count > 0 ? `${count} selected` : "Pick chats to forward to"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto">
          {targets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No matches</p>
          ) : (
            targets.map((t) => {
              const isSel = !!selected[t.phone];
              const initials =
                (t.name || t.phone).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
              return (
                <button
                  key={t.phone}
                  type="button"
                  onClick={() => toggle(t)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted",
                    isSel && "bg-primary/10",
                  )}
                >
                  <Avatar className="h-9 w-9">
                    {t.photo ? <AvatarImage src={t.photo} alt={t.name} /> : null}
                    <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{t.phone}</p>
                  </div>
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full border",
                      isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                    )}
                  >
                    {isSel && "✓"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={sending || count === 0}
            onClick={() => void forward()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {sending ? (
              <FontAwesomeIcon icon={faCircleNotch} className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FontAwesomeIcon icon={faShare} className="h-3.5 w-3.5" />
            )}
            Forward
          </button>
        </div>
      </div>
    </div>
  );
}