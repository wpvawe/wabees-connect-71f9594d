import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faMobileScreen } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { ManualTokenForm } from "@/components/connect/ManualTokenForm";
import { ConnectedCard } from "@/components/connect/ConnectedCard";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({ meta: [{ title: "Connect WhatsApp — Wabees" }] }),
  component: ConnectPage,
});

function ConnectPage() {
  const { data, loading } = useWhatsAppConfig();

  return (
    <>
      <TopBar title="Connect WhatsApp" subtitle="Link your WhatsApp Business Account" />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : data ? (
          <ConnectedCard row={data} />
        ) : (
          <>
            <WbCard>
              <WbCardHeader title="Connect with the mobile app" subtitle="Recommended" />
              <WbCardBody>
                <div className="flex items-start gap-3 rounded-md border border-border bg-muted/60 p-3 text-sm">
                  <FontAwesomeIcon icon={faMobileScreen} className="mt-0.5 h-4 w-4 text-primary" />
                  <p className="text-muted-foreground">
                    Sign in to the Wabees mobile app with this account and run Embedded Signup
                    there. The connection appears here instantly — both platforms share the
                    same data.
                  </p>
                </div>
              </WbCardBody>
            </WbCard>
            <WbCard>
              <WbCardHeader title="Use a manual token" subtitle="For Meta Apps in review" />
              <WbCardBody>
                <ManualTokenForm />
              </WbCardBody>
            </WbCard>
          </>
        )}
      </div>
    </>
  );
}