import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUserGroup,
  faMagnifyingGlass,
  faCheck,
  faXmark,
  faWandMagicSparkles,
  faKeyboard,
  faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useContacts } from "@/hooks/useContacts";
import { useTemplates, type Template } from "@/hooks/useTemplates";
import { prepareCampaignCreate } from "@/lib/firebase/campaigns";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { normalizePhone } from "@/lib/firebase/normalizers";
import { cn } from "@/lib/utils";
import { WhatsAppPreview } from "@/components/shared/WhatsAppPreview";

type Mode = "template" | "text";
type VarSource = "static" | "contact";

const CONTACT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
];

export function CampaignForm() {
  const navigate = useNavigate();
  const uid = useEffectiveUid();
  const { data: contacts, error: contactsError } = useContacts();
  const { data: templates, error: templatesError } = useTemplates();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [varSource, setVarSource] = useState<VarSource>("static");
  const [staticVars, setStaticVars] = useState<Record<string, string>>({});
  const [contactFieldMap, setContactFieldMap] = useState<Record<string, string>>({});
  const [textMessage, setTextMessage] = useState("");
  const [manualPhones, setManualPhones] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const approvedTemplates = useMemo(
    () =>
      (templates ?? []).filter(
        (t) => (t.status || "").toUpperCase() === "APPROVED" && (t.body || "").trim().length > 0,
      ),
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return approvedTemplates;
    return approvedTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [approvedTemplates, templateSearch]);

  const template: Template | null = useMemo(
    () => approvedTemplates.find((t) => t.id === selectedTemplateId) ?? null,
    [approvedTemplates, selectedTemplateId],
  );

  // Auto-pick first template when list first arrives
  useEffect(() => {
    if (mode === "template" && !selectedTemplateId && approvedTemplates.length > 0) {
      setSelectedTemplateId(approvedTemplates[0].id);
    }
  }, [mode, selectedTemplateId, approvedTemplates]);

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

  const manualAudience = useMemo(() => parsePhoneList(manualPhones), [manualPhones]);

  const audiencePreview = useMemo(() => {
    return Array.from(
      new Set([
        ...Array.from(selected)
          .map((p) => normalizePhone(p))
          .filter((p) => p.length >= 10),
        ...manualAudience,
      ]),
    );
  }, [selected, manualAudience]);

  // Render preview body with variable substitution.
  const previewContact = useMemo(() => {
    if (!contacts || contacts.length === 0) return null;
    // Prefer a selected contact if any
    for (const c of contacts) if (selected.has(c.phone)) return c;
    return contacts[0];
  }, [contacts, selected]);

  const renderedBody = useMemo(() => {
    if (mode === "text") return textMessage;
    if (!template) return "";
    return substituteVars(template.body, template.variables, {
      varSource,
      staticVars,
      contactFieldMap,
      contact: previewContact,
    });
  }, [mode, textMessage, template, varSource, staticVars, contactFieldMap, previewContact]);

  const renderedHeader = useMemo(() => {
    if (mode !== "template" || !template?.header) return null;
    return substituteVars(template.header, template.variables, {
      varSource,
      staticVars,
      contactFieldMap,
      contact: previewContact,
    });
  }, [mode, template, varSource, staticVars, contactFieldMap, previewContact]);

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

    if (mode === "template") {
      if (!template) {
        toast.error("Pick a template");
        return;
      }
      // Every template variable must resolve to something.
      for (const v of template.variables) {
        if (varSource === "static") {
          if (!(staticVars[v] ?? "").trim()) {
            toast.error(`Fill value for {{${v}}}`);
            return;
          }
        } else {
          if (!contactFieldMap[v]) {
            toast.error(`Map field for {{${v}}}`);
            return;
          }
        }
      }
    } else {
      if (!textMessage.trim()) {
        toast.error("Write a message");
        return;
      }
    }

    const audience = audiencePreview;
    if (audience.length === 0) {
      toast.error("Pick at least one recipient");
      return;
    }

    setBusy(true);
    const input =
      mode === "template" && template
        ? {
            name: name.trim(),
            description: description.trim(),
            messageType: "template" as const,
            messageBody: template.body, // store raw template body with placeholders
            templateName: template.name,
            templateLanguage: template.languageCode,
            selectedTemplateId: template.id,
            templateVariables: template.variables,
            variableSource: varSource,
            staticVariableValues: pickKeys(staticVars, template.variables),
            contactFieldMap: pickKeys(contactFieldMap, template.variables),
            audiencePhones: audience,
          }
        : {
            name: name.trim(),
            description: description.trim(),
            messageType: "text" as const,
            messageBody: textMessage.trim(),
            audiencePhones: audience,
          };

    try {
      const request = prepareCampaignCreate(uid, input);
      const res = await request.commit();
      toast.success("Campaign created");
      navigate({ to: "/campaigns/$id", params: { id: res.id } });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e ?? "");
      toast.error(raw || "Could not create campaign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* LEFT COLUMN */}
      <div className="space-y-5">
        {/* Basics */}
        <SectionCard title="Basics" subtitle="Name and describe this campaign">
          <div className="space-y-3">
            <Field label="Campaign name" required>
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
                placeholder="Internal note about this campaign"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
              />
            </Field>
          </div>
        </SectionCard>

        {/* Message type */}
        <SectionCard
          title="Message"
          subtitle="Meta only allows session (free-form) messages within a 24-hour window. Broadcasts must use an approved template."
        >
          <div className="mb-4 grid grid-cols-2 gap-2">
            <ModeChip
              active={mode === "template"}
              onClick={() => setMode("template")}
              icon={faWandMagicSparkles}
              title="Template"
              subtitle="Recommended for broadcasts"
              recommended
            />
            <ModeChip
              active={mode === "text"}
              onClick={() => setMode("text")}
              icon={faKeyboard}
              title="Free text"
              subtitle="Only for 24h session"
            />
          </div>

          {mode === "template" ? (
            <div className="space-y-4">
              {templatesError ? (
                <InfoBanner tone="danger">{templatesError}</InfoBanner>
              ) : templates === null ? (
                <InfoBanner tone="muted">Loading templates…</InfoBanner>
              ) : approvedTemplates.length === 0 ? (
                <InfoBanner tone="warn">
                  No approved templates found. Sync your templates from the Templates page first.
                </InfoBanner>
              ) : (
                <>
                  <div className="relative">
                    <FontAwesomeIcon
                      icon={faMagnifyingGlass}
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search templates"
                      className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
                    />
                  </div>
                  <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                    {filteredTemplates.map((t) => {
                      const active = t.id === selectedTemplateId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTemplateId(t.id)}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-all",
                            active
                              ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
                              : "border-border bg-background hover:border-primary/40 hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {t.name}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t.category}
                              </span>
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                {t.languageCode}
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {t.body}
                          </p>
                        </button>
                      );
                    })}
                    {filteredTemplates.length === 0 && (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        No templates match your search.
                      </p>
                    )}
                  </div>

                  {template && template.variables.length > 0 && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Variables ({template.variables.length})
                        </p>
                        <div className="flex rounded-md border border-border bg-background p-0.5 text-[11px]">
                          <SegBtn
                            active={varSource === "static"}
                            onClick={() => setVarSource("static")}
                          >
                            Static
                          </SegBtn>
                          <SegBtn
                            active={varSource === "contact"}
                            onClick={() => setVarSource("contact")}
                          >
                            Contact field
                          </SegBtn>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {template.variables.map((v) => (
                          <div key={v} className="flex items-center gap-2">
                            <code className="min-w-[52px] rounded bg-background px-2 py-1 text-center text-[11px] font-medium text-primary">
                              {`{{${v}}}`}
                            </code>
                            {varSource === "static" ? (
                              <input
                                value={staticVars[v] ?? ""}
                                onChange={(e) =>
                                  setStaticVars((p) => ({ ...p, [v]: e.target.value }))
                                }
                                placeholder={`Value for {{${v}}}`}
                                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-2"
                              />
                            ) : (
                              <select
                                value={contactFieldMap[v] ?? ""}
                                onChange={(e) =>
                                  setContactFieldMap((p) => ({ ...p, [v]: e.target.value }))
                                }
                                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none ring-ring focus-visible:ring-2"
                              >
                                <option value="">Select field…</option>
                                {CONTACT_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <FontAwesomeIcon icon={faCircleInfo} className="mt-0.5 h-3 w-3" />
                        {varSource === "static"
                          ? "Same values used for every recipient."
                          : "Values pulled per-recipient from their contact record."}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <InfoBanner tone="warn">
                Meta rejects free-form messages to users outside a 24-hour customer service window.
                Use a template for cold broadcasts.
              </InfoBanner>
              <textarea
                value={textMessage}
                onChange={(e) => setTextMessage(e.target.value)}
                rows={6}
                placeholder="Hello! Use plain text or include emojis 🎉"
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Only delivered to contacts inside the 24h window.</span>
                <span>{textMessage.length} chars</span>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Recipients */}
        <SectionCard
          title={`Recipients (${audiencePreview.length})`}
          subtitle="Pick from contacts or paste phone numbers"
          right={
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
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
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
              <div className="max-h-[320px] overflow-y-auto rounded-md border border-border">
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
            </div>
            <div className="space-y-2">
              <Field label="Manual recipients">
                <textarea
                  value={manualPhones}
                  onChange={(e) => setManualPhones(e.target.value)}
                  rows={8}
                  placeholder="Paste phone numbers — one per line or comma separated"
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {manualAudience.length} valid manual recipient
                  {manualAudience.length === 1 ? "" : "s"} · Numbers normalized to +E.164.
                </p>
              </Field>
            </div>
          </div>
        </SectionCard>

      </div>

      {/* RIGHT COLUMN — Preview + summary */}
      <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
        <WhatsAppPreview
          header={renderedHeader}
          headerFormat={template?.header ? "TEXT" : null}
          body={renderedBody}
          footer={mode === "template" ? (template?.footer ?? null) : null}
          buttons={mode === "template" ? (template?.buttons ?? []) : []}
        />
        <WbCard>
          <WbCardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FontAwesomeIcon icon={faUserGroup} className="h-3 w-3" />
                Summary
              </p>
            </div>
            <ul className="space-y-1.5 text-xs">
              <SummaryRow
                label="Type"
                value={mode === "template" ? "Template" : "Free text (session)"}
              />
              {mode === "template" && (
                <SummaryRow label="Template" value={template?.name ?? "—"} />
              )}
              <SummaryRow label="Recipients" value={audiencePreview.length.toString()} strong />
            </ul>
            <WbButton
              className="w-full"
              onClick={() => void save()}
              loading={busy}
              disabled={busy}
            >
              Create campaign
            </WbButton>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <FontAwesomeIcon icon={faCircleInfo} className="mt-0.5 h-3 w-3" />
              Campaign is saved as draft. Start sending from the campaign page.
            </p>
          </WbCardBody>
        </WbCard>
      </div>
    </div>
  );
}

/* --------------------------- helpers --------------------------- */

function parsePhoneList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;\t]+/)
        .map((p) => normalizePhone(p))
        .filter((p) => p.length >= 10),
    ),
  );
}

function pickKeys(o: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function substituteVars(
  text: string,
  vars: string[],
  ctx: {
    varSource: VarSource;
    staticVars: Record<string, string>;
    contactFieldMap: Record<string, string>;
    contact:
      | {
          name: string;
          phone: string;
          email?: string | null;
          company?: string | null;
        }
      | null;
  },
): string {
  let out = text;
  for (const v of vars) {
    let value: string;
    if (ctx.varSource === "contact") {
      const field = ctx.contactFieldMap[v];
      const raw = field && ctx.contact ? (ctx.contact as Record<string, unknown>)[field] : "";
      value = (raw as string | null | undefined)?.toString?.() ?? "";
      if (!value) value = ctx.staticVars[v] ?? `{{${v}}}`;
    } else {
      value = ctx.staticVars[v] || `{{${v}}}`;
    }
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRe(v)}\\s*\\}\\}`, "g"), value);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* --------------------------- subcomponents --------------------------- */

function SectionCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <WbCard>
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
      <WbCardBody>{children}</WbCardBody>
    </WbCard>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  icon,
  title,
  subtitle,
  recommended,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof faKeyboard;
  title: string;
  subtitle: string;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
          : "border-border bg-background hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {recommended && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Recommended
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function InfoBanner({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warn" | "danger" | "muted";
}) {
  const styles =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
      : tone === "danger"
        ? "border-destructive/40 bg-destructive/5 text-destructive"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div
      className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", styles)}
    >
      <FontAwesomeIcon icon={faCircleInfo} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "max-w-[60%] truncate text-right",
          strong ? "text-base font-semibold text-foreground" : "font-medium text-foreground",
        )}
      >
        {value}
      </span>
    </li>
  );
}

/* --------------------------- WhatsApp preview --------------------------- */

function WhatsAppPreview({
  header,
  headerFormat,
  body,
  footer,
  buttons,
}: {
  header: string | null;
  headerFormat: "TEXT" | null;
  body: string;
  footer: string | null;
  buttons: Array<Record<string, unknown>>;
}) {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      {/* Chat header */}
      <div className="flex items-center gap-2 bg-[#075e54] px-4 py-3 text-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          W
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">WhatsApp preview</p>
          <p className="truncate text-[10px] opacity-80">online</p>
        </div>
        <FontAwesomeIcon icon={faPhone} className="h-3.5 w-3.5 opacity-90" />
      </div>

      {/* Chat area */}
      <div
        className="min-h-[360px] px-3 py-4"
        style={{
          backgroundColor: "#e5ddd5",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M0 20 L20 0 L40 20 L20 40 Z' fill='%23d9d1c7' fill-opacity='0.35'/></svg>\")",
        }}
      >
        <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#dcf8c6] p-2 shadow-sm">
          {header && headerFormat === "TEXT" && (
            <p className="mb-1 text-[13px] font-semibold text-[#111b21]">{header}</p>
          )}
          <p className="whitespace-pre-wrap text-[13px] leading-snug text-[#111b21]">
            {formatWhatsApp(body || "Message preview will appear here…")}
          </p>
          {footer && (
            <p className="mt-1 text-[11px] text-[#667781]">{footer}</p>
          )}
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
            <span>
              {hh}:{mm}
            </span>
            <FontAwesomeIcon icon={faCheckDouble} className="h-2.5 w-2.5 text-[#53bdeb]" />
          </div>

          {/* inline buttons (quick replies) */}
          {buttons && buttons.length > 0 && (
            <div className="-mx-2 -mb-2 mt-2 divide-y divide-black/5 border-t border-black/5">
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
                    className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-[#00a5f4]"
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

/** Very light WhatsApp formatting: *bold*, _italic_, ~strike~, `mono` */
function formatWhatsApp(text: string): React.ReactNode {
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

