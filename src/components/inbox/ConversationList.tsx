import { Link, useNavigate } from "@tanstack/react-router";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faComments,
  faMagnifyingGlass,
  faThumbtack,
  faMailBulk,
  faClock,
  faExclamation,
  faTag,
  faTrash,
  faXmark,
  faPlus,
  faPen,
  faUser,
  faUserSlash,
  faNoteSticky,
  faBan,
  faCircleCheck,
  faMoon,
  faFlag,
} from "@fortawesome/free-solid-svg-icons";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates, str, toIso } from "@/lib/firebase/normalizers";
import { useConversations, type Conversation } from "@/hooks/useConversations";
import { useContacts, type Contact } from "@/hooks/useContacts";
import { useConvTags } from "@/hooks/useConvTags";
import { useAgentRole } from "@/hooks/useAgentRole";
import { useMessageSearch } from "@/hooks/useMessageSearch";
import {
  togglePin,
  addTag,
  removeTag,
  deleteConversation,
  createTag,
  deleteTag,
  updateTag,
  setPriority,
  PRIORITY_META,
  type ConvPriority,
} from "@/lib/firebase/conversations";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useHotkeys } from "@/hooks/useHotkeys";
import { ShortcutsHelp } from "@/components/inbox/ShortcutsHelp";
import { BulkActionBar } from "@/components/inbox/BulkActionBar";
import {
  faCheck,
  faSquareCheck,
} from "@fortawesome/free-solid-svg-icons";

type Filter =
  | "all"
  | "unread"
  | "free"
  | "free_unread"
  | "mine"
  | "unassigned"
  | "resolved"
  | "priority";
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function isReplyWindowOpen(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Date.now() - t < REPLY_WINDOW_MS;
}

/**
 * A conversation counts as "free" when the customer has messaged within the
 * 24h window. Older webhook writes did not persist `lastIncomingMessageAt`,
 * so fall back to `lastMessageAt` for legacy rows.
 */
function isConvInFreeWindow(c: {
  lastIncomingMessageAt?: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}): boolean {
  if (c.lastIncomingMessageAt) return isReplyWindowOpen(c.lastIncomingMessageAt);
  return isReplyWindowOpen(c.lastMessageAt);
}

// Session-scoped cache so switching between conversations doesn't refetch
// the same last-message preview repeatedly.
const previewCache = new Map<string, { body: string; type: string; at: string | null } | null>();

export function ConversationList({ activePhone }: { activePhone?: string }) {
  const { data, error, hasMore, loadMore, loadingMore } = useConversations();
  const { data: contacts } = useContacts();
  const { data: tags } = useConvTags();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const role = useAgentRole();
  const isPrivileged = role === "owner" || role === "supervisor";
  const [q, setQ] = useState("");
  // Inbox-wide substring search across all messages the user can read.
  // Fires when the search box has 2+ chars; results appear in a
  // "Messages" section above the conversation list. Firestore has no
  // full-text index — see useMessageSearch for the fixed-window trade-off.
  const { hits: msgHits, loading: msgSearching } = useMessageSearch(q);
  const [filter, setFilter] = useState<Filter>("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Regular agents get scoped visibility by default (Mine + Unassigned).
  // Owners/supervisors keep the "All" default. Runs once when role resolves.
  useEffect(() => {
    if (role === "agent" && filter === "all") {
      setFilter("mine");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [incomingFallbacks, setIncomingFallbacks] = useState<Record<string, string | null>>({});
  const [menu, setMenu] = useState<{ phone: string; x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const selectedList = useMemo(() => Array.from(selection), [selection]);
  const toggleSelect = (phone: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };
  const clearSelection = () => {
    setSelection(new Set());
    setSelectMode(false);
  };
  const enterSelect = (phone?: string) => {
    setSelectMode(true);
    if (phone) {
      setSelection((prev) => {
        const next = new Set(prev);
        next.add(phone);
        return next;
      });
    }
  };
  const [tagDialog, setTagDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    id: string | null;
    originalName: string | null;
    applyPhone: string | null;
    name: string;
    color: string;
  }>({
    open: false,
    mode: "create",
    id: null,
    originalName: null,
    applyPhone: null,
    name: "",
    color: "#6366f1",
  });
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
    let rows = merged;
    if (selectedTag) {
      rows = rows.filter((c) => Array.isArray(c.tags) && c.tags.includes(selectedTag));
    }
    switch (filter) {
      case "unread":
        rows = rows.filter((c) => c.unreadCount > 0);
        break;
      case "free":
        rows = rows.filter((c) => isConvInFreeWindow({ ...c, lastIncomingMessageAt: incomingFallbacks[c.contactPhone] ?? c.lastIncomingMessageAt }));
        break;
      case "free_unread":
        rows = rows.filter(
          (c) => c.unreadCount > 0 && isConvInFreeWindow({ ...c, lastIncomingMessageAt: incomingFallbacks[c.contactPhone] ?? c.lastIncomingMessageAt }),
        );
        break;
      case "mine":
        rows = rows.filter((c) => selfUid && c.assignedAgentId === selfUid);
        break;
      case "unassigned":
        rows = rows.filter((c) => !c.assignedAgentId);
        break;
      case "resolved":
        rows = rows.filter((c) => c.state === "resolved");
        break;
      case "priority":
        rows = rows.filter((c) => c.priority === "urgent" || c.priority === "high");
        break;
    }
    // Hide resolved chats from every non-resolved view so the queue stays
    // focused on actionable conversations. Users can hit the "Resolved" chip
    // to bring them back.
    if (filter !== "resolved") {
      const nowIso = new Date(nowTick).toISOString();
      rows = rows.filter(
        (c) =>
          c.state !== "resolved" &&
          (c.state !== "snoozed" || (Boolean(c.snoozeUntil) && c.snoozeUntil! <= nowIso)),
      );
    }
    // Agents (non-privileged) only ever see Mine + Unassigned regardless of
    // which chip they pick — the Firestore rules enforce this too, but
    // filtering client-side avoids empty rows from other agents.
    if (role === "agent") {
      rows = rows.filter(
        (c) => !c.assignedAgentId || (selfUid && c.assignedAgentId === selfUid),
      );
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (c) => c.contactName.toLowerCase().includes(needle) || c.contactPhone.includes(needle),
      );
    }
    return rows;
  }, [merged, q, filter, selectedTag, incomingFallbacks, selfUid, role, nowTick]);

  // Keyboard nav: j/k moves through the visible list; Enter is implicit
  // because we navigate immediately. `/` focuses search, `?` opens help,
  // `Escape` clears the search box.
  useHotkeys(
    {
      j: () => {
        if (!filtered || filtered.length === 0) return;
        const idx = filtered.findIndex((c) => c.contactPhone === activePhone);
        const next = filtered[(idx + 1 + filtered.length) % filtered.length];
        if (next) {
          void navigate({ to: "/inbox/$phone", params: { phone: next.contactPhone } });
        }
      },
      k: () => {
        if (!filtered || filtered.length === 0) return;
        const idx = filtered.findIndex((c) => c.contactPhone === activePhone);
        const prev = filtered[(idx <= 0 ? filtered.length : idx) - 1];
        if (prev) {
          void navigate({ to: "/inbox/$phone", params: { phone: prev.contactPhone } });
        }
      },
      "/": () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      "?": () => setHelpOpen(true),
      Escape: () => {
        if (q) setQ("");
      },
    },
    [filtered, activePhone, q],
  );

  // Keep the highlighted row visible as the user pages through with j/k.
  useEffect(() => {
    if (!activePhone) return;
    const el = document.querySelector(
      `[data-conv-row="${CSS.escape(activePhone)}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activePhone]);

  useEffect(() => {
    if (!uid || !merged) return;
    const missing = merged
      .filter((c) => !c.lastIncomingMessageAt && incomingFallbacks[c.contactPhone] === undefined)
      .map((c) => c.contactPhone)
      .slice(0, 40);
    if (missing.length === 0) return;
    const db = fbDbOrNull();
    if (!db) return;
    let cancelled = false;
    void (async () => {
      const updates: Record<string, string | null> = {};
      await Promise.all(
        missing.map(async (phone) => {
          const candidates = phoneQueryCandidates(phone);
          let latest: string | null = null;
          for (const candidate of candidates) {
            try {
              const snap = await getDocs(
                query(
                  collection(db, `users/${uid}/messages`),
                  where("contactPhone", "==", candidate),
                  where("direction", "==", "incoming"),
                  orderBy("createdAt", "desc"),
                  limit(1),
                ),
              );
              const first = snap.docs[0]?.data() as Record<string, unknown> | undefined;
              const iso = first ? toIso(first.createdAt) : null;
              if (iso && (!latest || iso > latest)) latest = iso;
            } catch {
              try {
                const snap = await getDocs(
                  query(
                    collection(db, `users/${uid}/messages`),
                    where("contactPhone", "==", candidate),
                    where("direction", "==", "incoming"),
                    limit(25),
                  ),
                );
                for (const d of snap.docs) {
                  const iso = toIso((d.data() as Record<string, unknown>).createdAt);
                  if (iso && (!latest || iso > latest)) latest = iso;
                }
              } catch {
                /* keep legacy fallback */
              }
            }
          }
          updates[phone] = latest;
        }),
      );
      if (!cancelled && Object.keys(updates).length > 0) {
        setIncomingFallbacks((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, merged, incomingFallbacks]);

  // Close context menu on outside click / ESC.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      const menuEl = document.querySelector("[data-conv-context-menu]");
      // Ignore clicks inside the menu itself. Event targets can be Text/SVG
      // nodes (not just HTMLElements), so use DOM containment instead of
      // Element.closest; otherwise pointerdown can unmount the menu before the
      // button click fires.
      if (target && menuEl?.contains(target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  async function handlePin(phone: string) {
    if (!uid) return;
    try {
      const ok = await togglePin(uid, phone);
      if (!ok) toast.error("Maximum 3 conversations can be pinned");
      else toast.success("Pin updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not pin");
    }
  }

  async function handleAddTag(phone: string, tagName: string) {
    if (!uid) return;
    try {
      await addTag(uid, phone, tagName);
      toast.success("Tag added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add tag");
    }
  }

  async function handleRemoveTag(phone: string, tagName: string) {
    if (!uid) return;
    try {
      await removeTag(uid, phone, tagName);
      toast.success("Tag removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove tag");
    }
  }

  async function handleDelete(phone: string) {
    if (!uid) return;
    if (!confirm("Delete this conversation from your inbox? Messages will be removed from your side.")) return;
    try {
      await deleteConversation(uid, phone);
      toast.success("Conversation deleted");
    } catch {
      toast.error("Could not delete");
    }
  }

  async function handleSetPriority(phone: string, priority: ConvPriority) {
    if (!uid) return;
    try {
      await setPriority(uid, phone, priority);
      toast.success(`Priority: ${PRIORITY_META[priority].label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update priority");
    }
  }

  async function handleDeleteTag(tagId: string, tagName: string) {
    if (!uid) return;
    if (!confirm(`Delete tag "${tagName}"? It will be removed from all conversations.`)) return;
    try {
      await deleteTag(uid, tagId);
      if (selectedTag === tagName) setSelectedTag(null);
      toast.success("Tag deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete tag");
    }
  }

  function handleCreateTag(applyPhone?: string) {
    setTagDialog({
      open: true,
      mode: "create",
      id: null,
      originalName: null,
      applyPhone: applyPhone ?? null,
      name: "",
      color: "#6366f1",
    });
  }

  function handleEditTag(tag: { id: string; name: string; color: string }) {
    setTagDialog({
      open: true,
      mode: "edit",
      id: tag.id,
      originalName: tag.name,
      applyPhone: null,
      name: tag.name,
      color: tag.color || "#64748b",
    });
  }

  async function submitCreateTag() {
    if (!uid) return;
    const name = tagDialog.name.trim();
    if (!name) {
      toast.error("Tag name is required");
      return;
    }
    try {
      if (tagDialog.mode === "edit" && tagDialog.id) {
        await updateTag(uid, tagDialog.id, { name, color: tagDialog.color || "#64748b" });
        if (selectedTag === tagDialog.originalName) setSelectedTag(name);
        toast.success("Tag updated");
      } else {
        await createTag(uid, name, tagDialog.color || "#6366f1");
        if (tagDialog.applyPhone) await addTag(uid, tagDialog.applyPhone, name);
        toast.success(tagDialog.applyPhone ? "Tag created and added" : "Tag created");
      }
      setTagDialog({
        open: false,
        mode: "create",
        id: null,
        originalName: null,
        applyPhone: null,
        name: "",
        color: "#6366f1",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save tag");
    }
  }

  return (
    <aside className="flex h-full w-full max-w-full flex-col border-r border-border bg-card md:max-w-sm">
      <div className="border-b border-border p-3 space-y-2">
        <div className="relative">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            ref={searchRef}
            placeholder="Search chats  (press /)"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => {
              if (selectMode) clearSelection();
              else setSelectMode(true);
            }}
            title={selectMode ? "Exit select mode" : "Select multiple"}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              selectMode
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            <FontAwesomeIcon icon={faSquareCheck} className="h-2.5 w-2.5" />
            {selectMode ? `Selected ${selection.size}` : "Select"}
          </button>
          {isPrivileged && (
            <FilterChip
              icon={faMailBulk}
              label="All"
              active={filter === "all" && !selectedTag}
              color="hsl(var(--primary))"
              onClick={() => {
                setFilter("all");
                setSelectedTag(null);
              }}
            />
          )}
          <FilterChip
            icon={faUser}
            label="Mine"
            active={filter === "mine"}
            color="#0ea5e9"
            onClick={() => {
              setFilter(filter === "mine" ? "all" : "mine");
              setSelectedTag(null);
            }}
          />
          <FilterChip
            icon={faUserSlash}
            label="Unassigned"
            active={filter === "unassigned"}
            color="#64748b"
            onClick={() => {
              setFilter(filter === "unassigned" ? "all" : "unassigned");
              setSelectedTag(null);
            }}
          />
          <FilterChip
            icon={faExclamation}
            label="Unread"
            active={filter === "unread"}
            color="#f59e0b"
            onClick={() => {
              setFilter(filter === "unread" ? "all" : "unread");
              setSelectedTag(null);
            }}
          />
          <FilterChip
            icon={faClock}
            label="Free Chat"
            active={filter === "free"}
            color="#0284c7"
            onClick={() => {
              setFilter(filter === "free" ? "all" : "free");
              setSelectedTag(null);
            }}
          />
          <FilterChip
            icon={faExclamation}
            label="Free Unread"
            active={filter === "free_unread"}
            color="#e91e63"
            onClick={() => {
              setFilter(filter === "free_unread" ? "all" : "free_unread");
              setSelectedTag(null);
            }}
          />
          <FilterChip
            icon={faCircleCheck}
            label="Resolved"
            active={filter === "resolved"}
            color="#10b981"
            onClick={() => {
              setFilter(filter === "resolved" ? (isPrivileged ? "all" : "mine") : "resolved");
              setSelectedTag(null);
            }}
          />
          <FilterChip
            icon={faFlag}
            label="Priority"
            active={filter === "priority"}
            color="#dc2626"
            onClick={() => {
              setFilter(filter === "priority" ? (isPrivileged ? "all" : "mine") : "priority");
              setSelectedTag(null);
            }}
          />
          {(tags ?? []).map((t) => (
            <FilterChip
              key={t.id}
              label={t.name}
              color={t.color}
              icon={faTag}
              active={selectedTag === t.name}
              onClick={() => {
                setSelectedTag(selectedTag === t.name ? null : t.name);
                setFilter("all");
              }}
              onContextMenu={() => handleEditTag(t)}
            />
          ))}
          <button
            type="button"
            onClick={() => handleCreateTag()}
            title="Create tag"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {q.trim().length >= 2 && (
          <div className="border-b border-border bg-muted/30">
            <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Messages{msgSearching ? " · searching…" : ` · ${msgHits.length}`}</span>
              {msgHits.length >= 50 && <span>showing first 50</span>}
            </div>
            {msgHits.length === 0 && !msgSearching ? (
              <p className="px-3 pb-2 text-xs italic text-muted-foreground">
                No message text matches “{q.trim()}”.
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto">
                {msgHits.map((h) => (
                  <li key={h.id}>
                    <Link
                      to="/inbox/$phone"
                      params={{ phone: h.phone }}
                      className="block px-3 py-2 text-left hover:bg-muted/60"
                    >
                      <div className="mb-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate font-medium text-foreground">
                          {h.contactName}
                        </span>
                        <span className="opacity-70">·</span>
                        <span>
                          {h.direction === "outgoing" ? "You" : "Them"}
                        </span>
                        {h.createdAt && (
                          <span className="ml-auto shrink-0">
                            {format(new Date(h.createdAt), "d MMM")}
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-2 text-xs">
                        {highlight(h.body, q.trim())}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
              title={q || filter !== "all" || selectedTag ? "No matches" : "No conversations yet"}
              description={
                q || filter !== "all" || selectedTag
                  ? undefined
                  : "Incoming WhatsApp messages will appear here in realtime."
              }
            />
          </div>
        ) : (
          <ul>
            {selectMode && filtered && filtered.length > 0 && (
              <li className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    const all = filtered.map((c) => c.contactPhone);
                    const allSelected = all.every((p) => selection.has(p));
                    setSelection(allSelected ? new Set() : new Set(all));
                  }}
                  className="font-semibold text-primary hover:underline"
                >
                  {filtered.every((c) => selection.has(c.contactPhone))
                    ? "Deselect all"
                    : `Select all ${filtered.length}`}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </li>
            )}
            {filtered.map((c) => (
              <ConvRow
                key={c.contactPhone}
                c={c}
                active={c.contactPhone === activePhone}
                tagColors={tagColorMap(tags)}
                incomingFallbackAt={incomingFallbacks[c.contactPhone] ?? null}
                onContextMenu={(x, y) => setMenu({ phone: c.contactPhone, x, y })}
                selectMode={selectMode}
                selected={selection.has(c.contactPhone)}
                onToggleSelect={() => toggleSelect(c.contactPhone)}
                onLongPress={() => enterSelect(c.contactPhone)}
              />
            ))}
            {hasMore && (
              <li className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-soft hover:bg-muted disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Show more conversations"}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {selectMode && selection.size > 0 && merged && (
        <BulkActionBar
          selected={selectedList}
          conversations={merged}
          tags={tags ?? []}
          onClear={clearSelection}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          conv={merged?.find((c) => c.contactPhone === menu.phone) ?? null}
          tags={tags ?? []}
          onClose={() => setMenu(null)}
          onPin={() => handlePin(menu.phone)}
          onDelete={() => handleDelete(menu.phone)}
          onAddTag={(t) => handleAddTag(menu.phone, t)}
          onRemoveTag={(t) => handleRemoveTag(menu.phone, t)}
          onCreateTag={() => handleCreateTag(menu.phone)}
          onSetPriority={(p) => handleSetPriority(menu.phone, p)}
        />
      )}
      <Dialog
        open={tagDialog.open}
        onOpenChange={(o) => setTagDialog((s) => ({ ...s, open: o }))}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FontAwesomeIcon icon={tagDialog.mode === "edit" ? faPen : faPlus} className="h-3.5 w-3.5" />
              {tagDialog.mode === "edit" ? "Edit tag" : "Create tag"}
            </DialogTitle>
            <DialogDescription>
              Give the tag a name and pick a color. Right-click a tag chip later to edit or delete it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Name</label>
              <input
                autoFocus
                value={tagDialog.name}
                onChange={(e) => setTagDialog((s) => ({ ...s, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && submitCreateTag()}
                placeholder="e.g. Lead"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={tagDialog.color}
                  onChange={(e) => setTagDialog((s) => ({ ...s, color: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded border border-input bg-background"
                />
                <input
                  value={tagDialog.color}
                  onChange={(e) => setTagDialog((s) => ({ ...s, color: e.target.value }))}
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm font-mono outline-none focus-visible:ring-2 ring-ring"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setTagDialog({
                  open: false,
                  mode: "create",
                  id: null,
                  originalName: null,
                  applyPhone: null,
                  name: "",
                  color: "#6366f1",
                })
              }
            >
              Cancel
            </Button>
            {tagDialog.mode === "edit" && tagDialog.id && tagDialog.originalName && (
              <Button
                variant="destructive"
                onClick={() => {
                  void handleDeleteTag(tagDialog.id!, tagDialog.originalName!);
                  setTagDialog((s) => ({ ...s, open: false }));
                }}
              >
                Delete
              </Button>
            )}
            <Button onClick={submitCreateTag}>{tagDialog.mode === "edit" ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </aside>
  );
}

function FilterChip({
  icon,
  label,
  color,
  active,
  onClick,
  onContextMenu,
}: {
  icon: import("@fortawesome/fontawesome-svg-core").IconDefinition;
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu();
            }
          : undefined
      }
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "text-white" : "border-border bg-background text-foreground hover:bg-muted",
      )}
      style={active ? { backgroundColor: color, borderColor: color } : undefined}
    >
      <FontAwesomeIcon icon={icon} className="h-2.5 w-2.5" />
      {label}
    </button>
  );
}

function tagColorMap(tags: ReturnType<typeof useConvTags>["data"]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of tags ?? []) m.set(t.name, t.color);
  return m;
}

function ContextMenu({
  x,
  y,
  conv,
  tags,
  onClose,
  onPin,
  onDelete,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onSetPriority,
}: {
  x: number;
  y: number;
  conv: Conversation | null;
  tags: import("@/lib/firebase/conversations").TagDef[];
  onClose: () => void;
  onPin: () => void;
  onDelete: () => void;
  onAddTag: (name: string) => void | Promise<void>;
  onRemoveTag: (name: string) => void | Promise<void>;
  onCreateTag: () => void;
  onSetPriority: (priority: ConvPriority) => void | Promise<void>;
}) {
  const active = new Set(conv?.tags ?? []);
  const menuWidth = 240;
  const menuHeight = 320;
  const left = Math.min(x, Math.max(8, window.innerWidth - menuWidth - 8));
  const top = Math.min(y, Math.max(8, window.innerHeight - menuHeight - 8));
  const runAction = (
    e: import("react").PointerEvent<HTMLButtonElement>,
    action: () => void | Promise<void>,
    closeAfter = true,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    void Promise.resolve(action()).finally(() => {
      if (closeAfter) onClose();
    });
  };
  return (
    <div
      className="fixed z-50 min-w-[220px] max-w-[240px] rounded-lg border border-border bg-card p-1 text-sm shadow-lg"
      style={{ top, left }}
      data-conv-context-menu=""
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onPointerDown={(e) => runAction(e, onPin)}
        onClick={(e) => e.preventDefault()}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
      >
        <FontAwesomeIcon icon={faThumbtack} className="h-3.5 w-3.5" />
        {conv?.isPinned ? "Unpin" : "Pin conversation"}
      </button>
      <div className="my-1 border-t border-border" />
      <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Priority</p>
      <div className="grid grid-cols-4 gap-1 px-2 pb-1">
        {(Object.keys(PRIORITY_META) as ConvPriority[]).map((p) => {
          const isActive = (conv?.priority ?? "normal") === p;
          return (
            <button
              key={p}
              type="button"
              onPointerDown={(e) => runAction(e, () => onSetPriority(p))}
              onClick={(e) => e.preventDefault()}
              title={PRIORITY_META[p].label}
              className={cn(
                "flex items-center justify-center gap-1 rounded px-1 py-1.5 text-[10px] font-semibold transition-colors",
                isActive ? "text-white" : "text-foreground hover:bg-muted",
              )}
              style={isActive ? { backgroundColor: PRIORITY_META[p].color } : undefined}
            >
              <FontAwesomeIcon icon={faFlag} className="h-2.5 w-2.5" style={!isActive ? { color: PRIORITY_META[p].color } : undefined} />
              {PRIORITY_META[p].label}
            </button>
          );
        })}
      </div>
      <div className="my-1 border-t border-border" />
      <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Tags</p>
      <div className="max-h-40 overflow-y-auto">
        {tags.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No tags yet</p>
        ) : (
          tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onPointerDown={(e) =>
                runAction(e, () => (active.has(t.name) ? onRemoveTag(t.name) : onAddTag(t.name)))
              }
              onClick={(e) => e.preventDefault()}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span className="flex-1 truncate">{t.name}</span>
              {active.has(t.name) && (
                <FontAwesomeIcon icon={faXmark} className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        onPointerDown={(e) => runAction(e, onCreateTag)}
        onClick={(e) => e.preventDefault()}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-primary hover:bg-primary/10"
      >
        <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> New tag
      </button>
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        onPointerDown={(e) => runAction(e, onDelete)}
        onClick={(e) => e.preventDefault()}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
      >
        <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" /> Delete conversation
      </button>
    </div>
  );
}

function ConvRow({
  c,
  active,
  tagColors,
  incomingFallbackAt,
  onContextMenu,
  selectMode,
  selected,
  onToggleSelect,
  onLongPress,
}: {
  c: Conversation;
  active: boolean;
  tagColors: Map<string, string>;
  incomingFallbackAt: string | null;
  onContextMenu: (x: number, y: number) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onLongPress: () => void;
}) {
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
  const freeChat = isConvInFreeWindow({ ...c, lastIncomingMessageAt: incomingFallbackAt ?? c.lastIncomingMessageAt });
  const longPressTimer = useRef<number | null>(null);
  const startLongPress = () => {
    if (selectMode) return;
    longPressTimer.current = window.setTimeout(() => {
      onLongPress();
    }, 450);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  return (
    <li>
      <Link
        to="/inbox/$phone"
        params={{ phone: c.contactPhone }}
        data-conv-row={c.contactPhone}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY);
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onClick={(e) => {
          if (selectMode) {
            e.preventDefault();
            onToggleSelect();
          }
        }}
        className={cn(
          "flex items-center gap-3 border-b border-border/60 px-3 py-3 transition-colors hover:bg-muted",
          active && !selectMode && "bg-accent/40",
          selected && "bg-primary/10",
        )}
      >
        {selectMode && (
          <div
            className={cn(
              "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
            )}
          >
            {selected && <FontAwesomeIcon icon={faCheck} className="h-2.5 w-2.5" />}
          </div>
        )}
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
          {(c.tags?.length || freeChat) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {freeChat && (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0 text-[9px] font-semibold text-emerald-600">
                  Free
                </span>
              )}
              {c.aiIntent && (
                <span
                  title={c.aiSummary ?? `AI intent: ${c.aiIntent}`}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0 text-[9px] font-semibold text-violet-700 dark:text-violet-300"
                >
                  {c.aiSentiment === "negative" ? "😠" : c.aiSentiment === "positive" ? "🙂" : "✨"}
                  {c.aiIntent}
                </span>
              )}
              {(c.tags ?? []).slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-full px-1.5 py-0 text-[9px] font-semibold text-white"
                  style={{ backgroundColor: tagColors.get(t) ?? "#64748b" }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="ml-1 flex shrink-0 flex-col items-end gap-1">
          {c.priority && c.priority !== "normal" && (
            <FontAwesomeIcon
              icon={faFlag}
              className="h-3 w-3"
              style={{ color: PRIORITY_META[c.priority].color }}
              title={`Priority: ${PRIORITY_META[c.priority].label}`}
            />
          )}
          {c.assignedAgentEmail && (
            <span
              title={`Assigned: ${c.assignedAgentEmail}`}
              className="grid h-4 min-w-[16px] place-items-center rounded-full bg-sky-500/15 px-1 text-[9px] font-semibold text-sky-600"
            >
              {(c.assignedAgentEmail.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase()}
            </span>
          )}
          {c.isPinned && (
            <FontAwesomeIcon
              icon={faThumbtack}
              className="h-3 w-3 rotate-45 text-muted-foreground"
              title="Pinned"
            />
          )}
          {c.isBlocked && (
            <FontAwesomeIcon
              icon={faBan}
              className="h-3 w-3 text-destructive"
              title="Blocked"
            />
          )}
          {c.state === "resolved" && (
            <FontAwesomeIcon
              icon={faCircleCheck}
              className="h-3 w-3 text-emerald-500"
              title="Resolved"
            />
          )}
          {c.state === "snoozed" && (
            <FontAwesomeIcon
              icon={faMoon}
              className="h-3 w-3 text-amber-500"
              title="Snoozed"
            />
          )}
          {typeof c.notesCount === "number" && c.notesCount > 0 && (
            <span
              title={`${c.notesCount} internal note${c.notesCount > 1 ? "s" : ""}`}
              className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[9px] font-semibold text-amber-600"
            >
              <FontAwesomeIcon icon={faNoteSticky} className="h-2.5 w-2.5" />
              {c.notesCount}
            </span>
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

/** Highlight matches of `needle` inside `body`. Case-insensitive. */
function highlight(body: string, needle: string): React.ReactNode {
  if (!needle) return body;
  const idx = body.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return body;
  return (
    <>
      {body.slice(0, idx)}
      <mark className="rounded bg-primary/20 px-0.5 text-foreground">
        {body.slice(idx, idx + needle.length)}
      </mark>
      {body.slice(idx + needle.length)}
    </>
  );
}
