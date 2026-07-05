import { format } from "date-fns";
import Linkify from "linkify-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCheckDouble,
  faClock,
  faTriangleExclamation,
  faReply,
  faCopy,
  faTrash,
  faFaceSmile,
  faEllipsisVertical,
  faLocationDot,
  faAddressCard,
  faShareNodes,
  faKey,
  faCircleQuestion,
  faShare,
  faDownload,
  faPhone,
  faUserPlus,
  faFilePdf,
  faFileWord,
  faFileExcel,
  faFilePowerpoint,
  faFileZipper,
  faFileAudio,
  faFileVideo,
  faFileImage,
  faFileLines,
  faFile,
  faPlay,
  faPause,
  faUpRightFromSquare,
  faRotateRight,
  faCircleExclamation,
  faStar,
} from "@fortawesome/free-solid-svg-icons";
import { faBagShopping, faClipboardList } from "@fortawesome/free-solid-svg-icons";
import type { Message } from "@/hooks/useMessages";
import { cn } from "@/lib/utils";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const linkifyOpts = {
  target: "_blank",
  rel: "noopener noreferrer",
  className: "underline underline-offset-2",
  defaultProtocol: "https",
};

// S6 fix — allowlist link schemes so a Firestore-stored `ctaUrl` /
// interactive URL from a hostile WhatsApp sender cannot become
// `javascript:` and execute in the agent's tab.
function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Body strings the webhook stamps as visual placeholders — we render a
// richer card (image/video/document/contact/etc.) so the placeholder text
// itself must never leak into the bubble.
const PLACEHOLDER_BODY = new Set([
  "[image]",
  "[video]",
  "[audio]",
  "[voice]",
  "[sticker]",
  "[document]",
  "[contacts]",
  "[contact]",
  "[location]",
  "[reaction]",
  "[interactive]",
  "[button]",
  "[order]",
  "[template]",
  "📇 contact shared",
  "contact shared",
  "message type unknown",
  "message not supported",
  "message not supported in whatsapp business",
]);
function isPlaceholderBody(v: string | null | undefined): boolean {
  if (!v) return true;
  const s = v.trim().toLowerCase();
  if (!s) return true;
  if (PLACEHOLDER_BODY.has(s)) return true;
  // Generic "[anything]" one-word placeholder
  if (/^\[[a-z_ ]+\]$/i.test(s)) return true;
  return false;
}
function cleanBody(v: string | null | undefined): string {
  return isPlaceholderBody(v) ? "" : (v ?? "");
}

function firstUrl(value: string): string | null {
  const match = value.match(/(?:https?:\/\/|www\.)[^\s<>()]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>()]*)?/i);
  if (!match) return null;
  return match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function detectOtpCode(body: string | null | undefined, templateName?: string | null): string | null {
  const text = (body ?? "").trim();
  if (!text) return null;
  const keywordHit = /\b(otp|one[-\s]?time|verification|verify|code|passcode|pin|security|login|auth|password)\b|رمز|کوڈ|کود/i.test(
    `${templateName ?? ""} ${text}`,
  );
  const compact = text.replace(/[\s-]+/g, "");
  if (/^\d{4,8}$/.test(compact)) return compact;
  if (!keywordHit) return null;
  return text.match(/\b(\d{4,8})\b/)?.[1] ?? null;
}

function extensionForMime(mime?: string | null): string {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/rtf": "rtf",
    "text/rtf": "rtf",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/zip": "zip",
    "application/x-rar-compressed": "rar",
    "application/x-7z-compressed": "7z",
    "application/vnd.android.package-archive": "apk",
    "application/octet-stream": "bin",
  };
  if (map[m]) return map[m];
  if (m.startsWith("image/")) return m.slice(6).replace("jpeg", "jpg");
  if (m.startsWith("video/")) return m.slice(6);
  if (m.startsWith("audio/")) return m.slice(6).replace("mpeg", "mp3");
  return "bin";
}

function safeFileName(name?: string | null, mime?: string | null, fallback = "document"): string {
  const base = (name || fallback).trim().replace(/[\\/:*?"<>|]+/g, "_");
  if (/\.[A-Za-z0-9]{1,8}$/.test(base) && !/\.bin$/i.test(base)) return base;
  const ext = extensionForMime(mime);
  if (ext === "bin" && /\.bin$/i.test(base)) return base;
  return `${base.replace(/\.bin$/i, "")}.${ext}`;
}

function downloadUrl(url: string, fileName?: string | null, mime?: string | null): string {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set("download", "1");
    if (fileName) u.searchParams.set("filename", safeFileName(fileName, mime));
    if (mime) u.searchParams.set("mime", mime);
    return u.toString();
  } catch {
    return url;
  }
}

async function downloadAttachment(url: string, fileName?: string | null, mime?: string | null) {
  const finalName = safeFileName(fileName, mime, "attachment");
  const href = downloadUrl(url, finalName, mime);
  try {
    const res = await fetch(href, { mode: "cors" });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export type MessageActions = {
  onReply?: (m: Message) => void;
  onReact?: (m: Message, emoji: string) => void;
  onDelete?: (m: Message) => void;
  onForward?: (m: Message) => void;
  onOpenMedia?: (m: Message) => void;
  onResend?: (m: Message) => void;
  onToggleStar?: (m: Message) => void;
};

function MessageBubbleImpl({ m, actions }: { m: Message; actions?: MessageActions }) {
  const mine = m.direction === "outgoing";
  const time = m.createdAt ? format(new Date(m.createdAt), "p") : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [fullPickerOpen, setFullPickerOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const isDeleted = m.status === "deleted" || m.body === "__DELETED__";
  // H-3 helper: reactions need a wamid to forward to Meta. Pending outgoing
  // messages don't have one yet, so disable the react button until the
  // webhook writes whatsappMessageId back. Otherwise the user reacts and
  // the WhatsApp contact never sees the emoji.
  const reactDisabled = mine && (m.status === "pending" || !m.whatsappMessageId);
  // M-4 fix: close popovers on any outside pointerdown (mouse + touch).
  // onMouseLeave alone never fires on mobile.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!reactOpen && !menuOpen && !errorOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setReactOpen(false);
        setMenuOpen(false);
        setErrorOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [reactOpen, menuOpen, errorOpen]);

  // A10 · long-press to open the actions menu on touch devices where the
  // hover action bar never appears. 450 ms matches WhatsApp's feel.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFired = useRef(false);
  function pressStart() {
    if (isDeleted || !actions) return;
    pressFired.current = false;
    pressTimer.current = setTimeout(() => {
      pressFired.current = true;
      setMenuOpen(true);
      if (actions.onReact && !reactDisabled) setReactOpen(true);
      // Haptic tick on supported devices
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(15);
        } catch {
          /* noop */
        }
      }
    }, 450);
  }
  function pressCancel() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function onContextMenu(e: React.MouseEvent) {
    if (isDeleted || !actions) return;
    e.preventDefault();
    setMenuOpen(true);
    if (actions.onReact && !reactDisabled) setReactOpen(true);
  }

  function copy() {
    const txt =
      m.body ||
      m.caption ||
      m.otpCode ||
      (m.buttonReplyText ?? "") ||
      (m.locationName ?? "") ||
      "";
    if (txt) void navigator.clipboard?.writeText(txt);
    setMenuOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={cn("group relative flex w-full flex-col", mine ? "items-end" : "items-start")}
    >
      <div className="relative max-w-[78%]">
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2 text-sm shadow-soft transition-shadow",
          mine
            ? "rounded-br-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground"
            : "rounded-bl-md border border-border bg-card text-card-foreground",
          isDeleted && "italic opacity-70",
        )}
        onTouchStart={pressStart}
        onTouchEnd={pressCancel}
        onTouchMove={pressCancel}
        onTouchCancel={pressCancel}
        onContextMenu={onContextMenu}
        onClick={(e) => {
          if (pressFired.current) {
            e.preventDefault();
            pressFired.current = false;
          }
        }}
      >
        {!isDeleted && mine && m.botName && (
          <p className="mb-1 text-[10px] font-semibold opacity-80">🤖 {m.botName}</p>
        )}
        {!isDeleted && (m as unknown as { forwarded?: boolean }).forwarded && (
          <p className={cn("mb-1 flex items-center gap-1 text-[10px] italic", mine ? "opacity-80" : "text-muted-foreground")}>
            <FontAwesomeIcon icon={faShare} className="h-2.5 w-2.5" /> Forwarded
          </p>
        )}
        {!isDeleted && m.replyToBody && (
          <ReplyQuote text={m.replyToBody} type={m.replyToType} mine={mine} />
        )}
        {isDeleted ? (
          <p className="flex items-center gap-1.5 whitespace-pre-wrap break-words text-xs">
            <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
            This message was deleted
          </p>
        ) : (
          <MessageContent m={m} mine={mine} actions={actions} />
        )}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            mine ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          <span>{time}</span>
          {m.starred && (
            <FontAwesomeIcon
              icon={faStar}
              className={cn("h-2.5 w-2.5", mine ? "text-amber-200" : "text-amber-500")}
              title="Starred"
            />
          )}
          {mine && <StatusIcon status={m.status} />}
        </div>
      </div>

      {/* Hover action bar */}
      {!isDeleted && actions && (
        <div
          className={cn(
            "absolute top-1/2 z-10 hidden -translate-y-1/2 items-center gap-1 rounded-full border border-border bg-card p-1 shadow-md group-hover:flex",
            mine ? "right-full mr-1.5" : "left-full ml-1.5",
          )}
        >
          {actions.onReact && (
            <button
              type="button"
              onClick={() => setReactOpen((v) => !v)}
              disabled={reactDisabled}
              title={reactDisabled ? "Waiting for send to complete…" : "React"}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted",
                reactDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
            >
              <FontAwesomeIcon icon={faFaceSmile} className="h-3.5 w-3.5" />
            </button>
          )}
          {actions.onReply && (
            <button
              type="button"
              onClick={() => actions.onReply?.(m)}
              title="Reply"
              className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <FontAwesomeIcon icon={faReply} className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="More"
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faEllipsisVertical} className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Reaction picker popover */}
      {reactOpen && actions?.onReact && (
        <div
          className={cn(
            "absolute z-20 flex gap-1 rounded-full border border-border bg-card px-2 py-1 shadow-md",
            "bottom-full mb-1",
            mine ? "right-0" : "left-0",
          )}
        >
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                actions.onReact?.(m, e);
                setReactOpen(false);
              }}
              className="rounded-full px-1.5 py-0.5 text-base transition-transform hover:scale-125"
            >
              {e}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setReactOpen(false);
              setFullPickerOpen(true);
            }}
            className="rounded-full px-1.5 py-0.5 text-base text-muted-foreground transition-transform hover:scale-125"
            aria-label="More emojis"
          >
            ➕
          </button>
        </div>
      )}

      {fullPickerOpen && actions?.onReact && (
        <div
          className={cn(
            "absolute z-30",
            "bottom-full mb-1",
            mine ? "right-0" : "left-0",
          )}
          onMouseLeave={() => setFullPickerOpen(false)}
        >
          <ReactionEmojiPickerLazy
            onSelect={(emoji) => {
              actions.onReact?.(m, emoji);
              setFullPickerOpen(false);
            }}
          />
        </div>
      )}

      {/* Dropdown menu */}
      {menuOpen && (
        <div
          className={cn(
            "absolute z-20 min-w-[140px] rounded-lg border border-border bg-card p-1 text-sm shadow-md",
            "top-full mt-1",
            mine ? "right-0" : "left-0",
          )}
          onMouseLeave={() => setMenuOpen(false)}
        >
          {(m.body || m.caption || m.buttonReplyText || m.locationName) && (
            <button
              type="button"
              onClick={copy}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <FontAwesomeIcon icon={faCopy} className="h-3.5 w-3.5" /> Copy
            </button>
          )}
          {mine && m.status === "failed" && actions?.onResend && (
            <button
              type="button"
              onClick={() => {
                actions.onResend?.(m);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-orange-600 hover:bg-orange-500/10"
            >
              <FontAwesomeIcon icon={faRotateRight} className="h-3.5 w-3.5" /> Resend
            </button>
          )}
          {mine && m.status === "failed" && (
            <button
              type="button"
              onClick={() => {
                setErrorOpen(true);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            >
              <FontAwesomeIcon icon={faCircleExclamation} className="h-3.5 w-3.5" /> View error
            </button>
          )}
          {actions?.onForward && (
            <button
              type="button"
              onClick={() => {
                actions.onForward?.(m);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <FontAwesomeIcon icon={faShare} className="h-3.5 w-3.5" /> Forward
            </button>
          )}
          {actions?.onToggleStar && (
            <button
              type="button"
              onClick={() => {
                actions.onToggleStar?.(m);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <FontAwesomeIcon
                icon={faStar}
                className={cn("h-3.5 w-3.5", m.starred && "text-amber-500")}
              />{" "}
              {m.starred ? "Unstar" : "Star"}
            </button>
          )}
          {m.mediaUrl && (
            <button
              type="button"
              onClick={() => {
                void downloadAttachment(m.mediaUrl!, m.fileName, m.mimeType);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <FontAwesomeIcon icon={faDownload} className="h-3.5 w-3.5" /> Download
            </button>
          )}
          {actions?.onDelete && (
            <button
              type="button"
              onClick={() => {
                actions.onDelete?.(m);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            >
              <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      )}

      {/* Error detail popup for failed outgoing messages */}
      {errorOpen && (
        <div
          className={cn(
            "absolute z-30 w-64 rounded-lg border border-destructive/40 bg-card p-3 text-xs shadow-md",
            "top-full mt-1",
            mine ? "right-0" : "left-0",
          )}
        >
          <div className="flex items-center gap-2 text-destructive">
            <FontAwesomeIcon icon={faCircleExclamation} className="h-3.5 w-3.5" />
            <p className="font-semibold">Send failed</p>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-muted-foreground">
            {m.errorReason || "No error detail was returned by WhatsApp."}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            {actions?.onResend && (
              <button
                type="button"
                onClick={() => {
                  actions.onResend?.(m);
                  setErrorOpen(false);
                }}
                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={() => setErrorOpen(false)}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
            >
              Close
            </button>
          </div>
        </div>
      )}
      </div>
      {!isDeleted && m.reactionEmoji && (
        <span className="-mt-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs shadow-soft">
          {m.reactionEmoji}
        </span>
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl, (prev, next) => {
  // Fast path — same message reference and same actions object means
  // nothing meaningful changed. Callers memoize `actions` via useMemo
  // in inbox.$phone.tsx, so this is stable across renders.
  return prev.m === next.m && prev.actions === next.actions;
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// WhatsApp voice notes are ogg/opus. Declare MIME via <source> so browsers
// pick the right decoder, and offer a download fallback on decode errors.
function VoiceNote({ url, mime }: { url: string; mime?: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [errored, setErrored] = useState(false);

  // WhatsApp voice notes are ogg/opus. If the browser doesn't advertise
  // support (Safari desktop < 17, older iOS), fail fast to the download
  // fallback instead of showing a dead player.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.createElement("audio");
    const primary = mime || "audio/ogg";
    // canPlayType returns "probably" | "maybe" | "".
    const ok =
      probe.canPlayType(primary) ||
      probe.canPlayType("audio/ogg; codecs=opus") ||
      probe.canPlayType("audio/mpeg");
    if (!ok) setErrored(true);
  }, [mime]);

  function fmt(sec: number): string {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      // Pause any other <audio> currently playing in the DOM so voice notes
      // don't overlap (mimics WhatsApp).
      document.querySelectorAll("audio").forEach((a) => {
        if (a !== el && !a.paused) a.pause();
      });
      void el.play().catch(() => setErrored(true));
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * duration;
    setCurrentTime(el.currentTime);
  }

  if (errored) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5 text-xs underline"
      >
        🎤 Download voice message
      </a>
    );
  }

  const pct = duration && duration > 0 ? (currentTime / duration) * 100 : 0;
  const shown = duration ? (playing || currentTime > 0 ? currentTime : duration) : 0;

  return (
    <div className="flex w-[260px] max-w-full items-center gap-2 rounded-full bg-muted/60 px-2 py-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
      >
        <FontAwesomeIcon icon={playing ? faPause : faPlay} className="h-3 w-3 pl-[1px]" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          onClick={seek}
          className="relative h-1.5 w-full cursor-pointer rounded-full bg-foreground/15"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-100"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums opacity-70">{fmt(shown)}</span>
      </div>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d) && d > 0) setDuration(d);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setErrored(true)}
        className="hidden"
      />
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "read") return <FontAwesomeIcon icon={faCheckDouble} className="h-3 w-3" />;
  if (status === "delivered")
    return <FontAwesomeIcon icon={faCheckDouble} className="h-3 w-3 opacity-70" />;
  if (status === "failed")
    return <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />;
  if (status === "pending") return <FontAwesomeIcon icon={faClock} className="h-3 w-3" />;
  return <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />;
}

function ReplyQuote({
  text,
  type,
  mine,
}: {
  text: string;
  type?: string | null;
  mine: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-1.5 flex items-stretch gap-2 rounded-md px-2 py-1 text-[11px]",
        mine ? "bg-white/15" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "w-0.5 shrink-0 rounded-full",
          mine ? "bg-white/70" : "bg-primary",
        )}
      />
      <div className="min-w-0">
        {type && type !== "text" && (
          <p className="font-semibold opacity-80">[{type}]</p>
        )}
        <p className="line-clamp-2 break-words opacity-90">{text}</p>
      </div>
    </div>
  );
}

// Lazy-load emoji picker so its ~200KB bundle only ships when a user opens
// the "more emojis" reaction picker.
function ReactionEmojiPickerLazy({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{
    onEmojiClick: (e: { emoji: string }) => void;
    width?: number;
    height?: number;
    lazyLoadEmojis?: boolean;
  }> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("emoji-picker-react").then((m) => {
      if (!cancelled) setComp(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Comp) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-md">
        Loading emoji…
      </div>
    );
  }
  return (
    <Comp
      onEmojiClick={(e) => onSelect(e.emoji)}
      width={300}
      height={360}
      lazyLoadEmojis
    />
  );
}

function MessageContent({
  m,
  mine,
  actions,
}: {
  m: Message;
  mine: boolean;
  actions?: MessageActions;
}) {
  // Track per-message media failure locally so a broken proxy URL doesn't
  // silently show as a blank/broken bubble — we surface a download link
  // instead. Also used for <video>.
  const [mediaFailed, setMediaFailed] = useState(false);
  // P11 fix — was `const Media = () => …`, a fresh component identity
  // on every render caused React to remount the media subtree on every
  // parent state change (mediaFailed, menuOpen, star toggle). Rendering
  // JSX to a variable keeps the DOM stable.
  const media: React.ReactNode = m.mediaUrl ? (
      <div className="mb-1 overflow-hidden rounded-md">
        {mediaFailed ? (
          <MediaFallback m={m} mine={mine} />
        ) : m.mimeType?.startsWith("image/") || m.type === "sticker" || m.type === "image" ? (
          <button
            type="button"
            onClick={() => actions?.onOpenMedia?.(m)}
            className="block w-full cursor-zoom-in overflow-hidden rounded-md"
            aria-label="Open image"
          >
            <img
              src={m.mediaUrl}
              alt={m.caption ?? "image"}
              className={cn(
                "w-auto rounded-md",
                m.type === "sticker" ? "max-h-32" : "max-h-64",
              )}
              loading="lazy"
              onError={() => setMediaFailed(true)}
            />
          </button>
        ) : m.mimeType?.startsWith("audio/") || m.type === "audio" ? (
          <VoiceNote url={m.mediaUrl} mime={m.mimeType} />
        ) : m.mimeType?.startsWith("video/") || m.type === "video" ? (
          <VideoThumb
            url={m.mediaUrl}
            mime={m.mimeType}
            onOpen={() => actions?.onOpenMedia?.(m)}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <DocumentCard m={m} mine={mine} />
        )}
      </div>
    ) : m.mediaId ? (
      // mediaId present but no URL — extremely rare after the useMessages
      // synthesis fix, but keep a lightweight loading state as a safety net.
      <div className="mb-1 flex h-24 w-64 max-w-full items-center justify-center rounded-md bg-muted/40 text-xs italic opacity-70">
        Loading media…
      </div>
    ) : null;

  const TextBody = ({ value }: { value: string }) =>
    value ? (
      <>
        <p className="whitespace-pre-wrap break-words">
          <Linkify options={linkifyOpts}>{value}</Linkify>
        </p>
        <LinkPreview text={value} mine={mine} />
      </>
    ) : null;

  // Authentication / OTP detection — show large copyable code.
  const detectedOtp = m.otpCode ?? detectOtpCode(m.body, m.templateName);
  if (detectedOtp || (m.templateName && /otp|auth|verif/i.test(m.templateName))) {
    const code = detectedOtp ?? "";
    return (
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold opacity-80">
          <FontAwesomeIcon icon={faKey} className="h-3 w-3" /> Verification code
        </p>
        <TextBody value={m.body} />
        {code && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              toast.success(`Copied ${code}`);
            }}
            className={cn(
              "mt-1.5 inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-base tracking-widest",
              mine ? "bg-white/20" : "bg-muted",
            )}
          >
            {code} <FontAwesomeIcon icon={faCopy} className="h-3 w-3 opacity-70" />
          </button>
        )}
      </div>
    );
  }

  switch (m.type) {
    case "text":
      return <TextBody value={m.body} />;

    case "image":
    case "video":
    case "audio":
    case "sticker":
      return (
        <>
          {media}
          <TextBody value={m.caption || cleanBody(m.body)} />
        </>
      );

    case "document":
      return (
        <>
          {media}
          <TextBody value={m.caption || cleanBody(m.body)} />
        </>
      );

    case "location": {
      const lat = m.latitude;
      const lng = m.longitude;
      const hasCoords = typeof lat === "number" && typeof lng === "number";
      const href = hasCoords
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : null;
      return (
        <div>
          {hasCoords && (
            <a
              href={href!}
              target="_blank"
              rel="noreferrer"
              className="mb-2 block overflow-hidden rounded-md border border-border/40"
              aria-label="Open map"
            >
              <iframe
                title="Location map"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.003},${lng + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lng}`}
                className="pointer-events-none h-40 w-full"
                loading="lazy"
              />
            </a>
          )}
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <FontAwesomeIcon icon={faLocationDot} className="h-3.5 w-3.5" />
            {m.locationName || "Location"}
          </p>
          {m.locationAddress && (
            <p className="text-xs opacity-90">{m.locationAddress}</p>
          )}
          {hasCoords && (
            <p className="text-[11px] opacity-75">
              {lat!.toFixed(5)}, {lng!.toFixed(5)}
            </p>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs underline"
            >
              Open in Maps
            </a>
          )}
        </div>
      );
    }

    case "contacts": {
      const list = m.contactsPayload ?? [];
      return (
        <div>
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <FontAwesomeIcon icon={faAddressCard} className="h-3.5 w-3.5" />
            Contact{list.length > 1 ? "s" : ""}
          </p>
          {list.length > 0 ? (
            list.map((c, i) => <ContactCard key={i} raw={c} mine={mine} />)
          ) : (
            <p className="text-xs opacity-80">
              {cleanBody(m.body) || "Shared contact — open on phone for full details"}
            </p>
          )}
        </div>
      );
    }

    case "button":
    case "interactive": {
      const label = m.buttonReplyText || m.body || "Reply";
      if (m.interactiveType === "nfm_reply" && m.flowResponse) {
        return <FlowResponseCard m={m} mine={mine} />;
      }
      return (
        <div>
          <p className="text-[11px] font-semibold opacity-80">
            🔘 {m.interactiveType || m.type}
          </p>
          <TextBody value={label} />
          {m.ctaUrl && (
            <a
              href={m.ctaUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs underline"
            >
              <FontAwesomeIcon icon={faShareNodes} className="h-3 w-3" />
              {m.ctaUrl}
            </a>
          )}
        </div>
      );
    }

    case "template":
      return (
        <div>
          {m.headerText && (
            <p className="mb-1 text-xs font-semibold opacity-80">{m.headerText}</p>
          )}
          <TextBody value={m.body} />
          {m.footerText && (
            <p className="mt-1 text-[11px] opacity-70">{m.footerText}</p>
          )}
        </div>
      );

    case "order":
      return <OrderCard m={m} mine={mine} />;

    case "poll":
    case "poll_response":
      return (
        <div>
          <p className="mb-1 text-[11px] font-semibold opacity-80">📊 Poll</p>
          <TextBody value={cleanBody(m.body) || "Poll received"} />
        </div>
      );

    case "event":
      return (
        <div>
          <p className="mb-1 text-[11px] font-semibold opacity-80">📅 Event</p>
          <TextBody value={cleanBody(m.body) || "Event received"} />
        </div>
      );

    case "system":
    case "ephemeral":
    case "request_welcome":
    case "referral":
      return <TextBody value={m.body || `[${m.type}]`} />;

    case "unsupported":
      return (
        <p className="flex items-center gap-1.5 text-xs italic opacity-80">
          <FontAwesomeIcon icon={faCircleQuestion} className="h-3 w-3" />
          {cleanBody(m.body) || "WhatsApp message"}
        </p>
      );

    default:
      // Never blank — fall back to whatever payload we have.
      return (
        <>
          {media}
          {cleanBody(m.body) ? (
            <TextBody value={cleanBody(m.body)} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs italic opacity-70">
              <FontAwesomeIcon icon={faCircleQuestion} className="h-3 w-3" />
              {`[${m.type || "message"}]`}
            </p>
          )}
        </>
      );
  }
}

function VideoThumb({
  url,
  mime,
  onOpen,
  onError,
}: {
  url: string;
  mime?: string | null;
  onOpen?: () => void;
  onError?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/vid relative block w-full cursor-pointer overflow-hidden rounded-md bg-black/60"
      aria-label="Open video"
    >
      <video
        src={url}
        preload="metadata"
        muted
        playsInline
        className="max-h-64 w-full object-cover"
        onError={onError}
      >
        {mime && <source src={url} type={mime} />}
      </video>
      <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-90 transition-opacity group-hover/vid:bg-black/40">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-black shadow-md">
          <FontAwesomeIcon icon={faPlay} className="h-4 w-4 pl-0.5" />
        </span>
      </span>
    </button>
  );
}

/// Fallback shown when an <img>/<video> fails to load (proxy 401/502,
/// network dropout). Gives the user a way to retry or open the raw file.
function MediaFallback({ m, mine }: { m: Message; mine: boolean }) {
  if (!m.mediaUrl) return null;
  const label =
    m.type === "video" || m.mimeType?.startsWith("video/")
      ? "Video unavailable"
      : m.type === "audio" || m.mimeType?.startsWith("audio/")
        ? "Voice message unavailable"
        : "Image unavailable";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-xs",
        mine ? "bg-white/15" : "bg-muted/60",
      )}
    >
      <FontAwesomeIcon icon={faTriangleExclamation} className="h-3.5 w-3.5 opacity-80" />
      <span className="min-w-0 flex-1 truncate opacity-90">{label}</span>
      <button
        type="button"
        onClick={() => void downloadAttachment(m.mediaUrl!, m.fileName, m.mimeType)}
        className={cn(
          "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
          mine ? "bg-white/25 hover:bg-white/35" : "bg-background hover:bg-muted",
        )}
      >
        Download
      </button>
    </div>
  );
}

function LinkPreview({ text, mine }: { text: string; mine: boolean }) {
  const url = firstUrl(text);
  if (!url) return null;
  const label = hostLabel(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-2 flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-xs no-underline transition-colors",
        mine
          ? "border-white/20 bg-white/15 text-primary-foreground hover:bg-white/25"
          : "border-border bg-muted/60 text-card-foreground hover:bg-muted",
      )}
    >
      <FontAwesomeIcon icon={faUpRightFromSquare} className="h-3 w-3 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </a>
  );
}

function docIconFor(mime?: string | null, name?: string | null) {
  const s = `${mime ?? ""} ${name ?? ""}`.toLowerCase();
  if (s.includes("pdf")) return { icon: faFilePdf, color: "text-red-500" };
  if (/(docx?|msword|officedocument\.wordprocessing)/.test(s))
    return { icon: faFileWord, color: "text-blue-600" };
  if (/(xlsx?|excel|spreadsheet)/.test(s)) return { icon: faFileExcel, color: "text-green-600" };
  if (/(pptx?|powerpoint|presentation)/.test(s))
    return { icon: faFilePowerpoint, color: "text-orange-500" };
  if (/(zip|rar|7z|tar|gz)/.test(s)) return { icon: faFileZipper, color: "text-yellow-600" };
  if (s.startsWith("audio") || /(mp3|wav|ogg|m4a)/.test(s))
    return { icon: faFileAudio, color: "text-pink-500" };
  if (s.startsWith("video") || /(mp4|mov|avi|mkv)/.test(s))
    return { icon: faFileVideo, color: "text-purple-500" };
  if (s.startsWith("image") || /(jpe?g|png|webp|gif|bmp|svg)/.test(s))
    return { icon: faFileImage, color: "text-indigo-500" };
  if (/(txt|md|log|csv|json|xml|html?)/.test(s))
    return { icon: faFileLines, color: "text-slate-500" };
  return { icon: faFile, color: "text-slate-500" };
}

function DocumentCard({ m, mine }: { m: Message; mine: boolean }) {
  if (!m.mediaUrl) return null;
  const meta = docIconFor(m.mimeType, m.fileName);
  const fileName = safeFileName(m.fileName, m.mimeType, "document");
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2",
        mine ? "bg-white/15" : "bg-muted/60",
      )}
    >
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-md bg-background/80",
          meta.color,
        )}
      >
        <FontAwesomeIcon icon={meta.icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{fileName}</p>
        <p className="text-[10px] opacity-70">
          {typeof m.fileSize === "number" && m.fileSize > 0 ? formatBytes(m.fileSize) : ""}
          {m.mimeType ? ` · ${m.mimeType.split("/").pop()?.toUpperCase()}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void downloadAttachment(m.mediaUrl!, fileName, m.mimeType)}
        aria-label="Download"
        className={cn(
          "grid h-8 w-8 place-items-center rounded-full",
          mine ? "bg-white/20 hover:bg-white/30" : "bg-background hover:bg-muted",
        )}
      >
        <FontAwesomeIcon icon={faDownload} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ContactCard({ raw, mine }: { raw: Record<string, unknown>; mine: boolean }) {
  const nameObj = (raw.name as Record<string, unknown> | undefined) ?? null;
  const name =
    (nameObj?.formatted_name as string | undefined) ??
    (raw.formatted_name as string | undefined) ??
    "Contact";
  const phones = Array.isArray(raw.phones)
    ? (raw.phones as Array<{ phone?: string; wa_id?: string; type?: string }>)
    : [];
  const first = phones[0]?.phone || phones[0]?.wa_id || "";
  const waId = phones[0]?.wa_id || first.replace(/[^0-9]/g, "");
  const emails = Array.isArray(raw.emails)
    ? (raw.emails as Array<{ email?: string; type?: string }>)
    : [];
  const vcard = () => {
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${name}`,
      ...phones
        .map((p) => (p.phone || p.wa_id ? `TEL;TYPE=${p.type ?? "CELL"}:${p.phone || p.wa_id}` : ""))
        .filter(Boolean),
      ...emails
        .map((e) => (e.email ? `EMAIL;TYPE=${e.type ?? "INTERNET"}:${e.email}` : ""))
        .filter(Boolean),
      "END:VCARD",
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/vcard" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^A-Za-z0-9]+/g, "_") || "contact"}.vcf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const initials = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <div
      className={cn(
        "mt-1 flex flex-col gap-2 rounded-md p-2",
        mine ? "bg-white/15" : "bg-muted/60",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-full text-xs font-semibold",
            mine ? "bg-white/25 text-white" : "bg-primary/15 text-primary",
          )}
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          {phones.map((p, i) => (
            <p key={i} className="truncate text-[11px] opacity-80">
              {p.phone || p.wa_id}
            </p>
          ))}
          {emails.map((e, i) => (
            <p key={`e-${i}`} className="truncate text-[11px] opacity-80">
              {e.email}
            </p>
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        {waId && (
          <a
            href={`https://wa.me/${waId.replace(/[^0-9]/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
              mine ? "bg-white/25 hover:bg-white/35" : "bg-background hover:bg-muted",
            )}
          >
            <FontAwesomeIcon icon={faShareNodes} className="h-3 w-3" /> Message
          </a>
        )}
        {first && (
          <a
            href={`tel:${first}`}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
              mine ? "bg-white/25 hover:bg-white/35" : "bg-background hover:bg-muted",
            )}
          >
            <FontAwesomeIcon icon={faPhone} className="h-3 w-3" /> Call
          </a>
        )}
        <button
          type="button"
          onClick={vcard}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
            mine ? "bg-white/25 hover:bg-white/35" : "bg-background hover:bg-muted",
          )}
        >
          <FontAwesomeIcon icon={faUserPlus} className="h-3 w-3" /> Save
        </button>
      </div>
    </div>
  );
}

function fmtMoney(amount: number, currency?: string | null): string {
  const n = amount.toFixed(2);
  return currency ? `${n} ${currency}` : n;
}

/**
 * Structured WhatsApp catalog order (from webhook `case 'order'`). Renders a
 * receipt-style card with line items and total. Falls back to the message
 * body when the webhook didn't populate `orderItems` (older messages).
 */
function OrderCard({ m, mine }: { m: Message; mine: boolean }) {
  const items = m.orderItems ?? [];
  if (items.length === 0) {
    return (
      <p className="whitespace-pre-wrap break-words">
        {m.body || "🛒 Order received"}
      </p>
    );
  }
  const total = m.orderTotal ?? items.reduce((s, it) => s + (it.lineTotal || 0), 0);
  const currency = m.orderCurrency ?? items.find((it) => it.currency)?.currency ?? "";
  return (
    <div className="min-w-[220px]">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <FontAwesomeIcon icon={faBagShopping} className="h-3.5 w-3.5" />
        Order · {items.length} item{items.length === 1 ? "" : "s"}
      </p>
      <ul
        className={cn(
          "mb-1.5 space-y-1 rounded-md p-2 text-[12px]",
          mine ? "bg-white/15" : "bg-muted/60",
        )}
      >
        {items.slice(0, 6).map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate">
              <span className="opacity-70">{it.quantity}× </span>
              <span className="font-mono">{it.productRetailerId}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {fmtMoney(it.lineTotal, it.currency || currency)}
            </span>
          </li>
        ))}
        {items.length > 6 && (
          <li className="text-[11px] italic opacity-70">
            +{items.length - 6} more
          </li>
        )}
      </ul>
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{fmtMoney(total, currency)}</span>
      </div>
      {m.orderNote && (
        <p className="mt-1 whitespace-pre-wrap text-[12px] opacity-80">
          {m.orderNote}
        </p>
      )}
    </div>
  );
}

/**
 * WhatsApp Flow submission (interactive.nfm_reply). The webhook decodes
 * `response_json` into `flowResponse`; we render each key/value pair as a
 * neat two-column grid so agents can read submitted form data quickly.
 */
function FlowResponseCard({ m, mine }: { m: Message; mine: boolean }) {
  const resp = m.flowResponse ?? {};
  const entries = Object.entries(resp);
  return (
    <div className="min-w-[220px]">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <FontAwesomeIcon icon={faClipboardList} className="h-3.5 w-3.5" />
        Form submission
      </p>
      {entries.length === 0 ? (
        <p className="text-[12px] italic opacity-80">Empty submission</p>
      ) : (
        <dl
          className={cn(
            "grid gap-x-2 gap-y-1 rounded-md p-2 text-[12px]",
            mine ? "bg-white/15" : "bg-muted/60",
          )}
          style={{ gridTemplateColumns: "auto 1fr" }}
        >
          {entries.slice(0, 12).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate font-medium opacity-70">{k}</dt>
              <dd className="min-w-0 truncate break-words">
                {v === null || v === undefined
                  ? "—"
                  : typeof v === "object"
                    ? JSON.stringify(v)
                    : String(v)}
              </dd>
            </div>
          ))}
          {entries.length > 12 && (
            <div className="col-span-2 text-[11px] italic opacity-70">
              +{entries.length - 12} more fields
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
