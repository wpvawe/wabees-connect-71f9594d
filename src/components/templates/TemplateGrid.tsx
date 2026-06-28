import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch, faFileLines, faMagnifyingGlass, faRotate, faCircleCheck, faClock, faCircleXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { useTemplates, type Template } from "@/hooks/useTemplates";
import { syncTemplatesFromMeta } from "@/lib/firebase/templates";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";

export function TemplateGrid() {
  const { data, error } = useTemplates();
  const uid = useEffectiveUid();
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function onSync() {
    if (!uid) return;
    setSyncing(true);
    try {
      const r = await syncTemplatesFromMeta(uid);
      toast.success(`Synced ${r.synced} templates`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return data;
    if (!q.trim()) return data;
    const n = q.toLowerCase();
    return data.filter((t) => t.name.toLowerCase().includes(n) || t.body.toLowerCase().includes(n));
  }, [data, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring focus-visible:ring-2"
          />
        </div>
        <WbButton onClick={() => void onSync()} loading={syncing} variant="secondary">
          <FontAwesomeIcon icon={faRotate} className="h-3.5 w-3.5" />
          Sync from Meta
        </WbButton>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : filtered === null ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <WbEmpty
          icon={faFileLines}
          title={q ? "No matches" : "No templates yet"}
          description={q ? undefined : "Click 'Sync from Meta' to pull approved templates."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => <TemplateCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { icon: faCircleCheck, cls: "text-primary", label: "Approved" };
  if (s === "PENDING") return { icon: faClock, cls: "text-muted-foreground", label: "Pending" };
  return { icon: faCircleXmark, cls: "text-destructive", label: s };
}

function TemplateCard({ t }: { t: Template }) {
  const b = statusBadge(t.status);
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{t.name}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.category} · {t.languageCode}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-medium ${b.cls}`}>
          <FontAwesomeIcon icon={b.icon} className="h-3 w-3" />
          {b.label}
        </span>
      </div>
      {t.header && <p className="mt-3 text-xs font-semibold text-foreground">{t.header}</p>}
      <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs text-muted-foreground">{t.body}</p>
      {t.footer && <p className="mt-2 text-[11px] italic text-muted-foreground">{t.footer}</p>}
      {t.variables.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {t.variables.map((v) => (
            <span key={v} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">{`{{${v}}}`}</span>
          ))}
        </div>
      )}
    </div>
  );
}