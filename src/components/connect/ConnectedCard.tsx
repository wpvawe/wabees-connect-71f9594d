import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faPhone, faBuilding, faStar } from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { disconnectWhatsApp } from "@/lib/meta/connect.functions";
import { toast } from "sonner";

interface Row {
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string | null;
  business_name: string | null;
  quality_rating: string | null;
  method: "embedded_signup" | "manual";
}

export function ConnectedCard({ row }: { row: Row }) {
  const qc = useQueryClient();
  const disFn = useServerFn(disconnectWhatsApp);
  const dis = useMutation({
    mutationFn: () => disFn(),
    onSuccess: () => {
      toast.success("Disconnected");
      qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <WbCard>
      <WbCardBody>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
            <FontAwesomeIcon icon={faCircleCheck} className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-foreground">WhatsApp connected</h3>
            <p className="text-xs text-muted-foreground">
              {row.method === "embedded_signup" ? "Via Meta Embedded Signup" : "Via manual token"}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <Item icon={faPhone} label="Phone" value={row.display_phone || row.phone_number_id || "—"} />
          <Item icon={faBuilding} label="WABA" value={row.business_name || row.waba_id || "—"} />
          {row.quality_rating && <Item icon={faStar} label="Quality" value={row.quality_rating} />}
        </dl>
        <div className="mt-6 flex justify-end">
          <WbButton variant="danger" size="sm" loading={dis.isPending} onClick={() => dis.mutate()}>
            Disconnect
          </WbButton>
        </div>
      </WbCardBody>
    </WbCard>
  );
}

function Item({ icon, label, value }: { icon: typeof faPhone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
      <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium text-foreground">{value}</dd>
      </div>
    </div>
  );
}