import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { ContactsWorkspace } from "@/components/contacts/ContactsWorkspace";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts — Wabees" },
      {
        name: "description",
        content: "Manage your WhatsApp address book — import, tag, and organise contacts.",
      },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  return (
    <>
      <TopBar title="Contacts" subtitle="Your WhatsApp address book" />
      <WbFirebaseGate>
        <ContactsWorkspace />
      </WbFirebaseGate>
    </>
  );
}
