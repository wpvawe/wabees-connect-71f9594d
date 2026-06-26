import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { MetaConnectButton } from "@/components/connect/MetaConnectButton";
import { ManualTokenForm } from "@/components/connect/ManualTokenForm";
import { ConnectedCard } from "@/components/connect/ConnectedCard";
import { getConnectionStatus } from "@/lib/meta/connect.functions";
import { getMetaPublicConfig } from "@/lib/meta/config.functions";
import { syncWhatsAppFromFirebase } from "@/lib/meta/sync.functions";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({ meta: [{ title: "Connect WhatsApp — Wabees" }] }),
  component: ConnectPage,
});

function ConnectPage() {
  const statusFn = useServerFn(getConnectionStatus);
  const cfgFn = useServerFn(getMetaPublicConfig);
  const syncFn = useServerFn(syncWhatsAppFromFirebase);
  const qc = useQueryClient();
  const { data: row } = useSuspenseQuery({ queryKey: ["whatsapp-config"], queryFn: () => statusFn() });
  const { data: cfg } = useSuspenseQuery({ queryKey: ["meta-public-config"], queryFn: () => cfgFn() });
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    if (row) return;
    let cancelled = false;
    syncFn({ data: undefined })
      .then((res) => {
        if (!cancelled && res.synced) qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [row, syncFn, qc]);

  return (
    <>
      <TopBar title="Connect WhatsApp" subtitle="Link your WhatsApp Business Account in one click" />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {row ? (
          <ConnectedCard row={row} />
        ) : (
          <>
            <WbCard>
              <WbCardHeader title="One-click setup" subtitle="Recommended — uses Meta's Embedded Signup" />
              <WbCardBody className="space-y-4">
                {cfg.configured ? (
                  <MetaConnectButton appId={cfg.appId} configId={cfg.configId} graphVersion={cfg.graphVersion} />
                ) : (
                  <div className="flex items-start gap-3 rounded-md border border-border bg-muted/60 p-3 text-sm">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Meta App not configured</p>
                      <p className="text-xs text-muted-foreground">Server is missing META_APP_ID / META_APP_SECRET / META_CONFIG_ID. Use the manual fallback below for now.</p>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  You'll be redirected to Facebook to pick the Business Manager and WhatsApp Business Account you want
                  to connect. We never see your password — Meta hands us a scoped token only.
                </p>
              </WbCardBody>
            </WbCard>

            <WbCard>
              <button
                type="button"
                onClick={() => setShowManual((v) => !v)}
                className="flex w-full items-center justify-between border-b border-border px-5 py-4 text-left sm:px-6"
              >
                <div>
                  <h3 className="text-base font-semibold text-foreground">Use a manual token</h3>
                  <p className="text-xs text-muted-foreground">For Meta Apps still in review.</p>
                </div>
                <FontAwesomeIcon icon={faChevronDown} className={`h-3 w-3 transition-transform ${showManual ? "rotate-180" : ""}`} />
              </button>
              {showManual && (
                <WbCardBody>
                  <ManualTokenForm />
                </WbCardBody>
              )}
            </WbCard>
          </>
        )}
      </div>
    </>
  );
}