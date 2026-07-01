import { Link } from "@tanstack/react-router";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faComments,
  faMagnifyingGlass,
  faThumbtack,
  faCheck,
  faCheckDouble,
  faClock,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { useState, useMemo } from "react";
import { useConversations, type Conversation } from "@/hooks/useConversations";
import { useContacts, type Contact } from "@/hooks/useContacts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { cn } from "@/lib/utils";

export function ConversationList({ activePhone }: { activePhone?: string }) {
  const { data, error } = useConversations();
  const { data: contacts } = useContacts();
  const [q, setQ] = useState("");
  // Build a phone → Contact lookup so a saved name/photo wins over a stale
  // conversation doc that still shows the raw phone.
  const byPhone = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts ?? []) {
      if (c.phone) m.set(c.phone, c);
    }
    return m;
  }, [contacts]);
  const merged = useMemo(() => {
    if (!data) return data;
    return data.map((conv) => {
      const ct = byPhone.get(conv.contactPhone);
      if (!ct) return conv;
      const looksLikePhone =
        !conv.contactName ||
        conv.contactName === conv.contactPhone ||
        /^\+?\d[\d\s\-()]+$/.test(conv.contactName);
      return {
        ...conv,
        contactName: looksLikePhone && ct.name ? ct.name : conv.contactName,
        profileImageUrl: conv.profileImageUrl ?? ct.profileImageUrl ?? null,
      };
    });
  }, [data, byPhone]);
  const filtered = useMemo(() => {
    if (!merged) return merged;
    if (!q.trim()) return merged;
    const needle = q.trim().toLowerCase();
    return merged.filter(
      (c) => c.contactName.toLowerCase().includes(needle) || c.contactPhone.includes(needle),
    );
  }, [merged, q]);

  return (
    <aside className="flex h-full w-full max-w-full flex-col border-r border-border bg-card md:max-w-sm">
      <div className="border-b border-border p-3">
        <div className="relative">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : filtered === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <WbEmpty
              icon={faComments}
              title={q ? "No matches" : "No conversations yet"}
              description={
                q ? undefined : "Incoming WhatsApp messages will appear here in realtime."
              }
            />
          </div>
        ) : (
          <ul>
            {filtered.map((c) => (
              <ConvRow key={c.contactPhone} c={c} active={c.contactPhone === activePhone} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ConvRow({ c, active }: { c: Conversation; active: boolean }) {
  const when = formatConvTime(c.lastMessageAt);
  const preview = formatPreview(c.lastMessage, c.lastMessageType);
  const displayName = c.contactName && c.contactName !== c.contactPhone ? c.contactName : "";
  const initials = (displayName || c.contactPhone).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <li>
      <Link
        to="/inbox/$phone"
        params={{ phone: c.contactPhone }}
        className={cn(
          "flex items-center gap-3 border-b border-border/60 px-3 py-3 transition-colors hover:bg-muted",
          active && "bg-accent/40",
        )}
      >
        <Avatar className="h-10 w-10 shrink-0">
          {c.profileImageUrl ? (
            <AvatarImage src={c.profileImageUrl} alt={displayName || c.contactPhone} />
          ) : null}
          <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {displayName || c.contactPhone}
            </p>
            <span
              className={cn(
                "shrink-0 text-[10px]",
                c.unreadCount > 0 ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {when}
            </span>
          </div>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            {displayName ? (
              <>
                <span className="opacity-70">{c.contactPhone} · </span>
                <span className="truncate">{preview}</span>
              </>
            ) : (
              <span className="truncate">{preview}</span>
            )}
          </p>
        </div>
        <div className="ml-1 flex shrink-0 flex-col items-end gap-1">
          {c.isPinned && (
            <FontAwesomeIcon
              icon={faThumbtack}
              className="h-3 w-3 rotate-45 text-muted-foreground"
              title="Pinned"
            />
          )}
          {c.unreadCount > 0 && (
            <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
              {c.unreadCount > 99 ? "99+" : c.unreadCount}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function formatConvTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  const days = differenceInDays(new Date(), d);
  if (days < 7) return format(d, "EEE");
  return format(d, "dd/MM/yy");
}

function formatPreview(body: string | null | undefined, type: string | null | undefined): string {
  const t = (type || "").toLowerCase();
  const text = (body || "").trim();
  const tagMap: Record<string, string> = {
    image: "📷 Photo",
    sticker: "💟 Sticker",
    video: "🎥 Video",
    audio: "🎤 Voice message",
    document: "📄 Document",
    location: "📍 Location",
    contacts: "👤 Contact",
    reaction: "❤️ Reaction",
    button: "🔘 Button reply",
    interactive: "🔘 Interactive",
    template: "📋 Template",
    order: "🛒 Order",
    system: "ℹ️ System",
    unsupported: "⚠️ Unsupported",
  };
  const tag = tagMap[t];
  if (tag && !text) return tag;
  if (tag && text) return `${tag.split(" ")[0]} ${text}`;
  return text || "—";
}
