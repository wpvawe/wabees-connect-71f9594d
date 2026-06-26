import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faInbox,
  faRobot,
  faBullhorn,
  faFileLines,
  faChartLine,
  faUsersGear,
  faBoxesStacked,
  faPhone,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";

const FEATURES: Array<{ icon: IconDefinition; title: string; desc: string }> = [
  { icon: faInbox, title: "Shared team inbox", desc: "Assign chats to agents, see typing, read receipts and presence in realtime." },
  { icon: faRobot, title: "AI + flow bots", desc: "Drag-and-drop bot builder plus an AI agent that learns your business context." },
  { icon: faBullhorn, title: "Broadcast campaigns", desc: "Schedule template messages to thousands with delivery, read and reply tracking." },
  { icon: faFileLines, title: "Template manager", desc: "Create, submit and track approval of HSM templates directly from the dashboard." },
  { icon: faBoxesStacked, title: "Catalog & commerce", desc: "Auto-create your WhatsApp catalog and send interactive product messages." },
  { icon: faChartLine, title: "Live analytics", desc: "Per-agent, per-campaign and per-bot insights with exportable reports." },
  { icon: faUsersGear, title: "Roles & agents", desc: "Owner, admin and agent roles with scoped permissions per conversation." },
  { icon: faPhone, title: "Voice calling", desc: "WebRTC voice calls inside the same workspace — no extra setup." },
  { icon: faShieldHalved, title: "Bank-grade security", desc: "Encrypted token vault, signed webhooks, rate-limits and full audit log." },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Everything you need</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          One platform. Every WhatsApp workflow.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Built on the official Meta Cloud API. The same features your team uses in the mobile app — now
          on a fast, keyboard-friendly web workspace.
        </p>
      </div>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <li
            key={f.title}
            className="group rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40"
          >
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <FontAwesomeIcon icon={f.icon} className="h-4 w-4" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}