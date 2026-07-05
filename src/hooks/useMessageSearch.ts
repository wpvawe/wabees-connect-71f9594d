import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid } from "@/hooks/useFirebaseSession";
import { normalizePhone, str, toIso } from "@/lib/firebase/normalizers";

export type MessageSearchHit = {
  id: string;
  phone: string;
  contactName: string;
  body: string;
  direction: "incoming" | "outgoing";
  createdAt: string | null;
};

// P6 fix — cache the last N-doc window per uid so a user typing a
// query fires ONE Firestore fetch, not one per debounced keystroke.
type CacheEntry = {
  ts: number;
  size: number;
  docs: Array<{ id: string; data: Record<string, unknown> }>;
};
const WINDOW_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * Inbox-wide substring search across all messages the current user can
 * read. Firestore has no full-text index, so we pull the last N=1000
 * messages once per query change (client-cached) and filter client-side.
 * Debounced 250 ms; empty query returns [].
 *
 * Trade-off: this scans a fixed window (default 1000 most-recent). Older
 * matches are missed but this keeps the cost predictable — an inbox-wide
 * query on a busy account can be very expensive otherwise.
 */
export function useMessageSearch(queryText: string, windowSize = 1000): {
  hits: MessageSearchHit[];
  loading: boolean;
  error: string | null;
} {
  const uid = useEffectiveUid();
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = queryText.trim().toLowerCase();
    if (!uid || q.length < 2) {
      setHits([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const db = fbDbOrNull();
        if (!db) return;
        const cacheKey = `${uid}:${windowSize}`;
        const cached = WINDOW_CACHE.get(cacheKey);
        let docs: CacheEntry["docs"];
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.size === windowSize) {
          docs = cached.docs;
        } else {
          const snap = await getDocs(
            query(
              collection(db, `users/${uid}/messages`),
              orderBy("createdAt", "desc"),
              limit(windowSize),
            ),
          );
          if (cancelled) return;
          docs = snap.docs.map((d) => ({
            id: d.id,
            data: d.data() as Record<string, unknown>,
          }));
          WINDOW_CACHE.set(cacheKey, { ts: Date.now(), size: windowSize, docs });
        }
        if (cancelled) return;
        const out: MessageSearchHit[] = [];
        for (const d of docs) {
          const x = d.data;
          const body = str(x.body);
          const caption = str(x.caption);
          const hay = `${body} ${caption}`.toLowerCase();
          if (!hay.includes(q)) continue;
          const phone = normalizePhone(str(x.contactPhone));
          out.push({
            id: d.id,
            phone,
            contactName: str(x.contactName, phone),
            body: body || caption || `[${str(x.type, "message")}]`,
            direction:
              (x.direction as string) === "outgoing" ? "outgoing" : "incoming",
            createdAt: toIso(x.createdAt),
          });
          if (out.length >= 50) break;
        }
        setHits(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [uid, queryText, windowSize]);

  return { hits, loading, error };
}