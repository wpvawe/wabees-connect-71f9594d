import { useEffect } from "react";
import { useFirebaseUid } from "@/hooks/useFirebaseSession";
import { initFcm } from "@/lib/firebase/fcm";

export function useFcm() {
  const uid = useFirebaseUid();
  useEffect(() => {
    if (!uid) return;
    void initFcm(uid);
  }, [uid]);
}