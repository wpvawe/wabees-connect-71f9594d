/**
 * Contact Details slide-over — right-side drawer that surfaces everything
 * we know about the person on the other side of the thread:
 *   • Identity (avatar, name, phone, email, company, tags)
 *   • Conversation stats (state, priority, assigned agent, unread, first msg)
 *   • Recent shared media (last 6 image/video attachments)
 *
 * Edit permissions follow the capability matrix in `src/lib/auth/permissions.ts`
 * — only owners can rename/delete a contact; owners + supervisors can manage
 * tags. Agents get a read-only view.
 */
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faPencil,
  faFloppyDisk,
  faEnvelope,
  faBuilding,
  faTag,
  faPlus,
  faCircleUser,
  faImages,
  faPhone,
  faUserPlus,
  faFlag,
  faCircleCheck,
  faMoon,
  faInbox,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCan } from "@/lib/auth/permissions";
import { useContacts, type Contact } from "@/hooks/useContacts";
import { useConversations, type Conversation } from "@/hooks/useConversations";
import { useMessages } from "@/hooks/useMessages";
import { useConvTags } from "@/hooks/useConvTags";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { addTag, removeTag, PRIORITY_META } from "@/lib/firebase/conversations";
import { upsertContact } from "@/lib/firebase/contacts";
import { normalizePhone } from "@/lib/firebase/normalizers";

type Props = {
  open: boolean;
  onClose: () => void;
  phone: string;
  onOpenMedia?: (messageId: string) => void;
};

export function ContactDetailsDrawer({ open, onClose, phone, onOpenMedia }: Props) {
  const uid = useEffectiveUid();
  const { data: contacts } = useContacts();
  const { data: conversations } = useConversations();
  const { data: messages } = useMessages(open ? phone : undefined);
  const { data: tagCatalog } = useConvTags();
  const can = useCan();

  const canEditContact = can("contacts.write");
  const canManageTags = can("conversation.assign"); // owner + supervisor

  const normalized = normalizePhone(phone);
  const contact = useMemo<Contact | undefined>(
    () => (contacts ?? []).find((c) => normalizePhone(c.phone) === normalized),
    [contacts, normalized],
  );
  const conv = useMemo<Conversation | undefined>(
    () => (conversations ?? []).find((c) => normalizePhone(c.contactPhone) === normalized),
    [conversations, normalized],
  );

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(contact?.name ?? conv?.contactName ?? "");
    setEmail(contact?.email ?? "");
    setCompany(contact?.company ?? "");
    setEditing(false);
    setTagPickerOpen(false);
  }, [open, contact?.id, contact?.name, contact?.email, contact?.company, conv?.contactName]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const displayName = contact?.name || conv?.contactName || phone;
  const initials =
    (displayName || phone).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const photo = contact?.profileImageUrl ?? conv?.profileImageUrl ?? null;

  const stats = useMemo(() => {
    const list = messages ?? [];
    const first = list[0]?.createdAt ?? null;
    const last = list[list.length - 1]?.createdAt ?? conv?.lastMessageAt ?? null;
    const incoming = list.filter((m) => m.direction === "incoming").length;
    const outgoing = list.filter((m) => m.direction === "outgoing").length;
    return { total: list.length, first, last, incoming, outgoing };
  }, [messages, conv?.lastMessageAt]);

  const sharedMedia = useMemo(() => {
    return (messages ?? [])
      .filter(
        (m) =>
          !!m.mediaUrl &&
          (m.type === "image" ||
            m.type === "video" ||
            m.type === "sticker" ||
            m.mimeType?.startsWith("image/") ||
            m.mimeType?.startsWith("video/")),
      )
      .slice(-6)
      .reverse();
  }, [messages]);

  const activeTagNames = new Set(conv?.tags ?? []);

  async function handleSave() {
    if (!uid || !canEditContact) return;
    setBusy(true);
    try {
      await upsertContact(uid, {
        id: contact?.id,
        name: name.trim() || displayName,
        phone: phone,
        email: email.trim() || undefined,
        company: company.trim() || undefined,
      });
      toast.success("Contact updated");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleTag(tagName: string) {
    if (!uid || !canManageTags) return;
    try {
      if (activeTagNames.has(tagName)) {
        await removeTag(uid, phone, tagName);
      } else {
        await addTag(uid, phone, tagName);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tag update failed");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faCircleUser} className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Contact details</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Identity */}
          <div className="flex flex-col items-center gap-3 border-b border-border px-4 py-6">
            <Avatar className="h-20 w-20">
              {photo ? <AvatarImage src={photo} alt={displayName} /> : null}
              <AvatarFallback className="bg-primary/15 text-lg font-semibold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            {editing ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contact name"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-center text-sm outline-none ring-ring focus-visible:ring-2"
              />
            ) : (
              <p className="text-base font-semibold text-foreground">{displayName}</p>
            )}
            <a
              href={`tel:${phone}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
            >
              <FontAwesomeIcon icon={faPhone} className="h-3 w-3" />
              {phone}
            </a>
            {canEditContact && (
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSave}
                      className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} className="h-3 w-3" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                  >
                    <FontAwesomeIcon icon={faPencil} className="h-3 w-3" />
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Fields */}
          <Section title="Details">
            <Field
              icon={faEnvelope}
              label="Email"
              value={email}
              editable={editing}
              placeholder="name@example.com"
              onChange={setEmail}
            />
            <Field
              icon={faBuilding}
              label="Company"
              value={company}
              editable={editing}
              placeholder="Company or team"
              onChange={setCompany}
            />
          </Section>

          {/* Conversation status */}
          <Section title="Conversation">
            <Row
              icon={faInbox}
              label="Status"
              value={
                <StatusChip
                  state={conv?.state ?? "open"}
                  isBlocked={!!conv?.isBlocked}
                />
              }
            />
            <Row
              icon={faFlag}
              label="Priority"
              value={
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    color: PRIORITY_META[conv?.priority ?? "normal"].color,
                    background: `${PRIORITY_META[conv?.priority ?? "normal"].color}15`,
                  }}
                >
                  {PRIORITY_META[conv?.priority ?? "normal"].label}
                </span>
              }
            />
            <Row
              icon={faUserPlus}
              label="Assigned to"
              value={
                conv?.assignedAgentEmail ? (
                  <span className="text-xs font-medium text-foreground">
                    {conv.assignedAgentEmail}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Unassigned</span>
                )
              }
            />
            {conv?.state === "snoozed" && conv.snoozeUntil && (
              <Row
                icon={faMoon}
                label="Snoozed until"
                value={
                  <span className="text-xs text-amber-600">
                    {format(new Date(conv.snoozeUntil), "d MMM, HH:mm")}
                  </span>
                }
              />
            )}
          </Section>

          {/* Tags */}
          <Section
            title="Tags"
            right={
              canManageTags && (tagCatalog?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => setTagPickerOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
                >
                  <FontAwesomeIcon icon={faPlus} className="h-2.5 w-2.5" />
                  Add
                </button>
              ) : null
            }
          >
            {(conv?.tags?.length ?? 0) === 0 && !tagPickerOpen ? (
              <p className="text-xs text-muted-foreground">No tags applied.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(conv?.tags ?? []).map((t) => {
                  const def = tagCatalog?.find((x) => x.name === t);
                  const color = def?.color ?? "#64748b";
                  return (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ color, background: `${color}20` }}
                    >
                      <FontAwesomeIcon icon={faTag} className="h-2.5 w-2.5" />
                      {t}
                      {canManageTags && (
                        <button
                          type="button"
                          onClick={() => void handleToggleTag(t)}
                          className="ml-0.5 opacity-60 hover:opacity-100"
                          aria-label={`Remove ${t}`}
                        >
                          <FontAwesomeIcon icon={faXmark} className="h-2 w-2" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
            {tagPickerOpen && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border bg-background p-1">
                {(tagCatalog ?? [])
                  .filter((t) => !activeTagNames.has(t.name))
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        void handleToggleTag(t.name);
                        setTagPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: t.color }}
                      />
                      {t.name}
                    </button>
                  ))}
                {(tagCatalog ?? []).filter((t) => !activeTagNames.has(t.name)).length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    All tags already applied.
                  </p>
                )}
              </div>
            )}
          </Section>

          {/* Stats */}
          <Section title="Activity">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Messages" value={stats.total} />
              <StatCard label="Received" value={stats.incoming} />
              <StatCard label="Sent" value={stats.outgoing} />
            </div>
            {stats.first && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                First message · {format(new Date(stats.first), "d MMM yyyy, HH:mm")}
              </p>
            )}
            {stats.last && (
              <p className="text-[11px] text-muted-foreground">
                Last message · {format(new Date(stats.last), "d MMM yyyy, HH:mm")}
              </p>
            )}
          </Section>

          {/* Shared media */}
          <Section
            title="Shared media"
            right={
              <span className="text-[10px] text-muted-foreground">
                {sharedMedia.length} recent
              </span>
            }
          >
            {sharedMedia.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FontAwesomeIcon icon={faImages} className="h-3 w-3" />
                No shared photos or videos yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {sharedMedia.map((m) => {
                  const isVideo =
                    m.type === "video" || m.mimeType?.startsWith("video/");
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onOpenMedia?.(m.id)}
                      className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                    >
                      {isVideo ? (
                        <video
                          src={m.mediaUrl!}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={m.mediaUrl!}
                          alt={m.caption ?? ""}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                      {isVideo && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[8px] font-bold text-white">
                          VIDEO
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {conv?.isBlocked && (
            <div className="m-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <FontAwesomeIcon icon={faCircleCheck} className="h-3.5 w-3.5" />
              Contact is currently blocked.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  editable,
  placeholder,
  onChange,
}: {
  icon: typeof faEnvelope;
  label: string;
  value: string;
  editable: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <FontAwesomeIcon icon={icon} className="mt-1 h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {editable ? (
          <input
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-2"
          />
        ) : (
          <p className="mt-0.5 truncate text-xs text-foreground">
            {value || <span className="text-muted-foreground">—</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: typeof faEnvelope;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-2 text-center">
      <p className="text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusChip({
  state,
  isBlocked,
}: {
  state: "open" | "pending" | "resolved" | "snoozed";
  isBlocked: boolean;
}) {
  if (isBlocked) {
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
        Blocked
      </span>
    );
  }
  const map = {
    open: { label: "Open", color: "#22c55e" },
    pending: { label: "Pending", color: "#f59e0b" },
    resolved: { label: "Resolved", color: "#0ea5e9" },
    snoozed: { label: "Snoozed", color: "#a855f7" },
  } as const;
  const meta = map[state];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: meta.color, background: `${meta.color}20` }}
    >
      {meta.label}
    </span>
  );
}