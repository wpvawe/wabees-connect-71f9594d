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
import { repairWhatsAppOwnerServer } from "@/lib/firebase/owner-repair.functions";

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
    let repairInFlight = false;
    let verifiedSelfPhoneNumberId = "";
    function clearRepairTimer() {
      if (repairTimer) window.clearInterval(repairTimer);
      repairTimer = null;
    }
    const unsub = onAuthStateChanged(fbAuth(), (u) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      clearRepairTimer();
      currentPhoneNumberId = "";
      currentDataOwner = null;
      repairInFlight = false;
      verifiedSelfPhoneNumberId = "";
      if (!u) { setState({ status: "no_uid" }); return; }
      // Keep loading until the first profile snapshot arrives; otherwise
      // agent accounts briefly subscribe to their own empty subcollections
      // before `dataOwner` resolves to the owner UID.
      setState({ status: "loading" });
      const user = u;
      async function resolveOwner(phoneNumberId: string): Promise<string | null> {
        if (repairInFlight) return null;
        repairInFlight = true;
        try {
          const idToken = await user.getIdToken();
          const server = await repairWhatsAppOwnerServer({ data: { idToken, phoneNumberId } });
          return server.ownerId ?? null;
        } catch {
          return repairWhatsAppOwnership(user.uid);
        } finally {
          repairInFlight = false;
        }
      }

      unsubProfile = onSnapshot(doc(fbDb(), "users", user.uid), (snap) => {
        const profile = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const dataOwnerRaw = profile.dataOwner;
        const dataOwner = typeof dataOwnerRaw === "string" && dataOwnerRaw.trim() ? dataOwnerRaw : null;
        const phoneNumberId = typeof profile.whatsappPhoneNumberId === "string" ? profile.whatsappPhoneNumberId : "";
        currentPhoneNumberId = phoneNumberId;
        currentDataOwner = dataOwner;
        if (!repairTimer) {
          repairTimer = window.setInterval(() => {
            if (!currentPhoneNumberId || currentDataOwner || repairInFlight) return;
            void resolveOwner(currentPhoneNumberId)
              .then((ownerId) => {
                if (ownerId && ownerId !== user.uid) {
                  currentDataOwner = ownerId;
                  setState({ status: "ready", uid: user.uid, effectiveUid: ownerId, dataOwner: ownerId, user });
                } else if (ownerId === user.uid) {
                  verifiedSelfPhoneNumberId = currentPhoneNumberId;
                }
              })
              .catch(() => undefined);
          }, 30_000);
        }
        if (phoneNumberId && !dataOwner && verifiedSelfPhoneNumberId !== phoneNumberId) {
          // Do not briefly expose `effectiveUid = self` for a connected account
          // until ownership is checked. That short wrong-state was enough for
          // inbox hooks to subscribe to the website-only data island.
          setState({ status: "loading" });
          void resolveOwner(phoneNumberId)
            .then((ownerId) => {
              if (ownerId && ownerId !== user.uid) {
                setState({ status: "ready", uid: user.uid, effectiveUid: ownerId, dataOwner: ownerId, user });
              } else if (ownerId === user.uid) {
                verifiedSelfPhoneNumberId = phoneNumberId;
                setState({ status: "ready", uid: user.uid, effectiveUid: user.uid, dataOwner: null, user });
              }
            })
            .catch(() => {
              // Keep retrying through the interval instead of permanently
              // treating this account as owner after a transient repair error.
              setState({ status: "ready", uid: user.uid, effectiveUid: user.uid, dataOwner: null, user });
            });
          return;
        }
        setState({
          status: "ready",
          uid: user.uid,
          effectiveUid: dataOwner ?? user.uid,
          dataOwner,
          user,
        });
      }, () => setState({ status: "ready", uid: user.uid, effectiveUid: user.uid, dataOwner: null, user }));
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