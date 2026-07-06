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

export function getCachedCount<T>(key: string, ttlMs = DEFAULT_COUNT_TTL_MS): T | null {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) return null;
  return hit.value;
}

export function isBackoff(key: string): boolean {
  const until = backoffUntil.get(key);
  return typeof until === "number" && Date.now() < until;
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
