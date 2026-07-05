/**
 * Self-heal for revoked agents.
 *
 * Server-side rules block a revoked agent from reading the owner's data
 * (isAgentOf checks status != 'revoked'). But the agent's own user doc
 * still carries `dataOwner = ownerId`, which keeps the client trying to
 * subscribe to the owner's tree — causing "permission denied" spam and
 * an unusable app.
 *
 * The Firestore rules do not let the owner mutate the agent's user doc,
 * so revocation cleanup is self-heal: when the signed-in user notices
 * their own agent doc is missing / revoked, they clear their own
 * `dataOwner` field. On the next tick the app treats them as an owner
 * of their own (empty) workspace.
 *
 * A best-effort notification is written to their own notifications
 * subcollection so the UI can toast "You were removed from …".
 */
import { useEffect, useRef } from "react";
import { addDoc, collection, deleteField, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

export function useAgentRevocationGuard(): void {
  const session = useFirebaseSession();
  const healedFor = useRef<string | null>(null);

  useEffect(() => {
    if (session.status !== "ready") return;
    const { uid, dataOwner } = session;
    if (!dataOwner || dataOwner === uid) return;
    const db = fbDbOrNull();
    if (!db) return;

    const key = `${uid}::${dataOwner}`;
    if (healedFor.current === key) return;

    const heal = async (reason: "revoked" | "missing" | "permission_denied" | "implicit_connect") => {
      if (healedFor.current === key) return;
      healedFor.current = key;
      if (reason === "implicit_connect") {
        await updateDoc(doc(db, `users/${dataOwner}/agents/${uid}`), {
          status: "left",
          leftAt: serverTimestamp(),
          leftReason: "implicit_connect_cleanup",
        }).catch(() => undefined);
      }
      try {
        await updateDoc(doc(db, `users/${uid}`), {
          dataOwner: deleteField(),
          dataOwnerJoinedAt: deleteField(),
          dataOwnerJoinedVia: deleteField(),
          dataOwnerClearedAt: serverTimestamp(),
          dataOwnerClearedReason: reason,
        });
      } catch {
        healedFor.current = null;
        return;
      }
      try {
        await addDoc(collection(db, `users/${uid}/notifications`), {
          type: "agent_access_revoked",
          title:
            reason === "revoked"
              ? "You were removed from a workspace"
              : "Your workspace assignment ended",
          message:
            reason === "revoked"
              ? "The workspace owner revoked your agent access. You now see your own account."
              : reason === "implicit_connect"
                ? "Your previous WhatsApp connection was moved to another account. You now see your own account."
              : "Your agent record is no longer available. You now see your own account.",
          ownerId: dataOwner,
          createdAt: serverTimestamp(),
          read: false,
        });
      } catch {
        /* best-effort */
      }
    };

    const unsub = onSnapshot(
      doc(db, `users/${dataOwner}/agents/${uid}`),
      (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        const status = typeof data?.status === "string" ? data.status : data ? "active" : "missing";
        const hasInvite =
          typeof data?.inviteCode === "string" || data?.joinedVia === "invite" || typeof data?.role === "string";
        if (data && status === "active" && !hasInvite) {
          void heal("implicit_connect");
          return;
        }
        if (status !== "revoked" && status !== "missing") return;
        void heal(status === "revoked" ? "revoked" : "missing");
      },
      () => {
        void heal("permission_denied");
      },
    );
    return () => unsub();
  }, [session]);
}
