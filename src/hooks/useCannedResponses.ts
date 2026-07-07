/**
 * Real-time list of canned responses for the active owner tree. Agents
 * inherit the owner's library via `useEffectiveUid` (dataOwner override).
 */
import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";
import { subscribeRefetch } from "@/lib/firebase/refetchBus";
import type { CannedResponse } from "@/lib/firebase/canned";

// Shared per-owner coalescing cache. Composer + settings both mount this;
// without it each inbox thread swap re-billed the full canned collection.
type RawSnap = Array<{ id: string; data: Record<string, unknown> }>;
const REGISTRY = new Map<string, { at: number; docs: RawSnap }>();
const INFLIGHT = new Map<string, Promise<RawSnap>>();
const REGISTRY_TTL_MS = 60_000;

async function fetchCannedCoalesced(
  db: ReturnType<typeof fbDbOrNull>,
  uid: string,
): Promise<RawSnap> {
  const hit = REGISTRY.get(uid);
  if (hit && Date.now() - hit.at < REGISTRY_TTL_MS) return hit.docs;
  const existing = INFLIGHT.get(uid);
  if (existing) return existing;
  const p = (async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db!, `users/${uid}/canned`),
          orderBy("shortcut", "asc"),
          limit(500),
        ),
      );
      const docs: RawSnap = snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
      REGISTRY.set(uid, { at: Date.now(), docs });
      return docs;
    } finally {
      INFLIGHT.delete(uid);
    }
  })();
  INFLIGHT.set(uid, p);
  return p;
}

function invalidateCanned(uid: string): void {
  REGISTRY.delete(uid);
}

export function useCannedResponses(): {
  data: CannedResponse[] | null;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [data, setData] = useState<CannedResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const docs = await fetchCannedCoalesced(db, uid);
      const rows: CannedResponse[] = docs.map((d) => {
        const x = d.data;
        return {
          id: d.id,
          shortcut: str(x.shortcut),
          title: str(x.title),
          body: str(x.body),
          createdAt: toIso(x.createdAt),
          updatedAt: toIso(x.updatedAt),
        };
      });
      setData(rows);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [uid]);

  useEffect(() => {
    void load();
    const unsub = subscribeRefetch("canned", () => {
      if (uid) invalidateCanned(uid);
      void load();
    });
    return () => unsub();
  }, [load, uid]);

  return { data, error };
}