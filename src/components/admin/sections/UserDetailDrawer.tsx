import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faMessage,
  faAddressBook,
  faRobot,
  faBullhorn,
  faCircleCheck,
  faCircleXmark,
  faUser,
  faCalendar,
  faTriangleExclamation,
  faTrash,
  faKey,
  faArrowsRotate,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { usePlans } from "@/hooks/usePlans";
import {
  useUserById,
  useUserSubscription,
  useUserLiveCounts,
  type UserSubscriptionRow,
} from "@/hooks/admin/useAdminData";
import {
  setUserRole,
  setUserStatus,
  setUserField,
  activatePendingSubscription,
  rejectPendingSubscription,
  deleteUserData,
  sendUserPasswordReset,
} from "@/lib/admin/mutations";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { PlanManagementCard } from "./PlanManagementCard";

export function UserDetailDrawer({
  uid,
  onClose,
}: {
  uid: string | null;
  onClose: () => void;
}) {
  const { data: user } = useUserById(uid);
  const { data: sub, loading: subLoading } = useUserSubscription(uid);
  const live = useUserLiveCounts(uid);
  const [busy, setBusy] = useState(false);

  if (!uid) return null;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const res = await fn();
      const planName =
        res && typeof res === "object" && "planName" in res
          ? String((res as { planName: unknown }).planName ?? "")
          : "";
      toast.success(planName ? `${label}: ${planName}` : label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
      />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
          <p className="text-sm font-semibold text-foreground">User details</p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {!user ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {/* Profile */}
              <WbCard>
                <WbCardBody className="flex flex-col items-center text-center">
                  <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary">
                    {user.profileImageUrl ? (
                      <img src={user.profileImageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <FontAwesomeIcon icon={faUser} className="h-6 w-6" />
                    )}
                  </div>
                  <p className="mt-3 text-base font-semibold text-foreground">
                    {user.businessName || user.email}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                  {user.phoneNumber && (
                    <p className="text-xs text-muted-foreground">{user.phoneNumber}</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                        user.status === "active"
                          ? "bg-emerald-500/15 text-emerald-600"
                          : user.status === "pending"
                            ? "bg-amber-500/15 text-amber-600"
                            : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {user.status}
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold capitalize text-primary">
                      {user.role}
                    </span>
                  </div>
                </WbCardBody>
              </WbCard>

              {/* Stats — denormalised counters on the root doc by default;
                  "Recalculate" fires 5 aggregate reads (BUG-04). */}
              <div className="grid grid-cols-2 gap-2">
                <StatTile
                  icon={faMessage}
                  label="Messages"
                  value={live.loaded ? live.messages : user.totalMessages}
                  loading={live.loading}
                />
                <StatTile
                  icon={faAddressBook}
                  label="Contacts"
                  value={live.loaded ? live.contacts : user.totalContacts}
                  loading={live.loading}
                />
                <StatTile
                  icon={faRobot}
                  label="Bots"
                  value={live.loaded ? live.bots : user.totalBots}
                  loading={live.loading}
                />
                <StatTile
                  icon={faBullhorn}
                  label="Campaigns"
                  value={live.loaded ? live.campaigns : user.totalCampaigns}
                  loading={live.loading}
                />
              </div>
              <button
                type="button"
                onClick={live.refresh}
                disabled={live.loading}
                className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <FontAwesomeIcon
                  icon={faArrowsRotate}
                  className={cn("h-3 w-3", live.loading && "animate-spin")}
                />
                {live.loaded ? "Recalculate live counts" : "Show live counts"}
              </button>

              {/* Current subscription */}
              <SubscriptionCard
                sub={sub}
                liveAgents={live.loaded ? live.agents : null}
                loading={subLoading}
              />

              {/* Full plan management: assign, customise limits, extend expiry */}
              <PlanManagementCard uid={user.id} />

              {/* WhatsApp */}
              <WbCard>
                <WbCardBody>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    WhatsApp connection
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    {user.whatsappConnected ? (
                      <>
                        <FontAwesomeIcon
                          icon={faCircleCheck}
                          className="h-4 w-4 text-emerald-500"
                        />
                        <p className="text-sm font-semibold text-foreground">Connected</p>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon
                          icon={faCircleXmark}
                          className="h-4 w-4 text-muted-foreground"
                        />
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </>
                    )}
                  </div>
                  {user.whatsappPhoneNumberId && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Phone ID: <span className="font-mono">{user.whatsappPhoneNumberId}</span>
                    </p>
                  )}
                  {user.whatsappWabaId && (
                    <p className="text-xs text-muted-foreground">
                      WABA ID: <span className="font-mono">{user.whatsappWabaId}</span>
                    </p>
                  )}
                </WbCardBody>
              </WbCard>

              {/* AI Bot toggle */}
              <WbCard>
                <WbCardBody className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">AI Bot feature</p>
                    <p className="text-xs text-muted-foreground">
                      {user.aiBotEnabled
                        ? "User can configure and use the AI auto-reply bot."
                        : "Disabled — user cannot access AI bot features."}
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={user.aiBotEnabled}
                      disabled={busy}
                      onChange={(e) =>
                        void run(
                          e.target.checked ? "AI Bot enabled" : "AI Bot disabled",
                          () => setUserField(user.id, "aiBotEnabled", e.target.checked),
                        )
                      }
                    />
                    <div className="h-6 w-11 rounded-full bg-muted after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-5" />
                  </label>
                </WbCardBody>
              </WbCard>

              {/* Role picker */}
              <WbCard>
                <WbCardBody>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Role
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["user", "admin"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        disabled={busy || user.role === r}
                        onClick={() =>
                          void run(`Role set to ${r}`, () => setUserRole(user.id, r))
                        }
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors",
                          user.role === r
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-muted",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Password
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sends a Firebase password-reset email to <b>{user.email || "—"}</b>.
                      The user will click the link to set a new password themselves.
                    </p>
                    <WbButton
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      disabled={busy || !user.email}
                      onClick={() =>
                        void run("Password reset email sent", () =>
                          sendUserPasswordReset(user.email, user.id),
                        )
                      }
                    >
                      <FontAwesomeIcon icon={faKey} className="h-3 w-3" /> Send password reset
                    </WbButton>
                  </div>
                </WbCardBody>
              </WbCard>

              {/* Actions */}
              <WbCard>
                <WbCardBody className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status actions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {user.status !== "active" && (
                      <WbButton
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run("User approved", () => setUserStatus(user.id, "active"))
                        }
                      >
                        Approve
                      </WbButton>
                    )}
                    {user.status === "active" && (
                      <WbButton
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Suspend ${user.businessName || user.email}?`))
                            return;
                          void run("User suspended", () => setUserStatus(user.id, "suspended"));
                        }}
                      >
                        Suspend
                      </WbButton>
                    )}
                    {user.status === "suspended" && (
                      <>
                        <WbButton
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run("User reactivated", () =>
                              setUserStatus(user.id, "active"),
                            )
                          }
                        >
                          Reactivate
                        </WbButton>
                        <WbButton
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Deactivate ${user.businessName || user.email}?`))
                              return;
                            void run("User deactivated", () =>
                              setUserStatus(user.id, "deactivated"),
                            );
                          }}
                        >
                          Deactivate
                        </WbButton>
                      </>
                    )}
                  </div>
                </WbCardBody>
              </WbCard>

              {/* Pending subscription quick actions */}
              <WbCard>
                <WbCardBody>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Subscription
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    If this user has a pending plan request, activate or reject it below.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <WbButton
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run("Subscription activated", () =>
                          activatePendingSubscription(user.id),
                        )
                      }
                    >
                      Activate pending
                    </WbButton>
                    <WbButton
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Reject pending subscription for ${user.businessName || user.email}?`,
                          )
                        )
                          return;
                        void run("Subscription rejected", () =>
                          rejectPendingSubscription(user.id),
                        );
                      }}
                    >
                      Reject pending
                    </WbButton>
                  </div>
                </WbCardBody>
              </WbCard>

              {/* Danger zone */}
              <WbCard className="border-destructive/40">
                <WbCardBody>
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
                    Danger zone
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Permanently wipe this user's Firestore data (messages, contacts,
                    bots, campaigns, subscription, etc.). Auth login stays until
                    removed from the Firebase console. This cannot be undone.
                  </p>
                  <div className="mt-3">
                    <WbButton
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        const label = user.businessName || user.email || user.id;
                        const first = window.prompt(
                          `Type DELETE to permanently wipe "${label}".`,
                        );
                        if (first?.trim() !== "DELETE") return;
                        if (!window.confirm(`Really delete ${label}? Cannot be undone.`)) return;
                        void run("User data deleted", async () => {
                          await deleteUserData(user.id);
                          onClose();
                        });
                      }}
                    >
                      <FontAwesomeIcon icon={faTrash} className="h-3 w-3" /> Delete user data
                    </WbButton>
                  </div>
                </WbCardBody>
              </WbCard>

              {/* IDs */}
              <p className="pt-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
                UID: {user.id}
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function StatTile({
  icon,
  label,
  value,
  loading,
}: {
  icon: import("@fortawesome/fontawesome-svg-core").IconDefinition;
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center">
      <FontAwesomeIcon icon={icon} className="h-4 w-4 text-primary" />
      <p className={cn("mt-1 text-lg font-black tabular-nums text-foreground", loading && "opacity-60")}>
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SubscriptionCard({
  sub,
  liveAgents,
  loading,
}: {
  sub: UserSubscriptionRow | null;
  liveAgents: number;
  loading: boolean;
}) {
  return (
    <WbCard>
      <WbCardBody>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current subscription
          </p>
          {sub && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                sub.status === "active"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {sub.status}
            </span>
          )}
        </div>
        {loading ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
        ) : !sub ? (
          <p className="mt-2 text-xs text-muted-foreground">No subscription yet.</p>
        ) : (
          <>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {sub.planName || sub.planId || "Unnamed plan"}
            </p>
            <p className="text-xs text-muted-foreground">
              <FontAwesomeIcon icon={faCalendar} className="mr-1 h-3 w-3" />
              {sub.expiryType === "lifetime"
                ? "Lifetime access"
                : sub.endDate
                  ? `Renews ${format(new Date(sub.endDate), "PP")} · ${formatDistanceToNow(new Date(sub.endDate), { addSuffix: true })}`
                  : "No expiry date"}
            </p>
            <LivePlanUsage sub={sub} liveAgents={liveAgents} />
          </>
        )}
      </WbCardBody>
    </WbCard>
  );
}

function LivePlanUsage({ sub, liveAgents }: { sub: UserSubscriptionRow; liveAgents: number }) {
  // Prefer the live plan definition (admin edits `plans/*` any time) so the
  // max* limits reflect the current plan, not the snapshotted values on
  // the user's subscription doc which can lag.
  const { data: plans } = usePlans({ includeInactive: true });
  const activePlan = plans?.find((p) => p.id === sub.planId) ?? null;
  const maxMessages = activePlan?.maxMessages ?? sub.maxMessages;
  const maxAiMessages = activePlan?.maxAiMessages ?? sub.maxAiMessages;
  const maxContacts = activePlan?.maxContacts ?? sub.maxContacts;
  const maxCampaigns = activePlan?.maxCampaigns ?? sub.maxCampaigns;
  const maxBots = activePlan?.maxBots ?? sub.maxBots;
  const maxTemplates = activePlan?.maxTemplates ?? sub.maxTemplates;
  const maxAgents = activePlan?.maxAgents ?? sub.maxAgents;
  return (
    <div className="mt-3 space-y-2">
      <UsageBar label="Messages" used={sub.messagesUsed} max={maxMessages} />
      <UsageBar label="AI messages" used={sub.aiMessagesUsed} max={maxAiMessages} />
      <UsageBar label="Contacts" used={sub.contactsUsed} max={maxContacts} />
      <UsageBar label="Campaigns" used={sub.campaignsUsed} max={maxCampaigns} />
      <UsageBar label="Bots" used={sub.botsUsed} max={maxBots} />
      <UsageBar label="Templates" used={sub.templatesUsed} max={maxTemplates} />
      <UsageBar label="Agents" used={liveAgents} max={maxAgents} />
    </div>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const isInfinite = max === 0;
  const pct = isInfinite ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const bad = !isInfinite && pct >= 90;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-semibold text-foreground">
          {used.toLocaleString()} / {isInfinite ? "∞" : max.toLocaleString()}
        </span>
      </div>
      {!isInfinite && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full transition-all", bad ? "bg-destructive" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}