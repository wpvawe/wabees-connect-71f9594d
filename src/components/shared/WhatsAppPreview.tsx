import type React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPhone,
  faCheckDouble,
  faReply,
  faArrowUpRightFromSquare,
  faImage,
  faFileLines,
  faVideo,
} from "@fortawesome/free-solid-svg-icons";

export type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;

export function WhatsAppPreview({
  header,
  headerFormat,
  headerMediaUrl,
  body,
  footer,
  buttons,
  title = "WhatsApp preview",
  minHeight = 360,
}: {
  header: string | null;
  headerFormat: HeaderFormat;
  headerMediaUrl?: string | null;
  body: string;
  footer: string | null;
  buttons: Array<Record<string, unknown>>;
  title?: string;
  minHeight?: number;
}) {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-2 bg-[#075e54] px-4 py-3 text-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          W
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-[10px] opacity-80">online</p>
        </div>
        <FontAwesomeIcon icon={faPhone} className="h-3.5 w-3.5 opacity-90" />
      </div>
      <div
        className="px-3 py-4"
        style={{
          minHeight,
          backgroundColor: "#e5ddd5",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M0 20 L20 0 L40 20 L20 40 Z' fill='%23d9d1c7' fill-opacity='0.35'/></svg>\")",
        }}
      >
        <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#dcf8c6] p-2 shadow-sm">
          {headerFormat === "TEXT" && header && (
            <p className="mb-1.5 text-[14px] font-semibold leading-[1.35] text-[#111b21]">
              {header}
            </p>
          )}
          {headerFormat === "IMAGE" && (
            <MediaHeaderBox icon={faImage} label="Image" url={headerMediaUrl} />
          )}
          {headerFormat === "VIDEO" && (
            <MediaHeaderBox icon={faVideo} label="Video" url={headerMediaUrl} />
          )}
          {headerFormat === "DOCUMENT" && (
            <MediaHeaderBox icon={faFileLines} label="Document" url={headerMediaUrl} />
          )}
          <p className="whitespace-pre-wrap text-[14px] leading-[1.45] text-[#111b21]">
            {formatWhatsApp(body || "Message preview will appear here…")}
          </p>
          {footer && (
            <p className="mt-1.5 text-[12px] leading-[1.35] text-[#667781]">{footer}</p>
          )}
          <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
            <span>
              {hh}:{mm}
            </span>
            <FontAwesomeIcon icon={faCheckDouble} className="h-2.5 w-2.5 text-[#53bdeb]" />
          </div>
          {buttons && buttons.length > 0 && (
            <div className="-mx-2 -mb-2 mt-2 divide-y divide-black/10 border-t border-black/10">
              {buttons.map((b, i) => {
                const type = ((b.type as string) ?? "").toUpperCase();
                const text = (b.text as string) ?? "Button";
                const icon =
                  type === "URL"
                    ? faArrowUpRightFromSquare
                    : type === "PHONE_NUMBER"
                      ? faPhone
                      : faReply;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 text-[13px] font-medium leading-none text-[#00a5f4]"
                  >
                    <FontAwesomeIcon icon={icon} className="h-3 w-3" />
                    {text}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaHeaderBox({
  icon,
  label,
  url,
}: {
  icon: typeof faImage;
  label: string;
  url?: string | null;
}) {
  if (label === "Image" && url) {
    return (
      <img
        src={url}
        alt="header"
        className="mb-2 h-32 w-full rounded-md object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className="mb-2 flex h-24 w-full items-center justify-center gap-2 rounded-md bg-black/10 text-[11px] text-[#667781]">
      <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      {label}
      {url ? " attached" : " placeholder"}
    </div>
  );
}

/** Light WhatsApp formatting: *bold*, _italic_, ~strike~, `mono` */
export function formatWhatsApp(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    if (tok.startsWith("*")) parts.push(<strong key={key++}>{inner}</strong>);
    else if (tok.startsWith("_")) parts.push(<em key={key++}>{inner}</em>);
    else if (tok.startsWith("~"))
      parts.push(
        <span key={key++} style={{ textDecoration: "line-through" }}>
          {inner}
        </span>,
      );
    else parts.push(<code key={key++}>{inner}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}