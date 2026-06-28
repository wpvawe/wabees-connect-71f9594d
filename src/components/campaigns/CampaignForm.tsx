import { useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserGroup } from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useContacts } from "@/hooks/useContacts";
import { createCampaign } from "@/lib/firebase/campaigns";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";

export function CampaignForm() {
  const navigate = useNavigate();
  const uid = useFirebaseUid();
  const { data: contacts } = useContacts();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const allTags = useMemo(() => {
    if (!contacts) return [];
    const s = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [contacts]);

  const visible = useMemo(() => {
    if (!contacts) return [];
    if (!tagFilter) return contacts;
    return contacts.filter((c) => c.tags.includes(tagFilter));
  }, [contacts, tagFilter]);

  function toggle(phone: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(phone)) n.delete(phone);
      else n.add(phone);
      return n;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(visible.map((c) => c.phone)));
  }

  async function save() {
    if (!uid || !name.trim() || !messageBody.trim() || selected.size === 0) {
      toast.error("Name, message, and at least one recipient are required");
      return;
    }
    setBusy(true);
    try {
      const res = await createCampaign(uid, {
        name: name.trim(),
        description: description.trim(),
        messageBody: messageBody.trim(),
        audiencePhones: Array.from(selected),
      });
      toast.success("Campaign created");
      navigate({ to: "/campaigns/$id", params: { id: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create");
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
              <p className="mt-1 text-[11px] text-muted-foreground">
                Free-form text only. To send approved templates with variables, open a template
                from the Templates page.
              </p>
            </Field>
          </WbCardBody>
        </WbCard>
        <div className="flex justify-end gap-2">
          <WbButton onClick={() => void save()} loading={busy} disabled={selected.size === 0}>
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
            <button type="button" onClick={selectAllVisible} className="text-xs text-primary hover:underline">
              Select all visible
            </button>
          </div>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">All tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
            {visible.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No contacts. Import some on the Contacts page.</p>
            ) : (
              visible.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted">
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