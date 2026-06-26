import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAndroid, faGooglePlay } from "@fortawesome/free-brands-svg-icons";
import { faDownload, faGlobe, faMobileScreen } from "@fortawesome/free-solid-svg-icons";
import inbox from "@/assets/screen-inbox.jpeg";
import campaigns from "@/assets/screen-campaigns.jpeg";
import bots from "@/assets/screen-bots.jpeg";

const APK_URL = "https://wabees.live/download/wabees.apk";

export function Download() {
  return (
    <section id="download" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Web + Mobile</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Use Wabees anywhere.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Sign in on the web for the full workspace experience, or grab the Android app to chat on the
            move. Both stay in perfect sync.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/auth/login"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:-translate-y-0.5"
            >
              <FontAwesomeIcon icon={faGlobe} className="h-4 w-4" />
              Open web app
            </a>
            <a
              href={APK_URL}
              rel="nofollow"
              className="inline-flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <FontAwesomeIcon icon={faAndroid} className="h-5 w-5 text-primary" />
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                  Download for
                </span>
                Android (APK)
              </span>
              <FontAwesomeIcon icon={faDownload} className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
            </a>
          </div>
          <ul className="mt-6 grid gap-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <FontAwesomeIcon icon={faMobileScreen} className="h-3.5 w-3.5 text-primary" />
              Android 5.0+ · ~25 MB · Auto-updates
            </li>
            <li className="flex items-center gap-2">
              <FontAwesomeIcon icon={faGooglePlay} className="h-3.5 w-3.5 text-primary" />
              Play Store version coming soon
            </li>
          </ul>
        </div>
        <div className="relative">
          <div className="grid grid-cols-3 gap-3">
            {[inbox, campaigns, bots].map((src, i) => (
              <img
                key={i}
                src={src}
                alt={["Shared inbox", "Campaign builder", "Bot studio"][i]}
                loading="lazy"
                className="aspect-[9/19] w-full rounded-2xl border border-border object-cover shadow-soft transition-transform hover:-translate-y-1"
                style={{ transform: `translateY(${i === 1 ? "-1.5rem" : "0"})` }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}