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
  faFaceSmile,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  extractWamid,
  sendTextMessage,
  sendMediaMessage,
  uploadMedia,
  mediaProxyUrl,
  sendTypingIndicator,
} from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { normalizePhone, phoneDocId, whatsappRecipientId } from "@/lib/firebase/normalizers";
import type { Message } from "@/hooks/useMessages";

export function Composer({
  phone,
  replyTo,
  onClearReply,
  lastInboundWamid,
}: {
  phone: string;
  replyTo?: Message | null;
  onClearReply?: () => void;
  lastInboundWamid?: string | null;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  // Voice notes use opus-recorder (encodes directly to ogg/opus) so WhatsApp
  // renders the waveform UI. MediaRecorder's webm/opus is rejected by Meta.
  const recRef = useRef<{
    stop: () => Promise<Blob>;
    cancel: () => void;
  } | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  // Outbound typing indicator: debounced, throttled to once per 20s per wamid.
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentRef = useRef<{ wamid: string; ts: number } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!emojiWrapRef.current) return;
      if (!emojiWrapRef.current.contains(e.target as Node)) setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [emojiOpen]);

  function insertEmoji(emoji: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setText((t) => t + emoji);
      return;
    }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    // Restore caret after React re-render.
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = start + emoji.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recRef.current?.cancel();
      recRef.current = null;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
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
      // H-1 fix: preserve the known contact name on optimistic writes so the
      // thread header / conversation list don't briefly flash back to the
      // raw phone number. Read from the conversation doc that already
      // tracks contactName (best-effort, cached by Firestore SDK).
      let knownName = normalizedPhone;
      try {
        const snap = await getDoc(doc(db, "users", uid, "conversations", convId));
        const existing = snap.data()?.contactName;
        if (typeof existing === "string" && existing && existing !== normalizedPhone) {
          knownName = existing;
        }
      } catch {
        /* fall back to phone */
      }
      // Optimistic write — message doc + conversation summary (Flutter pattern).
      msgRef = await addDoc(collection(db, "users", uid, "messages"), {
        contactPhone: normalizedPhone,
        contactName: knownName,
        type: "text",
        direction: "outgoing",
        status: "pending",
        body,
        ...(replyTo
          ? {
              replyToId: replyTo.id,
              replyToBody: replyPreview(replyTo).slice(0, 200),
              replyToWamid: replyTo.whatsappMessageId ?? null,
              replyToType: replyTo.type ?? null,
            }
          : {}),
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, "users", uid, "conversations", convId),
        {
          contactPhone: normalizedPhone,
          contactName: knownName,
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
        context_message_id: whatsappContextMessageId(replyTo),
      });
      const wamid = extractWamid(res.raw);
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
    // M-3 fix: preserve the contact's display name on optimistic media writes
    // too — without this, the conversation list briefly flashed back to the
    // raw phone number whenever you sent a photo/voice/document.
    let knownName = normalizedPhone;
    try {
      const snap = await getDoc(doc(db, "users", uid, "conversations", convId));
      const existing = snap.data()?.contactName;
      if (typeof existing === "string" && existing && existing !== normalizedPhone) {
        knownName = existing;
      }
    } catch {
      /* fall back to phone */
    }
    // Voice-note flag is encoded in the file MIME (audio/ogg from opus-recorder)
    // & file extension. We only set is_voice=true for that specific shape so
    // documents named "voice.ogg" uploaded via the file picker don't masquerade.
    const isVoice =
      kind === "audio" &&
      file.type.startsWith("audio/ogg") &&
      file.name.startsWith("voice-");
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
      const mediaId = up.data?.id ?? null;
      // If upload only returned a Meta media_id, build a media-proxy URL so the
      // Flutter app (which renders from `mediaUrl`) can display outgoing media.
      const mediaUrl =
        up.data?.url ?? (mediaId ? mediaProxyUrl(mediaId, uid) : null);
      const caption = kind === "audio" ? "" : text.trim();
      msgRef = await addDoc(collection(db, "users", uid, "messages"), {
        contactPhone: normalizedPhone,
        contactName: knownName,
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
        ...(isVoice ? { isVoice: true } : {}),
        ...(replyTo
          ? {
              replyToId: replyTo.id,
              replyToBody: replyPreview(replyTo).slice(0, 200),
              replyToWamid: replyTo.whatsappMessageId ?? null,
              replyToType: replyTo.type ?? null,
            }
          : {}),
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, "users", uid, "conversations", convId),
        {
          contactPhone: normalizedPhone,
          contactName: knownName,
          lastMessage: caption || `[${kind}]`,
          lastMessageType: kind,
          lastMessageAt: serverTimestamp(),
        },
        { merge: true },
      );
      setText("");
      onClearReply?.();
      const res = await sendMediaMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to: whatsappRecipientId(phone),
        type: kind,
        ...(mediaId ? { media_id: mediaId } : mediaUrl ? { media_url: mediaUrl } : {}),
        ...(caption ? { caption } : {}),
        ...(kind === "document" ? { filename: file.name } : {}),
        ...(isVoice ? { is_voice: true } : {}),
        context_message_id: whatsappContextMessageId(replyTo),
      });
      const wamid = extractWamid(res.raw);
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
      // Dynamic import keeps the 80KB encoder out of the initial bundle.
      const { default: Recorder } = await import("opus-recorder");
      if (!Recorder.isRecordingSupported()) {
        toast.error("Voice recording isn't supported in this browser");
        return;
      }
      const recorder = new Recorder({
        encoderPath: "/opus/encoderWorker.min.js",
        encoderApplication: 2048, // voip
        encoderFrameSize: 20,
        encoderSampleRate: 48000,
        numberOfChannels: 1,
        streamPages: false,
      });
      let resolveBlob: ((b: Blob) => void) | null = null;
      const ready = new Promise<Blob>((res) => {
        resolveBlob = res;
      });
      recorder.ondataavailable = (typedArray: Uint8Array) => {
        // Copy into a fresh ArrayBuffer so BlobPart typing is happy regardless
        // of whether the worker emitted a SharedArrayBuffer-backed view.
        const copy = new Uint8Array(typedArray.byteLength);
        copy.set(typedArray);
        const blob = new Blob([copy.buffer], { type: "audio/ogg; codecs=opus" });
        resolveBlob?.(blob);
      };
      await recorder.start();
      recRef.current = {
        stop: async () => {
          await recorder.stop();
          return ready;
        },
        cancel: () => {
          resolveBlob = null;
          try {
            recorder.close();
          } catch {
            /* ignore */
          }
        },
      };
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Microphone permission denied");
    }
  }

  async function stopRecording(send: boolean) {
    const rec = recRef.current;
    if (!rec) return;
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    recRef.current = null;
    setRecording(false);
    setRecSeconds(0);
    if (!send) {
      rec.cancel();
      return;
    }
    try {
      const blob = await rec.stop();
      if (!blob || blob.size === 0) {
        toast.error("Recording was empty");
        return;
      }
      const file = new File(
        [blob],
        `voice-${Date.now()}.ogg`,
        { type: "audio/ogg; codecs=opus" },
      );
      await sendFile(file, "audio");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to finalize recording");
    }
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
            onChange={(e) => {
              setText(e.target.value);
              // Best-effort outbound typing indicator. Requires a known
              // inbound wamid (Meta scopes typing to a read receipt). Debounce
              // so we only send once when the user actively types, and
              // throttle to one call per 20s per wamid (Meta drops the
              // indicator after ~25s).
              if (!lastInboundWamid || !selfUid) return;
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
              typingTimerRef.current = setTimeout(() => {
                const now = Date.now();
                const last = typingSentRef.current;
                if (last && last.wamid === lastInboundWamid && now - last.ts < 20000) return;
                typingSentRef.current = { wamid: lastInboundWamid, ts: now };
                void (async () => {
                  try {
                    const creds = await loadWaCredentials(selfUid);
                    if (!creds) return;
                    await sendTypingIndicator({
                      phone_number_id: creds.phone_number_id,
                      access_token: creds.access_token,
                      message_id: lastInboundWamid,
                    });
                  } catch {
                    /* best-effort */
                  }
                })();
              }, 350);
            }}
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

function whatsappContextMessageId(message?: Message | null): string | null {
  if (!message) return null;
  const raw =
    message.whatsappMessageId ??
    message.replyToWamid ??
    (message.id.startsWith("msg_") ? message.id.slice(4) : null);
  return raw?.replace(/^msg_/, "") ?? null;
}

// Build a non-empty reply preview so replying to a photo / voice / document
// still shows context above the bubble (previously empty body → no quote).
function replyPreview(m: Message): string {
  const text = (m.body || m.caption || "").trim();
  if (text) return text;
  const tagMap: Record<string, string> = {
    image: "📷 Photo",
    sticker: "💟 Sticker",
    video: "🎥 Video",
    audio: "🎤 Voice message",
    document: m.fileName ? `📄 ${m.fileName}` : "📄 Document",
    location: "📍 Location",
    contacts: "👤 Contact",
    template: "📋 Template",
    interactive: "🔘 Interactive",
    button: "🔘 Button",
    order: "🛒 Order",
  };
  return tagMap[(m.type || "").toLowerCase()] ?? `[${m.type || "message"}]`;
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
