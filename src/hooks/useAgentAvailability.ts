/**
 * Batch F7 — Per-agent availability status.
 *
 * Stored on `users/{owner}/agents/{selfUid}.availability` so both the
 * routing picker and teammate UI can see it. Values:
 *   - "available" (default) — routable
 *   - "away"                — visible offline-ish, still routable when nothing better
 *   - "dnd"                 — Do Not Disturb; auto-routing skips this agent
 *
 * Persisted locally to `localStorage` so the user's choice survives reloads
 * and is re-applied immediately on next sign-in (before the Firestore round-trip).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";

export type Availability = "available" | "away" | "dnd";
const STORAGE_KEY = "wb.agent.availability";

function readStored(): Availability {
  if (typeof window === "undefined") return "available";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "away" || v === "dnd" ? v : "available";
}

export function useAgentAvailability(): {
  status: Availability;
  setStatus: (next: Availability) => void;
} {
  const session = useFirebaseSession();
  const [status, setStatusState] = useState<Availability>(readStored);

  const setStatus = useCallback(
    (next: Availability) => {
      setStatusState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode */
      }
    },
    [],
  );

  // P-perf — depend on primitive fields so a fresh `session` object on every
  // parent render doesn't retrigger this effect and re-write the same
  // availability value. Also short-circuit if the value we're about to
  // write matches the last value we successfully wrote for this
  // (owner, agent) pair — mount + status echo used to cost one write.
  const ready = session.status === "ready";
  const uid = ready ? session.uid : null;
  const dataOwner = ready ? session.dataOwner : null;
  const lastWrittenRef = useRef<{ key: string; value: Availability } | null>(null);

  useEffect(() => {
    if (!ready || !uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    // Availability is a team-routing field and belongs only on real
    // agent docs. Owners can still keep a local preference for the toggle UI,
    // but writing users/{uid}/agents/{uid} creates a fake teammate row and
    // pollutes collection-group agent counts.
    if (!dataOwner || dataOwner === uid) return;
    const ownerUid = dataOwner;
    const key = `${ownerUid}|${uid}`;
    const last = lastWrittenRef.current;
    if (last && last.key === key && last.value === status) return;
    lastWrittenRef.current = { key, value: status };
    setDoc(
      doc(db, `users/${ownerUid}/agents/${uid}`),
      { availability: status, availabilityUpdatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => {
      // Rollback the marker so a transient error doesn't lock us out of
      // retrying the next time status actually changes.
      lastWrittenRef.current = null;
    });
  }, [ready, uid, dataOwner, status]);

  return { status, setStatus };
}