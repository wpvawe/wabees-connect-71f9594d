import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faCopy, faLink, faPlug, faTrash } from "@fortawesome/free-solid-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { loadWaCredentials } from "@/lib/firebase/whatsapp-config";
import {
  createMessageLink,
  deleteMessageLink,
  listMessageLinks,
  type MessageLink,
} from "@/lib/wabees/api";
import { toast } from "sonner";

type Link = { id: string; code: string; message: string; url: string; qrUrl: string };

export const Route = createFileRoute("/_authenticated/message-links")({
  head: () => ({ meta: [{ title: "Message Links — Wabees" }] }),
  component: MessageLinksPage,
});

function MessageLinksPage() {
  const uid = useFirebaseUid();
  const { data: wa } = useWhatsAppConfig();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const mapLink = (link: MessageLink): Link => ({
    id: link.id || link.code,
    code: link.code || link.id,
    message: link.prefilled_message || "",
    url: link.deep_link_url || "",
    qrUrl: link.qr_image_url || "",
  });

  const refreshLinks = useCallback(async () => {
    if (!uid || !wa?.phone_number_id) return;
    setLoading(true);
    try {
      const creds = await loadWaCredentials(uid);
      if (!creds?.access_token) throw new Error("WhatsApp not connected");
      const result = await listMessageLinks({
        phone_number_id: wa.phone_number_id,
        access_token: creds.access_token,
      });
      if (!result.success) throw new Error(result.message || "Failed to fetch links");
      const next = Array.isArray(result.data?.links) ? result.data.links.map(mapLink) : [];
      setLinks(next);
    } catch (e) {
      setLinks([]);
      toast.error(e instanceof Error ? e.message : "Failed to fetch links");
    } finally {
      setLoading(false);
    }
  }, [uid, wa?.phone_number_id]);

  useEffect(() => {
    void refreshLinks();
  }, [refreshLinks]);

  const phoneDigits = (wa?.display_phone ?? "").replace(/[^0-9]/g, "");
  const previewUrl =
    phoneDigits && message.trim()
      ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message.trim())}`
      : "";

  async function create() {
    if (!uid || !phoneDigits || !message.trim() || !wa?.phone_number_id) return;
    const phoneNumberId = wa.phone_number_id;
    setSaving(true);
    try {
      const creds = await loadWaCredentials(uid);
      if (!creds?.access_token) throw new Error("WhatsApp not connected");
      const result = await createMessageLink({
        phone_number_id: phoneNumberId,
        access_token: creds.access_token,
        prefilled_message: message.trim(),
      });
      if (!result.success) throw new Error(result.message || "Failed to create link");
      setMessage("");
      toast.success("Link created");
      void refreshLinks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(code: string) {
    if (!uid || !wa?.phone_number_id) return;
    const phoneNumberId = wa.phone_number_id;
    try {
      const creds = await loadWaCredentials(uid);
      if (!creds?.access_token) throw new Error("WhatsApp not connected");
      const result = await deleteMessageLink({
        phone_number_id: phoneNumberId,
        access_token: creds.access_token,
        link_id: code,
      });
      if (!result.success) throw new Error(result.message || "Failed to delete link");
      setLinks((current) => (current ? current.filter((l) => l.code !== code) : current));
      toast.success("Link deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied!");
    } catch {
      toast.error("Copy failed");
    }
  }

  if (!wa) {
    return (
      <>
        <TopBar title="Message Links" subtitle="Shareable WhatsApp links" />
        <div className="px-4 py-6 sm:px-6">
          <WbEmpty
            icon={faPlug}
            title="Connect WhatsApp first"
            description="Link your business number from Connect to create message links."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Message Links"
        subtitle="Create shareable wa.me links with prefilled messages"
      />
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardHeader title="New link" />
          <WbCardBody className="space-y-3">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Prefilled message text…"
              rows={3}
              className="block w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {previewUrl && (
              <p className="break-all rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                {previewUrl}
              </p>
            )}
            <div className="flex justify-end">
              <WbButton onClick={create} loading={saving} disabled={!message.trim()}>
                Create link
              </WbButton>
            </div>
          </WbCardBody>
        </WbCard>

        {links === null || loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : links.length === 0 ? (
          <WbEmpty
            icon={faLink}
            title="No links yet"
            description="Create your first prefilled wa.me link above."
          />
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="rounded-xl border border-border bg-card p-3">
                <p className="line-clamp-2 text-sm text-foreground">{l.message}</p>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all text-xs text-primary underline"
                >
                  {l.url}
                </a>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{l.code}</span>
                  <div className="flex gap-1">
                    <WbButton size="sm" variant="ghost" onClick={() => copyUrl(l.url)}>
                      <FontAwesomeIcon icon={faCopy} className="h-3.5 w-3.5" /> Copy
                    </WbButton>
                    <WbButton size="sm" variant="ghost" onClick={() => remove(l.code)}>
                      <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5 text-destructive" />
                    </WbButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
