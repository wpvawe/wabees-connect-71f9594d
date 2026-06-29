import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPaperPlane,
  faPaperclip,
  faMicrophone,
  faStop,
  faXmark,
  faImage,
  faFile,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";
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
import { sendTextMessage, sendMediaMessage, uploadMedia } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { normalizePhone, phoneDocId, whatsappRecipientId } from "@/lib/firebase/normalizers";
import type { Message } from "@/hooks/useMessages";

export function Composer({
  phone,
  replyTo,
  onClearReply,
}: {
  phone: string;
  replyTo?: Message | null;
  onClearReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function send() {
    const body = text.trim();
    if (!body || sending || !uid || !selfUid) return;
    setSending(true);
    const normalizedPhone = normalizePhone(phone);
    const to = phoneDocId(phone);
    const convId = to;
    const db = fbDb();
    let msgRef: Awaited<ReturnType<typeof addDoc>> | null = null;
    try {
      const creds = await loadWaCredentials(selfUid);
      if (!creds) {
        toast.error("Connect WhatsApp first");
        return;
      }
      // Optimistic write — message doc + conversation summary (Flutter pattern).
      msgRef = await addDoc(collection(db, "users", uid, "messages"), {
        contactPhone: normalizedPhone,
        contactName: normalizedPhone,
        type: "text",
        direction: "outgoing",
        status: "pending",
        body,
        ...(replyTo
          ? {
              replyToId: replyTo.id,
              replyToBody: replyTo.body?.slice(0, 200) ?? "",
              replyToWamid: replyTo.whatsappMessageId ?? null,
            }
          : {}),
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, "users", uid, "conversations", convId),
        {
          contactPhone: normalizedPhone,
          contactName: normalizedPhone,
          lastMessage: body,
          lastMessageType: "text",
          lastMessageAt: serverTimestamp(),
        },
        { merge: true },
      );
      setText("");
      onClearReply?.();
      const res = await sendTextMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to: whatsappRecipientId(phone),
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

  async function sendFile(file: File, kind: "image" | "video" | "document" | "audio") {
    if (!uid || !selfUid) return;
    setUploading(true);
    const normalizedPhone = normalizePhone(phone);
    const convId = phoneDocId(phone);
    const db = fbDb();
    let msgRef: Awaited<ReturnType<typeof addDoc>> | null = null;
    try {
      const creds = await loadWaCredentials(selfUid);
      if (!creds) {
        toast.error("Connect WhatsApp first");
        return;
      }
      const up = await uploadMedia({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        file,
        kind,
      });
      if (!up.success || (!up.data?.url && !up.data?.id)) {
        throw new Error(up.message ?? "Upload failed");
      }
      const mediaUrl = up.data?.url ?? null;
      const mediaId = up.data?.id ?? null;
      const caption = kind === "audio" ? "" : text.trim();
      msgRef = await addDoc(collection(db, "users", uid, "messages"), {
        contactPhone: normalizedPhone,
        contactName: normalizedPhone,
        type: kind,
        direction: "outgoing",
        status: "pending",
        body: caption,
        caption,
        mediaUrl,
        mediaId,
        mimeType: file.type || null,
        fileName: kind === "document" ? file.name : null,
        fileSize: file.size,
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, "users", uid, "conversations", convId),
        {
          contactPhone: normalizedPhone,
          contactName: normalizedPhone,
          lastMessage: caption || `[${kind}]`,
          lastMessageType: kind,
          lastMessageAt: serverTimestamp(),
        },
        { merge: true },
      );
      setText("");
      const res = await sendMediaMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to: whatsappRecipientId(phone),
        type: kind,
        ...(mediaUrl ? { media_url: mediaUrl } : {}),
        ...(mediaId ? { media_id: mediaId } : {}),
        ...(caption ? { caption } : {}),
        ...(kind === "document" ? { filename: file.name } : {}),
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
      setUploading(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      recChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mime });
        const ext = mime.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
        await sendFile(file, "audio");
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Microphone permission denied");
    }
  }

  function stopRecording(send: boolean) {
    if (!recRef.current) return;
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (!send) {
      recRef.current.ondataavailable = null;
      recRef.current.onstop = () => {
        recRef.current?.stream.getTracks().forEach((t) => t.stop());
      };
    }
    try {
      recRef.current.stop();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    setRecording(false);
    setRecSeconds(0);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const disabled = sending || uploading || recording;

  return (
    <div className="border-t border-border bg-card">
      {replyTo && (
        <div className="flex items-start gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <div className="h-full w-1 self-stretch rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">
              Replying to {replyTo.direction === "outgoing" ? "yourself" : replyTo.contactName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{replyTo.body || `[${replyTo.type}]`}</p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cancel reply"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {recording ? (
        <div className="flex items-center gap-3 p-3">
          <span className="flex h-3 w-3 animate-pulse rounded-full bg-destructive" />
          <p className="flex-1 text-sm">Recording… {formatSec(recSeconds)}</p>
          <button
            type="button"
            onClick={() => stopRecording(false)}
            className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => stopRecording(true)}
            className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground"
            aria-label="Stop & send"
          >
            <FontAwesomeIcon icon={faStop} className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2 p-3">
          <AttachMenu
            disabled={disabled}
            onPickImage={() => imageInputRef.current?.click()}
            onPickFile={() => fileInputRef.current?.click()}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a message"
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2 disabled:opacity-60"
          />
          {text.trim() ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void send()}
              aria-label="Send"
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {sending ? (
                <FontAwesomeIcon icon={faCircleNotch} className="h-4 w-4 animate-spin" />
              ) : (
                <FontAwesomeIcon icon={faPaperPlane} className="h-4 w-4" />
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void startRecording()}
              aria-label="Record voice"
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {uploading ? (
                <FontAwesomeIcon icon={faCircleNotch} className="h-4 w-4 animate-spin" />
              ) : (
                <FontAwesomeIcon icon={faMicrophone} className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const kind = f.type.startsWith("video/") ? "video" : "image";
          void sendFile(f, kind);
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void sendFile(f, "document");
        }}
      />
    </div>
  );
}

function AttachMenu({
  disabled,
  onPickImage,
  onPickFile,
}: {
  disabled: boolean;
  onPickImage: () => void;
  onPickFile: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="Attach"
        className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <FontAwesomeIcon icon={faPaperclip} className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute bottom-12 left-0 z-10 min-w-[160px] rounded-lg border border-border bg-card p-1 text-sm shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onPickImage();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
          >
            <FontAwesomeIcon icon={faImage} className="h-3.5 w-3.5" /> Photo / Video
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onPickFile();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
          >
            <FontAwesomeIcon icon={faFile} className="h-3.5 w-3.5" /> Document
          </button>
        </div>
      )}
    </div>
  );
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
