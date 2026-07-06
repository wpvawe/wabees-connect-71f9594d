import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faUsers,
  faUserTie,
  faCircleCheck,
  faCircleNotch,
  faBan,
  faWifi,
  faMessage,
  faBullhorn,
  faLayerGroup,
  faHeadset,
  faCreditCard,
  faCircleXmark,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import {
  useAllUsers,
  usePendingSubscriptions,
  usePlatformCounts,
  useConfigDoc,
  useUsersWithoutSubscription,
} from "@/hooks/admin/useAdminData";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { setUserStatus, saveConfigDoc } from "@/lib/admin/mutations";
import type { AdminSectionKey } from "@/components/admin/AdminShell";
import { useState } from "react";
import { UserDetailDrawer } from "@/components/admin/sections/UserDetailDrawer";

export function OverviewSection({
  onNavigate,
}: {
  onNavigate: (k: AdminSectionKey) => void;
}) {
  const { data: users } = useAllUsers();
  // Server-side aggregate counts — accurate even beyond the 200-user cap.
  const counts = usePlatformCounts();
  const { data: pending } = usePendingSubscriptions();
  const { data: missingPlan, loading: missingLoading } =
    useUsersWithoutSubscription(users);
  const { data: ann } = useConfigDoc<{ message?: string; active?: boolean }>([
    "config",
    "announcement",
  ]);
  const [openUid, setOpenUid] = useState<string | null>(null);

  const pendingUsers = (users ?? []).filter((u) => u.status === "pending").slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatCard icon={faUsers} label="Users" value={counts.total} color="text-indigo-500" />
        <StatCard icon={faUserTie} label="Agents" value={counts.agents} color="text-fuchsia-500" />
        <StatCard
          icon={faCircleCheck}
          label="Active"
          value={counts.active}
          color="text-emerald-500"
        />
        <StatCard
          icon={faCircleNotch}
          label="Pending"
          value={counts.pending}
          color="text-amber-500"
        />
        <StatCard
          icon={faBan}
          label="Suspended"
          value={counts.suspended}
          color="text-destructive"
        />
        <StatCard
          icon={faWifi}
          label="Connected"
          value={counts.connected}
          color="text-sky-500"
        />
        <StatCard
          icon={faMessage}
          label="Messages"
          value={counts.totalMessages}
          color="text-violet-500"
        />
      </div>

      {/* Quick actions */}
      <WbCard>
        <WbCardHeader title="Quick actions" subtitle="Jump to a workspace" />
        <WbCardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction icon={faBullhorn} label="System" onClick={() => onNavigate("system")} />
          <QuickAction icon={faLayerGroup} label="Plans" onClick={() => onNavigate("plans")} />
          <QuickAction icon={faUsers} label="Users" onClick={() => onNavigate("users")} />
          <QuickAction icon={faHeadset} label="Support" onClick={() => onNavigate("support")} />
        </WbCardBody>
      </WbCard>

      {/* Active announcement */}
      {ann?.active && ann.message && (
        <WbCard>
          <WbCardBody className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-500/15 text-pink-500">
                <FontAwesomeIcon icon={faBullhorn} className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Active announcement</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{ann.message}</p>
              </div>
            </div>
            <WbButton
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await saveConfigDoc(["config", "announcement"], { active: false });
                  toast.success("Announcement disabled");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              <FontAwesomeIcon icon={faCircleXmark} className="h-3 w-3" /> Disable
            </WbButton>
          </WbCardBody>
        </WbCard>
      )}

      {/* Pending signups */}
      <WbCard>
        <WbCardHeader
          title="Pending signups"
          subtitle={`${counts.pending} awaiting approval`}
          right={
            counts.pending > 5 ? (
              <button
                type="button"
                onClick={() => onNavigate("users")}
                className="text-xs font-semibold text-primary hover:underline"
              >
                View all →
              </button>
            ) : undefined
          }
        />
        <WbCardBody>
          {pendingUsers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending signups 🎉
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {pendingUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {u.businessName || u.email || u.id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email}
                      {u.phoneNumber ? ` · ${u.phoneNumber}` : ""}
                    </p>
                  </div>
                  <WbButton
                    size="sm"
                    onClick={async () => {
                      try {
                        await setUserStatus(u.id, "active");
                        toast.success("Approved");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed");
                      }
                    }}
                  >
                    Approve
                  </WbButton>
                </li>
              ))}
            </ul>
          )}
        </WbCardBody>
      </WbCard>

      {/* Pending subs */}
      <WbCard>
        <WbCardHeader
          title="Pending subscriptions"
          subtitle={`${pending?.length ?? 0} requests waiting`}
          right={
            (pending?.length ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => onNavigate("pending")}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Review →
              </button>
            ) : undefined
          }
        />
        <WbCardBody>
          {!pending || pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending subscriptions.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {pending.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <FontAwesomeIcon
                      icon={faCreditCard}
                      className="h-3.5 w-3.5 text-primary"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {p.userName || p.userEmail || p.userId}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.planName}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WbCardBody>
      </WbCard>

      {/* Users without a plan — admin needs to assign */}
      <WbCard>
        <WbCardHeader
          title="Users without a plan"
          subtitle={
            missingLoading
              ? "Scanning accounts…"
              : `${missingPlan?.length ?? 0} account${
                  (missingPlan?.length ?? 0) === 1 ? "" : "s"
                } need a subscription assigned`
          }
          right={
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
              <FontAwesomeIcon
                icon={faTriangleExclamation}
                className="mr-1 h-2.5 w-2.5"
              />
              Action needed
            </span>
          }
        />
        <WbCardBody>
          {missingLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              <FontAwesomeIcon
                icon={faCircleNotch}
                className="mr-2 h-3.5 w-3.5 animate-spin"
              />
              Checking subscriptions…
            </p>
          ) : !missingPlan || missingPlan.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Every user has a plan assigned 🎉
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                These accounts have no <span className="font-mono">subscription/current</span>{" "}
                doc. Plan limits are skipped for them until a plan is assigned.
              </p>
              <ul className="divide-y divide-border/60">
                {missingPlan.slice(0, 10).map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {u.businessName || u.email || u.id}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.email || u.id}
                        {u.phoneNumber ? ` · ${u.phoneNumber}` : ""}
                      </p>
                    </div>
                    <WbButton size="sm" onClick={() => setOpenUid(u.id)}>
                      Assign plan
                    </WbButton>
                  </li>
                ))}
              </ul>
              {missingPlan.length > 10 && (
                <p className="pt-3 text-center text-xs text-muted-foreground">
                  +{missingPlan.length - 10} more — open the Users section to review.
                </p>
              )}
            </>
          )}
        </WbCardBody>
      </WbCard>

      <UserDetailDrawer uid={openUid} onClose={() => setOpenUid(null)} />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: IconDefinition;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <WbCard className="p-3">
      <FontAwesomeIcon icon={icon} className={cn("h-5 w-5", color)} />
      <p className="mt-2 text-2xl font-black tabular-nums text-foreground">
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </WbCard>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: IconDefinition;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
    >
      <FontAwesomeIcon icon={icon} className="h-5 w-5 text-primary" />
      {label}
    </button>
  );
}