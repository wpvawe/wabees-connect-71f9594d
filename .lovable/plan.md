
# Inbox upgrade plan

Aap ke 7 issues — priority ke saath. Calling ko alag last phase me rakha hai (WhatsApp Business Calling API limited access aur SDP/WebRTC plumbing chahye).

## Phase 1 — Notification bell + chat polish (frontend only, fast)

1. **Bell sound on incoming message / notification**
   - `src/lib/notification-sound.ts` — short embedded base64 chime, `playNotificationChime()` with user-gesture unlock (browsers autoplay-block).
   - `useNotifications` hook: detect new doc added after first snapshot → fire toast + chime.
   - Also fire on new incoming message arriving in any conversation (subscribe to `users/{uid}/messages` with `direction == incoming` `where createdAt > sessionStart`).
   - Toggle in TopBar (mute icon, persisted in localStorage).

2. **Render every WhatsApp message type (fix "type unknown")**
   - `MessageBubble.tsx` rewrite content area with type-aware renderers:
     - `text`, `image`, `video`, `audio`/voice, `document`, `sticker` (image), `location` (lat/lng + Maps link), `contacts` (vCard summary), `button` / `interactive` (button-reply / list-reply / cta_url / nfm_reply), `order`, `system`, `unsupported`, `template` (header/body/footer + buttons), `authentication` OTP template (show OTP code + "Copy" action).
   - Fallback: never blank — show `"[message type: X]"` with raw payload toggle.
   - `ConversationList` last-message preview: type-aware label (📷 Photo, 🎤 Voice, 📄 Doc, 📍 Location, 🔘 Button reply, 🔐 OTP code, etc.).
   - Add missing fields to `useMessages.Message` type: `latitude`, `longitude`, `contactsPayload`, `buttonReplyId`, `buttonReplyText`, `interactiveType`, `otpCode`, `rawPayload`.

3. **Reply context visible on WhatsApp**
   - `Composer.send()` and `sendFile()` already capture `replyToWamid` — also pass `context: { message_id: replyTo.whatsappMessageId }` to Graph API.
   - `backend/api/send-message.php` — accept `context_message_id` and forward as `context.message_id` to Graph (for text/media/interactive).
   - Frontend `sendTextMessage` / `sendMediaMessage` API typings updated.
   - `MessageBubble` shows the quoted snippet inline (small bordered block above body) when `replyToId` or `replyToBody` exists, for both incoming and outgoing messages. Webhook already saves `replyToWamid`/`replyToBody` when WA delivers context.

4. **React both ways**
   - Web → WA: already calls `sendReactionMessage`. Bug: when user picks the SAME emoji twice WhatsApp treats as remove; document and add a "Remove reaction" item.
   - WA → Web: webhook stores `reactionEmoji` + `reactionMsgId` against a NEW doc, not the original. Fix in `webhook.php`: when type=`reaction`, look up the original message by `whatsappMessageId == reactionMsgId` and update IT with `reactionEmoji` (keep current "reaction event" doc as system-only, hidden from chat). `useMessages` already maps `reactionEmoji` to the bubble.
   - `MessageBubble`: render reaction chip anchored to the parent bubble (already does — verify after webhook fix).

5. **Delete (revoke) message**
   - WhatsApp does NOT expose message-revoke API for Business accounts. So:
     - "Delete for me" → current behaviour (Firestore status=deleted), works everywhere.
     - Add a clarifying line in the confirm dialog: "Sirf aap ki website/app se hide hoga, WhatsApp pe receiver ko visible rahega — Meta business API revoke support nahi karta."
   - Add delete entry for incoming messages too (currently only `mine`).

## Phase 2 — Voice/media sending parity (already partly done — confirm + fix gaps)

Composer already supports image/video/document picker + voice recording. Gaps observed:
- Audio MIME `audio/webm;codecs=opus` is NOT accepted by WhatsApp Graph — Meta needs `audio/ogg; codecs=opus` or AAC. We'll record as `audio/webm` and let `upload-media.php` transcode via `ffmpeg` to `audio/ogg` (Hostinger has ffmpeg). If ffmpeg missing, fall back to sending as `document`.
- Caption support: text typed while attaching is already captured — verify on image/video.
- Long-press / inline preview before sending (small preview card with cancel).

## Phase 3 — WhatsApp audio call (deferred, needs your sign-off)

Calling requires Meta's **WhatsApp Business Calling API** (currently limited access, must be enabled on your WABA). Work involved:
- Backend: `/api/call-initiate.php`, `/api/call-action.php` (accept/reject/terminate), webhook handlers for `calls` events (already partially in webhook.php line 1928).
- Frontend: WebRTC peer (SDP offer/answer via Graph), ringer UI, mic permission, in-call screen, mute/hangup, call log in Firestore.
- ~1-2 days of focused work; ship as a separate update once Phase 1+2 are verified.

Confirm: should I proceed with Phase 1 + 2 right now (no extra approvals needed), and we tackle Phase 3 in a follow-up turn?

## Technical notes

- Reaction-event docs created by webhook: keep them in Firestore for audit but filter out of chat by `useMessages` (skip rows where `type === 'reaction'` AND no body/media).
- Bell sound asset: tiny WAV embedded as data URL (~3 KB) — no extra request, no asset bundling complexity.
- All PHP changes will be re-zipped for upload alongside the existing fix bundle.
- No DB schema changes; purely Firestore writes + frontend rendering.
