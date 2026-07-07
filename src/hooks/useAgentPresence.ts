/**
 * Presence heartbeat for the signed-in user against the owner's
 * `agents/{selfUid}` doc. Writes `lastSeenAt` every 90s while the tab is
 * visible and marks `isOnline: false` on blur / unload. Owners running
 * their own account also heartbeat against `users/{uid}/agents/{uid}` so
 * the round-robin picker can consider them a routable target.
 *
 * The doc is created lazily — if it doesn't exist yet (owner never opened
 * Agents settings) the write is a no-op via `merge: true`. Rules already
 * allow owner + agent to write their own row.
 *
 * P-perf — the `email` field is written only on the first beat of the
 * session (it never changes for a signed-in user), so periodic heartbeats
 * carry a smaller payload. The interval is 90s (was 45s) which halves
 * write volume — presence freshness stays sub-2min which is well within
 * the "online now" UX threshold.
 */
import { useEffect } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

const HEARTBEAT_MS = 90_000;
// P-perf — coalesce visibility-change bursts. If we beat within this
// window already, skip the redundant write. Modern browsers fire
// `visibilitychange` on tab focus/blur, iOS Safari also on pageshow —
// without a throttle we'd stack 2-3 writes per swipe.
const MIN_BEAT_GAP_MS = 30_000;

export function useAgentPresence(): void {
  const session = useFirebaseSession();
  // P-perf — depend on primitive fields so a new session object identity
  // on every render doesn't tear down + re-attach the interval and 3
  // event listeners on every parent state change.
  const ready = session.status === "ready";
  const uid = ready ? session.uid : null;
  const dataOwner = ready ? session.dataOwner : null;
  const email = ready ? session.user.email ?? null : null;

  useEffect(() => {
    if (!ready || !uid) return;
    const ownerUid = dataOwner || uid;
    const db = fbDbOrNull();
    if (!db) return;

    const ref = doc(db, `users/${ownerUid}/agents/${uid}`);
    let cancelled = false;
    let emailWritten = false;
    let lastOnline: boolean | null = null;
    let lastBeatAt = 0;

    const beat = async (online: boolean, force = false) => {
      if (cancelled) return;
      const now = Date.now();
      // Skip if state hasn't flipped AND we beat recently. `force` bypasses
      // for the initial mount beat and the unload write.
      if (!force && lastOnline === online && now - lastBeatAt < MIN_BEAT_GAP_MS) return;
      lastOnline = online;
      lastBeatAt = now;
      try {
        const payload: Record<string, unknown> = {
          isOnline: online,
          lastSeenAt: serverTimestamp(),
        };
        // Only write `email` on the first beat — it never changes for a
        // signed-in user, so repeating it in every heartbeat wastes
        // bandwidth (and shows up as a dirty field in Firestore change
        // listeners downstream).
        if (!emailWritten && email) {
          payload.email = email;
          emailWritten = true;
        }
        await setDoc(ref, payload, { merge: true });
      } catch {
        /* transient — next tick retries */
      }
    };

    void beat(true, true);
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
  }, [ready, uid, dataOwner, email]);
}