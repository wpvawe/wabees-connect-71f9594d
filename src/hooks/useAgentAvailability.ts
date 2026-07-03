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
import { useCallback, useEffect, useState } from "react";
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

  // Mirror the value onto the agent doc whenever it changes.
  useEffect(() => {
    if (session.status !== "ready") return;
    const db = fbDbOrNull();
    if (!db) return;
    const ownerUid = session.dataOwner || session.uid;
    setDoc(
      doc(db, `users/${ownerUid}/agents/${session.uid}`),
      { availability: status, availabilityUpdatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => {
      /* best-effort */
    });
  }, [session, status]);

  return { status, setStatus };
}