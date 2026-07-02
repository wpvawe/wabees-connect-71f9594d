import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import Papa from "papaparse";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faAddressBook,
  faCircleNotch,
  faEllipsisVertical,
  faFileExport,
  faFileImport,
  faMagnifyingGlass,
  faMessage,
  faPen,
  faPlus,
  faTag,
  faTrash,
  faUserGroup,
  faUsers,
  faXmark,
  faFilter,
  faDownload,
  faLayerGroup,
} from "@fortawesome/free-solid-svg-icons";
import { WbButton } from "@/components/wb/WbButton";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { useContacts, type Contact } from "@/hooks/useContacts";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import {
  bulkImportContacts,
  deleteContact,
  upsertContact,
} from "@/lib/firebase/contacts";
import { cn } from "@/lib/utils";

type CsvRow = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  tags?: string;
  group?: string;
};

export function ContactsWorkspace() {
  const { data, error } = useContacts();
  const uid = useEffectiveUid();
  const fileRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; contact: Contact | null }>({
    open: false,
    contact: null,
  });
  const [confirm, setConfirm] = useState<Contact | null>(null);
  const [importing, setImporting] = useState(false);

  const stats = useMemo(() => {
    const list = data ?? [];
    const tags = new Set<string>();
    const groups = new Set<string>();
    let tagged = 0;
    let withMessages = 0;
    for (const c of list) {
      if (c.tags.length > 0) tagged++;
      if (c.totalMessages > 0) withMessages++;
      c.tags.forEach((t) => tags.add(t));
      if (c.group) groups.add(c.group);
    }
    return {
      total: list.length,
      tagged,
      tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
      groups: Array.from(groups).sort((a, b) => a.localeCompare(b)),
      withMessages,
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return data;
    const n = q.trim().toLowerCase();
    return data.filter((c) => {
      if (activeTag && !c.tags.includes(activeTag)) return false;
      if (activeGroup && (c.group || "") !== activeGroup) return false;
      if (!n) return true;
      return (
        c.name.toLowerCase().includes(n) ||
        c.phone.toLowerCase().includes(n) ||
        (c.email ?? "").toLowerCase().includes(n) ||
        (c.company ?? "").toLowerCase().includes(n) ||
        (c.group ?? "").toLowerCase().includes(n) ||
        c.tags.some((t) => t.toLowerCase().includes(n))
      );
    });
  }, [data, q, activeTag, activeGroup]);

  function triggerImport() {
    fileRef.current?.click();
  }

  function downloadSampleCsv() {
    const sample = Papa.unparse([
      { name: "Jane Doe", phone: "+923001234567", email: "jane@acme.com", company: "Acme Inc", tags: "lead,vip", group: "Customers" },
      { name: "John Smith", phone: "+14155551234", email: "", company: "", tags: "trial", group: "Prospects" },
      { name: "Ali Khan", phone: "+923215551234", email: "ali@shop.pk", company: "Shop", tags: "", group: "Suppliers" },
    ]);
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wabees-contacts-sample.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Sample CSV downloaded");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uid) return;
    setImporting(true);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const contacts = results.data
            .filter((r) => r.name && r.phone)
            .map((r) => ({
              name: String(r.name).trim(),
              phone: String(r.phone).trim(),
              email: r.email ? String(r.email).trim() : undefined,
              company: r.company ? String(r.company).trim() : undefined,
              group: r.group ? String(r.group).trim() : undefined,
              tags: r.tags
                ? String(r.tags)
                    .split(/[,;]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            }));
          if (contacts.length === 0) {
            toast.error("CSV needs columns: name, phone (also email, company, tags, group)");
            return;
          }
          const res = await bulkImportContacts(uid, contacts);
          toast.success(`Imported ${res.imported} contacts`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Import failed");
        } finally {
          setImporting(false);
          if (fileRef.current) fileRef.current.value = "";
        }
      },
      error: () => {
        toast.error("Could not parse CSV");
        setImporting(false);
      },
    });
  }

  function onExport() {
    const rows = filtered ?? data ?? [];
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const csv = Papa.unparse(
      rows.map((c) => ({
        name: c.name,
        phone: c.phone,
        email: c.email ?? "",
        company: c.company ?? "",
        tags: c.tags.join(","),
        group: c.group ?? "",
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wabees-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${rows.length} contact${rows.length === 1 ? "" : "s"}`);
  }

  async function handleDelete(c: Contact) {
    if (!uid) return;
    try {
      await deleteContact(uid, c.id);
      toast.success(`${c.name} deleted`);
      setConfirm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {data === null
              ? "Loading your contacts…"
              : `${stats.total} contact${stats.total === 1 ? "" : "s"} · ${stats.tags.length} tag${stats.tags.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WbButton variant="ghost" size="sm" onClick={downloadSampleCsv}>
            <FontAwesomeIcon icon={faDownload} className="h-3.5 w-3.5" />
            Sample CSV
          </WbButton>
          <WbButton
            variant="secondary"
            size="sm"
            onClick={triggerImport}
            loading={importing}
          >
            <FontAwesomeIcon icon={faFileImport} className="h-3.5 w-3.5" />
            Import CSV
          </WbButton>
          <WbButton variant="secondary" size="sm" onClick={onExport}>
            <FontAwesomeIcon icon={faFileExport} className="h-3.5 w-3.5" />
            Export
          </WbButton>
          <WbButton size="sm" onClick={() => setEditor({ open: true, contact: null })}>
            <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
            New contact
          </WbButton>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="hidden"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={faAddressBook} label="Total contacts" value={stats.total} tone="primary" />
        <StatCard icon={faTag} label="With tags" value={stats.tagged} tone="accent" />
        <StatCard icon={faLayerGroup} label="Groups" value={stats.groups.length} tone="muted" />
        <StatCard icon={faMessage} label="Chatted with" value={stats.withMessages} tone="muted" />
      </div>

      {/* Search + tag filter */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, email, company or tag"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm outline-none ring-ring focus-visible:ring-2"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
              </button>
            )}
          </div>
          {(q || activeTag || activeGroup) && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setActiveTag(null);
                setActiveGroup(null);
              }}
              className="h-10 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Reset filters
            </button>
          )}
        </div>
        {stats.groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <FontAwesomeIcon icon={faLayerGroup} className="h-3 w-3" />
              Groups
            </span>
            <TagChip label="All" active={activeGroup === null} onClick={() => setActiveGroup(null)} />
            {stats.groups.map((g) => (
              <TagChip
                key={g}
                label={g}
                active={activeGroup === g}
                onClick={() => setActiveGroup(activeGroup === g ? null : g)}
              />
            ))}
          </div>
        )}
        {stats.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <FontAwesomeIcon icon={faFilter} className="h-3 w-3" />
              Tags
            </span>
            <TagChip label="All" active={activeTag === null} onClick={() => setActiveTag(null)} />
            {stats.tags.map((t) => (
              <TagChip
                key={t}
                label={t}
                active={activeTag === t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Table / list */}
      <div className="rounded-2xl border border-border bg-card">
        {error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : filtered === null ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading contacts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <WbEmpty
              icon={faAddressBook}
              title={q || activeTag ? "No matches" : "No contacts yet"}
              description={
                q || activeTag
                  ? "Try clearing filters or a different search term."
                  : "Add your first contact or import a CSV to get started."
              }
              action={
                q || activeTag ? (
                  <WbButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setActiveTag(null);
                    }}
                  >
                    Reset filters
                  </WbButton>
                ) : (
                  <WbButton size="sm" onClick={() => setEditor({ open: true, contact: null })}>
                    <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
                    New contact
                  </WbButton>
                )
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 font-medium">Messages</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="group border-t border-border/60 transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar contact={c} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{c.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {c.phone}
                              {c.email ? ` · ${c.email}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {c.company || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-[240px] flex-wrap gap-1">
                          {c.tags.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            c.tags.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setActiveTag(t)}
                                className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground hover:bg-accent/80"
                              >
                                {t}
                              </button>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {c.totalMessages || 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <RowAction
                            icon={faMessage}
                            label="Open chat"
                            to={`/inbox/${encodeURIComponent(c.phone)}`}
                          />
                          <RowAction
                            icon={faPen}
                            label="Edit contact"
                            onClick={() => setEditor({ open: true, contact: c })}
                          />
                          <RowAction
                            icon={faTrash}
                            label="Delete contact"
                            danger
                            onClick={() => setConfirm(c)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-border/60 md:hidden">
              {filtered.map((c) => (
                <li key={c.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <Avatar contact={c} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{c.phone}</div>
                        </div>
                        <MobileMenu
                          onEdit={() => setEditor({ open: true, contact: c })}
                          onDelete={() => setConfirm(c)}
                          openHref={`/inbox/${encodeURIComponent(c.phone)}`}
                        />
                      </div>
                      {(c.company || c.email) && (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {[c.company, c.email].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {c.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {editor.open && (
        <ContactDialog
          contact={editor.contact}
          onClose={() => setEditor({ open: false, contact: null })}
          onSave={async (payload) => {
            if (!uid) return;
            await upsertContact(uid, payload);
            toast.success(editor.contact ? "Contact updated" : "Contact added");
            setEditor({ open: false, contact: null });
          }}
        />
      )}

      {confirm && (
        <ConfirmDelete
          contact={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => handleDelete(confirm)}
        />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconDefinition;
  label: string;
  value: number;
  tone: "primary" | "accent" | "muted";
}) {
  const toneClasses =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "accent"
        ? "bg-accent text-accent-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center gap-3">
        <div className={cn("grid h-10 w-10 place-items-center rounded-xl", toneClasses)}>
          <FontAwesomeIcon icon={icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
        </div>
      </div>
    </div>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function Avatar({ contact }: { contact: Contact }) {
  const initials = (contact.name || contact.phone || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return contact.profileImageUrl ? (
    <img
      src={contact.profileImageUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded-full object-cover"
    />
  ) : (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
      {initials || "?"}
    </div>
  );
}

function RowAction({
  icon,
  label,
  onClick,
  to,
  danger,
}: {
  icon: IconDefinition;
  label: string;
  onClick?: () => void;
  to?: string;
  danger?: boolean;
}) {
  const cls = cn(
    "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors",
    danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground",
  );
  if (to) {
    return (
      <Link to={to} aria-label={label} title={label} className={cls}>
        <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cls}>
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

function MobileMenu({
  onEdit,
  onDelete,
  openHref,
}: {
  onEdit: () => void;
  onDelete: () => void;
  openHref: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <FontAwesomeIcon icon={faEllipsisVertical} className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border border-border bg-popover shadow-soft">
            <Link
              to={openHref}
              className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <FontAwesomeIcon icon={faMessage} className="h-3.5 w-3.5" />
              Open chat
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <FontAwesomeIcon icon={faPen} className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

type SavePayload = {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  notes?: string;
  tags: string[];
};

function ContactDialog({
  contact,
  onClose,
  onSave,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [company, setCompany] = useState(contact?.company ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [tags, setTags] = useState((contact?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        id: contact?.id,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        company: company.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: tags
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {contact ? "Edit contact" : "New contact"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {contact ? "Update details and tags." : "Add someone to your WhatsApp address book."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Full name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="input"
            />
          </Field>
          <Field label="Phone *">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+923001234567"
              className="input"
            />
          </Field>
          <Field label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              className="input"
            />
          </Field>
          <Field label="Company">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Inc."
              className="input"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Tags (comma separated)">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="lead, vip, karachi"
                className="input"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes about this contact"
                className="input h-auto resize-none py-2"
              />
            </Field>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <WbButton variant="ghost" onClick={onClose}>
            Cancel
          </WbButton>
          <WbButton onClick={() => void save()} loading={busy}>
            {contact ? "Save changes" : "Add contact"}
          </WbButton>
        </div>
      </div>
      <style>{`.input{height:2.5rem;width:100%;border-radius:0.375rem;border:1px solid var(--input);background:var(--background);padding:0 0.75rem;font-size:0.875rem;outline:none}
      .input:focus-visible{box-shadow:0 0 0 2px var(--ring)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ConfirmDelete({
  contact,
  onCancel,
  onConfirm,
}: {
  contact: Contact;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
            <FontAwesomeIcon icon={faTrash} className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Delete contact?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {contact.name} ({contact.phone}) will be removed from your address book. This can't be
              undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <WbButton variant="ghost" onClick={onCancel}>
            Cancel
          </WbButton>
          <WbButton
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </WbButton>
        </div>
      </div>
    </div>
  );
}

// keep unused-import guard happy for consumers of the icon lib
export const __contactsIconKeepAlive = faUsers;