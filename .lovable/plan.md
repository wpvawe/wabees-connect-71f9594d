# Chat / Inbox — Baaki reh gaye kaam (sab step by step)

Ab jo aitems reh gaye the (frontend + PHP backend dono), sequence me
karenge. Backend access `rules.md` + `HOSTINGER_SSH_*` env se hai —
`webhook.php` (3942 lines) aur `cron/dispatch-scheduled.php` (442 lines)
SSH ke through edit karenge. Har PHP edit ke pehle server-side `.bak`
banega taakay rollback safe rahe.

## Order of execution

### Batch A — Backend foundations (PHP webhook)
1. **Inbound typing indicator persist** (`webhook.php`)
   - Meta ke `statuses[].message_status = "typing"` / `messages[].type = "typing"` events parse karo.
   - Conversation doc pe `typingUntil = now + 25s` + `typingWamid` write karo.
2. **Structured order / interactive nfm_reply persist** (`webhook.php`)
   - `messages[].order.product_items[]` → `orderItems` array (retailer_id, quantity, item_price, currency), `orderTotal`, `orderCatalogId`.
   - `messages[].interactive.nfm_reply.response_json` → `flowResponse` object.
3. **Cron subscription `messagesUsed` guard** (`cron/dispatch-scheduled.php`)
   - Ensure `messagesUsed` increment fires on every server-side dispatch (currently bypasses).

### Batch B — Frontend: typing + rich payloads
4. **useConversations**: expose `typingUntil` on conversation type.
5. **useMessages**: expose `orderItems`, `orderTotal`, `orderCatalogId`, `flowResponse`.
6. **Thread header** — show "typing…" dot when `typingUntil > now`.
7. **MessageBubble** — rich `order` renderer (line-items table, total), `interactive` nfm_reply renderer (key/value grid).

### Batch C — Frontend: starred, search, export
8. **Starred messages drawer** — new right-side panel showing all starred messages for current thread, click → scroll to that message. Access from thread header.
9. **Inbox-wide search** — extend inbox list search to also query all `messages` where body/caption contains query (limit 50), show "Messages" section with jump-to-thread.
10. **Chat export** — TXT + CSV download of current thread from header menu. WhatsApp-style plain-text format.

### Batch D — Deploy + verify
11. Redeploy Firestore indexes if any new composite query needed (unlikely).
12. Playwright smoke on `/inbox` (starred toggle + drawer, `#template` picker still works, order bubble renders on a test message).

## Out of scope (confirmed)
- Virtualized message list (needs `@tanstack/react-virtual` + heavier refactor).
- Business-hours auto-reply.
- Push deep-link (already working per prior audit).
- Whatsapp catalog product image fetch (would need Meta catalog API, separate feature).

## Rollback strategy
- Every PHP file edited via SSH gets copied to `<file>.bak.<timestamp>` first (mirrors existing `.bak` convention on the server). Frontend changes are in git.

## Confirm to proceed
Bolo "haan" ya specific batch (A/B/C) pick karo — main phir order me
execute karke har batch ke baad short summary + verification result dunga.
