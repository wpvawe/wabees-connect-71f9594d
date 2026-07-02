import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faCircleNotch,
  faCircleXmark,
  faGaugeHigh,
  faHeadset,
  faLifeRing,
  faLock,
  faUsers,
  faUsersGear,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { fbDb } from "@/integrations/firebase/client";
import { useProfile } from "@/hooks/useProfile";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Wabees" }] }),
  component: AdminPage,
});

type Tab = "users" | "plans" | "support";

type UserRow = {
  id: string;
  email: string;
  businessName: string;
  role: string;
  status: string;
  createdAt: Date | null;
  totalMessages: number;
};

function AdminPage() {
  const { data: profile, loading: profileLoading } = useProfile();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState<Tab>("users");

  if (profileLoading) {
    return (
      <>
        <TopBar title="Admin" />
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <TopBar title="Admin" />
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <FontAwesomeIcon icon={faLock} className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">Restricted area</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only workspace administrators can open this section.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Admin panel" subtitle="Approve users, manage plans and support" />
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap gap-2">
          <TabButton current={tab} value="users" onClick={setTab} icon={faUsers} label="Users" />
          <TabButton current={tab} value="plans" onClick={setTab} icon={faGaugeHigh} label="Plans" />
          <TabButton current={tab} value="support" onClick={setTab} icon={faHeadset} label="Support" />
        </div>

        {tab === "users" && <UsersTab />}
        {tab === "plans" && <PlansShortcut />}
        {tab === "support" && <SupportShortcut />}
      </div>
    </>
  );
}

function TabButton({
  current,
  value,
  onClick,
  icon,
  label,
}: {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  icon: typeof faUsers;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function UsersTab() {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "suspended">("pending");

  useEffect(() => {
    const q = query(collection(fbDb(), "users"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            const ts = x.createdAt as { toDate?: () => Date } | undefined;
            return {
              id: d.id,
              email: (x.email as string) ?? "",
              businessName: (x.businessName as string) ?? "",
              role: (x.role as string) ?? "user",
              status: (x.status as string) ?? "active",
              createdAt: ts?.toDate?.() ?? null,
              totalMessages: (x.totalMessages as number) ?? 0,
            };
          }),
        );
      },
      () => setRows([]),
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => filter === "all" || r.status === filter),
    [rows, filter],
  );

  async function setStatus(id: string, status: string) {
    try {
      await updateDoc(doc(fbDb(), "users", id), { status, updatedAt: serverTimestamp() });
      toast.success(`User ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Users"
        subtitle={`${rows?.length ?? 0} total · ${(rows ?? []).filter((r) => r.status === "pending").length} pending`}
        right={
          <div className="flex gap-1 rounded-full border border-border bg-background p-1 text-xs">
            {(["pending", "active", "suspended", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-2.5 py-1 font-semibold capitalize transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        }
      />
      <WbCardBody>
        {rows === null ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No users in this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Messages</th>
                  <th className="py-2 pr-3">Joined</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-foreground">{u.businessName || u.email || u.id}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="py-2 pr-3 text-xs uppercase text-muted-foreground">{u.role}</td>
                    <td className="py-2 pr-3">
                      <StatusPill status={u.status} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{u.totalMessages.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {u.createdAt ? u.createdAt.toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-1">
                        {u.status !== "active" && (
                          <WbButton size="sm" onClick={() => setStatus(u.id, "active")}>
                            <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" /> Approve
                          </WbButton>
                        )}
                        {u.status !== "suspended" && (
                          <WbButton
                            size="sm"
                            variant="secondary"
                            onClick={() => setStatus(u.id, "suspended")}
                          >
                            <FontAwesomeIcon icon={faCircleXmark} className="h-3 w-3" /> Suspend
                          </WbButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WbCardBody>
    </WbCard>
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

function PlansShortcut() {
  return (
    <WbCard>
      <WbCardHeader title="Plans" subtitle="Manage subscription tiers and message quotas" />
      <WbCardBody className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FontAwesomeIcon icon={faUsersGear} className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Plans workspace</p>
            <p className="text-xs text-muted-foreground">
              CRUD lives in the dedicated Plans page.
            </p>
          </div>
        </div>
        <Link
          to="/plans"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Open plans
        </Link>
      </WbCardBody>
    </WbCard>
  );
}

function SupportShortcut() {
  return (
    <WbCard>
      <WbCardHeader title="Support inbox" subtitle="Answer user tickets and live chats" />
      <WbCardBody className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FontAwesomeIcon icon={faLifeRing} className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Support workspace</p>
            <p className="text-xs text-muted-foreground">
              Ticket queue and live chat both live in Support.
            </p>
          </div>
        </div>
        <Link
          to="/support"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Open support
        </Link>
      </WbCardBody>
    </WbCard>
  );
}