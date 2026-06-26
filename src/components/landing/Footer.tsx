import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import wbIcon from "@/assets/wabees-icon.png";

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <img src={wbIcon} alt="" className="h-8 w-8 rounded-lg" />
            Wabees
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            WhatsApp Business automation built on the official Meta Cloud API.
          </p>
        </div>
        {[
          { title: "Product", links: [["Features", "#features"], ["Pricing", "#pricing"], ["Download", "#download"]] },
          { title: "Company", links: [["About", "/about"], ["Contact", "/contact"], ["Privacy", "/privacy"]] },
          { title: "Legal", links: [["Terms", "/terms"], ["Data deletion", "/data-deletion"]] },
        ].map((c) => (
          <div key={c.title}>
            <h4 className="text-sm font-semibold text-foreground">{c.title}</h4>
            <ul className="mt-3 space-y-2 text-sm">
              {c.links.map(([l, h]) => (
                <li key={l}>
                  <a href={h} className="text-muted-foreground hover:text-foreground">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <p>© {new Date().getFullYear()} Wabees. All rights reserved.</p>
          <a href="https://wa.me/" target="_blank" rel="noopener" className="inline-flex items-center gap-2 hover:text-foreground">
            <FontAwesomeIcon icon={faWhatsapp} className="h-3.5 w-3.5 text-primary" />
            Chat with us
          </a>
        </div>
      </div>
    </footer>
  );
}