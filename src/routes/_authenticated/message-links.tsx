import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch, faCopy, faLink, faPlug, faTrash } from "@fortawesome/free-solid-svg-icons";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbEmpty } from "@/components/wb/WbEmpty";
import { WbButton } from "@/components/wb/WbButton";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { fbDb } from "@/integrations/firebase/client";
import { toIso, str } from "@/lib/firebase/normalizers";
import { toast } from "sonner";
import { format } from "date-fns";

type Link = { id: string; message: string; url: string; createdAt: string | null };

export const Route = createFileRoute("/_authenticated/message-links")({
  head: () => ({ meta: [{ title: "Message Links — Wabees" }] }),
  component: MessageLinksPage,
});

function MessageLinksPage() {
  const uid = useEffectiveUid();
  const { data: wa } = useWhatsAppConfig();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(fbDb(), `users/${uid}/message_links`), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setLinks(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            message: str(x.message),
            url: str(x.url),
            createdAt: toIso(x.createdAt),
          };
        }),
      );
    });
  }, [uid]);

  const phoneDigits = (wa?.display_phone ?? "").replace(/[^0-9]/g, "");
  const previewUrl =
    phoneDigits && message.trim()
      ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message.trim())}`
      : "";

  async function create() {
    if (!uid || !phoneDigits || !message.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(fbDb(), `users/${uid}/message_links`), {
        message: message.trim(),
        url: previewUrl,
        createdAt: serverTimestamp(),
      });
      setMessage("");
      toast.success("Link created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!uid) return;
    try {
      await deleteDoc(doc(fbDb(), `users/${uid}/message_links/${id}`));
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

        {links === null ? (
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
                  <span className="text-[10px] text-muted-foreground">
                    {l.createdAt ? format(new Date(l.createdAt), "PPp") : ""}
                  </span>
                  <div className="flex gap-1">
                    <WbButton size="sm" variant="ghost" onClick={() => copyUrl(l.url)}>
                      <FontAwesomeIcon icon={faCopy} className="h-3.5 w-3.5" /> Copy
                    </WbButton>
                    <WbButton size="sm" variant="ghost" onClick={() => remove(l.id)}>
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
