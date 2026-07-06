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
import { fbAuth } from "@/integrations/firebase/client";
import { subscribeDoc } from "@/lib/firebase/docBroker";
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
    let unsubConfig: (() => void) | null = null;
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
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubConfig) {
        unsubConfig();
        unsubConfig = null;
      }
      clearRepairTimer();
      currentPhoneNumberId = "";
      currentDataOwner = null;
      repairInFlight = false;
      verifiedSelfPhoneNumberId = "";
      if (!u) {
        setState({ status: "no_uid" });
        return;
      }
      // Keep loading until the first profile snapshot arrives; otherwise
      // agent accounts briefly subscribe to their own empty subcollections
      // before `dataOwner` resolves to the owner UID.
      setState({ status: "loading" });
      const user = u;
      let profileLoaded = false;
      let configLoaded = false;
      let profile: Record<string, unknown> = {};
      let config: Record<string, unknown> = {};

      function text(value: unknown): string {
        return typeof value === "string" && value.trim() ? value.trim() : "";
      }

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

      function recomputeSession() {
        if (!profileLoaded || !configLoaded) return;
        const dataOwnerRaw = profile.dataOwner;
        const dataOwner =
          typeof dataOwnerRaw === "string" && dataOwnerRaw.trim() ? dataOwnerRaw.trim() : null;
        // Flutter reads WhatsApp credentials from users/{uid}/whatsapp_config/config.
        // Older mobile accounts may not have the top-level mirror populated, so
        // include the config doc here before deciding which owner's data tree to use.
        const topConnected = profile.whatsappConnected !== false;
        const configConnected = config.isConnected !== false;
        const phoneNumberId =
          (topConnected ? text(profile.whatsappPhoneNumberId) : "") ||
          (configConnected ? text(config.phoneNumberId) : "");
        currentPhoneNumberId = phoneNumberId;
        currentDataOwner = dataOwner;
        if (!repairTimer) {
          repairTimer = window.setInterval(() => {
            if (
              !currentPhoneNumberId ||
              (currentDataOwner && currentDataOwner !== user.uid) ||
              repairInFlight
            )
              return;
            void resolveOwner(currentPhoneNumberId)
              .then((ownerId) => {
                if (ownerId && ownerId !== user.uid) {
                  currentDataOwner = ownerId;
                  setState({
                    status: "ready",
                    uid: user.uid,
                    effectiveUid: ownerId,
                    dataOwner: ownerId,
                    user,
                  });
                } else if (ownerId === user.uid) {
                  verifiedSelfPhoneNumberId = currentPhoneNumberId;
                }
              })
              .catch(() => undefined);
          }, 30_000);
        }
        if (
          phoneNumberId &&
          (!dataOwner || dataOwner === user.uid) &&
          verifiedSelfPhoneNumberId !== phoneNumberId
        ) {
          if (repairInFlight) {
            setState({ status: "loading" });
            return;
          }
          // Do not briefly expose `effectiveUid = self` for a connected account
          // until ownership is checked. That short wrong-state was enough for
          // inbox hooks to subscribe to the website-only data island.
          setState({ status: "loading" });
          void resolveOwner(phoneNumberId)
            .then((ownerId) => {
              if (ownerId && ownerId !== user.uid) {
                setState({
                  status: "ready",
                  uid: user.uid,
                  effectiveUid: ownerId,
                  dataOwner: ownerId,
                  user,
                });
              } else if (ownerId === user.uid) {
                verifiedSelfPhoneNumberId = phoneNumberId;
                setState({
                  status: "ready",
                  uid: user.uid,
                  effectiveUid: user.uid,
                  dataOwner: null,
                  user,
                });
              } else {
                // resolveOwner returned null (server unreachable / no candidate).
                // Fall back to self so UI is not stuck on "loading" forever;
                // the 30s interval will retry repair in the background.
                setState({
                  status: "ready",
                  uid: user.uid,
                  effectiveUid: user.uid,
                  dataOwner: null,
                  user,
                });
              }
            })
            .catch(() => {
              // On error fall back to self instead of staying stuck in loading;
              // the 30s interval will retry repair.
              setState({
                status: "ready",
                uid: user.uid,
                effectiveUid: user.uid,
                dataOwner: null,
                user,
              });
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
      }

      unsubProfile = subscribeDoc(["users", user.uid], (snap) => {
        profileLoaded = true;
        profile = snap.data ?? {};
        recomputeSession();
      });
      unsubConfig = subscribeDoc(
        ["users", user.uid, "whatsapp_config", "config"],
        (snap) => {
          configLoaded = true;
          config = snap.data ?? {};
          recomputeSession();
        },
      );
    });
    return () => {
      unsub();
      clearRepairTimer();
      if (unsubProfile) unsubProfile();
      if (unsubConfig) unsubConfig();
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
