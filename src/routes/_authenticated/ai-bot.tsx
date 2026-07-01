import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBrain,
  faCircleNotch,
  faPlus,
  faTrash,
  faBuilding,
  faSliders,
  faQuestion,
  faWandMagicSparkles,
  faCircleCheck,
  faPause,
  faStore,
  faClock,
  faLocationDot,
  faPhone,
  faHandshake,
  faMessage,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { TopBar } from "@/components/shell/TopBar";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAiBotConfig, EMPTY_AI_CONFIG, type AiBotConfig } from "@/hooks/useAiBotConfig";
import { useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { fbDb } from "@/integrations/firebase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ai-bot")({
  head: () => ({ meta: [{ title: "AI Bot — Wabees" }] }),
  component: AiBotPage,
});

type Faq = { q: string; a: string };

function parseFaq(json: string): Faq[] {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v))
      return v
        .filter((x) => x && typeof x === "object")
        .map((x: { q?: unknown; a?: unknown }) => ({ q: String(x.q ?? ""), a: String(x.a ?? "") }));
  } catch {
    /* ignore */
  }
  return [];
}

function AiBotPage() {
  const uid = useEffectiveUid();
  const session = useFirebaseSession();
  const isOwner = session.status === "ready" && !session.dataOwner;
  const { data, error, exists } = useAiBotConfig();
  const [form, setForm] = useState<AiBotConfig | null>(null);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Track the last remote snapshot we synced so we only apply real changes.
  const lastSyncedRef = useRef<string>("");

  // Re-sync form whenever remote config changes AND the user has no unsaved
  // edits. This mirrors the Flutter app's StreamProvider behavior so edits
  // made on the phone show up immediately on the web (and vice-versa).
  useEffect(() => {
    if (!data) return;
    const signature = JSON.stringify(data);
    if (signature === lastSyncedRef.current) return;
    if (dirty) return; // don't clobber unsaved edits
    lastSyncedRef.current = signature;
    setForm(data);
    setFaqs(parseFaq(data.faq));
  }, [data, dirty]);

  function set<K extends keyof AiBotConfig>(k: K, v: AiBotConfig[K]) {
    setDirty(true);
    setForm((f) => ({ ...(f ?? EMPTY_AI_CONFIG), [k]: v }));
  }

  function updateFaqs(next: Faq[] | ((prev: Faq[]) => Faq[])) {
    setDirty(true);
    setFaqs((prev) => (typeof next === "function" ? (next as (p: Faq[]) => Faq[])(prev) : next));
  }

  async function save() {
    if (!uid || !form) return;
    setSaving(true);
    try {
      const payload = { ...form, faq: JSON.stringify(faqs), updatedAt: serverTimestamp() };
      await setDoc(doc(fbDb(), "users", uid, "bot_config", "settings"), payload, { merge: true });
      setDirty(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (error)
    return (
      <>
        <TopBar title="AI Bot" />
        <div className="p-6 text-sm text-destructive">{error}</div>
      </>
    );
  if (!data || !form) {
    return (
      <>
        <TopBar title="AI Bot" subtitle="Configure your AI auto-reply assistant" />
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="AI Bot"
        subtitle="Configure your AI auto-reply assistant"
        right={
          isOwner ? (
            <WbButton onClick={save} loading={saving}>
              <FontAwesomeIcon icon={faCircleCheck} className="h-3.5 w-3.5" /> Save changes
            </WbButton>
          ) : undefined
        }
      />
      <div className="space-y-5 px-4 py-6 sm:px-6">
        {/* Hero status */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary shadow-soft">
                <FontAwesomeIcon icon={faBrain} className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-foreground">
                    {form.businessName || "AI Assistant"}
                  </h2>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      form.enabled
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <FontAwesomeIcon
                      icon={form.enabled ? faCircleCheck : faPause}
                      className="h-2.5 w-2.5"
                    />
                    {form.enabled ? "Live" : "Paused"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {form.enabled
                    ? "Auto-replying to customers using your business context."
                    : "Turn on to let AI reply to new WhatsApp messages."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Assistant
                </p>
                <p className="text-xs font-semibold text-foreground">
                  {form.enabled ? "On" : "Off"}
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => set("enabled", v)}
                disabled={!isOwner}
              />
            </div>
          </div>
        </div>

        {!isOwner && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Read-only — only the workspace owner can edit AI bot settings.
          </p>
        )}

        {/* Two-column workspace */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div className="rounded-2xl border border-border bg-card">
            <Tabs defaultValue="business">
              <div className="border-b border-border px-2 pt-2">
                <TabsList className="w-full justify-start bg-transparent">
                  <TabsTrigger value="business" className="gap-1.5">
                    <FontAwesomeIcon icon={faBuilding} className="h-3 w-3" /> Business
                  </TabsTrigger>
                  <TabsTrigger value="behavior" className="gap-1.5">
                    <FontAwesomeIcon icon={faSliders} className="h-3 w-3" /> Behavior
                  </TabsTrigger>
                  <TabsTrigger value="faq" className="gap-1.5">
                    <FontAwesomeIcon icon={faQuestion} className="h-3 w-3" /> FAQ
                    {faqs.length > 0 && (
                      <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                        {faqs.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="advanced" className="gap-1.5">
                    <FontAwesomeIcon icon={faWandMagicSparkles} className="h-3 w-3" /> Advanced
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="business" className="mt-0 space-y-4 p-5">
                <Section title="Business identity" icon={faStore}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <WbInput
                  label="Business name"
                      placeholder="e.g. Wabees Cafe"
                  value={form.businessName}
                  onChange={(e) => set("businessName", e.target.value)}
                  disabled={!isOwner}
                />
                <WbInput
                  label="Business type"
                  placeholder="Restaurant, Retail, Services…"
                  value={form.businessType}
                  onChange={(e) => set("businessType", e.target.value)}
                  disabled={!isOwner}
                />
                  </div>
                <Field label="Services / Products">
                  <Textarea
                    value={form.services}
                    onChange={(v) => set("services", v)}
                    disabled={!isOwner}
                        rows={3}
                  />
                </Field>
                </Section>
                <Section title="Operating info" icon={faClock}>
                <Field label="Working hours">
                  <Textarea
                    value={form.timings}
                    onChange={(v) => set("timings", v)}
                    disabled={!isOwner}
                        rows={2}
                  />
                </Field>
                <WbInput
                  label="Location / Address"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  disabled={!isOwner}
                />
                <Field label="Contact info">
                  <Textarea
                    value={form.contacts}
                    onChange={(v) => set("contacts", v)}
                    disabled={!isOwner}
                        rows={2}
                  />
                </Field>
                <Field label="Additional info">
                  <Textarea
                    value={form.customInfo}
                    onChange={(v) => set("customInfo", v)}
                    disabled={!isOwner}
                  />
                </Field>
                </Section>
          </TabsContent>

              <TabsContent value="behavior" className="mt-0 space-y-4 p-5">
                <Section title="Personality" icon={faHandshake}>
                <Field label="Tone">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(
                          [
                            { v: "professional and friendly", l: "Pro + friendly" },
                            { v: "formal", l: "Formal" },
                            { v: "casual", l: "Casual" },
                            { v: "playful", l: "Playful" },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.v}
                            type="button"
                            onClick={() => set("tone", t.v)}
                            disabled={!isOwner}
                            className={cn(
                              "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                              form.tone === t.v
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {t.l}
                          </button>
                        ))}
                      </div>
                </Field>
                <Field label="Greeting">
                  <Textarea
                    value={form.greeting}
                    onChange={(v) => set("greeting", v)}
                    disabled={!isOwner}
                        rows={3}
                  />
                </Field>
                </Section>
                <Section title="Handoff & leads" icon={faUser}>
                <WbInput
                  label="Handoff keywords"
                  hint="Comma-separated. When customer types these, AI hands off to a human."
                      placeholder="agent, human, complain"
                  value={form.handoffKeywords}
                  onChange={(e) => set("handoffKeywords", e.target.value)}
                  disabled={!isOwner}
                />
                <Field label="After-hours message">
                  <Textarea
                    value={form.afterHoursMessage}
                    onChange={(v) => set("afterHoursMessage", v)}
                    disabled={!isOwner}
                        rows={2}
                  />
                </Field>
                <WbInput
                  label="Lead fields to collect"
                  placeholder="name,phone,email"
                  value={form.leadFields}
                  onChange={(e) => set("leadFields", e.target.value)}
                  disabled={!isOwner}
                />
                </Section>
          </TabsContent>

              <TabsContent value="faq" className="mt-0 space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">FAQ knowledge base</h4>
                    <p className="text-xs text-muted-foreground">
                      Teach the AI exact answers to common customer questions.
                    </p>
                  </div>
                  {isOwner && (
                    <WbButton
                      size="sm"
                      variant="secondary"
                      onClick={() => updateFaqs((a) => [...a, { q: "", a: "" }])}
                    >
                      <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> Add FAQ
                    </WbButton>
                  )}
                </div>
                {faqs.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 px-6 py-10 text-center">
                    <FontAwesomeIcon
                      icon={faQuestion}
                      className="h-5 w-5 text-muted-foreground"
                    />
                    <p className="mt-2 text-sm font-medium text-foreground">No FAQs yet</p>
                    <p className="text-xs text-muted-foreground">
                      Add question/answer pairs to guide the AI.
                    </p>
                  </div>
                )}
                {faqs.map((f, i) => (
                  <div key={i} className="space-y-2 rounded-xl border border-border bg-background/40 p-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
                          {i + 1}
                        </span>
                        FAQ
                      </span>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => updateFaqs((arr) => arr.filter((_, j) => j !== i))}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete FAQ"
                        >
                          <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <WbInput
                      label="Question"
                          placeholder="e.g. What are your prices?"
                      value={f.q}
                      onChange={(e) =>
                        updateFaqs((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)),
                        )
                      }
                      disabled={!isOwner}
                    />
                    <Field label="Answer">
                      <Textarea
                        value={f.a}
                        onChange={(v) =>
                          updateFaqs((arr) => arr.map((x, j) => (j === i ? { ...x, a: v } : x)))
                        }
                        disabled={!isOwner}
                            rows={3}
                      />
                    </Field>
                  </div>
                ))}
          </TabsContent>

              <TabsContent value="advanced" className="mt-0 space-y-4 p-5">
                <Section title="Custom instructions" icon={faWandMagicSparkles}>
                <Field label="Custom AI instructions">
                  <Textarea
                    rows={8}
                    value={form.customInstructions}
                    onChange={(v) => set("customInstructions", v)}
                    disabled={!isOwner}
                  />
                </Field>
                <p className="mt-2 text-xs text-muted-foreground">
                      Tell the AI exactly how to behave, what to avoid, and any policies to follow.
                </p>
                </Section>
          </TabsContent>
        </Tabs>
          </div>

          {/* Preview column */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <AiBotPreview form={form} faqs={faqs} />
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function Textarea({
  value,
  onChange,
  rows = 3,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      disabled={disabled}
      className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    />
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

function AiBotPreview({ form, faqs }: { form: AiBotConfig; faqs: Faq[] }) {
  const now = useMemo(() => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }, []);
  const businessLabel = form.businessName || "AI Assistant";
  const greeting =
    form.greeting ||
    `Hi! 👋 Welcome to ${businessLabel}. How can I help you today?`;

  const highlights: Array<{ icon: IconDefinition; label: string; value: string }> = [];
  if (form.businessType) highlights.push({ icon: faStore, label: "Type", value: form.businessType });
  if (form.timings) highlights.push({ icon: faClock, label: "Hours", value: form.timings });
  if (form.location) highlights.push({ icon: faLocationDot, label: "Location", value: form.location });
  if (form.contacts) highlights.push({ icon: faPhone, label: "Contact", value: form.contacts });

  const firstFaq = faqs.find((f) => f.q.trim() && f.a.trim());

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Live preview
      </p>
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-2 bg-[#075e54] px-4 py-3 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
            <FontAwesomeIcon icon={faBrain} className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{businessLabel}</p>
            <p className="truncate text-[10px] opacity-80">
              {form.enabled ? "online · AI-powered" : "paused"}
            </p>
          </div>
        </div>
        {/* Chat body */}
        <div
          className="space-y-2 px-3 py-4"
          style={{
            minHeight: 360,
            backgroundColor: "#e5ddd5",
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M0 20 L20 0 L40 20 L20 40 Z' fill='%23d9d1c7' fill-opacity='0.35'/></svg>\")",
          }}
        >
          {/* Incoming customer bubble */}
          <div className="max-w-[80%] rounded-lg rounded-tl-sm bg-white p-2 shadow-sm">
            <p className="text-[14px] leading-[1.45] text-[#111b21]">Hi</p>
            <div className="mt-1 flex justify-end text-[10px] text-[#667781]">{now}</div>
          </div>
          {/* Assistant greeting */}
          <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#dcf8c6] p-2 shadow-sm">
            <p className="whitespace-pre-wrap text-[14px] leading-[1.45] text-[#111b21]">
              {greeting}
            </p>
            <div className="mt-1 flex justify-end text-[10px] text-[#667781]">{now}</div>
          </div>
          {/* Info card style reply */}
          {highlights.length > 0 && (
            <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#dcf8c6] p-2 shadow-sm">
              <p className="text-[13px] font-semibold text-[#111b21]">About {businessLabel}</p>
              <div className="mt-1.5 space-y-1">
                {highlights.slice(0, 4).map((h) => (
                  <p
                    key={h.label}
                    className="flex items-start gap-1.5 text-[12px] leading-[1.4] text-[#111b21]"
                  >
                    <FontAwesomeIcon icon={h.icon} className="mt-[3px] h-3 w-3 text-[#075e54]" />
                    <span>
                      <span className="font-semibold">{h.label}:</span> {h.value}
                    </span>
                  </p>
                ))}
              </div>
              <div className="mt-1 flex justify-end text-[10px] text-[#667781]">{now}</div>
            </div>
          )}
          {/* FAQ demo */}
          {firstFaq && (
            <>
              <div className="max-w-[80%] rounded-lg rounded-tl-sm bg-white p-2 shadow-sm">
                <p className="text-[14px] leading-[1.45] text-[#111b21]">{firstFaq.q}</p>
                <div className="mt-1 flex justify-end text-[10px] text-[#667781]">{now}</div>
              </div>
              <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-[#dcf8c6] p-2 shadow-sm">
                <p className="whitespace-pre-wrap text-[14px] leading-[1.45] text-[#111b21]">
                  {firstFaq.a}
                </p>
                <div className="mt-1 flex justify-end text-[10px] text-[#667781]">{now}</div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
        <p className="mb-1 inline-flex items-center gap-1.5 font-semibold text-foreground">
          <FontAwesomeIcon icon={faMessage} className="h-3 w-3 text-primary" /> How this looks live
        </p>
        This is how your AI assistant introduces itself and uses your business info. Update fields
        on the left to see it change here.
      </div>
    </div>
  );
}
