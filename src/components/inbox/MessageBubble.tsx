import { format } from "date-fns";
import Linkify from "linkify-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCheckDouble,
  faClock,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import type { Message } from "@/hooks/useMessages";
import { cn } from "@/lib/utils";

const linkifyOpts = {
  target: "_blank",
  rel: "noopener noreferrer",
  className: "underline underline-offset-2",
};

export function MessageBubble({ m }: { m: Message }) {
  const mine = m.direction === "outgoing";
  const time = m.createdAt ? format(new Date(m.createdAt), "p") : "";
  return (
    <div className={cn("flex w-full flex-col", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-soft",
          mine
            ? "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground border border-border",
        )}
      >
        {mine && m.botName && (
          <p className="mb-1 text-[10px] font-semibold opacity-80">🤖 {m.botName}</p>
        )}
        {m.mediaUrl && (
          <div className="mb-1 overflow-hidden rounded-md">
            {m.mimeType?.startsWith("image/") ? (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt
              <img
                src={m.mediaUrl}
                alt={m.caption ?? "image"}
                className="max-h-64 w-auto"
                loading="lazy"
              />
            ) : (
              <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="underline">
                {m.fileName ?? "Attachment"}
                {typeof m.fileSize === "number" && m.fileSize > 0 && (
                  <span className="ml-1 opacity-70">({formatBytes(m.fileSize)})</span>
                )}
              </a>
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words">
          <Linkify options={linkifyOpts}>{m.body}</Linkify>
        </p>
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
      {m.reactionEmoji && (
        <span className="-mt-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-soft">
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
