import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faPlus,
  faTrash,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { WhatsAppPreview, type HeaderFormat } from "@/components/shared/WhatsAppPreview";
import { cn } from "@/lib/utils";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { createMetaTemplate } from "@/lib/wabees/api";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import { fbDb } from "@/integrations/firebase/client";
import { doc, getDoc } from "firebase/firestore";

type Category = "MARKETING" | "UTILITY" | "AUTHENTICATION";
type HeaderKind = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonKind = "NONE" | "QUICK_REPLY" | "CTA";

type CtaButton =
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "ur", label: "Urdu" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pt_BR", label: "Portuguese (BR)" },
  { code: "id", label: "Indonesian" },
];

function extractVars(text: string): string[] {
  // Meta supports positional ({{1}}) and named ({{name}}) parameters. Accept both.
  const m = text.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
  if (!m) return [];
  return Array.from(new Set(m.map((s) => s.replace(/[{}\s]/g, ""))));
}

function renderWithSamples(text: string, samples: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => samples[k] || `{{${k}}}`);
}

function nextVarToken(text: string): string {
  // Only auto-increment numeric variables (Meta best-practice for positional
  // params). Named variables like {{name}} must be typed manually by the user.
  const nums = extractVars(text)
    .filter((v) => /^\d+$/.test(v))
    .map((n) => Number(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `{{${next}}}`;
}

export function TemplateComposer() {
  const navigate = useNavigate();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("MARKETING");
  const [language, setLanguage] = useState("en_US");
  const [allowCategoryChange, setAllowCategoryChange] = useState(true);

  const [headerKind, setHeaderKind] = useState<HeaderKind>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");

  const [body, setBody] = useState("");
  const [bodySamples, setBodySamples] = useState<Record<string, string>>({});
  const [namedVar, setNamedVar] = useState("");

  const [footer, setFooter] = useState("");

  const [buttonKind, setButtonKind] = useState<ButtonKind>("NONE");
  const [quickReplies, setQuickReplies] = useState<string[]>([""]);
  const [ctaButtons, setCtaButtons] = useState<CtaButton[]>([
    { type: "URL", text: "", url: "https://" },
  ]);

  const [submitting, setSubmitting] = useState(false);

  const bodyVars = useMemo(() => extractVars(body), [body]);
  const headerVars = useMemo(
    () => (headerKind === "TEXT" ? extractVars(headerText) : []),
    [headerKind, headerText],
  );

  const previewBody = useMemo(() => renderWithSamples(body, bodySamples), [body, bodySamples]);
  const previewHeader = useMemo(() => {
    if (headerKind !== "TEXT") return null;
    return renderWithSamples(headerText, bodySamples);
  }, [headerKind, headerText, bodySamples]);

  const previewHeaderFormat: HeaderFormat = headerKind === "NONE" ? null : (headerKind as HeaderFormat);

  const previewButtons = useMemo<Array<Record<string, unknown>>>(() => {
    if (buttonKind === "QUICK_REPLY") {
      return quickReplies
        .filter((t) => t.trim())
        .map((t) => ({ type: "QUICK_REPLY", text: t }));
    }
    if (buttonKind === "CTA") {
      return ctaButtons
        .filter((b) => b.text.trim())
        .map((b) =>
          b.type === "URL"
            ? { type: "URL", text: b.text, url: b.url }
            : { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number },
        );
    }
    return [];
  }, [buttonKind, quickReplies, ctaButtons]);

  function insertVarInBody() {
    setBody((b) => `${b}${nextVarToken(b)}`);
  }

  function insertNamedVarInBody() {
    const raw = namedVar.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!raw) {
      toast.error("Enter a variable name (letters, numbers, underscores).");
      return;
    }
    if (/^\d/.test(raw)) {
      toast.error("Named variables must start with a letter.");
      return;
    }
    setBody((b) => `${b}{{${raw}}}`);
    setNamedVar("");
  }

  function validate(): string | null {
    if (!/^[a-z0-9_]{1,512}$/.test(name)) {
      return "Name must be lowercase letters, numbers or underscores (e.g. order_confirmation).";
    }
    if (!body.trim()) return "Body is required.";
    if (body.length > 1024) return "Body must be ≤ 1024 characters.";
    if (footer.length > 60) return "Footer must be ≤ 60 characters.";
    if (headerKind === "TEXT") {
      if (!headerText.trim()) return "Header text is empty.";
      if (headerText.length > 60) return "Header text must be ≤ 60 characters.";
      if (extractVars(headerText).length > 1) return "Header allows at most one {{1}} variable.";
    }
    if (headerKind !== "NONE" && headerKind !== "TEXT" && !headerMediaUrl.trim()) {
      return "Provide a sample media URL so Meta can review your header.";
    }
    for (const v of bodyVars) {
      if (!bodySamples[v] || !bodySamples[v].trim()) {
        return `Provide an example value for {{${v}}}.`;
      }
    }
    if (buttonKind === "QUICK_REPLY") {
      const cleaned = quickReplies.map((s) => s.trim()).filter(Boolean);
      if (cleaned.length === 0) return "Add at least one quick-reply button or switch to None.";
      if (cleaned.length > 3) return "Maximum 3 quick-reply buttons.";
    }
    if (buttonKind === "CTA") {
      const cleaned = ctaButtons.filter((b) => b.text.trim());
      if (cleaned.length === 0) return "Add at least one call-to-action button or switch to None.";
      if (cleaned.length > 2) return "Maximum 2 call-to-action buttons.";
      for (const b of cleaned) {
        if (b.type === "URL" && !/^https?:\/\//i.test(b.url)) return "URL button needs http(s) URL.";
        if (b.type === "PHONE_NUMBER" && !b.phone_number.trim())
          return "Phone-number button needs a phone.";
      }
    }
    return null;
  }

  function buildComponents(): Array<Record<string, unknown>> {
    const comps: Array<Record<string, unknown>> = [];
    if (headerKind === "TEXT") {
      const hVars = extractVars(headerText);
      const header: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: headerText };
      if (hVars.length > 0) {
        header.example = { header_text: hVars.map((v) => bodySamples[v] ?? "") };
      }
      comps.push(header);
    } else if (headerKind !== "NONE") {
      comps.push({
        type: "HEADER",
        format: headerKind,
        example: { header_handle: [headerMediaUrl] },
      });
    }

    const bodyComp: Record<string, unknown> = { type: "BODY", text: body };
    if (bodyVars.length > 0) {
      bodyComp.example = { body_text: [bodyVars.map((v) => bodySamples[v] ?? "")] };
    }
    comps.push(bodyComp);

    if (footer.trim()) comps.push({ type: "FOOTER", text: footer });

    if (buttonKind === "QUICK_REPLY") {
      comps.push({
        type: "BUTTONS",
        buttons: quickReplies
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text) => ({ type: "QUICK_REPLY", text })),
      });
    } else if (buttonKind === "CTA") {
      comps.push({
        type: "BUTTONS",
        buttons: ctaButtons
          .filter((b) => b.text.trim())
          .map((b) =>
            b.type === "URL"
              ? { type: "URL", text: b.text, url: b.url }
              : { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number },
          ),
      });
    }
    return comps;
  }

  async function submit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (!uid || !selfUid) {
      toast.error("Sign in first.");
      return;
    }
    setSubmitting(true);
    try {
      const creds = await loadWaCredentials(selfUid);
      if (!creds) throw new Error("Connect WhatsApp first (Connect page).");
      const db = fbDb();
      const cfg = await getDoc(doc(db, "users", selfUid, "whatsapp_config", "config"));
      const userDoc = await getDoc(doc(db, "users", selfUid));
      const waba_id =
        (cfg.data()?.businessAccountId as string | undefined) ||
        (userDoc.data()?.whatsappBusinessAccountId as string | undefined) ||
        "";
      if (!waba_id) throw new Error("WABA ID missing — add it on Connect page.");

      const res = await createMetaTemplate({
        business_account_id: waba_id,
        access_token: creds.access_token,
        name,
        category,
        language,
        components: buildComponents(),
        allow_category_change: allowCategoryChange,
      });
      if (!res.success) {
        throw new Error(res.message ?? "Meta rejected the template.");
      }
      toast.success(
        `Template submitted — status: ${res.data?.status ?? "PENDING"}. Sync from Meta to refresh.`,
      );
      navigate({ to: "/templates" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create template.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <WbButton variant="ghost" size="sm" onClick={() => navigate({ to: "/templates" })}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-3 w-3" />
          Back to templates
        </WbButton>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* LEFT — Meta-style composer */}
        <div className="space-y-5">
          <Section title="Basics">
            <div className="grid gap-3 sm:grid-cols-2">
              <WbInput
                label="Template name"
                placeholder="order_confirmation"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                hint="Lowercase letters, numbers, underscores."
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1.5 block text-sm font-medium">Category</label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["MARKETING", "UTILITY", "AUTHENTICATION"] as Category[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      "rounded-md border p-3 text-left text-sm transition-all",
                      category === c
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border bg-card hover:bg-muted/40",
                    )}
                  >
                    <p className="font-semibold">{c[0] + c.slice(1).toLowerCase()}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {c === "MARKETING"
                        ? "Promotions, offers, product news."
                        : c === "UTILITY"
                          ? "Order updates, reminders, alerts."
                          : "OTP / login codes."}
                    </p>
                  </button>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allowCategoryChange}
                  onChange={(e) => setAllowCategoryChange(e.target.checked)}
                />
                Allow Meta to auto-correct the category if needed
              </label>
            </div>
          </Section>

          <Section title="Header" optional>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as HeaderKind[]).map((k) => (
                <ChipButton key={k} active={headerKind === k} onClick={() => setHeaderKind(k)}>
                  {k[0] + k.slice(1).toLowerCase()}
                </ChipButton>
              ))}
            </div>
            {headerKind === "TEXT" && (
              <div className="mt-3 space-y-2">
                <WbInput
                  label="Header text (≤ 60 chars, up to one {{1}} variable)"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  maxLength={60}
                />
                {headerVars.length > 0 && (
                  <VarSampleGrid
                    vars={headerVars}
                    samples={bodySamples}
                    onChange={(v, val) => setBodySamples((s) => ({ ...s, [v]: val }))}
                    label="Header example"
                  />
                )}
              </div>
            )}
            {headerKind !== "NONE" && headerKind !== "TEXT" && (
              <WbInput
                label={`Sample ${headerKind.toLowerCase()} URL (Meta reviews this asset)`}
                placeholder="https://…"
                value={headerMediaUrl}
                onChange={(e) => setHeaderMediaUrl(e.target.value)}
                className="mt-3"
              />
            )}
          </Section>

          <Section title="Body" required>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Message (≤ 1024 chars)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    value={namedVar}
                    onChange={(e) => setNamedVar(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        insertNamedVarInBody();
                      }
                    }}
                    placeholder="name"
                    className="h-8 w-24 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <WbButton size="sm" variant="ghost" type="button" onClick={insertNamedVarInBody}>
                    <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                    Named
                  </WbButton>
                  <WbButton size="sm" variant="ghost" type="button" onClick={insertVarInBody}>
                    <FontAwesomeIcon icon={faWandMagicSparkles} className="h-3 w-3" />
                    Numbered
                  </WbButton>
                </div>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={1024}
                rows={6}
                placeholder="Hi {{1}}, your order {{2}} has been shipped."
                className="w-full rounded-md border border-input bg-card p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-right text-[11px] text-muted-foreground">
                {body.length} / 1024
              </p>
              {bodyVars.length > 0 && (
                <VarSampleGrid
                  vars={bodyVars}
                  samples={bodySamples}
                  onChange={(v, val) => setBodySamples((s) => ({ ...s, [v]: val }))}
                  label="Body examples (shown to Meta for approval — also drive the live preview)"
                />
              )}
            </div>
          </Section>

          <Section title="Footer" optional>
            <WbInput
              label="Footer text (≤ 60 chars)"
              value={footer}
              maxLength={60}
              onChange={(e) => setFooter(e.target.value)}
            />
          </Section>

          <Section title="Buttons" optional>
            <div className="grid grid-cols-3 gap-2">
              {(["NONE", "QUICK_REPLY", "CTA"] as ButtonKind[]).map((k) => (
                <ChipButton key={k} active={buttonKind === k} onClick={() => setButtonKind(k)}>
                  {k === "NONE"
                    ? "None"
                    : k === "QUICK_REPLY"
                      ? "Quick replies"
                      : "Call to action"}
                </ChipButton>
              ))}
            </div>

            {buttonKind === "QUICK_REPLY" && (
              <div className="mt-3 space-y-2">
                {quickReplies.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <WbInput
                      className="flex-1"
                      placeholder={`Reply ${i + 1}`}
                      value={t}
                      onChange={(e) =>
                        setQuickReplies((arr) => arr.map((x, j) => (i === j ? e.target.value : x)))
                      }
                      maxLength={25}
                    />
                    <WbButton
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setQuickReplies((arr) => arr.filter((_, j) => j !== i))
                      }
                    >
                      <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                    </WbButton>
                  </div>
                ))}
                {quickReplies.length < 3 && (
                  <WbButton
                    size="sm"
                    variant="secondary"
                    onClick={() => setQuickReplies((a) => [...a, ""])}
                  >
                    <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                    Add quick reply
                  </WbButton>
                )}
              </div>
            )}

            {buttonKind === "CTA" && (
              <div className="mt-3 space-y-3">
                {ctaButtons.map((b, i) => (
                  <div key={i} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <select
                        value={b.type}
                        onChange={(e) =>
                          setCtaButtons((arr) =>
                            arr.map((x, j) =>
                              j === i
                                ? e.target.value === "URL"
                                  ? { type: "URL", text: x.text, url: "https://" }
                                  : { type: "PHONE_NUMBER", text: x.text, phone_number: "" }
                                : x,
                            ),
                          )
                        }
                        className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="URL">Visit website</option>
                        <option value="PHONE_NUMBER">Call phone number</option>
                      </select>
                      <WbButton
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setCtaButtons((arr) => arr.filter((_, j) => j !== i))
                        }
                      >
                        <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                      </WbButton>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <WbInput
                        label="Button text"
                        maxLength={25}
                        value={b.text}
                        onChange={(e) =>
                          setCtaButtons((arr) =>
                            arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                          )
                        }
                      />
                      {b.type === "URL" ? (
                        <WbInput
                          label="URL"
                          value={b.url}
                          onChange={(e) =>
                            setCtaButtons((arr) =>
                              arr.map((x, j) =>
                                j === i && x.type === "URL" ? { ...x, url: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      ) : (
                        <WbInput
                          label="Phone number"
                          placeholder="+9230000000"
                          value={b.phone_number}
                          onChange={(e) =>
                            setCtaButtons((arr) =>
                              arr.map((x, j) =>
                                j === i && x.type === "PHONE_NUMBER"
                                  ? { ...x, phone_number: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
                {ctaButtons.length < 2 && (
                  <WbButton
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setCtaButtons((a) => [...a, { type: "URL", text: "", url: "https://" }])
                    }
                  >
                    <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                    Add CTA
                  </WbButton>
                )}
              </div>
            )}
          </Section>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <WbButton variant="secondary" onClick={() => navigate({ to: "/templates" })}>
              Cancel
            </WbButton>
            <WbButton onClick={() => void submit()} loading={submitting}>
              Submit for approval
            </WbButton>
          </div>
        </div>

        {/* RIGHT — sticky preview */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-3">
          <WhatsAppPreview
            header={previewHeader}
            headerFormat={previewHeaderFormat}
            headerMediaUrl={headerMediaUrl || null}
            body={previewBody}
            footer={footer || null}
            buttons={previewButtons}
            title={name || "New template"}
          />
          <p className="rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            This preview matches how Meta renders your template on WhatsApp. Once approved,
            variables like <code>{"{{1}}"}</code> are replaced with the recipient's data at send time.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  optional,
  required,
}: {
  title: string;
  children: React.ReactNode;
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {optional && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
            optional
          </span>
        )}
        {required && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase text-primary">
            required
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ChipButton({
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
        "rounded-md border px-3 py-2 text-xs font-medium transition-all",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}

function VarSampleGrid({
  vars,
  samples,
  onChange,
  label,
}: {
  vars: string[];
  samples: Record<string, string>;
  onChange: (v: string, val: string) => void;
  label: string;
}) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {vars.map((v) => (
          <WbInput
            key={v}
            label={`{{${v}}}`}
            value={samples[v] ?? ""}
            placeholder={`Example for {{${v}}}`}
            onChange={(e) => onChange(v, e.target.value)}
          />
        ))}
      </div>
    </div>
  );
}