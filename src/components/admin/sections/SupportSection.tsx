import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPaperPlane,
  faImage,
  faXmark,
  faHeadset,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";
import { format } from "date-fns";
import { toast } from "sonner";
import { WbCard } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import {
  useAdminSupportChats,
  useAdminSupportMessages,
} from "@/hooks/admin/useAdminData";
import {
  adminSendSupportMessage,
  markSupportChatReadByAdmin,
} from "@/lib/admin/mutations";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { cn } from "@/lib/utils";

export function SupportSection() {
  const { data: chats } = useAdminSupportChats();
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <WbCard className="overflow-hidden">
      <div className="grid min-h-[70vh] grid-cols-1 md:grid-cols-[280px_1fr]">
        {/* Chat list */}
        <aside className="border-r border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Chats</p>
            <p className="text-xs text-muted-foreground">{chats?.length ?? 0} conversations</p>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {!chats ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : chats.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No support chats yet.</p>
            ) : (
              chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors",
                    activeId === c.id ? "bg-primary/10" : "hover:bg-muted/50",
                  )}
                >
                  <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {(c.userName || c.userEmail || "?").slice(0, 1).toUpperCase()}
                    {c.userOnline && (
                      <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          "truncate text-sm",
                          c.unreadByAdmin > 0 ? "font-bold text-foreground" : "font-medium text-foreground",
                        )}
                      >
                        {c.userName || c.userEmail || c.userId}
                      </p>
                      {c.unreadByAdmin > 0 && (
                        <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {c.unreadByAdmin}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.lastMessage || "No messages yet"}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Chat thread */}
        <section className="flex min-h-0 flex-col">
          {activeId ? (
            <ChatThread chatId={activeId} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
              <FontAwesomeIcon icon={faHeadset} className="mb-3 h-10 w-10 text-primary/60" />
              <p className="text-sm font-semibold text-foreground">Pick a conversation</p>
              <p className="mt-1 text-xs">Select a chat on the left to reply.</p>
            </div>
          )}
        </section>
      </div>
    </WbCard>
  );
}

function ChatThread({ chatId }: { chatId: string }) {
  const { data: messages } = useAdminSupportMessages(chatId);
  const adminUid = useFirebaseUid();
  const [text, setText] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages?.length]);

  useEffect(() => {
    if (!messages) return;
    const unreadIds = messages
      .filter((m) => m.senderRole === "user" && !m.read)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    void markSupportChatReadByAdmin(chatId, unreadIds).catch(() => {});
  }, [chatId, messages]);

  async function send() {
    const body = text.trim();
    if ((!body && !pendingImage) || !adminUid) return;
    setSending(true);
    try {
      await adminSendSupportMessage(chatId, adminUid, body, pendingImage);
      setText("");
      setPendingImage(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image");
      return;
    }
    // Base64 inflates size by ~33%. Firestore document hard limit is 1 MiB,
    // so a 800 KB file → ~1.07 MB base64 payload → write silently fails.
    // Cap at 700 KB so the base64 stays comfortably under 1 MB.
    if (file.size > 700 * 1024) {
      toast.error("Image is too large — use under 700 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPendingImage(String(reader.result));
    reader.onerror = () => toast.error("Could not read image");
    reader.readAsDataURL(file);
  }

  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/20 p-3">
        {!messages ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No messages in this chat yet.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === "admin";
            return (
              <div
                key={m.id}
                className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-soft",
                    mine
                      ? "rounded-br-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground"
                      : "bg-card text-card-foreground border border-border",
                  )}
                >
                  {!mine && (
                    <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                      User
                    </p>
                  )}
                  {m.imageUrl && (
                    <img
                      src={m.imageUrl}
                      alt="attachment"
                      className="mb-1 max-h-64 w-auto rounded-md"
                    />
                  )}
                  {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                  <p
                    className={cn(
                      "mt-1 text-right text-[10px]",
                      mine ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {m.createdAt ? format(new Date(m.createdAt), "p") : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-border bg-card">
        {pendingImage && (
          <div className="flex items-start gap-3 border-b border-border bg-muted/30 px-3 py-2">
            <img src={pendingImage} alt="preview" className="h-16 w-16 rounded-md object-cover" />
            <p className="flex-1 text-xs text-muted-foreground">Image ready to send</p>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove"
            >
              <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Attach image"
          >
            <FontAwesomeIcon icon={faImage} className="h-4 w-4" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Reply to user…"
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
          <WbButton onClick={send} loading={sending} disabled={!text.trim() && !pendingImage}>
            <FontAwesomeIcon icon={faPaperPlane} className="h-3.5 w-3.5" /> Send
          </WbButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickImage}
          />
        </div>
      </div>
    </>
  );
}