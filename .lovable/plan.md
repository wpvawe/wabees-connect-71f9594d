# Sprint 2 — `useAnalytics` daily rollup

## Problem

`useAnalytics` runs `getDocs(users/{uid}/messages where createdAt >= start limit 5000)` on every range change. On active accounts this bills up to 5k reads per toggle, is capped (so totals become approximate), and gets slower as history grows.

## Constraint (from project memory)

Firestore client SDK only — no Firebase Admin, no Cloud Functions, no server-side cron. Messages are written by both the React client and the PHP webhook (WhatsApp inbound), so we cannot rely on incremental counter writes at message-create time from the client alone.

## Approach — lazy daily aggregates written from the client

Keep the raw `messages` collection untouched. Add a new per-user aggregate collection:

```text
users/{uid}/analytics_daily/{YYYY-MM-DD}
  sent, delivered, read, failed, pending, incoming, outgoing: number
  byType: { text: n, image: n, ... }        // small map
  topContacts: { "+9198…": { name, count } } // capped to top 50 for the day
  uniqueContacts: number
  computedAt: Timestamp
  source: "client-rollup-v1"
```

Read flow (`useAnalytics(range)`):

1. Compute `[start,end]` day list for the requested range.
2. `getDocs(analytics_daily where __name__ in [dayIds])` — 1 read per cached day (batched via `in` queries of 10).
3. For missing days and for **today** (always stale), run one `getDocs(messages where createdAt in that day)` per day, compute the aggregate, `setDoc(analytics_daily/{day})`. Today's doc is rewritten each visit; past days are written once and reused forever.
4. Merge day docs into the same `AnalyticsData` shape the UI already consumes — no chart/component changes.

## Cost math

- First visit for a 30-day range on an account with ~500 msgs/day: 30 × ~500 = 15k message reads, capped at 5000 today ≈ same cost as current, but writes 30 aggregate docs.
- Every subsequent visit for that range: 30 aggregate reads + 1 recompute for today (~500 msg reads). ~30× cheaper.
- Range switches between `7d`/`30d`/`month`/`lastMonth` reuse the same cached days.

## Files touched

- `src/lib/firebase/analyticsRollup.ts` — new. Pure helpers: `dayIdsForRange`, `fetchCachedDays`, `computeDayFromMessages`, `writeDayAggregate`, `mergeDaysIntoAnalyticsData`.
- `src/hooks/useAnalytics.ts` — replace the single `getDocs(messages)` effect with the rollup flow above; keep the exported `AnalyticsData` shape and `reload()` API unchanged so `src/routes/_authenticated/analytics.tsx` needs no edits.

Nothing else changes. No schema migration, no backend touch, no security-rule change (writes are under `users/{uid}/…`, already covered by existing per-user rules).

## Out of scope

- Precomputing on message write (would need PHP backend cooperation — separate sprint).
- Backfilling historical aggregates in the background — happens naturally on first visit per range.
