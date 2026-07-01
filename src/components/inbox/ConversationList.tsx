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
import { useState, useMemo, useEffect } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates, str, toIso } from "@/lib/firebase/normalizers";
import { useConversations, type Conversation } from "@/hooks/useConversations";
import { useContacts, type Contact } from "@/hooks/useContacts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { cn } from "@/lib/utils";

// Session-scoped cache so switching between conversations doesn't refetch
// the same last-message preview repeatedly.
const previewCache = new Map<string, { body: string; type: string; at: string | null } | null>();

export function ConversationList({ activePhone }: { activePhone?: string }) {
  const { data, error } = useConversations();
  const { data: contacts } = useContacts();
  const [q, setQ] = useState("");
  // Build a phone → Contact lookup so a saved name/photo wins over a stale
  // conversation doc that still shows the raw phone.
  const byPhone = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts ?? []) {
      if (!c.phone) continue;
      const digits = c.phone.replace(/[^0-9]/g, "");
      m.set(c.phone, c);
      m.set(digits, c);
      m.set(`+${digits}`, c);
    }
    return m;
  }, [contacts]);
  const merged = useMemo(() => {
    if (!data) return data;
    return data.map((conv) => {
      const convDigits = conv.contactPhone.replace(/[^0-9]/g, "");
      const ct = byPhone.get(conv.contactPhone) ?? byPhone.get(convDigits) ?? byPhone.get(`+${convDigits}`);
      if (!ct) return conv;
      const looksLikePhone =
        !conv.contactName ||
        conv.contactName === conv.contactPhone ||
        /^\+?\d[\d\s\-()]+$/.test(conv.contactName);
      return {
        ...conv,
        contactName: looksLikePhone && ct.name ? ct.name : conv.contactName,
        profileImageUrl: ct.profileImageUrl || conv.profileImageUrl || null,
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
  const fallback = useLastMessageFallback(
    c.contactPhone,
    !((c.lastMessage || "").trim()),
  );
  const bodyForPreview = (c.lastMessage || "").trim() || fallback?.body || "";
  const typeForPreview = (c.lastMessage || "").trim() ? c.lastMessageType : fallback?.type ?? c.lastMessageType;
  const when = formatConvTime(c.lastMessageAt || fallback?.at || null);
  const preview = formatPreview(bodyForPreview, typeForPreview);
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
          <p className="truncate text-xs text-muted-foreground">
            {preview}
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

/**
 * Legacy conversations (written before the webhook started persisting a
 * descriptive `lastMessage`) show "No preview" in the list. Fetch the most
 * recent message once per phone and derive a preview from it so the row
 * always shows something meaningful.
 */
function useLastMessageFallback(
  phone: string,
  enabled: boolean,
): { body: string; type: string; at: string | null } | null {
  const uid = useEffectiveUid();
  const [state, setState] = useState<{ body: string; type: string; at: string | null } | null>(
    () => previewCache.get(phone) ?? null,
  );

  useEffect(() => {
    if (!enabled || !uid) return;
    if (previewCache.has(phone)) {
      setState(previewCache.get(phone) ?? null);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    void (async () => {
      try {
        const candidates = phoneQueryCandidates(phone);
        const q = query(
          collection(db, `users/${uid}/messages`),
          candidates.length === 1
            ? where("contactPhone", "==", candidates[0])
            : where("contactPhone", "in", candidates),
          orderBy("createdAt", "desc"),
          limit(1),
        );
        const snap = await getDocs(q);
        const doc = snap.docs[0];
        if (!doc) {
          previewCache.set(phone, null);
          if (!cancelled) setState(null);
          return;
        }
        const d = doc.data() as Record<string, unknown>;
        const body =
          str(d.body) ||
          str(d.caption) ||
          str(d.fileName) ||
          "";
        const type = str(d.type, "text");
        const at = toIso(d.createdAt);
        const value = { body, type, at };
        previewCache.set(phone, value);
        if (!cancelled) setState(value);
      } catch {
        // Firestore may reject the `in` query if candidates > 30 or the
        // orderBy needs an index. Fail silent — row keeps "No preview".
        if (!cancelled) setState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, uid, phone]);

  return state;
}

function formatPreview(body: string | null | undefined, type: string | null | undefined): string {
  const t = (type || "").toLowerCase();
  let text = (body || "").trim();
  const normalized = text
    .toLowerCase()
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s:·-]+/u, "")
    .trim();
  // Strip webhook placeholder bodies so the list doesn't say "📷 [image]"
  // or show legacy "Message type unknown" text next to a real type icon.
  const low = normalized || text.toLowerCase();
  if (
    /^\[[a-z_ ]+\]$/i.test(low) ||
    low === "message type unknown" ||
    low === "message not supported" ||
    low === "message not supported in whatsapp business" ||
    low === "contact shared" ||
    low === "📇 contact shared"
  ) {
    text = "";
  }
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
    unsupported: "⚠️ Unsupported message",
    poll: "📊 Poll",
    event: "📅 Event",
  };
  const tag = tagMap[t];
  if (tag && text) {
    const tagIcon = tag.split(" ")[0];
    const tagLabel = tag.slice(tagIcon.length).trim().toLowerCase();
    if (low === tagLabel || text.startsWith(tagIcon)) return text;
    return `${tagIcon} ${text}`;
  }
  if (tag && !text) return tag;
  return text || "No preview";
}
