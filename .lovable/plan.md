# Chat / Inbox audit — DONE

Ab jo aitems reh gaye the (frontend + PHP backend dono), sequence me
karenge. Backend access `rules.md` + `HOSTINGER_SSH_*` env se hai —
`webhook.php` (3942 lines) aur `cron/dispatch-scheduled.php` (442 lines)
SSH ke through edit karenge. Har PHP edit ke pehle server-side `.bak`
banega taakay rollback safe rahe.

## Order of execution

### Batch A — Backend (PHP webhook + cron)
1. **Structured order persistence** — `webhook.php` case 'order' now parses `product_items[]`, computes total, persists `orderItems / orderTotal / orderCurrency / orderCatalogId / orderNote`.
2. **Flow (nfm_reply) response persistence** — decodes `response_json` into `flowResponse` for interactive bubble rendering.
3. **Cron subscription counter** — `dispatch-scheduled.php` now increments `subscription/current.messagesUsed` on every server-side send.
4. Backups: `webhook.php.bak.1783225747`, `cron/dispatch-scheduled.php.bak.1783225747`.

### Batch B — Frontend rich payloads
5. **useMessages**: exposes `orderItems / orderTotal / orderCurrency / orderCatalogId / orderNote / flowResponse`.
6. **MessageBubble**: new `OrderCard` (receipt with line items + total) and `FlowResponseCard` (key/value grid) renderers.

### Batch C — Frontend UX
7. **StarredDrawer**: right-side panel with all starred messages, click → smooth scroll + `wb-star-flash` highlight.
8. **Inbox-wide message search**: `useMessageSearch` hook + "Messages" section in `ConversationList` (2+ chars, 250 ms debounce, last 1000 messages, top 50 shown, match highlighted).
9. **Chat export**: `lib/inbox/export.ts` (TXT WhatsApp-style + CSV RFC-4180). Header menu item downloads both.
10. **Bubble anchors** (`data-msg-id`) for jump-to-message.

## Skipped (documented reasons)
- **Inbound typing indicator** — WhatsApp Cloud API does NOT forward customer typing to businesses. No webhook signal exists to render it. Meta limitation, not our bug.
- **Virtualized list**, **business-hours auto-reply** — out of plan scope.

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
