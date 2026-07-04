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
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useUserById } from "@/hooks/admin/useAdminData";
import {
  setUserRole,
  setUserStatus,
  setUserField,
  activatePendingSubscription,
  rejectPendingSubscription,
} from "@/lib/admin/mutations";
import { cn } from "@/lib/utils";

export function UserDetailDrawer({
  uid,
  onClose,
}: {
  uid: string | null;
  onClose: () => void;
}) {
  const { data: user } = useUserById(uid);
  const [busy, setBusy] = useState(false);

  if (!uid) return null;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
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

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2">
                <StatTile icon={faMessage} label="Messages" value={user.totalMessages} />
                <StatTile icon={faAddressBook} label="Contacts" value={user.totalContacts} />
                <StatTile icon={faRobot} label="Bots" value={user.totalBots} />
                <StatTile icon={faBullhorn} label="Campaigns" value={user.totalCampaigns} />
              </div>

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
                      onClick={() =>
                        void run("Subscription rejected", () =>
                          rejectPendingSubscription(user.id),
                        )
                      }
                    >
                      Reject pending
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
}: {
  icon: import("@fortawesome/fontawesome-svg-core").IconDefinition;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center">
      <FontAwesomeIcon icon={icon} className="h-4 w-4 text-primary" />
      <p className="mt-1 text-lg font-black tabular-nums text-foreground">
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}