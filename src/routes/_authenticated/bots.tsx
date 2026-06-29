import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBolt,
  faCircleNotch,
  faRobot,
  faToggleOn,
  faPlus,
  faPen,
} from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { Switch } from "@/components/ui/switch";
import { useBots, type Bot } from "@/hooks/useBots";
import { BotFormSheet } from "@/components/bots/BotFormSheet";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { doc, updateDoc } from "firebase/firestore";
import { fbDb } from "@/integrations/firebase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bots")({
  head: () => ({ meta: [{ title: "Bots — Wabees" }] }),
  component: BotsPage,
});

function BotsPage() {
  const { data, error } = useBots();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Bot | null>(null);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(b: Bot) {
    setEditing(b);
    setOpen(true);
  }

  return (
    <>
      <TopBar
        title="Bots"
        subtitle="AI + rule-based auto-replies"
        right={
          <WbButton size="sm" onClick={openNew}>
            <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> New bot
          </WbButton>
        }
      />
      <div className="px-4 py-6 sm:px-6">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : data.length === 0 ? (
          <WbEmpty
            icon={faRobot}
            title="No bots yet"
            description="App me create kiye gaye AI aur keyword bots yahan realtime show hon ge."
            action={
              <WbButton onClick={openNew}>
                <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" /> Create bot
              </WbButton>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((bot) => (
              <BotCard key={bot.id} bot={bot} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>
      <BotFormSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}

function BotCard({ bot, onEdit }: { bot: Bot; onEdit: (b: Bot) => void }) {
  const uid = useEffectiveUid();
  async function toggle() {
    if (!uid) return;
    try {
      await updateDoc(doc(fbDb(), "users", uid, "bots", bot.id), { isActive: !bot.isActive });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  }
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{bot.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {bot.description || bot.responseText || "Auto-reply bot"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={bot.isActive} onCheckedChange={toggle} aria-label="Toggle active" />
          <button
            onClick={() => onEdit(bot)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Edit bot"
          >
            <FontAwesomeIcon icon={faPen} className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Metric icon={faToggleOn} label="Trigger" value={bot.triggerType} />
        <Metric icon={faBolt} label="Runs" value={String(bot.totalTriggered)} />
      </div>
      {bot.triggerKeywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {bot.triggerKeywords.slice(0, 6).map((k) => (
            <span
              key={k}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {k}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function Metric({ icon, label, value }: { icon: IconDefinition; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FontAwesomeIcon icon={icon} className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-1 truncate font-medium text-foreground">{value}</p>
    </div>
  );
}
