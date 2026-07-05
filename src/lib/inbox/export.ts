import type { Message } from "@/hooks/useMessages";

/**
 * Chat export helpers — mirror WhatsApp's own "Export chat" format so the
 * file feels familiar (agents often forward these to compliance/legal).
 *
 * TXT: `[YYYY-MM-DD HH:MM] Sender: body`
 * CSV: RFC-4180-safe columns for spreadsheets.
 */

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function fmtTs(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function bodyFor(m: Message): string {
  if (m.status === "deleted" || m.body === "__DELETED__") return "<deleted>";
  if (m.type === "text") return m.body;
  if (m.type === "image") return `[image]${m.caption ? " " + m.caption : ""}`;
  if (m.type === "video") return `[video]${m.caption ? " " + m.caption : ""}`;
  if (m.type === "audio") return "[voice message]";
  if (m.type === "sticker") return "[sticker]";
  if (m.type === "document") return `[document${m.fileName ? " " + m.fileName : ""}]`;
  if (m.type === "location") return `[location${m.locationName ? " " + m.locationName : ""}]`;
  if (m.type === "contacts") return "[contact]";
  if (m.type === "template") return m.body || "[template]";
  if (m.type === "order") return m.body || "[order]";
  if (m.type === "interactive" || m.type === "button")
    return m.buttonReplyText || m.body || "[interactive]";
  return m.body || `[${m.type}]`;
}

export function exportChatTxt(
  messages: Message[],
  meta: { contactName: string; contactPhone: string },
): string {
  const header = [
    `WhatsApp Chat with ${meta.contactName}`,
    `Phone: ${meta.contactPhone}`,
    `Exported: ${fmtTs(new Date().toISOString())}`,
    `Messages: ${messages.length}`,
    "",
  ].join("\n");
  const lines = messages.map((m) => {
    const ts = fmtTs(m.createdAt);
    const who = m.direction === "outgoing" ? "You" : meta.contactName;
    return `[${ts}] ${who}: ${bodyFor(m).replace(/\n/g, " ").trim()}`;
  });
  return header + lines.join("\n") + "\n";
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportChatCsv(messages: Message[]): string {
  const header = [
    "timestamp",
    "direction",
    "sender",
    "type",
    "status",
    "body",
    "media_url",
    "wamid",
  ].join(",");
  const rows = messages.map((m) =>
    [
      fmtTs(m.createdAt),
      m.direction,
      m.direction === "outgoing" ? "You" : m.contactName,
      m.type,
      m.status,
      bodyFor(m),
      m.mediaUrl ?? "",
      m.whatsappMessageId ?? "",
    ]
      .map((v) => csvEscape(String(v ?? "")))
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}