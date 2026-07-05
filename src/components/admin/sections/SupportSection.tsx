import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPaperPlane,
  faImage,
  faXmark,
  faHeadset,
  faCircleNotch,
  faFlag,
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
  setSupportChatStatus,
  setSupportChatPriority,
  type SupportStatus,
  type SupportPriority,
} from "@/lib/admin/mutations";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { cn } from "@/lib/utils";

export function SupportSection() {
  const { data: chats } = useAdminSupportChats();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SupportStatus>("all");

  const visibleChats = (chats ?? []).filter(
    (c) => statusFilter === "all" || (c.status || "open") === statusFilter,
  );
  const activeChat = (chats ?? []).find((c) => c.id === activeId) ?? null;

  return (
    <WbCard className="overflow-hidden">
      <div className="grid min-h-[70vh] grid-cols-1 md:grid-cols-[280px_1fr]">
        {/* Chat list */}
        <aside className="border-r border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Chats</p>
            <p className="text-xs text-muted-foreground">
              {visibleChats.length} of {chats?.length ?? 0}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["all", "open", "pending", "resolved", "closed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {!chats ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : visibleChats.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No support chats yet.</p>
            ) : (
              visibleChats.map((c) => (
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
                    <div className="mt-1 flex gap-1">
                      <StatusPill s={(c.status as SupportStatus) || "open"} />
                      {c.priority && c.priority !== "normal" && (
                        <PriorityPill p={c.priority as SupportPriority} />
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Chat thread */}
        <section className="flex min-h-0 flex-col">
          {activeId ? (
            <ChatThread chatId={activeId} chat={activeChat} />
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

function StatusPill({ s }: { s: SupportStatus }) {
  const tone =
    s === "open"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : s === "pending"
        ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
        : s === "resolved"
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase", tone)}>
      {s}
    </span>
  );
}

function PriorityPill({ p }: { p: SupportPriority }) {
  const tone =
    p === "urgent"
      ? "bg-destructive/15 text-destructive"
      : p === "high"
        ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase", tone)}>
      <FontAwesomeIcon icon={faFlag} className="mr-0.5 h-2 w-2" /> {p}
    </span>
  );
}

function ChatThread({
  chatId,
  chat,
}: {
  chatId: string;
  chat: { status?: string; priority?: string } | null;
}) {
  const { data: messages } = useAdminSupportMessages(chatId);
  const adminUid = useFirebaseUid();
  const [text, setText] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function changeStatus(next: SupportStatus) {
    setSavingMeta(true);
    try {
      await setSupportChatStatus(chatId, next);
      toast.success(`Marked ${next}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingMeta(false);
    }
  }
  async function changePriority(next: SupportPriority) {
    setSavingMeta(true);
    try {
      await setSupportChatPriority(chatId, next);
      toast.success(`Priority: ${next}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingMeta(false);
    }
  }

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
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-xs">
        <label className="text-muted-foreground">Status:</label>
        <select
          disabled={savingMeta}
          value={(chat?.status as SupportStatus) || "open"}
          onChange={(e) => void changeStatus(e.target.value as SupportStatus)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <label className="ml-2 text-muted-foreground">Priority:</label>
        <select
          disabled={savingMeta}
          value={(chat?.priority as SupportPriority) || "normal"}
          onChange={(e) => void changePriority(e.target.value as SupportPriority)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
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