import { useState, type KeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { sendMessage } from "@/lib/inbox/send.functions";

export function Composer({ phone }: { phone: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const sendFn = useServerFn(sendMessage);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await sendFn({ data: { phone, message: body } });
      setText("");
    } catch (err) {
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