/**
 * Shared TTL cache for Firestore `getCountFromServer` /
 * `getAggregateFromServer` calls. Prevents dashboard mounts from firing 4+
 * aggregation RPCs each and slamming the project quota (429 resource-
 * exhausted). Also coalesces concurrent callers so a single in-flight
 * promise is reused when multiple components mount at once.
 */

type Entry<T> = {
  at: number;
  value: T;
};

const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
/** Track keys under 429 backoff so we don't retry until TTL elapses. */
const backoffUntil = new Map<string, number>();

/** 60s default TTL — usage counters rarely change faster than that. */
export const DEFAULT_COUNT_TTL_MS = 60_000;
/** 5-minute cool-down after a 429 so we stop hammering the quota. */
export const QUOTA_BACKOFF_MS = 5 * 60_000;

/**
 * sessionStorage backup so counts survive a page reload. Without this the
 * in-memory Map is wiped on every hard refresh — admin dashboards then
 * re-run every `getCountFromServer` / `getAggregateFromServer` RPC, which
 * were the top billed reads in the Firebase usage dashboard.
 */
const SS_KEY = "wb:countCache:v1";
let hydrated = false;
function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(SS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Entry<unknown>>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.at === "number") cache.set(k, v);
    }
  } catch {
    /* ignore corrupt cache */
  }
}
function isPlainSerializable(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return true;
  if (t !== "object") return false;
  // Reject anything with methods (e.g. Firestore AggregateQuerySnapshot has
  // `.data()`) — JSON.stringify would silently drop the method and rehydrate
  // an empty object that crashes at the call site.
  try {
    for (const key of Object.keys(v as object)) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === "function") return false;
    }
  } catch {
    return false;
  }
  return true;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, Entry<unknown>> = {};
    for (const [k, v] of cache) {
      if (isPlainSerializable(v.value)) obj[k] = v;
    }
    window.sessionStorage.setItem(SS_KEY, JSON.stringify(obj));
  } catch {
    /* quota or serialization error — best-effort only */
  }
}

export function getCachedCount<T>(key: string, ttlMs = DEFAULT_COUNT_TTL_MS): T | null {
  hydrate();
  const hit = cache.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) return null;
  return hit.value;
}

export function isBackoff(key: string): boolean {
  const until = backoffUntil.get(key);
  return typeof until === "number" && Date.now() < until;
}

export function invalidateCachedCount(key: string): void {
  hydrate();
  cache.delete(key);
  backoffUntil.delete(key);
  persist();
}

/**
 * Returns the cached value if fresh; otherwise runs `loader`, caches the
 * result, and shares the in-flight promise with any concurrent caller.
 * On 429 (`resource-exhausted`) the key is put into a 5-minute cool-down
 * so we stop retrying until it clears — this is what the console noise
 * was about (loops of 429s on every navigation).
 */
export async function fetchCached<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_COUNT_TTL_MS,
): Promise<T | null> {
  hydrate();
  const fresh = getCachedCount<T>(key, ttlMs);
  if (fresh !== null) return fresh;
  if (isBackoff(key)) {
    // Return the last known value (possibly stale) rather than firing.
    const stale = cache.get(key) as Entry<T> | undefined;
    return stale ? stale.value : null;
  }
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      const value = await loader();
      cache.set(key, { at: Date.now(), value });
      backoffUntil.delete(key);
      persist();
      return value;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      const message = (err as { message?: string })?.message ?? "";
      if (code === "resource-exhausted" || /429|resource-exhausted/i.test(message)) {
        backoffUntil.set(key, Date.now() + QUOTA_BACKOFF_MS);
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
