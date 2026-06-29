import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faHeadset, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { format } from "date-fns";
import { TopBar } from "@/components/shell/TopBar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useSupportChat } from "@/hooks/useSupportChat";
import { useFirebaseUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { fbDb } from "@/integrations/firebase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({ meta: [{ title: "Support — Wabees" }] }),
  component: SupportPage,
});

function SupportPage() {
  const uid = useFirebaseUid();
  const session = useFirebaseSession();
  const email = session.status === "ready" ? (session.user.email ?? "") : "";
  const { data, error } = useSupportChat();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [data?.length]);

  // Mark admin messages read when chat opens / new admin replies arrive.
  // Uses the already-streamed messages to avoid a composite (senderRole+read)
  // index requirement on `support_chats/{uid}/messages`.
  useEffect(() => {
    if (!uid || !data) return;
    const unread = data.filter((m) => m.senderRole === "admin" && !m.read);
    if (unread.length === 0) return;
    (async () => {
      try {
        const batch = writeBatch(fbDb());
        for (const m of unread) {
          batch.update(doc(fbDb(), "support_chats", uid, "messages", m.id), { read: true });
        }
        batch.set(
          doc(fbDb(), "support_chats", uid),
          { unreadByUser: 0 },
          { merge: true },
        );
        await batch.commit();
      } catch {
        /* ignore */
      }
    })();
  }, [uid, data]);

  async function send() {
    const body = text.trim();
    if (!body || !uid) return;
    setSending(true);
    try {
      await setDoc(
        doc(fbDb(), "support_chats", uid),
        {
          userId: uid,
          userEmail: email,
          lastMessage: body,
          lastMessageAt: serverTimestamp(),
          unreadByAdmin: increment(1),
          userOnline: true,
        },
        { merge: true },
      );
      await addDoc(collection(fbDb(), "support_chats", uid, "messages"), {
        senderId: uid,
        senderRole: "user",
        text: body,
        read: false,
        createdAt: serverTimestamp(),
      });
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <TopBar title="Support" subtitle="Chat with the Wabees support team" />
      <section className="flex h-[calc(100vh-7.5rem)] flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3 sm:p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />{" "}
              Loading…
            </div>
          ) : data.length === 0 ? (
            <WbEmpty
              icon={faHeadset}
              title="Say hello 👋"
              description="Send us a message and we'll get back to you as soon as possible."
            />
          ) : (
            data.map((m) => {
              const mine = m.senderRole === "user";
              return (
                <div
                  key={m.id}
                  className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-soft",
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-card-foreground border border-border",
                    )}
                  >
                    {!mine && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                        Support
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
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
        <div className="flex items-center gap-2 border-t border-border bg-card p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Type a message…"
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
          <WbButton onClick={send} loading={sending} disabled={!text.trim()}>
            <FontAwesomeIcon icon={faPaperPlane} className="h-3.5 w-3.5" /> Send
          </WbButton>
        </div>
      </section>
    </>
  );
}
