import { createFileRoute } from "@tanstack/react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faBolt, faCircleNotch, faRobot, faToggleOn } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { useBots, type Bot } from "@/hooks/useBots";

export const Route = createFileRoute("/_authenticated/bots")({
  head: () => ({ meta: [{ title: "Bots — Wabees" }] }),
  component: BotsPage,
});

function BotsPage() {
  const { data, error } = useBots();
  return (
    <>
      <TopBar title="Bots" subtitle="AI + rule-based auto-replies" />
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
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((bot) => <BotCard key={bot.id} bot={bot} />)}
          </div>
        )}
      </div>
    </>
  );
}

function BotCard({ bot }: { bot: Bot }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{bot.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{bot.description || bot.responseText || "Auto-reply bot"}</p>
        </div>
        <span className={bot.isActive ? "rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-primary" : "rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"}>
          {bot.isActive ? "Active" : "Off"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Metric icon={faToggleOn} label="Trigger" value={bot.triggerType} />
        <Metric icon={faBolt} label="Runs" value={String(bot.totalTriggered)} />
      </div>
      {bot.triggerKeywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {bot.triggerKeywords.slice(0, 6).map((k) => (
            <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{k}</span>
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