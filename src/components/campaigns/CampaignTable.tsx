import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faBullhorn } from "@fortawesome/free-solid-svg-icons";
import { useCampaigns } from "@/hooks/useCampaigns";
import { WbEmpty } from "@/components/wb/WbEmpty";

const STATUS_CLS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-primary/15 text-primary",
  completed: "bg-accent text-accent-foreground",
  failed: "bg-destructive/15 text-destructive",
};

export function CampaignTable() {
  const { data, error } = useCampaigns();
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (data === null)
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  if (data.length === 0)
    return (
      <WbEmpty
        icon={faBullhorn}
        title="No campaigns yet"
        description="Create a campaign to broadcast a message to multiple contacts."
      />
    );
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Recipients</th>
            <th className="px-4 py-2 text-right">Sent</th>
            <th className="px-4 py-2 text-right">Failed</th>
            <th className="px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} className="border-t border-border/60 hover:bg-muted/40">
              <td className="px-4 py-2 font-medium text-foreground">
                <Link to="/campaigns/$id" params={{ id: c.id }} className="hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[c.status] ?? "bg-muted"}`}
                >
                  {c.status}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground">{c.totalRecipients}</td>
              <td className="px-4 py-2 text-right text-foreground">{c.sentCount}</td>
              <td className="px-4 py-2 text-right text-destructive">{c.failedCount || ""}</td>
              <td className="px-4 py-2 text-xs text-muted-foreground">
                {c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
