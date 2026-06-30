import { useEffect } from "react";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { initFcm } from "@/lib/firebase/fcm";

export function useFcm() {
  const session = useFirebaseSession();
  useEffect(() => {
    if (session.status !== "ready") return;
    void initFcm({
      uid: session.uid,
      effectiveUid: session.effectiveUid,
      dataOwner: session.dataOwner,
    });
  }, [session]);
}