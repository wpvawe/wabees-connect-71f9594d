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
import { faClock, faFileLines } from "@fortawesome/free-solid-svg-icons";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AttachmentSheet, type AttachKind } from "@/components/inbox/AttachmentSheet";
import { InteractiveDialog } from "@/components/inbox/InteractiveDialog";
import { CannedPicker } from "@/components/inbox/CannedPicker";
import { TemplatePicker, templateNeedsForm } from "@/components/inbox/TemplatePicker";
import { useCannedResponses } from "@/hooks/useCannedResponses";
import { useTemplates } from "@/hooks/useTemplates";
import { useContacts } from "@/hooks/useContacts";
import {
  expandCanned,
  filterCanned,
  findUnresolvedVars,
  type CannedContext,
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
  sendTemplateMessage,
} from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { fbDb } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { normalizePhone, phoneDocId, whatsappRecipientId } from "@/lib/firebase/normalizers";
import { fbAuth } from "@/integrations/firebase/client";
import { assignConversation } from "@/lib/firebase/assignments";
import { markFirstResponseIfNeeded } from "@/lib/firebase/sla";
import type { Message } from "@/hooks/useMessages";

export function Composer({
  phone,
  replyTo,
  onClearReply,
  lastInboundWamid,
  lastInboundAt,
}: {
  phone: string;
  replyTo?: Message | null;
  onClearReply?: () => void;
  lastInboundWamid?: string | null;
  lastInboundAt?: string | null;
}) {
  // Draft persistence: rehydrate any unsent text for this thread so
  // switching conversations doesn't drop what the user was typing.
  const draftKey = `wb:draft:${phone}`;
  const [text, setText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  // Swap draft when the thread changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setText(window.localStorage.getItem(draftKey) ?? "");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);
  // Persist while typing (debounced).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        if (text) window.localStorage.setItem(draftKey, text);
        else window.localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text, draftKey]);
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
  const [plusOpen, setPlusOpen] = useState(false);
  const plusWrapRef = useRef<HTMLDivElement | null>(null);
  // Canned-response picker: opens when the textarea value starts with "/".
  const { data: cannedList } = useCannedResponses();
  const [cannedOpen, setCannedOpen] = useState(false);
  const [cannedIndex, setCannedIndex] = useState(0);
  const cannedQuery = cannedOpen && text.startsWith("/") ? text.slice(1) : "";
  const cannedMatches = cannedOpen
    ? filterCanned(cannedList ?? [], cannedQuery)
    : [];

  // Template picker: opens when the composer value starts with "#". Filters
  // by template name (case-insensitive prefix / includes match). Only
  // APPROVED + synced templates are eligible for inline send.
  const { data: templatesList } = useTemplates();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateIndex, setTemplateIndex] = useState(0);
  const templateQuery =
    templateOpen && text.startsWith("#") ? text.slice(1).trim().toLowerCase() : "";
  const templateMatches = templateOpen
    ? (templatesList ?? [])
        .filter(
          (t) =>
            (t.status ?? "").toUpperCase() === "APPROVED" &&
            (templateQuery === "" ||
              t.name.toLowerCase().includes(templateQuery)),
        )
        .slice(0, 30)
    : [];

  // Live personalisation context for the quick-reply picker + insert.
  // Sourced from the matching contact (email/company) and the conversation
  // doc (display name), with the signed-in user's name as `{{agent}}`.
  const { data: contactsList } = useContacts();
  const cannedCtx: CannedContext = (() => {
    const norm = normalizePhone(phone);
    const contact = (contactsList ?? []).find((c) => c.phone === norm) ?? null;
    const authUser = fbAuth().currentUser;
    const agentName =
      authUser?.displayName?.trim() ||
      (authUser?.email ? authUser.email.split("@")[0] : "") ||
      "";
    return {
      name: contact?.name ?? null,
      phone: norm,
      email: contact?.email ?? null,
      company: contact?.company ?? null,
      agent: agentName || null,
    };
  })();

  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!emojiWrapRef.current) return;
      if (!emojiWrapRef.current.contains(e.target as Node)) setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [emojiOpen]);

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!plusWrapRef.current) return;
      if (!plusWrapRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [plusOpen]);

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

  // Mirror trigger logic for the "#" template picker.
  useEffect(() => {
    if (!text.startsWith("#")) {
      if (templateOpen) setTemplateOpen(false);
      return;
    }
    if ((templatesList?.length ?? 0) === 0) {
      if (templateOpen) setTemplateOpen(false);
      return;
    }
    if (!templateOpen) setTemplateOpen(true);
    setTemplateIndex(0);
  }, [text, templatesList, templateOpen]);

  async function insertTemplate(t: import("@/hooks/useTemplates").Template) {
    if (templateNeedsForm(t)) {
      toast.info(`"${t.name}" needs variables — opening Templates page`, {
        duration: 3500,
      });
      setTemplateOpen(false);
      setText("");
      // Best-effort: navigate the user to the Templates page. They can
      // paste the phone (already in the URL) and select the template.
      try {
        window.location.href = "/templates";
      } catch {
        /* ignore */
      }
      return;
    }
    // No variables / no media header → send inline immediately.
    setTemplateOpen(false);
    setText("");
    await sendTemplateNow(t);
  }

  async function sendTemplateNow(t: import("@/hooks/useTemplates").Template) {
    if (!uid || !selfUid || sending) return;
    setSending(true);
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
      try {
        const { assertWithinPlanLimit } = await import("@/lib/plans/limits");
        await assertWithinPlanLimit(uid, "messages");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
        return;
      }
      let knownName = normalizedPhone;
      try {
        const snap = await getDoc(doc(db, "users", uid, "conversations", convId));
        const existing = snap.data()?.contactName;
        if (typeof existing === "string" && existing && existing !== normalizedPhone) {
          knownName = existing;
        }
      } catch {
        /* ignore */
      }
      msgRef = await addDoc(collection(db, "users", uid, "messages"), {
        contactPhone: normalizedPhone,
        contactName: knownName,
        type: "template",
        direction: "outgoing",
        status: "pending",
        body: t.body,
        templateName: t.name,
        headerText: t.header ?? null,
        footerText: t.footer ?? null,
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, "users", uid, "conversations", convId),
        {
          contactPhone: normalizedPhone,
          contactName: knownName,
          lastMessage: t.body,
          lastMessageType: "template",
          lastMessageAt: serverTimestamp(),
        },
        { merge: true },
      );
      const res = await sendTemplateMessage({
        phone_number_id: creds.phone_number_id,
        access_token: creds.access_token,
        to: whatsappRecipientId(phone),
        template_name: t.name,
        language_code: t.languageCode,
      });
      const wamid = extractWamid(res.raw);
      if (!res.success) {
        await updateDoc(msgRef, {
          status: "failed",
          errorReason: res.message ?? "Send failed",
        });
        toast.error(res.message ?? "Could not send template");
        return;
      }
      await updateDoc(msgRef, { status: "sent", whatsappMessageId: wamid });
      await updateDoc(doc(db, "users", uid), { totalMessages: increment(1) }).catch(() => {});
      await updateDoc(doc(db, "users", uid, "subscription", "current"), {
        messagesUsed: increment(1),
      }).catch(() => {});
    } catch (err) {
      if (msgRef) {
        await updateDoc(msgRef, {
          status: "failed",
          errorReason: err instanceof Error ? err.message : "Send failed",
        }).catch(() => {});
      }
      toast.error(err instanceof Error ? err.message : "Could not send template");
    } finally {
      setSending(false);
    }
  }

  async function insertCanned(item: CannedResponse) {
    // Contacts-hook first (already streaming); fall back to the conversation
    // doc's `contactName` so agents get personalisation even before the
    // contact list has hydrated.
    let ctx: CannedContext = { ...cannedCtx };
    if (!ctx.name && uid) {
      try {
        const snap = await getDoc(
          doc(fbDb(), "users", uid, "conversations", phoneDocId(phone)),
        );
        const cn = snap.data()?.contactName;
        if (typeof cn === "string" && cn) ctx = { ...ctx, name: cn };
      } catch {
        /* best-effort personalisation */
      }
    }
    const body = expandCanned(item.body, ctx);
    setText(body);
    setCannedOpen(false);
    const missing = findUnresolvedVars(item.body, ctx);
    if (missing.length > 0) {
      toast.warning(
        `Fill in ${missing.join(", ")} before sending`,
        { duration: 4000 },
      );
    }
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
    if (windowClosed) {
      toast.error("Reply window closed — send an approved template instead.");
      return;
    }
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
      try {
        const { assertWithinPlanLimit } = await import("@/lib/plans/limits");
        await assertWithinPlanLimit(uid, "messages");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Message limit reached");
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
      void markFirstResponseIfNeeded(uid, phone, selfUid);
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
    if (windowClosed) {
      toast.error("Reply window closed — send an approved template instead.");
      return;
    }
    setUploading(true);
    // Client-side image compression: Meta caps images at 5 MB and rejects
    // anything larger with a silent failure. Downscale + re-encode as JPEG
    // so users can send photos straight from a modern phone camera
    // (which routinely produce 6–12 MB files) without hitting the limit.
    if (kind === "image" && file.size > 1_500_000 && file.type.startsWith("image/")) {
      try {
        file = await compressImage(file);
      } catch {
        /* fall back to original file on any encode error */
      }
    }
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
      void markFirstResponseIfNeeded(uid, phone, selfUid);
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
    if (templateOpen && templateMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setTemplateIndex((i) => (i + 1) % templateMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setTemplateIndex(
          (i) => (i - 1 + templateMatches.length) % templateMatches.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = templateMatches[templateIndex] ?? templateMatches[0];
        void insertTemplate(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTemplateOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // WhatsApp 24-hour customer service window — derived from the last inbound
  // message. Meta silently drops free-form outbound sends when the window is
  // closed, so we block the composer and route the user to templates instead.
  // Ticks every 30s to keep the countdown fresh without re-rendering per second.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(iv);
  }, []);
  const windowInfo = (() => {
    if (!lastInboundAt) {
      return { hasInbound: false, open: false, expiresAt: 0, remainingMs: 0 };
    }
    const ts = new Date(lastInboundAt).getTime();
    if (!Number.isFinite(ts)) {
      return { hasInbound: false, open: false, expiresAt: 0, remainingMs: 0 };
    }
    const expiresAt = ts + 24 * 60 * 60 * 1000;
    const remainingMs = expiresAt - nowTick;
    return { hasInbound: true, open: remainingMs > 0, expiresAt, remainingMs };
  })();
  const windowClosed = !windowInfo.open;
  const disabled = sending || uploading || recording || windowClosed;

  return (
    <div className="border-t border-border bg-card">
      <WindowStatusBar info={windowInfo} />
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
            ctx={cannedCtx}
          />
          <TemplatePicker
            matches={templateMatches}
            activeIndex={templateIndex}
            onHover={setTemplateIndex}
            onPick={(t) => void insertTemplate(t)}
          />
          {/* WhatsApp-style single "+" that reveals attach / interactive / emoji */}
          <div className="relative" ref={plusWrapRef}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPlusOpen((v) => !v)}
              aria-label="More"
              className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faPaperclip} className="h-4 w-4" />
            </button>
            {plusOpen && (
              <div className="absolute bottom-12 left-0 z-30 flex flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                <button
                  type="button"
                  onClick={() => { setPlusOpen(false); setAttachOpen(true); }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <FontAwesomeIcon icon={faPaperclip} className="h-4 w-4 text-muted-foreground" />
                  Attach file
                </button>
                <button
                  type="button"
                  onClick={() => { setPlusOpen(false); setInteractiveOpen(true); }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <FontAwesomeIcon icon={faBolt} className="h-4 w-4 text-muted-foreground" />
                  Interactive
                </button>
                <button
                  type="button"
                  onClick={() => { setPlusOpen(false); setEmojiOpen(true); }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <FontAwesomeIcon icon={faFaceSmile} className="h-4 w-4 text-muted-foreground" />
                  Emoji
                </button>
              </div>
            )}
          </div>
          <div className="relative" ref={emojiWrapRef}>
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
            placeholder={windowClosed ? "Reply window closed — send a template" : "Type a message"}
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
function WindowStatusBar({
  info,
}: {
  info: { hasInbound: boolean; open: boolean; expiresAt: number; remainingMs: number };
}) {
  if (info.open) {
    const hours = Math.floor(info.remainingMs / 3_600_000);
    const minutes = Math.floor((info.remainingMs % 3_600_000) / 60_000);
    // Only show the banner when the window is closing soon (< 2h) to
    // avoid noise for the common "plenty of time left" case.
    if (info.remainingMs > 2 * 60 * 60 * 1000) return null;
    return (
      <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <FontAwesomeIcon icon={faClock} className="h-3.5 w-3.5" />
        <span className="flex-1">
          Reply window closes in {hours > 0 ? `${hours}h ` : ""}{minutes}m. Send a
          message now or use a template afterwards.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <FontAwesomeIcon icon={faClock} className="h-3.5 w-3.5" />
      <span className="flex-1 min-w-[180px]">
        {info.hasInbound
          ? "24-hour reply window closed. WhatsApp only allows approved templates until the customer messages again."
          : "No customer message yet. Start the conversation with an approved template."}
      </span>
      <Link
        to="/templates"
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
      >
        <FontAwesomeIcon icon={faFileLines} className="h-3 w-3" />
        Send template
      </Link>
    </div>
  );
}

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

/**
 * Downscale + re-encode an image so it fits under Meta's 5 MB image cap.
 * Longest side is clamped to 1920 px (WhatsApp itself does the same on
 * outbound photos). Quality steps 0.85 → 0.7 → 0.55 until the encoded
 * result is under 3 MB, leaving headroom for the multipart wrapper.
 */
async function compressImage(file: File): Promise<File> {
  if (typeof window === "undefined" || !("createImageBitmap" in window)) return file;
  const bitmap = await createImageBitmap(file);
  const MAX = 1920;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const TARGET = 3_000_000;
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", q),
    );
    if (blob && (blob.size <= TARGET || q === 0.4)) {
      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
    }
  }
  return file;
}
