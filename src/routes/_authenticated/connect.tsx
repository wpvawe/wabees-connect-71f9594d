import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCircleNotch,
  faCloudArrowDown,
  faFileLines,
  faKey,
  faPlugCircleBolt,
  faRoute,
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { ManualTokenForm } from "@/components/connect/ManualTokenForm";
// Embedded Signup UI hidden for now (Meta BSP/TP gate). Keep import commented for future use.
// import { EmbeddedSignupButton } from "@/components/connect/EmbeddedSignupButton";
import { ConnectedCard } from "@/components/connect/ConnectedCard";
import { PhoneHealthCard } from "@/components/connect/PhoneHealthCard";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { RequireCapability } from "@/components/auth/RequireCapability";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({ meta: [{ title: "Connect WhatsApp — Wabees" }] }),
  component: () => (
    <RequireCapability capability="whatsapp.connect">
      <ConnectPage />
    </RequireCapability>
  ),
});

function ConnectPage() {
  const { data, loading } = useWhatsAppConfig();

  return (
    <>
      <TopBar title="Connect WhatsApp" subtitle="Phone, templates and webhook routing" />
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-5 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
                  <FontAwesomeIcon icon={faWhatsapp} className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">
                    Business API connection
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Website ab app ke same backend flow aur Firestore schema use karti hai.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <FlowItem
                  icon={faKey}
                  title="Manual credentials"
                  text="Phone Number ID + permanent token save hota hai."
                />
                <FlowItem
                  icon={faRoute}
                  title="Webhook routing"
                  text="wa_map owner routing doc auto-create hota hai."
                />
                <FlowItem
                  icon={faCloudArrowDown}
                  title="Template sync"
                  text="WABA ID ho to templates PHP backend se sync hoti hain."
                />
                <FlowItem
                  icon={faFileLines}
                  title="Shared data"
                  text="Contacts, inbox, bots effective owner UID se read hote hain."
                />
              </div>
            </div>
            <div className="border-t border-border bg-background p-5 sm:p-7 lg:border-l lg:border-t-0">
              <div className="flex h-full flex-col justify-center rounded-lg border border-border bg-card p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FontAwesomeIcon icon={faPlugCircleBolt} className="h-4 w-4 text-primary" />
                  Connection audit
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <AuditLine label="Phone connection" ok={Boolean(data?.phone_number_id)} />
                  <AuditLine label="Display phone" ok={Boolean(data?.display_phone)} />
                  <AuditLine label="WABA-dependent sync" ok={Boolean(data?.waba_id)} soft />
                  <AuditLine label="Quality rating" ok={Boolean(data?.quality_rating)} soft />
                </div>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : data ? (
          <>
            <ConnectedCard row={data} />
            {data.phone_number_id && (
              <PhoneHealthCard
                phoneNumberId={data.phone_number_id}
                cachedRating={data.quality_rating}
              />
            )}
          </>
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
              <WbCardHeader
                title="Manual connection"
                subtitle="Use the same safe backend flow as the mobile app"
              />
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

function FlowItem({ icon, title, text }: { icon: IconDefinition; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <FontAwesomeIcon icon={icon} className="h-4 w-4 text-primary" />
      <p className="mt-2 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function AuditLine({ label, ok, soft }: { label: string; ok: boolean; soft?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          ok
            ? "text-xs font-semibold text-primary"
            : soft
              ? "text-xs font-semibold text-muted-foreground"
              : "text-xs font-semibold text-destructive"
        }
      >
        {ok ? "Ready" : soft ? "Optional" : "Needed"}
      </span>
    </div>
  );
}
