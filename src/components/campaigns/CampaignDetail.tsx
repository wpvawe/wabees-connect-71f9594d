import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlay, faTrash, faCircleNotch, faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { WbCard, WbCardBody } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { useCampaign } from "@/hooks/useCampaigns";
import { useCampaignLogs } from "@/hooks/useCampaignLogs";
import { useContacts } from "@/hooks/useContacts";
import { runCampaign, deleteCampaign } from "@/lib/firebase/campaigns";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";

export function CampaignDetail({ id }: { id: string }) {
  const { data, error } = useCampaign(id);
  const { data: logs } = useCampaignLogs(id);
  const { data: contacts } = useContacts();
  const navigate = useNavigate();
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [running, setRunning] = useState(false);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (data === undefined || data === null) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  async function run() {
    if (!uid || !selfUid || !data) return;
    if (!confirm(`Start sending to ${data.totalRecipients} recipients?`)) return;
    setRunning(true);
    try {
      const contactsByPhone: Record<string, Record<string, string>> = {};
      for (const c of contacts ?? []) {
        contactsByPhone[c.phone] = {
          name: c.name,
          phone: c.phone,
          email: c.email ?? "",
          company: c.company ?? "",
        };
      }
      const r = await runCampaign(
        uid,
        selfUid,
        id,
        data.audiencePhones ?? [],
        data.messageBody,
        {
          messageType: (data.messageType as "text" | "template") ?? "text",
          templateName: data.templateName ?? null,
          templateLanguage: data.templateLanguage ?? null,
          templateVariables: data.templateVariables ?? [],
          templateHeaderFormat: data.templateHeaderFormat ?? null,
          templateHeaderMediaUrl: data.templateHeaderMediaUrl ?? null,
          variableSource: data.variableSource ?? "static",
          staticVariableValues: data.staticVariableValues ?? {},
          contactFieldMap: data.contactFieldMap ?? {},
          contactsByPhone,
        },
      );
      toast.success(`Sent ${r.sent}, failed ${r.failed}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function remove() {
    if (!uid) return;
    if (!confirm("Delete this campaign?")) return;
    try {
      await deleteCampaign(uid, id);
      toast.success("Deleted");
      navigate({ to: "/campaigns" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate({ to: "/campaigns" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <FontAwesomeIcon icon={faArrowLeft} className="h-3.5 w-3.5" />
        Back to campaigns
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{data.name}</h2>
          <p className="text-xs text-muted-foreground">
            Created {data.createdAt ? format(new Date(data.createdAt), "MMM d, yyyy 'at' p") : "—"}
          </p>
        </div>
        <div className="flex gap-2">
          {data.status === "draft" && (
            <WbButton onClick={() => void run()} loading={running}>
              <FontAwesomeIcon icon={faPlay} className="h-3.5 w-3.5" />
              Start sending
            </WbButton>
          )}
          <WbButton variant="ghost" onClick={() => void remove()}>
            <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
            Delete
          </WbButton>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Recipients" value={data.totalRecipients} />
        <Stat label="Sent" value={data.sentCount} />
        <Stat label="Failed" value={data.failedCount} tone="danger" />
        <Stat label="Status" value={data.status} />
      </div>
      <WbCard>
        <WbCardBody>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Message
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{data.messageBody}</p>
        </WbCardBody>
      </WbCard>
      <WbCard>
        <div className="border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">Send log</p>
        </div>
        {logs === null ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : logs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No sends yet.</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Error</th>
                  <th className="px-4 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border/60">
                    <td className="px-4 py-2 text-muted-foreground">{l.phone}</td>
                    <td
                      className={`px-4 py-2 font-medium ${l.status === "sent" ? "text-primary" : "text-destructive"}`}
                    >
                      {l.status}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.error ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {l.sentAt ? format(new Date(l.sentAt), "MMM d, p") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WbCard>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" }) {
  return (
    <WbCard>
      <WbCardBody>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold ${tone === "danger" ? "text-destructive" : "text-foreground"}`}
        >
          {value}
        </p>
      </WbCardBody>
    </WbCard>
  );
}
