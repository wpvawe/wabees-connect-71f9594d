/**
 * Presence heartbeat for the signed-in user against the owner's
 * `agents/{selfUid}` doc. Writes `lastSeenAt` every 45s while the tab is
 * visible and marks `isOnline: false` on blur / unload. Owners running
 * their own account also heartbeat against `users/{uid}/agents/{uid}` so
 * the round-robin picker can consider them a routable target.
 *
 * The doc is created lazily — if it doesn't exist yet (owner never opened
 * Agents settings) the write is a no-op via `merge: true`. Rules already
 * allow owner + agent to write their own row.
 */
import { useEffect } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

const HEARTBEAT_MS = 45_000;

export function useAgentPresence(): void {
  const session = useFirebaseSession();

  useEffect(() => {
    if (session.status !== "ready") return;
    const { uid, dataOwner } = session;
    const ownerUid = dataOwner || uid;
    const db = fbDbOrNull();
    if (!db) return;

    const ref = doc(db, `users/${ownerUid}/agents/${uid}`);
    let cancelled = false;

    const beat = async (online: boolean) => {
      if (cancelled) return;
      try {
        await setDoc(
          ref,
          {
            isOnline: online,
            lastSeenAt: serverTimestamp(),
            email: session.user.email ?? null,
          },
          { merge: true },
        );
      } catch {
        /* transient — next tick retries */
      }
    };

    void beat(true);
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") void beat(true);
    }, HEARTBEAT_MS);

    const onVis = () => void beat(document.visibilityState === "visible");
    const onBye = () => void beat(false);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onBye);
    window.addEventListener("pagehide", onBye);

    return () => {
      cancelled = true;
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBye);
      window.removeEventListener("pagehide", onBye);
      void setDoc(ref, { isOnline: false, lastSeenAt: serverTimestamp() }, { merge: true }).catch(
        () => {},
      );
    };
  }, [session]);
}