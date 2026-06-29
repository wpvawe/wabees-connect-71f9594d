import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFacebook } from "@fortawesome/free-brands-svg-icons";
import { faCheck, faPlugCircleBolt, faPaperPlane } from "@fortawesome/free-solid-svg-icons";

const STEPS = [
  {
    icon: faFacebook,
    title: "Sign in with Facebook",
    desc: "One-click Embedded Signup. We never ask you to paste tokens — Meta provisions everything in a secure popup.",
  },
  {
    icon: faPlugCircleBolt,
    title: "Auto-connect your number",
    desc: "Pick your Business, WABA and phone number. We register webhooks, fetch the catalog and verify quality automatically.",
  },
  {
    icon: faPaperPlane,
    title: "Start messaging in seconds",
    desc: "Open the shared inbox, launch a campaign or turn on your AI bot. Everything updates in realtime.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            How it works
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            From zero to live in under 2 minutes.
          </h2>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="relative rounded-2xl border border-border bg-background p-6 shadow-soft"
            >
              <span className="absolute -top-3 left-6 inline-flex h-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">
                Step {i + 1}
              </span>
              <FontAwesomeIcon icon={s.icon} className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold text-foreground">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
              <p className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary">
                <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                No manual tokens
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
