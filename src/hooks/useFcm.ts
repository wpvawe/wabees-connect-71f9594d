import { useEffect } from "react";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { initFcm } from "@/lib/firebase/fcm";

export function useFcm() {
  const session = useFirebaseSession();
  // M-2 fix: depend on stable primitives, not the session object reference.
  // If `useFirebaseSession` returns a fresh object each render this
  // re-triggers getToken()/serviceWorker.register() on every commit.
  const status = session.status;
  const uid = session.status === "ready" ? session.uid : null;
  const effectiveUid = session.status === "ready" ? session.effectiveUid : null;
  const dataOwner = session.status === "ready" ? session.dataOwner : null;
  useEffect(() => {
    if (status !== "ready" || !uid || !effectiveUid) return;
    void initFcm({
      uid,
      effectiveUid,
      dataOwner,
    });
  }, [status, uid, effectiveUid, dataOwner]);
}