import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";

const PLANS = [
  {
    name: "Starter",
    price: "Free",
    blurb: "For trying Wabees out.",
    cta: "Start free",
    features: ["1 WhatsApp number", "Shared inbox", "Up to 2 agents", "100 broadcast / month"],
    accent: false,
  },
  {
    name: "Business",
    price: "$29",
    blurb: "For growing teams.",
    cta: "Choose Business",
    features: ["Everything in Starter", "Unlimited agents", "AI bot + flow builder", "10k broadcast / month", "Catalog & analytics"],
    accent: true,
  },
  {
    name: "Scale",
    price: "Custom",
    blurb: "For high-volume senders.",
    cta: "Talk to sales",
    features: ["Everything in Business", "Dedicated IP & support", "SSO & audit log", "Unlimited broadcast"],
    accent: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Pricing</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Simple, predictable plans.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Pay monthly, cancel anytime. All plans use the official Meta Cloud API — Meta&apos;s conversation
            fees billed separately at cost.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                "relative flex flex-col rounded-2xl border p-6 shadow-soft " +
                (p.accent
                  ? "border-primary bg-card ring-2 ring-primary/30"
                  : "border-border bg-background")
              }
            >
              {p.accent && (
                <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-foreground">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
                {p.price}
                {p.price.startsWith("$") && <span className="text-base font-normal text-muted-foreground">/mo</span>}
              </p>
              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-foreground/90">
                    <FontAwesomeIcon icon={faCheck} className="mt-1 h-3 w-3 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="/auth/login"
                className={
                  "mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors " +
                  (p.accent
                    ? "bg-primary text-primary-foreground hover:bg-[var(--wb-green-deep)]"
                    : "border border-border bg-card text-foreground hover:bg-muted")
                }
              >
                {p.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}