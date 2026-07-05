import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSliders,
  faFloppyDisk,
  faClockRotateLeft,
  faCalendarPlus,
  faWandMagicSparkles,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { usePlans } from "@/hooks/usePlans";
import { useUserSubscription } from "@/hooks/admin/useAdminData";
import {
  adminAssignPlan,
  extendSubscriptionExpiry,
  resetSubscriptionCounters,
  updateUserSubscriptionLimits,
} from "@/lib/admin/mutations";

/**
 * Admin-only "plan management" surface inside the user drawer.
 *
 * Contract:
 *  - Assigning a plan REPLACES the user's subscription (fresh cycle).
 *  - Editing limits ONLY affects this user's subscription doc. The
 *    underlying `plans/{planId}` document is never mutated, so other users
 *    on the same plan are unaffected. Sub is flagged `isCustom: true`.
 */
export function PlanManagementCard({ uid }: { uid: string }) {
  const { data: plans } = usePlans({ includeInactive: true });
  const { data: sub } = useUserSubscription(uid);
  const [assignId, setAssignId] = useState("");
  const [extendDays, setExtendDays] = useState("30");
  const [busy, setBusy] = useState<string | null>(null);

  // Limits editor — hydrated from the current sub. `null` means "not touched
  // by admin this session" so we don't overwrite unrelated fields on save.
  const [maxMessages, setMaxMessages] = useState<number | null>(null);
  const [maxContacts, setMaxContacts] = useState<number | null>(null);
  const [maxCampaigns, setMaxCampaigns] = useState<number | null>(null);
  const [maxBots, setMaxBots] = useState<number | null>(null);
  const [maxTemplates, setMaxTemplates] = useState<number | null>(null);
  const [maxAiMessages, setMaxAiMessages] = useState<number | null>(null);

  useEffect(() => {
    if (!sub) return;
    setMaxMessages(sub.maxMessages);
    setMaxContacts(sub.maxContacts);
    setMaxCampaigns(sub.maxCampaigns);
    setMaxBots(sub.maxBots);
    setMaxTemplates(sub.maxTemplates);
    setMaxAiMessages(sub.maxAiMessages);
  }, [sub?.planId]); // reset the form only when the plan itself changes

  async function run(label: string, tag: string, fn: () => Promise<void>) {
    setBusy(tag);
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const isCustom = Boolean(
    (sub as unknown as { isCustom?: boolean } | null)?.isCustom,
  );

  return (
    <WbCard>
      <WbCardHeader
        title="Plan management"
        subtitle="Assign a plan, customise this user's limits, or extend expiry"
        right={
          isCustom ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
              <FontAwesomeIcon icon={faWandMagicSparkles} className="mr-1 h-2.5 w-2.5" />
              Customised
            </span>
          ) : null
        }
      />
      <WbCardBody className="space-y-5">
        {/* Assign / change plan */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Assign or change plan
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={assignId}
              onChange={(e) => setAssignId(e.target.value)}
              className="h-9 flex-1 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">Select a plan…</option>
              {(plans ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.currency} {p.priceMonthly} · {p.expiryType}
                </option>
              ))}
            </select>
            <WbButton
              size="sm"
              disabled={!assignId || busy !== null}
              loading={busy === "assign"}
              onClick={() => {
                const plan = plans?.find((p) => p.id === assignId);
                if (!plan) return;
                const currentLabel = sub?.planName || "no plan";
                if (
                  !window.confirm(
                    `Replace "${currentLabel}" with "${plan.name}"?\n\nThis starts a fresh cycle and resets message counters.`,
                  )
                )
                  return;
                void run("Plan assigned", "assign", async () => {
                  await adminAssignPlan(uid, assignId);
                  setAssignId("");
                });
              }}
            >
              <FontAwesomeIcon icon={faFloppyDisk} className="h-3 w-3" /> Assign
            </WbButton>
          </div>
        </div>

        {sub ? (
          <>
            {/* Custom limits editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Custom limits for this user
                </p>
                <FontAwesomeIcon icon={faSliders} className="h-3 w-3 text-muted-foreground" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only affects <span className="font-semibold">this user</span>. The plan itself
                stays unchanged. Use <span className="font-mono">0</span> for unlimited.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <LimitField label="Messages" v={maxMessages} onChange={setMaxMessages} />
                <LimitField label="AI messages" v={maxAiMessages} onChange={setMaxAiMessages} />
                <LimitField label="Contacts" v={maxContacts} onChange={setMaxContacts} />
                <LimitField label="Campaigns" v={maxCampaigns} onChange={setMaxCampaigns} />
                <LimitField label="Bots" v={maxBots} onChange={setMaxBots} />
                <LimitField label="Templates" v={maxTemplates} onChange={setMaxTemplates} />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <WbButton
                  size="sm"
                  disabled={busy !== null}
                  loading={busy === "limits"}
                  onClick={() =>
                    void run("Custom limits saved", "limits", async () => {
                      await updateUserSubscriptionLimits(uid, {
                        maxMessages: numOrZero(maxMessages),
                        maxContacts: numOrZero(maxContacts),
                        maxCampaigns: numOrZero(maxCampaigns),
                        maxBots: numOrZero(maxBots),
                        maxTemplates: numOrZero(maxTemplates),
                        maxAiMessages: numOrZero(maxAiMessages),
                      });
                    })
                  }
                >
                  <FontAwesomeIcon icon={faFloppyDisk} className="h-3 w-3" />
                  Save custom limits
                </WbButton>
                <WbButton
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!sub) return;
                    setMaxMessages(sub.maxMessages);
                    setMaxContacts(sub.maxContacts);
                    setMaxCampaigns(sub.maxCampaigns);
                    setMaxBots(sub.maxBots);
                    setMaxTemplates(sub.maxTemplates);
                    setMaxAiMessages(sub.maxAiMessages);
                  }}
                >
                  Discard
                </WbButton>
              </div>
            </div>

            {/* Extend expiry */}
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Extend / adjust expiry
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <WbInput
                    label="Days (+ / −)"
                    type="number"
                    value={extendDays}
                    onChange={(e) => setExtendDays(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <WbButton
                    size="sm"
                    disabled={busy !== null || sub.expiryType === "lifetime"}
                    loading={busy === "extend"}
                    onClick={() =>
                      void run(
                        Number(extendDays) >= 0 ? "Expiry extended" : "Expiry reduced",
                        "extend",
                        () => extendSubscriptionExpiry(uid, Number(extendDays) || 0),
                      )
                    }
                  >
                    <FontAwesomeIcon icon={faCalendarPlus} className="h-3 w-3" />
                    Apply
                  </WbButton>
                </div>
              </div>
              {sub.expiryType === "lifetime" && (
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
                  Lifetime plans don't expire.
                </p>
              )}
            </div>

            {/* Reset counters */}
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Usage counters
              </p>
              <WbButton
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                loading={busy === "reset"}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Reset this user's messages / AI / campaigns usage back to 0?",
                    )
                  )
                    return;
                  void run("Counters reset", "reset", () => resetSubscriptionCounters(uid));
                }}
              >
                <FontAwesomeIcon icon={faClockRotateLeft} className="h-3 w-3" />
                Reset usage counters
              </WbButton>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No active subscription — assign a plan above to unlock custom limits, expiry, and
            counter controls.
          </p>
        )}
      </WbCardBody>
    </WbCard>
  );
}

function numOrZero(v: number | null): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function LimitField({
  label,
  v,
  onChange,
}: {
  label: string;
  v: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <WbInput
      label={label}
      type="number"
      value={v === null ? "" : String(v)}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
    />
  );
}