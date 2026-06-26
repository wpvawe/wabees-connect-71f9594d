import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/shell/TopBar";
import { WbFirebaseGate } from "@/components/wb/WbFirebaseGate";
import { ContactsTable } from "@/components/contacts/ContactsTable";
import { ImportExportBar } from "@/components/contacts/ImportExportBar";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contacts — Wabees" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  return (
    <>
      <TopBar title="Contacts" subtitle="Manage your WhatsApp address book" />
      <WbFirebaseGate>
        <div className="space-y-4 px-4 py-6 sm:px-6">
          <ImportExportBar />
          <ContactsTable />
        </div>
      </WbFirebaseGate>
    </>
  );
}