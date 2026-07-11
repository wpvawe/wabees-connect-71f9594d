# WhatsApp Calls — Testing Guide

## What ships in this build

Signaling-only integration with the Meta WhatsApp Business Calling API.
Audio path is intentionally NOT implemented in the browser — that requires
a SIP or WebRTC media gateway (Asterisk / FreeSWITCH / Janus / Twilio SIP
trunk). Meta does not provide the media transport; every WhatsApp
Business Solution Provider brings their own.

| Capability | Works today | Requires media gateway |
|---|---|---|
| Incoming call webhook → Firestore log | ✅ | — |
| Ringing banner + tone in the browser | ✅ | — |
| Reject incoming call | ✅ | — |
| Terminate active call | ✅ | — |
| Call history with duration + status | ✅ | — |
| Outbound call from browser | ❌ | ✅ SIP/WebRTC |
| Answer + talk in the browser | ❌ | ✅ SIP/WebRTC |

Until a gateway is added, agents answer on the WhatsApp Business app or
WhatsApp Desktop; the website is a real-time control panel around it.

## Prerequisites (verify once)

1. Meta App → WhatsApp → Configuration → Webhook: `calls` field subscribed
   (green toggle). Your screenshot shows this is done. ✅
2. Meta App → WhatsApp → Phone number → Call settings → **Allow voice
   calls = On**. Your screenshot shows this is done. ✅
3. `backend/api/webhook.php` deployed and reachable at the URL configured
   in Meta → Configuration → Callback URL.
4. `backend/api/send-call.php` deployed to the same host as the other
   endpoints (send-message.php, etc.).
5. Firestore rules include `match /users/{u}/call_logs/{callId}` (already
   in `firebase/firestore.rules`).

## Test 1 — Incoming call is logged

1. Sign in to the website. Open `/calls`.
2. From any other phone that has WhatsApp installed, open the chat with
   your business number and press the call button.
3. Within ~1s: a **banner appears at the top** of every website page with
   the caller's name/number and a Reject button. A soft ring tone plays.
4. `/calls` → the row shows up under **Active** with status `Ringing`.
5. Let it time out (~30s) or hang up. The row moves to **History** with
   status `Missed` / `Not answered` and the duration column stays `—`.

If the banner does not appear:
- Check Meta → Webhooks recent deliveries — did Meta POST to your callback?
- Check `backend/logs/webhook_*.log` for `CALL:` lines.
- Check Firestore `users/{ownerUid}/call_logs` — is the doc there? If yes,
  the browser hook is the problem. If no, the webhook write path is.

## Test 2 — Reject from the browser

1. Trigger an incoming call (Test 1 step 2).
2. Press **Reject** on the banner (or on the row under Active).
3. Expected: the caller's WhatsApp shows "Call declined" almost immediately.
   `/calls` history row shows status `Rejected`.

If reject fails with a Meta error toast, copy the exact message. Common
causes: expired access token, call already ended (race with `not_answered`
timeout — try again with a fresh call).

## Test 3 — Answer on WhatsApp Business app, verify duration

1. Trigger an incoming call.
2. Answer on the WhatsApp Business app / Desktop that owns the number.
3. `/calls` Active row updates to `Connected` and stays there while the
   call is live.
4. Hang up. History row shows status `Ended` and a real duration (e.g. `0:23`).

## Test 4 — Outbound call button (expected to fail cleanly)

1. Try to make an outbound call via `initiateCall()` in the browser console:
   ```js
   const { initiateCall } = await import("/src/lib/wabees/calls.ts");
   await initiateCall({ to: "923001234567" });
   ```
2. Expected result: HTTP 501 with body
   `{"error":{"message":"Outbound calling requires a WebRTC/SIP media gateway...", "code":"media_gateway_required"}}`.
3. This is the correct behavior — it prevents a broken payload from being
   sent to Meta. It confirms outbound is disabled by design, not silently
   failing.

## To enable full browser calling (Option B)

1. Stand up a SIP↔WebRTC gateway. Cheapest paths:
   - Asterisk on a $5 VPS with `chan_pjsip` + `res_pjsip_transport_websocket`
   - Twilio SIP trunk (managed, per-minute pricing)
   - Janus + `janus_sip` plugin (self-hosted, WebRTC-native)
2. Meta → WhatsApp → Phone number → Call settings → **Use SIP → Set up**.
   Paste the gateway's SIP URI, credentials, and codecs (Meta supports
   Opus + G.711).
3. Add a browser WebRTC endpoint (JsSIP or SIP.js) that registers against
   the same gateway. Wire it into `acceptCall()` / `initiateCall()` in
   `src/lib/wabees/calls.ts` — signaling scaffolding is already there;
   only the SDP generation + audio element need to be added.
4. Remove the 501 guard in `backend/api/send-call.php` (marked with
   "Honest guard").

No data model or UI change is needed — the same `call_logs` collection,
banner, and history table drive the full-audio version.