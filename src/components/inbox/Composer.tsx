import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPaperPlane,
  faPaperclip,
  faMicrophone,
  faStop,
  faXmark,
  faCircleNotch,
  faFaceSmile,
  faBolt,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { AttachmentSheet, type AttachKind } from "@/components/inbox/AttachmentSheet";
import { InteractiveDialog } from "@/components/inbox/InteractiveDialog";
import { CannedPicker } from "@/components/inbox/CannedPicker";
import { useCannedResponses } from "@/hooks/useCannedResponses";
import {
  expandCanned,
  filterCanned,
  type CannedResponse,
} from "@/lib/firebase/canned";
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
import { fbAuth } from "@/integrations/firebase/client";
import { assignConversation } from "@/lib/firebase/assignments";
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
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  // Outbound typing indicator: debounced, throttled to once per 20s per wamid.
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentRef = useRef<{ wamid: string; ts: number } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiWrapRef = useRef<HTMLDivElement | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  // Canned-response picker: opens when the textarea value starts with "/".
  const { data: cannedList } = useCannedResponses();
  const [cannedOpen, setCannedOpen] = useState(false);
  const [cannedIndex, setCannedIndex] = useState(0);
  const cannedQuery = cannedOpen && text.startsWith("/") ? text.slice(1) : "";
  const cannedMatches = cannedOpen
    ? filterCanned(cannedList ?? [], cannedQuery)
    : [];

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

  // Re-evaluate picker visibility whenever text or the library changes.
  useEffect(() => {
    if (!text.startsWith("/")) {
      if (cannedOpen) setCannedOpen(false);
      return;
    }
    if ((cannedList?.length ?? 0) === 0) {
      if (cannedOpen) setCannedOpen(false);
      return;
    }
    if (!cannedOpen) setCannedOpen(true);
    setCannedIndex(0);
  }, [text, cannedList, cannedOpen]);

  async function insertCanned(item: CannedResponse) {
    let name: string | null = null;
    try {
      if (uid) {
        const snap = await getDoc(
          doc(fbDb(), "users", uid, "conversations", phoneDocId(phone)),
        );
        const cn = snap.data()?.contactName;
        if (typeof cn === "string" && cn) name = cn;
      }
    } catch {
      /* best-effort personalisation */
    }
    const body = expandCanned(item.body, { name, phone: normalizePhone(phone) });
    setText(body);
    setCannedOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const len = body.length;
      textareaRef.current?.setSelectionRange(len, len);
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

  // Listen for files dropped anywhere in the chat thread. The thread wrapper
  // fires a `wabees:chat-drop` CustomEvent with a File[] payload so we can
  // reuse the composer's upload pipeline (creds, optimistic write, Meta send).
  useEffect(() => {
    const onDrop = (e: Event) => {
      const detail = (e as CustomEvent<{ files: File[] }>).detail;
      if (!detail?.files?.length) return;
      for (const f of detail.files) {
        const kind: AttachKind = f.type.startsWith(
          "image/",
        )
          ? "image"
          : f.type.startsWith("video/")
            ? "video"
            : f.type.startsWith("audio/")
              ? "audio"
              : "document";
        void sendFile(f, kind);
      }
    };
    window.addEventListener("wabees:chat-drop", onDrop as EventListener);
    return () => window.removeEventListener("wabees:chat-drop", onDrop as EventListener);
    // sendFile is stable enough for this — it reads state via closures each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, selfUid, phone, text, replyTo]);

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
      // Auto-assign on first outgoing reply from an agent/owner if the
      // conversation isn't already assigned. Silent — never blocks send.
      void maybeAutoAssignOnReply(uid, selfUid, phone).catch(() => undefined);
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
      await updateDoc(doc(db, "users", uid, "subscription", "current"), { messagesUsed: increment(1) }).catch(() => {});
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

  async function sendFile(
    file: File,
    kind: "image" | "video" | "document" | "audio",
    captionOverride?: string,
  ) {
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
      const caption =
        kind === "audio"
          ? ""
          : typeof captionOverride === "string"
            ? captionOverride.trim()
            : text.trim();
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
      await updateDoc(doc(db, "users", uid, "subscription", "current"), { messagesUsed: increment(1) }).catch(() => {});
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
    if (cannedOpen && cannedMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCannedIndex((i) => (i + 1) % cannedMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCannedIndex(
          (i) => (i - 1 + cannedMatches.length) % cannedMatches.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = cannedMatches[cannedIndex] ?? cannedMatches[0];
        void insertCanned(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCannedOpen(false);
        return;
      }
    }
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
        <div className="relative flex items-end gap-2 p-3">
          <CannedPicker
            matches={cannedMatches}
            activeIndex={cannedIndex}
            onHover={setCannedIndex}
            onPick={(item) => void insertCanned(item)}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAttachOpen(true)}
            aria-label="Attach"
            className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faPaperclip} className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setInteractiveOpen(true)}
            aria-label="Interactive"
            title="Send location / buttons / list"
            className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faBolt} className="h-4 w-4" />
          </button>
          <div className="relative" ref={emojiWrapRef}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEmojiOpen((v) => !v)}
              aria-label="Emoji"
              className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faFaceSmile} className="h-4 w-4" />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-12 left-0 z-30">
                <EmojiPickerLazy onSelect={(e) => insertEmoji(e)} />
              </div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const it of Array.from(items)) {
                if (it.kind === "file") {
                  const f = it.getAsFile();
                  if (!f) continue;
                  e.preventDefault();
                  const kind: "image" | "video" | "document" = f.type.startsWith(
                    "image/",
                  )
                    ? "image"
                    : f.type.startsWith("video/")
                      ? "video"
                      : "document";
                  void sendFile(f, kind);
                  return;
                }
              }
            }}
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
      <AttachmentSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPick={(file, kind, caption) => void sendFile(file, kind, caption)}
      />
      {uid && selfUid && (
        <InteractiveDialog
          open={interactiveOpen}
          onClose={() => setInteractiveOpen(false)}
          phone={phone}
          uid={uid}
          selfUid={selfUid}
          contextMessageId={whatsappContextMessageId(replyTo)}
        />
      )}
    </div>
  );
}

function whatsappContextMessageId(message?: Message | null): string | null {
  if (!message) return null;
  // Only use the message's OWN wamid — never `replyToWamid` (that's the
  // grandparent) or a stripped doc id. Otherwise Meta silently drops
  // context and the reply lands on WhatsApp as a plain message with no
  // quoted preview.
  const raw =
    message.whatsappMessageId ??
    (message.id.startsWith("msg_") ? message.id.slice(4) : null);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// Dynamic import keeps ~200KB emoji data out of the initial bundle.
function EmojiPickerLazy({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{
    onEmojiClick: (e: { emoji: string }) => void;
    width?: number;
    height?: number;
    lazyLoadEmojis?: boolean;
    previewConfig?: { showPreview: boolean };
    searchPlaceHolder?: string;
  }> | null>(null);
  useEffect(() => {
    let alive = true;
    void import("emoji-picker-react").then((m) => {
      if (alive) setComp(() => m.default);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!Comp) {
    return (
      <div className="grid h-[360px] w-[320px] place-items-center rounded-lg border border-border bg-card text-xs text-muted-foreground shadow-md">
        Loading emoji…
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-md">
      <Comp
        onEmojiClick={(e) => onSelect(e.emoji)}
        width={320}
        height={360}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
        searchPlaceHolder="Search"
      />
    </div>
  );
}

/**
 * Auto-assign a conversation to the sending user on their first outgoing
 * reply, when nobody owns the thread yet. Silent — best-effort only.
 */
async function maybeAutoAssignOnReply(
  ownerUid: string,
  selfUid: string,
  phone: string,
): Promise<void> {
  const db = fbDb();
  const convId = phoneDocId(phone);
  const snap = await getDoc(doc(db, "users", ownerUid, "conversations", convId));
  const data = snap.data() as Record<string, unknown> | undefined;
  const currentAssignee = typeof data?.assignedAgentId === "string" ? data.assignedAgentId : null;
  if (currentAssignee) return;
  const actorEmail = fbAuth().currentUser?.email ?? null;
  await assignConversation(
    ownerUid,
    phone,
    { id: selfUid, email: actorEmail },
    { uid: selfUid, email: actorEmail },
    { source: "auto_reply", reason: "Auto-assigned on first reply" },
  );
}
