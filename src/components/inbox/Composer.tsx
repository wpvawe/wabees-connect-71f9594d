import { useState, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { sendTextMessage } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";

export function Composer({ phone }: { phone: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const uid = useEffectiveUid();

  async function send() {
    const body = text.trim();
    if (!body || sending || !uid) return;
    setSending(true);
    const to = phone.replace(/[^0-9]/g, "");
    const db = fbDb();
    let msgRef: Awaited<ReturnType<typeof addDoc>> | null = null;
    try {
      const creds = await loadWaCredentials(uid);
      if (!creds) {
        toast.error("Connect WhatsApp first");
        return;
      }
      // Optimistic write — message doc + conversation summary (Flutter pattern).
      msgRef = await addDoc(collection(db, "users", uid, "messages"), {
        contactPhone: to,
        contactName: phone,
        type: "text",
        direction: "outgoing",
        status: "pending",
        body,
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, "users", uid, "conversations", to),
        {
          contactName: phone,
          lastMessage: body,
          lastMessageType: "text",
          lastMessageAt: serverTimestamp(),
        },
        { merge: true },
      );
      setText("");
      const res = await sendTextMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to,
        message: body,
      });
      const wamid = (res.raw?.messages as Array<{ id?: string }> | undefined)?.[0]?.id ?? null;
      if (!res.success) {
        await updateDoc(msgRef, { status: "failed", errorReason: res.message ?? "Send failed" });
        toast.error(res.message ?? "Could not send");
        return;
      }
      await updateDoc(msgRef, { status: "sent", whatsappMessageId: wamid });
      await updateDoc(doc(db, "users", uid), { totalMessages: increment(1) }).catch(() => {});
    } catch (err) {
      if (msgRef) {
        await updateDoc(msgRef, {
          status: "failed",
          errorReason: err instanceof Error ? err.message : "Send failed",
        }).catch(() => {});
      }
      toast.error(err instanceof Error ? err.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border bg-card p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Type a message"
        rows={1}
        className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
      />
      <button
        type="button"
        disabled={sending || !text.trim()}
        onClick={() => void send()}
        aria-label="Send"
        className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-50"
      >
        <FontAwesomeIcon icon={faPaperPlane} className="h-4 w-4" />
      </button>
    </div>
  );
}