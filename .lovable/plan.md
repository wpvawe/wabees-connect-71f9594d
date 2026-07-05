
# Baqi chat audit fixes — sequenced plan

rules.md me indexes deploy section add ho gaya. Ab audit ke remaining items — scope bara hai, is liye 4 batches me karte hain. Har batch ke baad quick verify + next batch.

## Batch 1 — Perf & scale (highest impact)
- **N+1 fallback dedup** in `ConversationList` — cache resolved contact/name docs; skip re-fetching same phone on every incoming message.
- **Messages pagination** — 300 hard cap remove. Add "Load older messages" button in `useMessages` + `inbox.$phone.tsx` (cursor-based, +200 per fetch).
- **Conversations pagination** — 200 cap remove. Add infinite scroll / load-more in `ConversationList`.
- **Jump to first-unread** — on thread open, auto-scroll to first unread divider (or bottom if none).

## Batch 2 — Composer UX
- **Inline template picker** — `/` shows canned (already), add `#` prefix to show approved templates from `useTemplates`; on pick, if template has vars open a small dialog, else send directly via existing send-template call.
- **Draft indicator** in `ConversationList` — italic "Draft: …" if `wb:draft:<phone>` in localStorage.
- **Image compression** before upload — client-side resize/quality-drop to fit Meta 5MB image cap; keep original if already small.

## Batch 3 — Reliability & counters
- **Scheduled dispatcher double-count guard** — client dispatcher only increments if `dispatchedBy !== "cron"`; server cron sets that flag.
- **Push notification deep-link** — FCM click handler navigates to `/inbox/<phone>` if payload has `contactPhone`.
- **Typing indicator (inbound)** — read `typing` flag written by webhook (if present) and show "typing…" dots for 5s in header.

## Batch 4 — Rich rendering (smaller polish)
- **Sticker rendering** in `MessageBubble` (image variant, transparent background).
- **Catalog / product / order** minimal card renderer (name + thumb + link) — currently show as "unsupported".
- **Message star/pin** — bubble action → writes `starred:true` on message doc; small filter chip in list header.

## Out of scope (explicitly deferred, flag only)
- Virtualized message list (react-virtuoso — separate migration).
- Inbox-wide search across all conversations.
- Export chat to PDF/CSV.
- Business-hours customer-facing auto-reply (working-hours code hai, sender missing).

## Technical notes
- Har feature ke liye existing `assertWithinPlanLimit` + `incrementMessagesUsed` reuse honge.
- Pagination cursor: Firestore `startAfter(lastDoc)`. Existing `useMessages` / `useConversations` extend karte hain, new hooks nahi banate.
- Image compress: browser Canvas API — no new npm dep.
- Template picker: reuse `useTemplates` + existing `sendTemplateMessage` from `@/lib/wabees/api`.

## Verify per batch
- Typecheck auto (harness).
- Playwright quick smoke for Batch 1 (pagination + jump-to-unread) since visible.
- Batch 2–4 verify by opening `/inbox/<phone>` in preview after each.

Confirm to start with Batch 1, ya sequence badalna hai to batao.
