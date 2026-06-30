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
} from "@fortawesome/free-solid-svg-icons";
import type { Message } from "@/hooks/useMessages";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const linkifyOpts = {
  target: "_blank",
  rel: "noopener noreferrer",
  className: "underline underline-offset-2",
};

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type MessageActions = {
  onReply?: (m: Message) => void;
  onReact?: (m: Message, emoji: string) => void;
  onDelete?: (m: Message) => void;
};

export function MessageBubble({ m, actions }: { m: Message; actions?: MessageActions }) {
  const mine = m.direction === "outgoing";
  const time = m.createdAt ? format(new Date(m.createdAt), "p") : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
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
    if (!reactOpen && !menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setReactOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [reactOpen, menuOpen]);

  function copy() {
    const txt = m.body || m.caption || m.otpCode || "";
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
      >
        {!isDeleted && mine && m.botName && (
          <p className="mb-1 text-[10px] font-semibold opacity-80">🤖 {m.botName}</p>
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
          <MessageContent m={m} mine={mine} />
        )}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            mine ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          <span>{time}</span>
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
          {m.body && (
            <button
              type="button"
              onClick={copy}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <FontAwesomeIcon icon={faCopy} className="h-3.5 w-3.5" /> Copy
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
      </div>
      {!isDeleted && m.reactionEmoji && (
        <span className="-mt-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs shadow-soft">
          {m.reactionEmoji}
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// WhatsApp voice notes are ogg/opus. Declare MIME via <source> so browsers
// pick the right decoder, and offer a download fallback on decode errors.
function VoiceNote({ url, mime }: { url: string; mime?: string | null }) {
  const [errored, setErrored] = useState(false);
  const type = mime || "audio/ogg";
  if (errored) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs underline"
      >
        🎤 Download voice message
      </a>
    );
  }
  return (
    <audio
      controls
      preload="metadata"
      className="h-10 w-[260px] max-w-full"
      onError={() => setErrored(true)}
    >
      <source src={url} type={type} />
      <source src={url} type="audio/ogg" />
      <source src={url} type="audio/mpeg" />
    </audio>
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

function MessageContent({ m, mine }: { m: Message; mine: boolean }) {
  // Inline media renderer used by image/video/audio/document/sticker.
  const Media = () =>
    m.mediaUrl ? (
      <div className="mb-1 overflow-hidden rounded-md">
        {m.mimeType?.startsWith("image/") || m.type === "sticker" || m.type === "image" ? (
          <img
            src={m.mediaUrl}
            alt={m.caption ?? "image"}
            className={cn("w-auto rounded-md", m.type === "sticker" ? "max-h-32" : "max-h-64")}
            loading="lazy"
          />
        ) : m.mimeType?.startsWith("audio/") || m.type === "audio" ? (
          <VoiceNote url={m.mediaUrl} mime={m.mimeType} />
        ) : m.mimeType?.startsWith("video/") || m.type === "video" ? (
          <video controls src={m.mediaUrl} className="max-h-64 w-full rounded-md" />
        ) : (
          <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
            📄 {m.fileName ?? "Attachment"}
            {typeof m.fileSize === "number" && m.fileSize > 0 && (
              <span className="opacity-70">({formatBytes(m.fileSize)})</span>
            )}
          </a>
        )}
      </div>
    ) : null;

  const TextBody = ({ value }: { value: string }) =>
    value ? (
      <p className="whitespace-pre-wrap break-words">
        <Linkify options={linkifyOpts}>{value}</Linkify>
      </p>
    ) : null;

  // Authentication / OTP detection — show large copyable code.
  if (m.otpCode || (m.templateName && /otp|auth|verif/i.test(m.templateName))) {
    const code = m.otpCode ?? (m.body.match(/\b(\d{4,8})\b/)?.[1] ?? "");
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
          <Media />
          <TextBody value={m.caption || m.body} />
        </>
      );

    case "document":
      return (
        <>
          <Media />
          <TextBody value={m.caption || m.body} />
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
            list.map((c, i) => {
              const name =
                ((c.name as Record<string, unknown>)?.formatted_name as string | undefined) ??
                String(c.formatted_name ?? "Contact");
              const phones = Array.isArray(c.phones)
                ? (c.phones as Array<{ phone?: string; wa_id?: string }>)
                : [];
              return (
                <div key={i} className="text-xs opacity-90">
                  <p className="font-medium">{name}</p>
                  {phones.map((p, j) => (
                    <p key={j}>{p.phone || p.wa_id}</p>
                  ))}
                </div>
              );
            })
          ) : (
            <p className="text-xs opacity-80">{m.body || "Shared contact"}</p>
          )}
        </div>
      );
    }

    case "button":
    case "interactive": {
      const label = m.buttonReplyText || m.body || "Reply";
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
      return <TextBody value={m.body || "🛒 Order received"} />;

    case "system":
    case "ephemeral":
    case "request_welcome":
    case "referral":
      return <TextBody value={m.body || `[${m.type}]`} />;

    case "unsupported":
      return (
        <p className="flex items-center gap-1.5 text-xs italic opacity-80">
          <FontAwesomeIcon icon={faCircleQuestion} className="h-3 w-3" />
          {m.body || "Message not supported by WhatsApp Business"}
        </p>
      );

    default:
      // Never blank — fall back to whatever payload we have.
      return (
        <>
          <Media />
          {m.body ? (
            <TextBody value={m.body} />
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
