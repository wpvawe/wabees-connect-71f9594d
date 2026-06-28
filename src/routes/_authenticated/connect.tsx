import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { ManualTokenForm } from "@/components/connect/ManualTokenForm";
// Embedded Signup UI hidden for now (Meta BSP/TP gate). Keep import commented for future use.
// import { EmbeddedSignupButton } from "@/components/connect/EmbeddedSignupButton";
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
            {/* Auto (Embedded Signup) flow hidden — requires Meta BSP/TP approval.
                Re-enable later by uncommenting this block and the import above.
            <WbCard>
              <WbCardHeader title="Connect with Facebook" subtitle="Fully automatic — recommended" />
              <WbCardBody>
                <EmbeddedSignupButton />
              </WbCardBody>
            </WbCard>
            */}
            <WbCard>
              <WbCardHeader title="Use a manual token" subtitle="Fallback for advanced setups" />
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