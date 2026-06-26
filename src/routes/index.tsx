import { createFileRoute } from "@tanstack/react-router";
import { SiteNav } from "@/components/landing/SiteNav";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Download } from "@/components/landing/Download";
import { Pricing } from "@/components/landing/Pricing";
import { Footer } from "@/components/landing/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wabees — WhatsApp Business Automation Platform" },
      {
        name: "description",
        content:
          "Shared team inbox, AI bots, broadcast campaigns, templates and analytics on the official WhatsApp Cloud API. One-click connect, no manual tokens.",
      },
      { property: "og:title", content: "Wabees — WhatsApp Business Automation" },
      {
        property: "og:description",
        content:
          "Run your WhatsApp like a real business. Shared inbox, AI bots, campaigns and analytics — built on the official Meta Cloud API.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Download />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}
