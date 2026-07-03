/**
 * Owner-only SLA target configuration. Two numeric inputs (first-response
 * and resolution targets, in minutes). Zero disables the corresponding
 * badge across the app.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useSlaSettings } from "@/hooks/useSlaSettings";
import { saveSlaSettings } from "@/lib/firebase/sla";

export function SlaSettingsSection() {
  const uid = useFirebaseUid();
  const current = useSlaSettings();
  const [first, setFirst] = useState<string>(String(current.firstResponseMinutes));
  const [resolve, setResolve] = useState<string>(String(current.resolutionMinutes));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFirst(String(current.firstResponseMinutes));
    setResolve(String(current.resolutionMinutes));
  }, [current.firstResponseMinutes, current.resolutionMinutes]);

  async function save() {
    if (!uid) return;
    const f = Number.parseInt(first, 10);
    const r = Number.parseInt(resolve, 10);
    if (Number.isNaN(f) || f < 0 || Number.isNaN(r) || r < 0) {
      toast.error("Enter a non-negative number of minutes");
      return;
    }
    setSaving(true);
    try {
      await saveSlaSettings(uid, { firstResponseMinutes: f, resolutionMinutes: r });
      toast.success("SLA targets updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WbCard>
      <WbCardHeader
        title="Response SLA"
        subtitle="Targets for first response and resolution. Zero disables the badge."
      />
      <WbCardBody>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            First response target (minutes)
            <WbInput
              type="number"
              min={0}
              value={first}
              onChange={(e) => setFirst(e.currentTarget.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Resolution target (minutes)
            <WbInput
              type="number"
              min={0}
              value={resolve}
              onChange={(e) => setResolve(e.currentTarget.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <WbButton onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save SLA"}
          </WbButton>
        </div>
      </WbCardBody>
    </WbCard>
  );
}