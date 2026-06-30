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
import { useState } from "react";
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

  function copy() {
    const txt = m.body || m.caption || m.otpCode || "";
    if (txt) void navigator.clipboard?.writeText(txt);
    setMenuOpen(false);
  }

  return (
    <div className={cn("group relative flex w-full flex-col", mine ? "items-end" : "items-start")}>
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
              title="React"
              className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
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
          {mine && actions?.onDelete && (
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

function StatusIcon({ status }: { status: string }) {
  if (status === "read") return <FontAwesomeIcon icon={faCheckDouble} className="h-3 w-3" />;
  if (status === "delivered")
    return <FontAwesomeIcon icon={faCheckDouble} className="h-3 w-3 opacity-70" />;
  if (status === "failed")
    return <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />;
  if (status === "pending") return <FontAwesomeIcon icon={faClock} className="h-3 w-3" />;
  return <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />;
}
