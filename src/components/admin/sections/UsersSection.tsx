import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faCircleXmark,
  faCircleNotch,
  faEllipsisVertical,
  faSearch,
  faEye,
} from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAllUsers, type AdminUser } from "@/hooks/admin/useAdminData";
import { setUserStatus } from "@/lib/admin/mutations";
import { UserDetailDrawer } from "@/components/admin/sections/UserDetailDrawer";

type Filter = "all" | "pending" | "active" | "suspended" | "deactivated";

export function UsersSection() {
  const { data, error } = useAllUsers();
  const [filter, setFilter] = useState<Filter>("pending");
  const [searchQ, setSearchQ] = useState("");
  const [openUid, setOpenUid] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return (data ?? []).filter((u) => {
      if (filter !== "all" && u.status !== filter) return false;
      if (!q) return true;
      return (
        u.businessName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phoneNumber.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      );
    });
  }, [data, filter, searchQ]);

  const counts = useMemo(() => {
    const c = { pending: 0, active: 0, suspended: 0, deactivated: 0 };
    for (const u of data ?? []) {
      if (u.status === "pending") c.pending++;
      else if (u.status === "active") c.active++;
      else if (u.status === "suspended") c.suspended++;
      else if (u.status === "deactivated") c.deactivated++;
    }
    return c;
  }, [data]);

  return (
    <>
      <WbCard>
        <WbCardHeader
          title="Users"
          subtitle={`${data?.length ?? 0} total`}
          right={
            <div className="relative w-full max-w-xs">
              <FontAwesomeIcon
                icon={faSearch}
                className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search name, email, phone…"
                className="h-9 w-full rounded-full border border-input bg-background pl-8 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
              />
            </div>
          }
        />
        <div className="border-b border-border px-4 py-2 sm:px-6">
          <div className="flex gap-1 overflow-x-auto">
            {(
              [
                ["all", "All", data?.length ?? 0],
                ["pending", "Pending", counts.pending],
                ["active", "Active", counts.active],
                ["suspended", "Suspended", counts.suspended],
                ["deactivated", "Deactivated", counts.deactivated],
              ] as [Filter, string, number][]
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  filter === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {label} <span className="opacity-70">({count})</span>
              </button>
            ))}
          </div>
        </div>

        <WbCardBody>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No users match this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Msgs</th>
                    <th className="py-2 pr-3">WA</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((u) => (
                    <UserRow key={u.id} u={u} onOpen={() => setOpenUid(u.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WbCardBody>
      </WbCard>

      <UserDetailDrawer uid={openUid} onClose={() => setOpenUid(null)} />
    </>
  );
}

function UserRow({ u, onOpen }: { u: AdminUser; onOpen: () => void }) {
  async function action(status: string) {
    try {
      await setUserStatus(u.id, status);
      toast.success(`User ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }
  return (
    <tr className="hover:bg-muted/30">
      <td className="py-2 pr-3">
        <button
          type="button"
          onClick={onOpen}
          className="text-left"
        >
          <p className="font-semibold text-foreground hover:underline">
            {u.businessName || u.email || u.id}
          </p>
          <p className="text-xs text-muted-foreground">{u.email}</p>
        </button>
      </td>
      <td className="py-2 pr-3 text-xs uppercase text-muted-foreground">{u.role}</td>
      <td className="py-2 pr-3">
        <StatusPill status={u.status} />
      </td>
      <td className="py-2 pr-3 tabular-nums">{u.totalMessages.toLocaleString()}</td>
      <td className="py-2 pr-3">
        {u.whatsappConnected ? (
          <FontAwesomeIcon icon={faCircleCheck} className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <FontAwesomeIcon icon={faCircleXmark} className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </td>
      <td className="py-2 pr-3">
        <div className="flex justify-end gap-1">
          <WbButton size="sm" variant="ghost" onClick={onOpen}>
            <FontAwesomeIcon icon={faEye} className="h-3 w-3" />
          </WbButton>
          {u.status !== "active" && (
            <WbButton size="sm" onClick={() => action("active")}>
              <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" /> Approve
            </WbButton>
          )}
          {u.status === "active" && (
            <WbButton size="sm" variant="secondary" onClick={() => action("suspended")}>
              Suspend
            </WbButton>
          )}
          {u.status === "suspended" && (
            <WbButton size="sm" variant="danger" onClick={() => action("deactivated")}>
              Deactivate
            </WbButton>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "pending"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : status === "suspended"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", tone)}>
      {status}
    </span>
  );
}

// eslint fix — keep imports referenced
void faEllipsisVertical;