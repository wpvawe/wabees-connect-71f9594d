import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getCountFromServer, updateDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faTriangleExclamation,
  faHourglassHalf,
  faComments,
  faLock,
  faShieldHalved,
  faHeadset,
} from "@fortawesome/free-solid-svg-icons";
import { Link } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { usePlans } from "@/hooks/usePlans";
import { useSubscription } from "@/hooks/useSubscription";
import { usePendingSubscription } from "@/hooks/usePendingSubscription";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useProfile } from "@/hooks/useProfile";
import { useContacts } from "@/hooks/useContacts";
import { fetchCached } from "@/lib/firebase/countCache";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { useSubscriptionMessages } from "@/hooks/useSubscriptionMessages";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import {
  requestSubscription,
  postSubscriptionRequestToSupport,
} from "@/lib/firebase/subscriptions";
import { toast } from "sonner";
import { RequireCapability } from "@/components/auth/RequireCapability";
import { PlanCard } from "@/components/plans/PlanCard";
import { UsageBar } from "@/components/plans/UsageBar";
import { PlanCompareTable } from "@/components/plans/PlanCompareTable";
import { PlanFaq } from "@/components/plans/PlanFaq";
import { SubscriptionRequestDialog } from "@/components/plans/SubscriptionRequestDialog";
import type { Plan } from "@/hooks/usePlans";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({ meta: [{ title: "Plans — Wabees" }] }),
  component: () => (
    <RequireCapability capability="billing.manage">
      <PlansPage />
    </RequireCapability>
  ),
});

function PlansPage() {
  const { data: plans, error } = usePlans();
  const { data: sub, loading } = useSubscription();
  const { data: pending } = usePendingSubscription();
  const { data: profile } = useProfile("effective");
  const { data: contacts } = useContacts();
  const effectiveUid = useEffectiveUid();
  const [realCampaigns, setRealCampaigns] = useState<number | null>(null);
  useEffect(() => {
    if (!effectiveUid) return;
    const db = fbDbOrNull();
    if (!db) return;
    let alive = true;
    void fetchCached<number>(
      `count:${effectiveUid}/campaigns`,
      async () => {
        const snap = await getCountFromServer(
          collection(db, "users", effectiveUid, "campaigns"),
        );
        return snap.data().count;
      },
      5 * 60_000,
    )
      .then((n) => {
        if (alive && typeof n === "number") setRealCampaigns(n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [effectiveUid]);
  const messages = useSubscriptionMessages();
  const { data: wa, loading: waLoading } = useWhatsAppConfig("effective");
  const uid = useFirebaseUid();
  const [dialogPlan, setDialogPlan] = useState<Plan | null>(null);
  const waConnected = Boolean(wa?.connected);

  // Use maintained counters/list lengths only. Avoid Firestore aggregation
  // reads here because quota exhaustion blocks regular message fetching too.
  const usedMessages =
    sub?.messagesUsed ?? profile?.totalMessages ?? 0;
  const usedContacts =
    contacts?.length ?? sub?.contactsUsed ?? profile?.totalContacts ?? 0;
  // Prefer the server-side aggregate count (real number of campaign docs)
  // over the maintained counter, because the counter can drift if a
  // campaign is deleted outside deleteCampaign() or a reservation succeeds
  // but the doc write fails partway. Falls back to the counters when the
  // aggregate hasn't loaded yet.
  const usedCampaigns =
    realCampaigns ?? sub?.campaignsUsed ?? profile?.totalCampaigns ?? 0;
  const usedBots = sub?.botsUsed ?? profile?.totalBots ?? 0;

  // One-shot self-heal: if the maintained counters disagree with the real
  // campaign count, quietly correct them so the quota bar stops lying.
  const healedRef = useRef(false);
  useEffect(() => {
    if (healedRef.current) return;
    if (!uid || !sub || realCampaigns === null) return;
    const real = realCampaigns;
    const subUsed = sub.campaignsUsed ?? 0;
    const profUsed = profile?.totalCampaigns ?? 0;
    if (subUsed === real && profUsed === real) return;
    healedRef.current = true;
    const db = fbDbOrNull();
    if (!db) return;
    void Promise.all([
      subUsed !== real
        ? updateDoc(doc(db, "users", uid, "subscription", "current"), {
            campaignsUsed: real,
          }).catch(() => {})
        : Promise.resolve(),
      profUsed !== real
        ? updateDoc(doc(db, "users", uid), { totalCampaigns: real }).catch(() => {})
        : Promise.resolve(),
    ]);
  }, [uid, sub, profile?.totalCampaigns, realCampaigns]);

  const pendingPlan = useMemo(
    () => plans?.find((p) => p.id === pending?.planId) ?? null,
    [plans, pending?.planId],
  );

  const daysLeft = useMemo(() => {
    if (!sub?.endDate) return null;
    const ends = new Date(sub.endDate).getTime();
    if (!Number.isFinite(ends)) return null;
    const diff = ends - Date.now();
    if (diff <= 0) return 0;
    return Math.ceil(diff / 86_400_000);
  }, [sub?.endDate]);

  return (
    <>
      <TopBar title="Plans & Billing" subtitle="Manage your subscription and quotas" />
      <div className="space-y-8 px-4 py-6 sm:px-6">
        {!waLoading && !waConnected && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <FontAwesomeIcon
              icon={faTriangleExclamation}
              className="mt-0.5 h-4 w-4 flex-shrink-0"
            />
            <div className="flex-1">
              <p className="font-semibold">Connect WhatsApp to request a plan</p>
              <p className="mt-1 text-xs">
                Subscriptions activate a WhatsApp Business number. Please connect your
                WhatsApp account first — you can request or upgrade a plan after that.
              </p>
              <Link
                to="/connect"
                className="mt-2 inline-flex items-center rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              >
                Connect WhatsApp
              </Link>
            </div>
          </div>
        )}

        {pending && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <FontAwesomeIcon
                icon={faHourglassHalf}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400"
              />
              <div>
                <p className="font-semibold">
                  Request pending — {pendingPlan?.name || pending.planId}
                </p>
                <p className="mt-1 text-xs">
                  Admin will review your payment and activate the plan shortly. Follow up
                  in support chat if you need help.
                </p>
              </div>
            </div>
            <Link
              to="/support"
              className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              <FontAwesomeIcon icon={faComments} className="h-3 w-3" />
              Open support
            </Link>
          </div>
        )}

        {/* Current plan summary */}
        <WbCard>
          <WbCardBody>
            {loading ? (
              <div className="flex items-center text-sm text-muted-foreground">
                <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
                Loading current plan…
              </div>
            ) : sub ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Current subscription
                    </p>
                    <h2 className="mt-1 truncate text-xl font-bold tracking-tight text-foreground">
                      {sub.planName || sub.planId || "Active plan"}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        sub.status === "active"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {sub.status}
                    </span>
                    {daysLeft != null && (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {daysLeft === 0
                          ? "Ends today"
                          : `${daysLeft} day${daysLeft > 1 ? "s" : ""} left`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <UsageBar label="Messages" used={usedMessages} max={sub.maxMessages} />
                  <UsageBar label="Contacts" used={usedContacts} max={sub.maxContacts} />
                  <UsageBar label="Campaigns" used={usedCampaigns} max={sub.maxCampaigns} />
                  <UsageBar label="Chatbots" used={usedBots} max={sub.maxBots} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  You don't have an active subscription yet.
                </p>
                <p className="text-xs text-muted-foreground">
                  Pick a plan below to get started — the Welcome plan is free.
                </p>
              </div>
            )}
          </WbCardBody>
        </WbCard>

        {/* Plan cards */}
        <div className="space-y-3">
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
              Simple pricing
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              Choose the plan that fits your team
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No contracts. No surprises. Upgrade or cancel anytime.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : plans === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading plans…
            </div>
          ) : plans.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No plans available right now. Contact support for a custom quote.
            </p>
          ) : (
            <div className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  active={sub?.planId === plan.id}
                  pendingPlanId={pending?.planId ?? null}
                  hasPending={Boolean(pending)}
                  onRequest={async () => {
                    if (!uid) return;
                    if (!waConnected) {
                      toast.error(
                        "Please connect your WhatsApp account before requesting a plan.",
                      );
                      return;
                    }
                    try {
                      await requestSubscription(uid, plan);
                      await postSubscriptionRequestToSupport(uid, plan, messages, {
                        name: profile?.businessName || "",
                        email: profile?.email || "",
                        phone: profile?.phoneNumber || "",
                      }).catch(() => undefined);
                      toast.success("Request sent — waiting for admin approval");
                      setDialogPlan(plan);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Request failed");
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Trust strip */}
        <div className="grid gap-3 sm:grid-cols-3">
          <TrustPill
            icon={faShieldHalved}
            title="Secure by design"
            body="End-to-end WhatsApp encryption, Firestore RLS, and RBAC agent access."
          />
          <TrustPill
            icon={faLock}
            title="Cancel anytime"
            body="Month-to-month billing. No lock-in contracts, no cancellation fees."
          />
          <TrustPill
            icon={faHeadset}
            title="Human support"
            body="Real humans on WhatsApp — average first response under 30 minutes."
          />
        </div>

        {/* Comparison table */}
        {plans && plans.length >= 2 && (
          <PlanCompareTable plans={plans} activePlanId={sub?.planId ?? null} />
        )}

        {/* FAQ */}
        <PlanFaq />
      </div>

      <SubscriptionRequestDialog
        open={dialogPlan !== null}
        onClose={() => setDialogPlan(null)}
        plan={dialogPlan}
        messages={messages}
        user={{
          name: profile?.businessName || "",
          email: profile?.email || "",
          phone: profile?.phoneNumber || "",
        }}
      />
    </>
  );
}

function TrustPill({
  icon,
  title,
  body,
}: {
  icon: typeof faLock;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
