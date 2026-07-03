import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBuilding,
  faChartLine,
  faCircleCheck,
  faCircleExclamation,
  faFileLines,
  faPhone,
  faRotate,
  faShieldHalved,
  faStar,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { useState } from "react";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useMutation } from "@tanstack/react-query";
import {
  disconnectWhatsApp,
  updateWhatsAppBusinessAccountId,
} from "@/lib/firebase/whatsapp-config";
import { syncTemplatesFromMeta } from "@/lib/firebase/templates";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Row {
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string | null;
  business_name: string | null;
  quality_rating: string | null;
  method: "embedded_signup" | "manual";
}

export function ConnectedCard({ row }: { row: Row }) {
  const selfUid = useFirebaseUid();
  const effectiveUid = useEffectiveUid();
  const [wabaInput, setWabaInput] = useState(row.waba_id ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dis = useMutation({
    mutationFn: () => disconnectWhatsApp(selfUid!),
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("WhatsApp disconnected");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => syncTemplatesFromMeta(effectiveUid!, selfUid!),
    onSuccess: (r) =>
      toast.success(
        `Synced ${r.synced} templates${r.deleted ? ` — ${r.deleted} removed` : ""}`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });
  const saveWaba = useMutation({
    mutationFn: () => updateWhatsAppBusinessAccountId(selfUid!, wabaInput),
    onSuccess: () => toast.success("WABA ID saved"),
    onError: (e: Error) => toast.error(e.message),
  });
  const hasWaba = Boolean(row.waba_id);
  return (
    <WbCard className="overflow-hidden rounded-xl">
      <WbCardBody className="p-0">
        <div className="border-b border-border bg-accent/35 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft">
                <FontAwesomeIcon icon={faCircleCheck} className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-lg font-semibold text-foreground">WhatsApp connected</h3>
                <p className="text-sm text-muted-foreground">
                  {row.display_phone || row.phone_number_id || "Phone number connected"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <WbButton
                variant="secondary"
                size="sm"
                loading={sync.isPending}
                onClick={() => sync.mutate()}
              >
                <FontAwesomeIcon icon={faRotate} className="h-3.5 w-3.5" />
                Sync templates
              </WbButton>
              <WbButton
                variant="danger"
                size="sm"
                loading={dis.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                Disconnect
              </WbButton>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Item
              icon={faPhone}
              label="Display phone"
              value={row.display_phone || row.phone_number_id || "—"}
            />
            <Item icon={faBuilding} label="Verified name" value={row.business_name || "—"} />
            <Item
              icon={faShieldHalved}
              label="WABA ID"
              value={row.waba_id || "Not added"}
              muted={!hasWaba}
            />
            <Item
              icon={faStar}
              label="Quality"
              value={row.quality_rating || "Unknown"}
              muted={!row.quality_rating}
            />
          </dl>

          {!hasWaba && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-primary">
                  <FontAwesomeIcon icon={faCircleExclamation} className="h-4 w-4" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    WABA ID is optional, but strongly recommended
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Adding a WABA ID enables template sync, account quality, limits and
                    business-level details. Basic send/receive works without it.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <WbInput
                  label="Add WABA ID"
                  value={wabaInput}
                  onChange={(e) => setWabaInput(e.target.value)}
                  placeholder="WhatsApp Business Account ID"
                />
                <WbButton loading={saveWaba.isPending} onClick={() => saveWaba.mutate()}>
                  Save WABA
                </WbButton>
              </div>
            </div>
          )}

          <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
            <Feature icon={faFileLines} title="Templates" active={hasWaba} />
            <Feature icon={faChartLine} title="Quality & limits" active={hasWaba} />
            <Feature icon={faRotate} title="Manual sync" active />
          </div>
        </div>
      </WbCardBody>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FontAwesomeIcon
                icon={faTriangleExclamation}
                className="h-4 w-4 text-destructive"
              />
              Disconnect WhatsApp?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This will disconnect{" "}
                  <span className="font-medium text-foreground">
                    {row.display_phone || row.phone_number_id || "your WhatsApp number"}
                  </span>{" "}
                  from this workspace. Until you reconnect:
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>New messages will not be delivered to your inbox.</li>
                  <li>Sending, replies, campaigns and scheduled messages will fail.</li>
                  <li>Your agents will be shown a “workspace disconnected” screen.</li>
                </ul>
                <p>You can reconnect anytime from this page.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dis.isPending}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                dis.mutate();
              }}
              disabled={dis.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {dis.isPending ? "Disconnecting…" : "Yes, disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WbCard>
  );
}

function Item({
  icon,
  label,
  value,
  muted,
}: {
  icon: IconDefinition;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-3">
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
        <dd
          className={
            muted
              ? "truncate text-sm font-medium text-muted-foreground"
              : "truncate text-sm font-medium text-foreground"
          }
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  active,
}: {
  icon: IconDefinition;
  title: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <FontAwesomeIcon
        icon={icon}
        className={active ? "h-3.5 w-3.5 text-primary" : "h-3.5 w-3.5 text-muted-foreground"}
      />
      <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>
        {title}
      </span>
      <span className={active ? "ml-auto text-primary" : "ml-auto text-muted-foreground"}>
        {active ? "Ready" : "Needs WABA"}
      </span>
    </div>
  );
}
