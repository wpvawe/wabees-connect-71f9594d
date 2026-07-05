import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faPen,
  faTrash,
  faXmark,
  faStar,
  faFloppyDisk,
  faCircleNotch,
  faFire,
  faHourglassHalf,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { usePlans, type Plan } from "@/hooks/usePlans";
import {
  createPlan,
  deletePlan,
  togglePlanActive,
  updatePlan,
  type PlanInput,
} from "@/lib/admin/mutations";
import { cn } from "@/lib/utils";
import { resolvePricing, billingCycleLabel, formatEndsIn } from "@/lib/plans/pricing";

export function PlansSection() {
  // Admin view must see inactive plans too (otherwise the count and the
  // "Active" checkbox are misleading — a disabled plan disappears entirely).
  const { data: plans } = usePlans({ includeInactive: true });
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <WbCard>
        <WbCardHeader
          title="Plans"
          subtitle={`${plans?.length ?? 0} plans`}
          right={
            <WbButton size="sm" onClick={() => setCreating(true)}>
              <FontAwesomeIcon icon={faPlus} className="h-3 w-3" /> New plan
            </WbButton>
          }
        />
        <WbCardBody>
          {!plans ? (
            <div className="flex items-center py-10 text-sm text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : plans.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No plans yet. Create one to get started.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {plans.map((p) => (
                <li key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                      {p.isPopular && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                          <FontAwesomeIcon icon={faStar} className="h-2.5 w-2.5" /> Popular
                        </span>
                      )}
                      {p.isWelcomePlan && (
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                          Welcome
                        </span>
                      )}
                      {(() => {
                        const pr = resolvePricing(p);
                        if (!pr.offerActive || !p.offer) return null;
                        return (
                          <span className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            <FontAwesomeIcon icon={faFire} className="mr-1 h-2.5 w-2.5" />
                            {p.offer.label}
                            {pr.discountPct != null ? ` · ${pr.discountPct}% OFF` : ""}
                          </span>
                        );
                      })()}
                      {p.offer?.active === true && p.offer?.endsAt && (
                        <span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                          <FontAwesomeIcon icon={faHourglassHalf} className="mr-1 h-2.5 w-2.5" />
                          {formatEndsIn(p.offer.endsAt)}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {(() => {
                        const pr = resolvePricing(p);
                        const priceStr =
                          pr.effectivePrice === 0
                            ? "Free"
                            : `${p.currency} ${pr.effectivePrice.toLocaleString()}`;
                        const orig =
                          pr.offerActive && pr.effectivePrice < p.priceMonthly
                            ? ` (was ${p.currency} ${p.priceMonthly.toLocaleString()})`
                            : "";
                        const validity =
                          p.expiryType === "lifetime"
                            ? "lifetime"
                            : `${billingCycleLabel(p)} · ${p.expiryDays}d`;
                        return `${priceStr}${orig} · ${validity} · ${p.maxMessages === 0 ? "∞" : p.maxMessages} msgs · ${p.maxAiMessages === 0 ? "∞" : p.maxAiMessages} AI`;
                      })()}
                    </p>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted-foreground/80">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={p.isActive}
                        disabled={p.isWelcomePlan}
                        onChange={async (e) => {
                          try {
                            await togglePlanActive(p.id, e.target.checked);
                            toast.success(e.target.checked ? "Activated" : "Deactivated");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed");
                          }
                        }}
                      />
                      Active
                    </label>
                    <WbButton size="sm" variant="ghost" onClick={() => setEditing(p)}>
                      <FontAwesomeIcon icon={faPen} className="h-3 w-3" />
                    </WbButton>
                    {!p.isWelcomePlan && (
                      <WbButton
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm(`Delete "${p.name}" plan? This cannot be undone.`)) return;
                          try {
                            await deletePlan(p.id);
                            toast.success("Deleted");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed");
                          }
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} className="h-3 w-3 text-destructive" />
                      </WbButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WbCardBody>
      </WbCard>

      {(editing || creating) && (
        <PlanFormDialog
          existing={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function PlanFormDialog({ existing, onClose }: { existing: Plan | null; onClose: () => void }) {
  const [form, setForm] = useState<PlanInput>({
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    priceMonthly: existing?.priceMonthly ?? 0,
    priceYearly: existing?.priceYearly ?? null,
    currency: existing?.currency ?? "PKR",
    maxMessages: existing?.maxMessages ?? 1000,
    maxContacts: existing?.maxContacts ?? 500,
    maxCampaigns: existing?.maxCampaigns ?? 10,
    maxBots: existing?.maxBots ?? 5,
    maxTemplates: existing?.maxTemplates ?? 20,
    maxAiMessages: existing?.maxAiMessages ?? 300,
    hasAnalytics: existing?.hasAnalytics ?? false,
    hasPrioritySupport: existing?.hasPrioritySupport ?? false,
    hasApiAccess: existing?.hasApiAccess ?? false,
    features: existing?.features ?? [],
    expiryType: existing?.expiryType ?? "monthly",
    expiryDays: existing?.expiryDays ?? 30,
    isActive: existing?.isActive ?? true,
    isPopular: existing?.isPopular ?? false,
    showOnPublic: existing?.showOnPublic ?? true,
    sortOrder: existing?.sortOrder ?? 0,
    offer: existing?.offer
      ? {
          active: existing.offer.active,
          label: existing.offer.label,
          discountPct: existing.offer.discountPct,
          priceOverride: existing.offer.priceOverride,
          endsAt: existing.offer.endsAt,
        }
      : null,
  });
  const [featuresText, setFeaturesText] = useState(form.features.join("\n"));
  const [saving, setSaving] = useState(false);

  async function save() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    const payload: PlanInput = {
      ...form,
      name,
      description: form.description.trim().slice(0, 500),
      features: featuresText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30),
      offer: form.offer && form.offer.active
        ? {
            active: true,
            label: (form.offer.label || "").trim().slice(0, 40) || "Special offer",
            discountPct:
              form.offer.discountPct != null && form.offer.discountPct > 0
                ? Math.min(100, Math.round(form.offer.discountPct))
                : null,
            priceOverride:
              form.offer.priceOverride != null && form.offer.priceOverride >= 0
                ? Math.round(form.offer.priceOverride)
                : null,
            endsAt: form.offer.endsAt || null,
          }
        : null,
    };
    setSaving(true);
    try {
      if (existing) {
        await updatePlan(existing.id, payload);
        toast.success("Plan updated");
      } else {
        await createPlan(payload);
        toast.success("Plan created");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof PlanInput>(k: K, v: PlanInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">
            {existing ? `Edit "${existing.name}"` : "Create plan"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WbInput label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            <WbInput
              label="Currency"
              value={form.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 5))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
              maxLength={500}
              className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumField label="Price" v={form.priceMonthly} onChange={(v) => set("priceMonthly", v)} />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Billing cycle
              </label>
              <select
                value={form.expiryType}
                onChange={(e) => {
                  const t = e.target.value;
                  set("expiryType", t);
                  // Auto-fill days from cycle so admin never has to think
                  // about the two fields separately.
                  const auto: Record<string, number> = {
                    monthly: 30,
                    quarterly: 90,
                    yearly: 365,
                    lifetime: 0,
                  };
                  if (t in auto) set("expiryDays", auto[t]);
                }}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="monthly">Monthly (30 days)</option>
                <option value="quarterly">Quarterly (90 days)</option>
                <option value="yearly">Yearly (365 days)</option>
                <option value="lifetime">Lifetime (no expiry)</option>
                <option value="custom">Custom duration…</option>
              </select>
            </div>
            {form.expiryType === "custom" ? (
              <NumField
                label="Custom days"
                v={form.expiryDays}
                onChange={(v) => set("expiryDays", v)}
              />
            ) : (
              <div className="flex flex-col justify-end">
                <p className="mb-1.5 text-sm font-medium text-foreground">Duration</p>
                <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {form.expiryType === "lifetime"
                    ? "Never expires"
                    : `${form.expiryDays} days · auto`}
                </p>
              </div>
            )}
            <NumField label="Sort order" v={form.sortOrder} onChange={(v) => set("sortOrder", v)} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Yearly price (optional)
              </label>
              <input
                type="number"
                min={0}
                value={form.priceYearly ?? ""}
                onChange={(e) =>
                  set("priceYearly", e.target.value ? Number(e.target.value) : null)
                }
                placeholder={`e.g. ${form.priceMonthly * 10}`}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none ring-ring focus-visible:ring-2"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Only used when the plan cycle is not already yearly — shown as a
                "Save X%" cross-sell on the plan card.
              </p>
            </div>
            {form.priceYearly != null && form.priceYearly > 0 && form.priceMonthly > 0 && (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">
                  Yearly vs 12x monthly
                </p>
                <p className="mt-1">
                  12x monthly = {form.currency} {(form.priceMonthly * 12).toLocaleString()} —
                  yearly saves{" "}
                  <b className="text-primary">
                    {Math.max(
                      0,
                      Math.round(
                        ((form.priceMonthly * 12 - form.priceYearly) /
                          (form.priceMonthly * 12)) *
                          100,
                      ),
                    )}
                    %
                  </b>
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumField label="Max messages (0=∞)" v={form.maxMessages} onChange={(v) => set("maxMessages", v)} />
            <NumField label="Max contacts (0=∞)" v={form.maxContacts} onChange={(v) => set("maxContacts", v)} />
            <NumField label="Max campaigns (0=∞)" v={form.maxCampaigns} onChange={(v) => set("maxCampaigns", v)} />
            <NumField label="Max bots (0=∞)" v={form.maxBots} onChange={(v) => set("maxBots", v)} />
            <NumField label="Max templates (0=∞)" v={form.maxTemplates} onChange={(v) => set("maxTemplates", v)} />
            <NumField label="Max AI msgs (0=∞)" v={form.maxAiMessages} onChange={(v) => set("maxAiMessages", v)} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Feature bullet points (one per line)
            </label>
            <textarea
              rows={5}
              value={featuresText}
              onChange={(e) => setFeaturesText(e.target.value)}
              className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-ring focus-visible:ring-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Toggle label="Active" checked={form.isActive} onChange={(v) => set("isActive", v)} />
            <Toggle label="Popular" checked={form.isPopular} onChange={(v) => set("isPopular", v)} />
            <Toggle label="Show on public site" checked={form.showOnPublic} onChange={(v) => set("showOnPublic", v)} />
            <Toggle label="Analytics" checked={form.hasAnalytics} onChange={(v) => set("hasAnalytics", v)} />
            <Toggle label="Priority support" checked={form.hasPrioritySupport} onChange={(v) => set("hasPrioritySupport", v)} />
            <Toggle label="API access" checked={form.hasApiAccess} onChange={(v) => set("hasApiAccess", v)} />
          </div>

          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Limited-time offer</p>
                <p className="text-xs text-muted-foreground">
                  Show a promo badge, discount price, and countdown on this plan card.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={Boolean(form.offer?.active)}
                  onChange={(e) =>
                    set(
                      "offer",
                      e.target.checked
                        ? {
                            active: true,
                            label: form.offer?.label ?? "Limited offer",
                            discountPct: form.offer?.discountPct ?? null,
                            priceOverride: form.offer?.priceOverride ?? null,
                            endsAt: form.offer?.endsAt ?? null,
                          }
                        : null,
                    )
                  }
                />
                Enable offer
              </label>
            </div>
            {form.offer?.active && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WbInput
                  label="Badge label"
                  value={form.offer.label}
                  placeholder="e.g. Limited offer, 50% OFF"
                  onChange={(e) =>
                    set("offer", { ...form.offer!, label: e.target.value.slice(0, 40) })
                  }
                />
                <WbInput
                  label="Ends at (optional)"
                  type="datetime-local"
                  value={form.offer.endsAt ? toLocalInput(form.offer.endsAt) : ""}
                  onChange={(e) =>
                    set("offer", {
                      ...form.offer!,
                      endsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
                <WbInput
                  label="Discount %"
                  type="number"
                  value={form.offer.discountPct != null ? String(form.offer.discountPct) : ""}
                  placeholder="e.g. 20"
                  onChange={(e) =>
                    set("offer", {
                      ...form.offer!,
                      discountPct: e.target.value ? Number(e.target.value) : null,
                      priceOverride: e.target.value ? null : form.offer!.priceOverride,
                    })
                  }
                  hint="Use either discount % OR a fixed price override — not both."
                />
                <WbInput
                  label={`Price override (${form.currency})`}
                  type="number"
                  value={form.offer.priceOverride != null ? String(form.offer.priceOverride) : ""}
                  placeholder={String(form.priceMonthly)}
                  onChange={(e) =>
                    set("offer", {
                      ...form.offer!,
                      priceOverride: e.target.value ? Number(e.target.value) : null,
                      discountPct: e.target.value ? null : form.offer!.discountPct,
                    })
                  }
                />
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <WbButton variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </WbButton>
          <WbButton onClick={save} loading={saving}>
            <FontAwesomeIcon icon={faFloppyDisk} className="h-3 w-3" />
            {existing ? "Save changes" : "Create plan"}
          </WbButton>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  v,
  onChange,
}: {
  label: string;
  v: number;
  onChange: (v: number) => void;
}) {
  return (
    <WbInput
      label={label}
      type="number"
      value={String(v)}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
        checked ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Convert an ISO string to the value expected by <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}