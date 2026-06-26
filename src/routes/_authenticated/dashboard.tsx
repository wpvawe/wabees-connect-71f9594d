import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlug, faComments, faBullhorn, faRobot } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { getConnectionStatus } from "@/lib/meta/connect.functions";
import { syncWhatsAppFromFirebase } from "@/lib/meta/sync.functions";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Wabees" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const fn = useServerFn(getConnectionStatus);
  const syncFn = useServerFn(syncWhatsAppFromFirebase);
  const qc = useQueryClient();
  const { data: row } = useSuspenseQuery({ queryKey: ["whatsapp-config"], queryFn: () => fn() });

  // First load only: if web has no WA row, try pulling it from the Flutter app's Firestore.
  useEffect(() => {
    if (row) return;
    let cancelled = false;
    syncFn({ data: undefined })
      .then((res) => {
        if (!cancelled && res.synced) qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
      })
      .catch(() => {
        /* silent — user can still connect manually */
      });
    return () => {
      cancelled = true;
    };
  }, [row, syncFn, qc]);

  return (
    <>
      <TopBar title="Dashboard" subtitle="Overview of your WhatsApp Business activity" />
      <div className="space-y-6 px-4 py-6 sm:px-6">
        {!row ? (
          <WbEmpty
            icon={faPlug}
            title="Connect WhatsApp to get started"
            description="One click sets up your number, webhook, and team inbox — no copy/paste tokens."
            action={<Link to="/connect"><WbButton>Connect WhatsApp</WbButton></Link>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={faComments} label="Conversations today" value="—" />
            <Stat icon={faBullhorn} label="Campaigns sent" value="—" />
            <Stat icon={faRobot} label="Bot replies" value="—" />
            <Stat icon={faPlug} label="Number" value={row.display_phone ?? row.phone_number_id ?? "—"} />
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ icon, label, value }: { icon: typeof faPlug; label: string; value: string }) {
  return (
    <WbCard>
      <WbCardBody>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <FontAwesomeIcon icon={icon} className="h-4 w-4 text-primary" />
        </div>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </WbCardBody>
    </WbCard>
  );
}