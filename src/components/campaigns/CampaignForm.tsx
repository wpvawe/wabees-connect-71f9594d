import { useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUserGroup,
  faMagnifyingGlass,
  faCheck,
  faXmark,
  faBug,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useContacts } from "@/hooks/useContacts";
import { createCampaign } from "@/lib/firebase/campaigns";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { cn } from "@/lib/utils";

type DebugEntry = {
  at: string;
  ok: boolean;
  path: string;
  payload: Record<string, unknown>;
  code?: string;
  name?: string;
  message?: string;
  stack?: string;
  resultId?: string;
  durationMs: number;
};

export function CampaignForm() {
  const navigate = useNavigate();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const { data: contacts, error: contactsError } = useContacts();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState<DebugEntry | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);

  const allTags = useMemo(() => {
    if (!contacts) return [];
    const s = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [contacts]);

  const visible = useMemo(() => {
    if (!contacts) return [];
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (tagFilter.size > 0 && !c.tags.some((t) => tagFilter.has(t))) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [contacts, tagFilter, search]);

  function toggle(phone: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(phone)) n.delete(phone);
      else n.add(phone);
      return n;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const n = new Set(prev);
      visible.forEach((c) => c.phone && n.add(c.phone));
      return n;
    });
  }

  function clearAllVisible() {
    setSelected((prev) => {
      const n = new Set(prev);
      visible.forEach((c) => n.delete(c.phone));
      return n;
    });
  }

  function toggleTag(tag: string) {
    setTagFilter((prev) => {
      const n = new Set(prev);
      if (n.has(tag)) n.delete(tag);
      else n.add(tag);
      return n;
    });
  }

  async function save() {
    if (!uid) {
      toast.error("Not signed in — refresh and try again");
      return;
    }
    if (!name.trim()) {
      toast.error("Enter a campaign name");
      return;
    }
    if (!messageBody.trim()) {
      toast.error("Write a message");
      return;
    }
    const audience = Array.from(selected)
      .map((p) => p.replace(/[^0-9+]/g, ""))
      .filter((p) => p.length >= 6);
    if (audience.length === 0) {
      toast.error("Pick at least one recipient");
      return;
    }
    setBusy(true);
    const payload = {
      name: name.trim(),
      description: description.trim(),
      messageBody: messageBody.trim(),
      audiencePhones: audience,
    };
    const path = `users/${uid}/campaigns`;
    const startedAt = performance.now();
    try {
      const res = await createCampaign(uid, payload);
      setDebug({
        at: new Date().toISOString(),
        ok: true,
        path,
        payload,
        resultId: res.id,
        durationMs: Math.round(performance.now() - startedAt),
      });
      toast.success("Campaign created");
      navigate({ to: "/campaigns/$id", params: { id: res.id } });
    } catch (e) {
      const err = e as { code?: string; message?: string; name?: string; stack?: string } | Error;
      const code = (err as { code?: string }).code;
      const nm = (err as { name?: string }).name;
      const raw = err instanceof Error ? err.message : String(err ?? "");
      const stack = err instanceof Error ? err.stack : undefined;
      // eslint-disable-next-line no-console
      console.error("createCampaign failed", { code, raw, err });
      setDebug({
        at: new Date().toISOString(),
        ok: false,
        path,
        payload,
        code,
        name: nm,
        message: raw,
        stack,
        durationMs: Math.round(performance.now() - startedAt),
      });
      setDebugOpen(true);
      const msg =
        code === "permission-denied"
          ? "Permission denied by Firestore rules. Sign out and back in, then retry."
          : code === "unavailable"
            ? "Network issue reaching Firestore. Check your connection and retry."
            : raw || "Could not create campaign";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <WbCard>
          <WbCardBody className="space-y-3">
            <Field label="Campaign name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Diwali Promo 2026"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
              />
            </Field>
            <Field label="Description (optional)">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
              />
            </Field>
            <Field label="Message">
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={6}
                placeholder="Hello! Use plain text or include emojis 🎉"
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Free-form text. For approved templates with variables use the Templates page.
                </span>
                <span>{messageBody.length} chars</span>
              </div>
            </Field>
          </WbCardBody>
        </WbCard>
        <div className="flex justify-end gap-2">
          <WbButton
            onClick={() => void save()}
            loading={busy}
            disabled={!name.trim() || !messageBody.trim() || selected.size === 0}
          >
            Create campaign ({selected.size})
          </WbButton>
        </div>
        <DebugPanel
          entry={debug}
          open={debugOpen}
          onToggle={() => setDebugOpen((v) => !v)}
          onClear={() => setDebug(null)}
          effectiveUid={uid}
          selfUid={selfUid}
          contactsCount={contacts?.length ?? null}
          contactsError={contactsError}
        />
      </div>
      <WbCard>
        <WbCardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FontAwesomeIcon icon={faUserGroup} className="h-3.5 w-3.5" />
              Recipients ({selected.size})
            </p>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-primary hover:underline"
              >
                Add all
              </button>
              <button
                type="button"
                onClick={clearAllVisible}
                className="text-muted-foreground hover:underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="relative">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / phone / email"
              className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) => {
                const on = tagFilter.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {on && <FontAwesomeIcon icon={faCheck} className="h-2.5 w-2.5" />}
                    {t}
                  </button>
                );
              })}
              {tagFilter.size > 0 && (
                <button
                  type="button"
                  onClick={() => setTagFilter(new Set())}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  <FontAwesomeIcon icon={faXmark} className="h-2.5 w-2.5" />
                  Clear tags
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Showing {visible.length} of {contacts?.length ?? 0} contacts
          </p>
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
            {contactsError ? (
              <p className="p-4 text-xs text-destructive">{contactsError}</p>
            ) : contacts === null ? (
              <p className="p-4 text-xs text-muted-foreground">Loading contacts…</p>
            ) : visible.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                {contacts.length === 0
                  ? "No contacts yet. Import some on the Contacts page."
                  : "No contacts match this filter."}
              </p>
            ) : (
              visible.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.phone)}
                    onChange={() => toggle(c.phone)}
                    className="h-4 w-4 accent-[var(--wb-green)]"
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.phone}</span>
                </label>
              ))
            )}
          </div>
        </WbCardBody>
      </WbCard>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function DebugPanel({
  entry,
  open,
  onToggle,
  onClear,
  effectiveUid,
  selfUid,
  contactsCount,
  contactsError,
}: {
  entry: DebugEntry | null;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  effectiveUid: string | null;
  selfUid: string | null;
  contactsCount: number | null;
  contactsError: string | null;
}) {
  const dump = entry
    ? JSON.stringify(entry, null, 2)
    : "No create attempt yet. Fill the form and click Create campaign to record a trace.";
  const toneOk = entry?.ok === true;
  const toneErr = entry?.ok === false;
  async function copy() {
    try {
      await navigator.clipboard.writeText(dump);
      toast.success("Debug trace copied");
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <div
      className={cn(
        "rounded-xl border text-xs",
        toneErr
          ? "border-destructive/40 bg-destructive/5"
          : toneOk
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-dashed border-border bg-muted/30",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-2 font-semibold text-foreground">
          <FontAwesomeIcon icon={faBug} className="h-3 w-3" />
          Create-campaign debug
          {entry && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                toneErr
                  ? "bg-destructive/15 text-destructive"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              )}
            >
              {toneErr ? entry.code || "error" : "ok"}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              effectiveUid: <span className="text-foreground">{effectiveUid ?? "—"}</span>
            </span>
            <span>
              selfUid: <span className="text-foreground">{selfUid ?? "—"}</span>
            </span>
            <span>
              contacts loaded:{" "}
              <span className="text-foreground">
                {contactsCount === null ? "loading…" : contactsCount}
              </span>
            </span>
            <span>
              contacts error:{" "}
              <span className={contactsError ? "text-destructive" : "text-foreground"}>
                {contactsError ?? "none"}
              </span>
            </span>
          </div>
          {entry?.message && (
            <p className="rounded bg-destructive/10 px-2 py-1.5 text-destructive">
              <strong>{entry.name ?? "Error"}:</strong> {entry.message}
            </p>
          )}
          <pre className="max-h-64 overflow-auto rounded bg-background/70 p-2 font-mono text-[10.5px] leading-relaxed text-foreground">
            {dump}
          </pre>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
            >
              <FontAwesomeIcon icon={faCopy} className="h-2.5 w-2.5" />
              Copy trace
            </button>
            {entry && (
              <button
                type="button"
                onClick={onClear}
                className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
