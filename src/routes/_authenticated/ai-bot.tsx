import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBrain, faCircleNotch, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbInput } from "@/components/wb/WbInput";
import { WbButton } from "@/components/wb/WbButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAiBotConfig, EMPTY_AI_CONFIG, type AiBotConfig } from "@/hooks/useAiBotConfig";
import { useEffectiveUid, useFirebaseSession } from "@/hooks/useFirebaseSession";
import { fbDb } from "@/integrations/firebase/client";
import { toast } from "sonner";

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
  const { data, error } = useAiBotConfig();
  const [form, setForm] = useState<AiBotConfig | null>(null);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !form) {
      setForm(data);
      setFaqs(parseFaq(data.faq));
    }
  }, [data, form]);

  function set<K extends keyof AiBotConfig>(k: K, v: AiBotConfig[K]) {
    setForm((f) => ({ ...(f ?? EMPTY_AI_CONFIG), [k]: v }));
  }

  async function save() {
    if (!uid || !form) return;
    setSaving(true);
    try {
      const payload = { ...form, faq: JSON.stringify(faqs), updatedAt: serverTimestamp() };
      await setDoc(doc(fbDb(), "users", uid, "bot_config", "settings"), payload, { merge: true });
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
              Save changes
            </WbButton>
          ) : undefined
        }
      />
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardBody className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <FontAwesomeIcon icon={faBrain} />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">AI Bot</p>
                <p className="text-xs text-muted-foreground">
                  {form.enabled ? "Active — auto-replies are ON" : "Paused"}
                </p>
              </div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", v)}
              disabled={!isOwner}
            />
          </WbCardBody>
        </WbCard>

        {!isOwner && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Read-only — only the owner can edit AI bot settings.
          </p>
        )}

        <Tabs defaultValue="business">
          <TabsList className="w-full">
            <TabsTrigger value="business">Business</TabsTrigger>
            <TabsTrigger value="behavior">Behavior</TabsTrigger>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="business">
            <WbCard>
              <WbCardBody className="space-y-3">
                <WbInput
                  label="Business name"
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
                <Field label="Services / Products">
                  <Textarea
                    value={form.services}
                    onChange={(v) => set("services", v)}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="Working hours">
                  <Textarea
                    value={form.timings}
                    onChange={(v) => set("timings", v)}
                    disabled={!isOwner}
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
                  />
                </Field>
                <Field label="Additional info">
                  <Textarea
                    value={form.customInfo}
                    onChange={(v) => set("customInfo", v)}
                    disabled={!isOwner}
                  />
                </Field>
              </WbCardBody>
            </WbCard>
          </TabsContent>

          <TabsContent value="behavior">
            <WbCard>
              <WbCardBody className="space-y-3">
                <Field label="Tone">
                  <select
                    value={form.tone}
                    onChange={(e) => set("tone", e.target.value)}
                    disabled={!isOwner}
                    className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                  >
                    <option value="professional and friendly">Professional &amp; friendly</option>
                    <option value="formal">Formal</option>
                    <option value="casual">Casual</option>
                    <option value="playful">Playful</option>
                  </select>
                </Field>
                <Field label="Greeting">
                  <Textarea
                    value={form.greeting}
                    onChange={(v) => set("greeting", v)}
                    disabled={!isOwner}
                  />
                </Field>
                <WbInput
                  label="Handoff keywords"
                  hint="Comma-separated. When customer types these, AI hands off to a human."
                  value={form.handoffKeywords}
                  onChange={(e) => set("handoffKeywords", e.target.value)}
                  disabled={!isOwner}
                />
                <Field label="After-hours message">
                  <Textarea
                    value={form.afterHoursMessage}
                    onChange={(v) => set("afterHoursMessage", v)}
                    disabled={!isOwner}
                  />
                </Field>
                <WbInput
                  label="Lead fields to collect"
                  placeholder="name,phone,email"
                  value={form.leadFields}
                  onChange={(e) => set("leadFields", e.target.value)}
                  disabled={!isOwner}
                />
              </WbCardBody>
            </WbCard>
          </TabsContent>

          <TabsContent value="faq">
            <WbCard>
              <WbCardBody className="space-y-3">
                {faqs.length === 0 && <p className="text-sm text-muted-foreground">No FAQs yet.</p>}
                {faqs.map((f, i) => (
                  <div key={i} className="rounded-md border border-border p-3 space-y-2">
                    <WbInput
                      label="Question"
                      value={f.q}
                      onChange={(e) =>
                        setFaqs((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)),
                        )
                      }
                      disabled={!isOwner}
                    />
                    <Field label="Answer">
                      <Textarea
                        value={f.a}
                        onChange={(v) =>
                          setFaqs((arr) => arr.map((x, j) => (j === i ? { ...x, a: v } : x)))
                        }
                        disabled={!isOwner}
                      />
                    </Field>
                    {isOwner && (
                      <div className="flex justify-end">
                        <WbButton
                          size="sm"
                          variant="ghost"
                          onClick={() => setFaqs((arr) => arr.filter((_, j) => j !== i))}
                        >
                          <FontAwesomeIcon
                            icon={faTrash}
                            className="h-3.5 w-3.5 text-destructive"
                          />{" "}
                          Delete
                        </WbButton>
                      </div>
                    )}
                  </div>
                ))}
                {isOwner && (
                  <WbButton
                    variant="secondary"
                    onClick={() => setFaqs((a) => [...a, { q: "", a: "" }])}
                  >
                    <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> Add FAQ
                  </WbButton>
                )}
              </WbCardBody>
            </WbCard>
          </TabsContent>

          <TabsContent value="advanced">
            <WbCard>
              <WbCardBody>
                <Field label="Custom AI instructions">
                  <Textarea
                    rows={8}
                    value={form.customInstructions}
                    onChange={(v) => set("customInstructions", v)}
                    disabled={!isOwner}
                  />
                </Field>
                <p className="mt-2 text-xs text-muted-foreground">
                  Tell the AI exactly how to behave, what to avoid, etc.
                </p>
              </WbCardBody>
            </WbCard>
          </TabsContent>
        </Tabs>
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
