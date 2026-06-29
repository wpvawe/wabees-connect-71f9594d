/**
 * Firebase auth state hook. Subscribes once at the app shell and exposes the
 * current Firebase user to downstream Firestore hooks. With Firebase Auth as
 * the only auth system (mirroring the Flutter app), "ready" simply means a
 * signed-in user exists.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { fbAuth, fbDb } from "@/integrations/firebase/client";
import { repairWhatsAppOwnership } from "@/lib/firebase/whatsapp-config";

type State =
  | { status: "loading" }
  | { status: "no_uid" }
  | { status: "ready"; uid: string; effectiveUid: string; dataOwner: string | null; user: User };

const Ctx = createContext<State>({ status: "loading" });

export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let repairTimer: number | null = null;
    let currentPhoneNumberId = "";
    let currentDataOwner: string | null = null;
    function clearRepairTimer() {
      if (repairTimer) window.clearInterval(repairTimer);
      repairTimer = null;
    }
    const unsub = onAuthStateChanged(fbAuth(), (u) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      clearRepairTimer();
      currentPhoneNumberId = "";
      currentDataOwner = null;
      if (!u) { setState({ status: "no_uid" }); return; }
      // Keep loading until the first profile snapshot arrives; otherwise
      // agent accounts briefly subscribe to their own empty subcollections
      // before `dataOwner` resolves to the owner UID.
      setState({ status: "loading" });
      unsubProfile = onSnapshot(doc(fbDb(), "users", u.uid), (snap) => {
        const profile = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const dataOwnerRaw = profile.dataOwner;
        const dataOwner = typeof dataOwnerRaw === "string" && dataOwnerRaw.trim() ? dataOwnerRaw : null;
        const phoneNumberId = typeof profile.whatsappPhoneNumberId === "string" ? profile.whatsappPhoneNumberId : "";
        currentPhoneNumberId = phoneNumberId;
        currentDataOwner = dataOwner;
        if (phoneNumberId && !dataOwner) {
          void repairWhatsAppOwnership(u.uid)
            .then((ownerId) => {
              if (ownerId && ownerId !== u.uid) {
                setState({ status: "ready", uid: u.uid, effectiveUid: ownerId, dataOwner: ownerId, user: u });
              }
            })
            .catch(() => undefined);
        }
        if (!repairTimer) {
          repairTimer = window.setInterval(() => {
            if (!currentPhoneNumberId || currentDataOwner) return;
            void repairWhatsAppOwnership(u.uid)
              .then((ownerId) => {
                if (ownerId && ownerId !== u.uid) {
                  currentDataOwner = ownerId;
                  setState({ status: "ready", uid: u.uid, effectiveUid: ownerId, dataOwner: ownerId, user: u });
                }
              })
              .catch(() => undefined);
          }, 30_000);
        }
        setState({
          status: "ready",
          uid: u.uid,
          effectiveUid: dataOwner ?? u.uid,
          dataOwner,
          user: u,
        });
      }, () => setState({ status: "ready", uid: u.uid, effectiveUid: u.uid, dataOwner: null, user: u }));
    });
    return () => {
      unsub();
      clearRepairTimer();
      if (unsubProfile) unsubProfile();
    };
  }, []);
  return createElement(Ctx.Provider, { value: state }, children);
}

export function useFirebaseSession(): State {
  return useContext(Ctx);
}

/** Convenience: returns the signed-in user's own uid. */
export function useFirebaseUid(): string | null {
  const s = useFirebaseSession();
  return s.status === "ready" ? s.uid : null;
}

/**
 * Returns the UID whose shared business subcollections should be used — i.e.
 * `users/{uid}.dataOwner ?? uid`. When the signed-in user is an agent under
 * another account, this points at the owner's UID. Mirrors the Flutter app's
 * `dataOwnerIdProvider` so messages/contacts/templates/campaigns stay shared.
 * Account connection/config actions still use the signed-in user's own UID.
 */
export function useEffectiveUid(): string | null {
  const s = useFirebaseSession();
  return s.status === "ready" ? s.effectiveUid : null;
}