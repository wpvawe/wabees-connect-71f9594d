import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { signOut as fbSignOut } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser, faCheckCircle } from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import { useProfile } from "@/hooks/useProfile";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { toast } from "sonner";
import { BusinessProfileSection } from "@/components/settings/BusinessProfileSection";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Wabees" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const uid = useFirebaseUid();
  const { data: profile, loading } = useProfile();
  const { data: wa } = useWhatsAppConfig();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.businessName);
      setPhone(profile.phoneNumber);
      setImageUrl(profile.profileImageUrl ?? "");
    }
  }, [profile]);

  async function save() {
    if (!uid) return;
    setSaving(true);
    try {
      await updateDoc(doc(fbDb(), "users", uid), {
        businessName: name,
        phoneNumber: phone,
        profileImageUrl: imageUrl || null,
        updatedAt: serverTimestamp(),
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await fbSignOut(fbAuth());
    window.location.assign("/auth");
  }

  return (
    <>
      <TopBar title="Settings" subtitle="Your account & profile" />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {/* Profile summary */}
        <WbCard>
          <WbCardBody>
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Avatar url={imageUrl || profile?.profileImageUrl} fallback={name || profile?.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-foreground">
                  {loading ? "…" : name || profile?.email || "Account"}
                </p>
                <p className="truncate text-sm text-muted-foreground">{profile?.email}</p>
                {profile?.role && (
                  <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                    {profile.role}
                  </span>
                )}
              </div>
            </div>
          </WbCardBody>
        </WbCard>

        {/* WhatsApp connection summary */}
        {wa && (
          <WbCard>
            <WbCardHeader title="WhatsApp connection" subtitle="Live from your linked Business account" />
            <WbCardBody className="space-y-3">
              <ReadOnlyRow
                icon={faWhatsapp}
                label="WhatsApp Business name"
                value={wa.business_name || "—"}
              />
              <ReadOnlyRow
                icon={faCheckCircle}
                label="Display phone"
                value={wa.display_phone || "—"}
              />
              {wa.quality_rating && (
                <ReadOnlyRow icon={faCheckCircle} label="Quality rating" value={wa.quality_rating} />
              )}
            </WbCardBody>
          </WbCard>
        )}

        <WbCard>
          <WbCardHeader title="Account profile" subtitle="Your internal business details" />
          <WbCardBody className="space-y-4">
            <WbInput label="Business name" value={name} onChange={(e) => setName(e.target.value)} />
            <WbInput
              label="Phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <WbInput
              label="Profile image URL"
              placeholder="https://…"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              hint="Paste a public image URL. Direct uploads coming soon."
            />
            <WbInput label="Email" value={profile?.email ?? ""} disabled />
            <div className="flex justify-end">
              <WbButton onClick={save} loading={saving}>
                Save changes
              </WbButton>
            </div>
          </WbCardBody>
        </WbCard>
        <BusinessProfileSection />
        <WbCard>
          <WbCardHeader title="Session" />
          <WbCardBody>
            <WbButton variant="danger" onClick={signOut}>
              Sign out
            </WbButton>
          </WbCardBody>
        </WbCard>
      </div>
    </>
  );
}

function Avatar({ url, fallback }: { url: string | null | undefined; fallback?: string }) {
  const initial = (fallback ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (url) {
    return (
      <img
        src={url}
        alt="Profile"
        className="h-16 w-16 rounded-full border border-border object-cover shadow-soft"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
      {initial !== "?" ? initial : <FontAwesomeIcon icon={faUser} className="h-6 w-6" />}
    </div>
  );
}

function ReadOnlyRow({
  icon,
  label,
  value,
}: {
  icon: typeof faWhatsapp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 text-primary" />
        {label}
      </span>
      <span className="truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
