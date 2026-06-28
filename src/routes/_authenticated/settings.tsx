import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { signOut as fbSignOut } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { TopBar } from "@/components/shell/TopBar";
import { WbCard, WbCardBody, WbCardHeader } from "@/components/wb/WbCard";
import { WbButton } from "@/components/wb/WbButton";
import { WbInput } from "@/components/wb/WbInput";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import { useProfile } from "@/hooks/useProfile";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Wabees" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const uid = useFirebaseUid();
  const { data: profile } = useProfile();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.businessName);
      setPhone(profile.phoneNumber);
    }
  }, [profile]);

  async function save() {
    if (!uid) return;
    setSaving(true);
    try {
      await updateDoc(doc(fbDb(), "users", uid), {
        businessName: name,
        phoneNumber: phone,
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
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6">
        <WbCard>
          <WbCardHeader title="Profile" />
          <WbCardBody className="space-y-4">
            <WbInput label="Business name" value={name} onChange={(e) => setName(e.target.value)} />
            <WbInput label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <WbInput label="Email" value={profile?.email ?? ""} disabled />
            <div className="flex justify-end">
              <WbButton onClick={save} loading={saving}>Save changes</WbButton>
            </div>
          </WbCardBody>
        </WbCard>
        <WbCard>
          <WbCardHeader title="Session" />
          <WbCardBody>
            <WbButton variant="danger" onClick={signOut}>Sign out</WbButton>
          </WbCardBody>
        </WbCard>
      </div>
    </>
  );
}