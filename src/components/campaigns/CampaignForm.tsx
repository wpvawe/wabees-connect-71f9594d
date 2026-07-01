import { useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUserGroup,
  faMagnifyingGlass,
  faCheck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useContacts } from "@/hooks/useContacts";
import { createCampaign } from "@/lib/firebase/campaigns";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { cn } from "@/lib/utils";

export function CampaignForm() {
  const navigate = useNavigate();
  const uid = useEffectiveUid();
  const { data: contacts, error: contactsError } = useContacts();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

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
    try {
      const res = await createCampaign(uid, {
        name: name.trim(),
        description: description.trim(),
        messageBody: messageBody.trim(),
        audiencePhones: audience,
      });
      toast.success("Campaign created");
      navigate({ to: "/campaigns/$id", params: { id: res.id } });
    } catch (e) {
      const err = e as { code?: string; message?: string } | Error;
      const code = (err as { code?: string }).code;
      const raw = err instanceof Error ? err.message : String(err ?? "");
      // eslint-disable-next-line no-console
      console.error("createCampaign failed", { code, raw, err });
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
