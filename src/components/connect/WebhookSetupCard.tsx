import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faChevronDown,
  faCopy,
  faExternalLinkAlt,
  faLink,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import {
  META_WEBHOOK_CALLBACK_URL,
  META_WEBHOOK_SUBSCRIBE_FIELDS,
  META_WEBHOOK_VERIFY_TOKEN,
} from "@/lib/constants/webhook";

/**
 * Shows the Meta webhook Callback URL + Verify Token with copy buttons,
 * and a step-by-step guide to generating a permanent (System User) access
 * token. Users need these values inside Meta App Dashboard → WhatsApp →
 * Configuration BEFORE they can paste a permanent token in the manual form.
 */
export function WebhookSetupCard() {
  const [tokenGuideOpen, setTokenGuideOpen] = useState(false);

  return (
    <WbCard>
      <WbCardHeader
        title="Webhook setup"
        subtitle="Paste these two values in Meta App Dashboard → WhatsApp → Configuration"
      />
      <WbCardBody>
        <div className="grid gap-3">
          <CopyRow
            icon="callback"
            label="Callback URL"
            value={META_WEBHOOK_CALLBACK_URL}
          />
          <CopyRow icon="token" label="Verify Token" value={META_WEBHOOK_VERIFY_TOKEN} />
        </div>

        <div className="mt-5 rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-semibold text-foreground">Setup steps</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>
              Open{" "}
              <a
                href="https://developers.facebook.com/apps/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline"
              >
                Meta App Dashboard
              </a>{" "}
              and create (or open) your Business-type app.
            </li>
            <li>
              In the left sidebar, add the <strong>WhatsApp</strong> product and open{" "}
              <strong>Configuration</strong>.
            </li>
            <li>
              Under <strong>Webhook</strong> click <em>Edit</em>, paste the Callback URL and
              Verify Token above, then press <em>Verify and save</em>.
            </li>
            <li>
              Click <em>Manage</em> next to Webhook fields and subscribe to:{" "}
              <code className="rounded bg-muted px-1 text-[11px]">
                {META_WEBHOOK_SUBSCRIBE_FIELDS.join(", ")}
              </code>
              .
            </li>
            <li>
              Under <strong>Phone numbers</strong>, add / verify your business number and
              copy the <strong>Phone Number ID</strong>.
            </li>
            <li>
              Generate a <strong>permanent access token</strong> (see guide below) — the
              default temporary token expires in 24 hours.
            </li>
            <li>Paste the Phone Number ID + permanent token in the form below.</li>
          </ol>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
          <button
            type="button"
            onClick={() => setTokenGuideOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              <FontAwesomeIcon icon={faShieldHalved} className="h-4 w-4 text-primary" />
              How to get a permanent access token?
            </span>
            <FontAwesomeIcon
              icon={faChevronDown}
              className={
                tokenGuideOpen
                  ? "h-3 w-3 rotate-180 transition-transform"
                  : "h-3 w-3 transition-transform"
              }
            />
          </button>
          {tokenGuideOpen && (
            <div className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Open{" "}
                  <a
                    href="https://business.facebook.com/settings/system-users"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline"
                  >
                    Business Settings → Users → System Users
                  </a>
                  .
                </li>
                <li>
                  Click <em>Add</em>, name the user (e.g. <code>wabees-api</code>) and role{" "}
                  <strong>Admin</strong>. Confirm.
                </li>
                <li>
                  Select the system user, click <em>Add Assets</em> → <strong>Apps</strong>{" "}
                  → pick your Meta app → toggle <strong>Full control</strong>.
                </li>
                <li>
                  Repeat and add your <strong>WhatsApp Account</strong> asset with{" "}
                  <strong>Full control</strong> too.
                </li>
                <li>
                  Click <em>Generate new token</em>. Select your app, set expiry to{" "}
                  <strong>Never</strong>, and check permissions:{" "}
                  <code className="rounded bg-muted px-1 text-[11px]">
                    whatsapp_business_management, whatsapp_business_messaging
                  </code>
                  .
                </li>
                <li>
                  Copy the token immediately (Meta shows it only once) and paste it below.
                </li>
              </ol>
          <a
            href="https://developers.facebook.com/docs/whatsapp/business-management-api/get-started"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-primary hover:underline"
          >
            Meta official guide
            <FontAwesomeIcon icon={faExternalLinkAlt} className="h-3 w-3" />
          </a>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="https://developers.facebook.com/apps/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex"
          >
            <WbButton variant="secondary" size="sm">
              <FontAwesomeIcon icon={faExternalLinkAlt} className="h-3 w-3" /> Open Meta
              App Dashboard
            </WbButton>
          </a>
          <a
            href="https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview"
            target="_blank"
            rel="noreferrer"
            className="inline-flex"
          >
            <WbButton variant="ghost" size="sm">
              <FontAwesomeIcon icon={faExternalLinkAlt} className="h-3 w-3" /> Webhook docs
            </WbButton>
          </a>
        </div>
      </WbCardBody>
    </WbCard>
  );
}

function CopyRow({
  icon,
  label,
  value,
}: {
  icon: "callback" | "token";
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  }
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <FontAwesomeIcon
          icon={icon === "callback" ? faLink : faShieldHalved}
          className="h-3 w-3 text-primary"
        />
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-xs font-mono text-foreground">
          {value}
        </code>
        <WbButton size="sm" variant="secondary" onClick={copy}>
          <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </WbButton>
      </div>
    </div>
  );
}