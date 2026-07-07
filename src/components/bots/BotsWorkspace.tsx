import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBolt,
  faCircleNotch,
  faRobot,
  faPlus,
  faTrash,
  faMagnifyingGlass,
  faPen,
  faKeyboard,
  faComments,
  faMessage,
  faReply,
  faLayerGroup,
  faCircleCheck,
  faPause,
  faStopwatch,
  faListCheck,
  faLink,
  faList,
} from "@fortawesome/free-solid-svg-icons";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { Switch } from "@/components/ui/switch";
import { WhatsAppPreview } from "@/components/shared/WhatsAppPreview";
import { useBots, type Bot } from "@/hooks/useBots";
import { useProfile } from "@/hooks/useProfile";
import { useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { useOwnerCollectionCount } from "@/hooks/useCollectionCount";
import { fbDb } from "@/integrations/firebase/client";
import { cn } from "@/lib/utils";

type Mode = { kind: "empty" } | { kind: "edit"; id: string } | { kind: "new" };

type FormState = {
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  triggerKeywords: string;
  caseSensitive: boolean;
  responseText: string;
  headerText: string;
  footerText: string;
  delaySeconds: number;
  cooldownMinutes: number;
  ctaLabel: string;
  ctaUrl: string;
  additionalMessages: string; // newline-separated, each line = an extra follow-up message
};

const TRIGGER_LABEL: Record<string, string> = {
  keyword: "Keyword match",
  all_messages: "Every message",
  first_message: "First message",
  button_reply: "Button reply",
};

function empty(): FormState {
  return {
    name: "",
    description: "",
    isActive: true,
    triggerType: "keyword",
    triggerKeywords: "",
    caseSensitive: false,
    responseText: "",
    headerText: "",
    footerText: "",
    delaySeconds: 0,
    cooldownMinutes: 0,
    ctaLabel: "",
    ctaUrl: "",
    additionalMessages: "",
  };
}

function fromBot(b: Bot): FormState {
  const cta = (b.ctaButton ?? {}) as Record<string, unknown>;
  const ctaLabel = typeof cta.label === "string" ? cta.label : typeof cta.text === "string" ? cta.text : "";
  const ctaUrl = typeof cta.url === "string" ? cta.url : typeof cta.href === "string" ? cta.href : "";
  const extras = (b.additionalResponses ?? [])
    .map((r) => (r && typeof (r as Record<string, unknown>).text === "string" ? String((r as Record<string, unknown>).text) : ""))
    .filter(Boolean)
    .join("\n");
  return {
    name: b.name,
    description: b.description,
    isActive: b.isActive,
    triggerType: b.triggerType,
    triggerKeywords: b.triggerKeywords.join(", "),
    caseSensitive: b.caseSensitive,
    responseText: b.responseText,
    headerText: b.headerText ?? "",
    footerText: b.footerText ?? "",
    delaySeconds: b.delaySeconds,
    cooldownMinutes: b.cooldownMinutes ?? 0,
    ctaLabel,
    ctaUrl,
    additionalMessages: extras,
  };
}

export function BotsWorkspace() {
  const { data, error } = useBots();
  const uid = useEffectiveUid();
  const session = useFirebaseSession();
  const isOwner = session.status === "ready" && !session.dataOwner;
  const { data: profile } = useProfile("effective");
  const { data: realBots } = useOwnerCollectionCount("bots", "bots");
  const totalBotsAuthoritative = realBots ?? Math.max(profile?.totalBots ?? 0, data?.length ?? 0);

  const [mode, setMode] = useState<Mode>({ kind: "empty" });
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(empty());
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.responseText.toLowerCase().includes(q) ||
        b.triggerKeywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, active: 0, keyword: 0, triggered: 0 };
    return data.reduce(
      (a, b) => ({
        total: a.total + 1,
        active: a.active + (b.isActive ? 1 : 0),
        keyword: a.keyword + (b.triggerType === "keyword" ? 1 : 0),
        triggered: a.triggered + b.totalTriggered,
      }),
      { total: 0, active: 0, keyword: 0, triggered: 0 },
    );
  }, [data]);

  const selected = useMemo(
    () => (mode.kind === "edit" && data ? (data.find((b) => b.id === mode.id) ?? null) : null),
    [mode, data],
  );

  useEffect(() => {
    if (mode.kind === "edit" && selected) setForm(fromBot(selected));
    if (mode.kind === "new") setForm(empty());
  }, [mode, selected]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!isOwner) return toast.error("Only the owner can edit bots");
    if (!uid) return;
    if (!form.name.trim() || !form.responseText.trim())
      return toast.error("Name and reply text are required");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        isActive: form.isActive,
        triggerType: form.triggerType,
        triggerKeywords: form.triggerKeywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        caseSensitive: form.caseSensitive,
        responseText: form.responseText,
        headerText: form.headerText || null,
        footerText: form.footerText || null,
        delaySeconds: Number(form.delaySeconds) || 0,
        cooldownMinutes: Number(form.cooldownMinutes) || 0,
        ctaButton:
          form.ctaLabel.trim() && form.ctaUrl.trim()
            ? { label: form.ctaLabel.trim(), url: form.ctaUrl.trim(), type: "URL" }
            : null,
        additionalResponses: form.additionalMessages
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((text) => ({ type: "text", text })),
        updatedAt: serverTimestamp(),
      };
      if (mode.kind === "edit") {
        await updateDoc(doc(fbDb(), "users", uid, "bots", mode.id), payload);
        (await import("@/lib/firebase/refetchBus")).bumpRefetch("bots");
        toast.success("Bot updated");
      } else {
        const { reserveQuota, releaseQuota } = await import("@/lib/plans/limits");
        await reserveQuota(uid, "bots");
        let ref: Awaited<ReturnType<typeof addDoc>> | null = null;
        try {
          ref = await addDoc(collection(fbDb(), "users", uid, "bots"), {
            ...payload,
            quickReplies: [],
            totalTriggered: 0,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          await releaseQuota(uid, "bots", 1).catch(() => {});
          throw err;
        }
        (await import("@/lib/firebase/refetchBus")).bumpRefetch("bots");
        toast.success("Bot created");
        setMode({ kind: "edit", id: ref.id });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(b: Bot) {
    if (!uid) return;
    try {
      await updateDoc(doc(fbDb(), "users", uid, "bots", b.id), { isActive: !b.isActive });
      (await import("@/lib/firebase/refetchBus")).bumpRefetch("bots");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  }

  async function remove(b: Bot) {
    if (!uid) return;
    if (!confirm(`Delete bot "${b.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(fbDb(), "users", uid, "bots", b.id));
      const { releaseQuota } = await import("@/lib/plans/limits");
      await releaseQuota(uid, "bots", 1).catch(() => {});
      (await import("@/lib/firebase/refetchBus")).bumpRefetch("bots");
      toast.success("Bot deleted");
      if (mode.kind === "edit" && mode.id === b.id) setMode({ kind: "empty" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={faLayerGroup} label="Total bots" value={Math.max(totalBotsAuthoritative, stats.total)} tone="primary" />
        <Kpi icon={faCircleCheck} label="Active" value={stats.active} tone="success" />
        <Kpi icon={faKeyboard} label="Keyword" value={stats.keyword} />
        <Kpi icon={faBolt} label="Total triggers" value={stats.triggered} tone="warning" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bots, keywords, replies…"
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
        <WbButton size="sm" onClick={() => setMode({ kind: "new" })} disabled={!isOwner}>
          <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> New bot
        </WbButton>
      </div>

      {/* Two-column — narrower list, wider editor+preview */}
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* LEFT — list */}
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">
              {filtered.length} bot{filtered.length === 1 ? "" : "s"}
            </p>
            <span className="text-xs text-muted-foreground">{stats.active} active</span>
          </div>
          {data === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <WbEmpty
                icon={faRobot}
                title={data.length === 0 ? "No bots yet" : "No matches"}
                description={
                  data.length === 0
                    ? "Create your first keyword or greeting auto-reply bot."
                    : "Try a different search term."
                }
                action={
                  data.length === 0 && isOwner ? (
                    <WbButton onClick={() => setMode({ kind: "new" })}>
                      <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> Create bot
                    </WbButton>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border/60 overflow-y-auto">
              {filtered.map((b) => (
                <BotRow
                  key={b.id}
                  bot={b}
                  active={mode.kind === "edit" && mode.id === b.id}
                  onSelect={() => setMode({ kind: "edit", id: b.id })}
                  onToggle={() => toggleActive(b)}
                  onDelete={() => remove(b)}
                  canEdit={isOwner}
                />
              ))}
            </ul>
          )}
        </div>

        {/* RIGHT — editor + preview */}
        <div className="rounded-2xl border border-border bg-card">
          {mode.kind === "empty" ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-8 text-center text-muted-foreground">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <FontAwesomeIcon icon={faRobot} className="h-6 w-6" />
              </div>
              <h4 className="mt-4 text-base font-semibold text-foreground">Select a bot</h4>
              <p className="mt-1 max-w-xs text-sm">
                Pick a bot on the left to edit it, or create a new keyword auto-reply.
              </p>
              {isOwner && (
                <WbButton className="mt-5" onClick={() => setMode({ kind: "new" })}>
                  <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> New bot
                </WbButton>
              )}
            </div>
          ) : (
            <BotEditor
              form={form}
              set={set}
              onSave={save}
              saving={saving}
              isOwner={isOwner}
              isNew={mode.kind === "new"}
              onCancel={() => setMode({ kind: "empty" })}
              existing={selected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BotRow({
  bot,
  active,
  onSelect,
  onToggle,
  onDelete,
  canEdit,
}: {
  bot: Bot;
  active: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  return (
    <li>
      <div
        className={cn(
          "group flex w-full items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
          active && "bg-primary/5",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                bot.isActive
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <FontAwesomeIcon icon={faRobot} className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{bot.name}</p>
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {bot.description || bot.responseText || "Auto-reply"}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FontAwesomeIcon icon={faReply} className="h-3 w-3" />
              {TRIGGER_LABEL[bot.triggerType] ?? bot.triggerType}
            </span>
            <span className="inline-flex items-center gap-1">
              <FontAwesomeIcon icon={faBolt} className="h-3 w-3" />
              {bot.totalTriggered} runs
            </span>
            {bot.triggerKeywords.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <FontAwesomeIcon icon={faKeyboard} className="h-3 w-3" />
                {bot.triggerKeywords.length} kw
              </span>
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={bot.isActive}
            onCheckedChange={onToggle}
            disabled={!canEdit}
            aria-label="Toggle active"
          />
          <button
            onClick={onDelete}
            disabled={!canEdit}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:hidden"
            aria-label="Delete bot"
          >
            <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
          </button>
        </div>
      </div>
    </li>
  );
}

function BotEditor({
  form,
  set,
  onSave,
  saving,
  isOwner,
  isNew,
  onCancel,
  existing,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onSave: () => void;
  saving: boolean;
  isOwner: boolean;
  isNew: boolean;
  onCancel: () => void;
  existing: Bot | null;
}) {
  const keywordsArr = form.triggerKeywords
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isNew ? "New bot" : "Editing"}
          </p>
          <h3 className="mt-0.5 truncate text-lg font-semibold text-foreground">
            {form.name || (isNew ? "Untitled bot" : "Bot")}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WbButton size="sm" variant="secondary" onClick={onCancel}>
            Close
          </WbButton>
          <WbButton size="sm" onClick={onSave} loading={saving} disabled={!isOwner}>
            <FontAwesomeIcon icon={faCircleCheck} className="h-3.5 w-3.5" />
            {isNew ? "Create bot" : "Save changes"}
          </WbButton>
        </div>
      </div>

      {!isOwner && (
        <p className="border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
          Read-only — only the workspace owner can edit bots.
        </p>
      )}

      {/* Body: form + preview */}
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        {/* Form */}
        <div className="space-y-4">
          <Section title="Identity" icon={faPen}>
            <div className="grid gap-3 sm:grid-cols-2">
              <WbInput
                label="Bot name"
                placeholder="e.g. Welcome bot"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                disabled={!isOwner}
              />
              <div className="flex items-end">
                <label className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span className="inline-flex items-center gap-2 text-foreground">
                    <FontAwesomeIcon
                      icon={form.isActive ? faCircleCheck : faPause}
                      className={cn(
                        "h-3.5 w-3.5",
                        form.isActive ? "text-emerald-500" : "text-muted-foreground",
                      )}
                    />
                    Active
                  </span>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(v) => set("isActive", v)}
                    disabled={!isOwner}
                  />
                </label>
              </div>
            </div>
            <WbInput
              label="Description"
              placeholder="Short internal note (optional)"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              disabled={!isOwner}
            />
          </Section>

          <Section title="Trigger" icon={faReply}>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Trigger type</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    { v: "keyword", l: "Keyword", i: faKeyboard },
                    { v: "all_messages", l: "Any message", i: faComments },
                    { v: "first_message", l: "First msg", i: faMessage },
                    { v: "button_reply", l: "Button reply", i: faReply },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    onClick={() => set("triggerType", t.v)}
                    disabled={!isOwner}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors",
                      form.triggerType === t.v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <FontAwesomeIcon icon={t.i} className="h-3.5 w-3.5" />
                    {t.l}
                  </button>
                ))}
              </div>
            </div>
            {form.triggerType === "keyword" && (
              <>
                <WbInput
                  label="Trigger keywords"
                  hint="Comma-separated. Message matching any of these will fire the bot."
                  placeholder="hi, hello, salam, price"
                  value={form.triggerKeywords}
                  onChange={(e) => set("triggerKeywords", e.target.value)}
                  disabled={!isOwner}
                />
                {keywordsArr.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {keywordsArr.map((k) => (
                      <span
                        key={k}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span className="text-foreground">Case sensitive</span>
                  <Switch
                    checked={form.caseSensitive}
                    onCheckedChange={(v) => set("caseSensitive", v)}
                    disabled={!isOwner}
                  />
                </label>
              </>
            )}
          </Section>

          <Section title="Reply" icon={faMessage}>
            <WbInput
              label="Header (optional)"
              placeholder="e.g. Welcome!"
              value={form.headerText}
              onChange={(e) => set("headerText", e.target.value)}
              disabled={!isOwner}
            />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Reply text</label>
              <textarea
                rows={5}
                value={form.responseText}
                onChange={(e) => set("responseText", e.target.value)}
                disabled={!isOwner}
                placeholder="Write the reply message. Use *bold*, _italic_, ~strike~ formatting."
                className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
              <p className="text-[11px] text-muted-foreground">{form.responseText.length}/1024</p>
            </div>
            <WbInput
              label="Footer (optional)"
              placeholder="Small text under the reply"
              value={form.footerText}
              onChange={(e) => set("footerText", e.target.value)}
              disabled={!isOwner}
            />
          </Section>

          <Section title="Call-to-action button" icon={faLink}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
              <WbInput
                label="Button label"
                placeholder="Visit site"
                value={form.ctaLabel}
                onChange={(e) => set("ctaLabel", e.target.value)}
                disabled={!isOwner}
              />
              <WbInput
                label="URL"
                placeholder="https://example.com"
                value={form.ctaUrl}
                onChange={(e) => set("ctaUrl", e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Adds a URL button below the reply. Leave both empty for a plain text reply.
            </p>
          </Section>

          <Section title="Follow-up messages" icon={faList}>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Additional messages (one per line)
              </label>
              <textarea
                rows={4}
                value={form.additionalMessages}
                onChange={(e) => set("additionalMessages", e.target.value)}
                disabled={!isOwner}
                placeholder={"Second message sent right after the main reply\nThird message …"}
                className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
              <p className="text-[11px] text-muted-foreground">
                Each non-empty line is sent as a separate WhatsApp message after the main reply, in
                order. Use blank lines to skip.
              </p>
            </div>
          </Section>

          <Section title="Timing & limits" icon={faStopwatch}>
            <div className="grid gap-3 sm:grid-cols-2">
              <WbInput
                type="number"
                label="Reply delay (seconds)"
                hint="Wait before sending the reply."
                value={String(form.delaySeconds)}
                onChange={(e) => set("delaySeconds", Number(e.target.value) || 0)}
                disabled={!isOwner}
              />
              <WbInput
                type="number"
                label="Cooldown (minutes)"
                hint="Minimum gap before same contact triggers again."
                value={String(form.cooldownMinutes)}
                onChange={(e) => set("cooldownMinutes", Number(e.target.value) || 0)}
                disabled={!isOwner}
              />
            </div>
          </Section>

          {existing && !isNew && (
            <Section title="Analytics" icon={faListCheck}>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <Stat label="Total triggers" value={String(existing.totalTriggered)} />
                <Stat label="Trigger type" value={TRIGGER_LABEL[existing.triggerType] ?? existing.triggerType} />
                <Stat
                  label="Keywords"
                  value={String(existing.triggerKeywords.length)}
                />
              </div>
            </Section>
          )}
        </div>

        {/* Preview column */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Live preview
          </p>
          <WhatsAppPreview
            title={form.name || "Bot preview"}
            header={form.headerText || null}
            headerFormat={form.headerText ? "TEXT" : null}
            body={form.responseText || "Your reply will appear here as the customer sees it."}
            footer={form.footerText || null}
            buttons={
              form.ctaLabel.trim() && form.ctaUrl.trim()
                ? [{ type: "URL", text: form.ctaLabel.trim(), url: form.ctaUrl.trim() }]
                : []
            }
          />
          <div className="rounded-xl border border-dashed border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
            Preview updates as you type. Formatting: <code>*bold*</code>, <code>_italic_</code>,{" "}
            <code>~strike~</code>, <code>`mono`</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconDefinition;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary">
          <FontAwesomeIcon icon={icon} className="h-3 w-3" />
        </span>
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconDefinition;
  label: string;
  value: number;
  tone?: "primary" | "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : tone === "danger"
        ? "bg-destructive/15 text-destructive"
        : tone === "warning"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : tone === "primary"
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", toneClass)}>
          <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  );
}