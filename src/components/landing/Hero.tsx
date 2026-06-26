import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { faArrowRight, faShield, faBolt } from "@fortawesome/free-solid-svg-icons";
import { Bee3D } from "./Bee3D";

export function Hero() {
  return (
    <section className="hero-bg relative overflow-hidden">
      <Bee3D className="pointer-events-none absolute right-[-6%] top-1/2 hidden h-[420px] w-[420px] -translate-y-1/2 opacity-70 lg:block" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:py-32">
        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Official WhatsApp Cloud API partner-ready
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Run your WhatsApp like a <span className="text-primary">real business</span>.
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            Shared team inbox, AI replies, broadcast campaigns, templates, catalog and analytics — all on the
            official Meta Cloud API. One click connect, no manual tokens.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#download"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:-translate-y-0.5"
            >
              <FontAwesomeIcon icon={faWhatsapp} className="h-4 w-4" />
              Connect WhatsApp
              <FontAwesomeIcon icon={faArrowRight} className="h-3.5 w-3.5" />
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              See features
            </a>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-2 gap-6 text-sm">
            <div className="flex items-start gap-3">
              <FontAwesomeIcon icon={faShield} className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <dt className="font-medium text-foreground">End-to-end secure</dt>
                <dd className="text-muted-foreground">Encrypted tokens, JWT sessions, signed webhooks.</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FontAwesomeIcon icon={faBolt} className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <dt className="font-medium text-foreground">Realtime</dt>
                <dd className="text-muted-foreground">No reloads. Messages stream live to every device.</dd>
              </div>
            </div>
          </dl>
        </div>

        <div className="relative hidden lg:block">
          {/* phone mockup */}
          <div className="relative mx-auto h-[560px] w-[300px] rounded-[2.5rem] border border-border bg-card p-3 shadow-soft">
            <div className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-foreground/80" />
            <div className="h-full overflow-hidden rounded-[2rem] bg-[oklch(0.18_0.018_230)]">
              <div className="flex items-center gap-2 bg-primary px-4 py-3 text-primary-foreground">
                <FontAwesomeIcon icon={faWhatsapp} className="h-5 w-5" />
                <span className="text-sm font-semibold">Wabees Inbox</span>
              </div>
              <ul className="divide-y divide-white/5">
                {["Aisha — order #2189", "Hassan — pricing question", "Bot · Welcome flow", "Bilal — invoice sent"].map((m, i) => (
                  <li key={m} className="flex items-center gap-3 px-3 py-3 text-sm text-white/90">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/30 text-xs font-semibold text-primary-foreground">
                      {m.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m}</p>
                      <p className="truncate text-xs text-white/50">Tap to open conversation</p>
                    </div>
                    {i < 2 && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{i + 1}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}