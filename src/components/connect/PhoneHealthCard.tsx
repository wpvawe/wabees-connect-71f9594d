import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faCircleCheck,
  faCircleExclamation,
  faGaugeHigh,
  faShieldHalved,
  faSignal,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { fbAuth, WABEES_API_BASE } from "@/integrations/firebase/client";
import { loadWaConnection } from "@/lib/firebase/whatsapp-config";
import { cn } from "@/lib/utils";

type Health = {
  quality_rating: string;
  messaging_limit_tier: string;
  verified_name: string;
  name_status: string;
  display_phone_number: string;
  code_verification_status: string;
  throughput_level: string;
};

const ENDPOINT = `${WABEES_API_BASE}/phone-health.php`;

export function PhoneHealthCard({
  phoneNumberId,
  cachedRating,
}: {
  phoneNumberId: string;
  cachedRating?: string | null;
}) {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  async function fetchHealth() {
    const user = fbAuth().currentUser;
    if (!user) {
      setError("Not signed in");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const creds = await loadWaConnection(user.uid);
      if (!creds) {
        throw new Error("WhatsApp access token not available for this account");
      }
      const idToken = await user.getIdToken().catch(() => null);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          phone_number_id: phoneNumberId || creds.phone_number_id,
        }),
      });
      const json = (await res.json()) as Health & { error?: unknown };
      if (!res.ok) {
        const errMsg =
          typeof json.error === "string"
            ? json.error
            : json.error && typeof json.error === "object"
              ? ((json.error as { message?: string }).message ??
                JSON.stringify(json.error))
              : `HTTP ${res.status}`;
        throw new Error(errMsg);
      }
      setData(json);
      setCheckedAt(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch phone health";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (phoneNumberId) fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneNumberId]);

  const rating = (data?.quality_rating || cachedRating || "UNKNOWN").toUpperCase();

  return (
    <WbCard>
      <WbCardHeader
        title="Phone health"
        subtitle="Live quality signal from Meta for this WhatsApp number"
        right={
          <WbButton size="sm" variant="secondary" onClick={fetchHealth} loading={loading}>
            <FontAwesomeIcon icon={faArrowsRotate} className="h-3.5 w-3.5" /> Refresh
          </WbButton>
        }
      />
      <WbCardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <QualityPill rating={rating} />
          {data?.verified_name && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground">
              <FontAwesomeIcon icon={faShieldHalved} className="h-3 w-3 text-primary" />
              {data.verified_name}
              {data.name_status && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  · {data.name_status.toLowerCase()}
                </span>
              )}
            </span>
          )}
          {checkedAt && (
            <span className="text-[11px] text-muted-foreground">
              Checked {checkedAt.toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <HealthStat
            icon={faGaugeHigh}
            label="Messaging tier"
            value={formatTier(data?.messaging_limit_tier)}
          />
          <HealthStat
            icon={faSignal}
            label="Throughput"
            value={data?.throughput_level || "STANDARD"}
          />
          <HealthStat
            icon={faCircleCheck}
            label="Verification"
            value={data?.code_verification_status || "—"}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <FontAwesomeIcon icon={faCircleExclamation} className="mt-0.5 h-3.5 w-3.5" />
            <span>{error}. Showing last cached values (if any).</span>
          </div>
        )}
      </WbCardBody>
    </WbCard>
  );
}

function formatTier(t?: string): string {
  if (!t) return "—";
  const m = t.match(/TIER_(\d+K?)/i);
  if (m) return `Tier ${m[1]}`;
  if (/UNLIMITED/i.test(t)) return "Unlimited";
  return t;
}

function QualityPill({ rating }: { rating: string }) {
  const tone =
    rating === "GREEN"
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
      : rating === "YELLOW"
        ? "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400"
        : rating === "RED"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-muted text-muted-foreground border-border";
  const label =
    rating === "GREEN"
      ? "High quality"
      : rating === "YELLOW"
        ? "Medium quality"
        : rating === "RED"
          ? "Low quality"
          : "Unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        tone,
      )}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
    </span>
  );
}

function HealthStat({
  icon,
  label,
  value,
}: {
  icon: typeof faGaugeHigh;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <FontAwesomeIcon icon={icon} className="h-3 w-3 text-primary" />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}