# Wabees Web — Complete Feature Inventory (Parity Checklist)

> Source-of-truth audit of every website feature, Firestore path, PHP endpoint, and hook. Use this to bring the Flutter app to full parity.


## Cross-cutting Infrastructure
- **Firebase client** (`src/integrations/firebase/client.ts`): lazy `fbAuth()`, `fbDb()`, SSR-safe `*OrNull()`; `WABEES_API_BASE` normalised (strips trailing `/api`).
- **Session / effective UID** (`src/hooks/useFirebaseSession.ts`): dual snapshots on `users/{uid}` + `users/{uid}/whatsapp_config/config`; `effectiveUid = dataOwner ?? uid`; auto server repair via `repairWhatsAppOwnerServer()` retried every 30s when phone known but owner missing.
- **WA credentials** (`loadWaCredentials(uid)`): reads subcollection then top-level fallback.
- **Phone normalisation** (`src/lib/firebase/normalizers.ts`): `normalizePhone` (PK special-case), `phoneQueryCandidates` (≤10 variants for Firestore `in`), `phoneDocId`, `whatsappRecipientId`.
- **Media proxy** (`mediaProxyUrl(id,uid)`) — synthesised in `useMessages` when webhook wrote only `mediaId`.
- **Permissions** (`src/lib/auth/permissions.ts`): 22 capabilities × 3 roles (owner/supervisor/agent).

---

## A. Auth & Session
| # | Feature | Files | Firestore / API |
|---|---------|-------|-----------------|
| A1 | Email sign-in | `SignInForm.tsx` | Firebase Auth + `ensureUserDoc` + honeypot `company_website` |
| A2 | Sign-up | `SignUpForm.tsx`, `users.ts` | `users/{uid}` `{status:pending, role:user, whatsappConnected:false, counters, apiKey:null}` |
| A3 | Google OAuth | `GoogleButton.tsx` | `signInWithPopup` + `ensureUserDoc` |
| A4 | Forgot / reset password | `auth.forgot.tsx`, `auth.reset-password.tsx` | `sendPasswordResetEmail`, `confirmPasswordReset(oobCode)` |
| A5 | Agent invite join | `join.$code.tsx`, `agent-invites.ts` | `agent_invites/{code}` global + `users/{owner}/agents/{self}` + sets `dataOwner`; handles AGENT_SWITCH_REQUIRED |
| A6 | Welcome subscription | `users.ts:ensureWelcomeSubscription` | `plans[isWelcomePlan]` → `users/{uid}/subscription/current` + `bot_usage/current` |
| A7 | Account status gate | `AccountStatusGate.tsx` | Blocks `pending`/`suspended`; agents blocked when owner `whatsappConnected:false` |
| A8 | Revocation guard | `useAgentRevocationGuard.ts` | Listens `users/{owner}/agents/{self}`; on revoke clears `dataOwner`, writes notification |
| A9 | Capability gates | `RequireCapability`, `OwnerOnly` | `can(role, capability)` from MATRIX |

## B. Onboarding / Connect
| # | Feature | Files | PHP endpoint |
|---|---------|-------|--------------|
| B1 | Manual token | `ManualTokenForm.tsx` | `verify-token.php` → `whatsapp-smart-connect.php` |
| B2 | Embedded Signup (FB Login for Business) | `EmbeddedSignupButton.tsx` | `whatsapp-exchange-code.php` (App Secret stays server-side) |
| B3 | Smart Connect autodiscover | api.ts | `whatsapp-smart-connect.php` |
| B4 | Multi-account picker | `AccountPickerDialog.tsx` | `whatsapp-list-accounts.php` (Bearer idToken) |
| B5 | `saveWhatsAppConfig()` | `whatsapp-config.ts:41` | Writes `users/{uid}` top-level + `whatsapp_config/config` + `wa_map/{phoneId}` + agent doc; owner-only `subscribe-webhook.php` + `clear-cache.php` (Bearer idToken) |
| B6 | Phone health card | `PhoneHealthCard.tsx` | Reads Firestore; inline WABA-ID edit |
| B7 | Webhook setup card | `WebhookSetupCard.tsx` | Static URL + verify token constants |
| B8 | Disconnect | `ConnectedCard.tsx` | Cancels pending scheduled/campaigns, deletes `wa_map` if last, deletes agent doc |
| B9 | Sync templates | `ConnectedCard.tsx` | `get-templates.php` → batch write `users/{uid}/templates` |

## C. Inbox / Chat
### C1 Conversation list (`ConversationList.tsx`, `useConversations`)
- Realtime `users/{uid}/conversations`.
- Sort: pinned (by `pinOrder`) → priorityRank → `lastMessageAt`.
- Filters: search (name/phone), state (open/pending/resolved/snoozed), assigned (me/unassigned/agent), tags.
- Auto-canonicalises duplicate docs (different phone formats) via merge write.

### C2 Thread (`inbox.$phone.tsx`, `useMessages`)
- `where(contactPhone, in, phoneQueryCandidates)`; orphan reactions merged onto parent by wamid.
- Side-hooks: `useConvNotes`, `useConvTags`, `useAssignLog`, `useScheduledMessages(phone)`, `useSlaSettings`.

### C3 Message bubble types (`MessageBubble.tsx`)
text (link preview) · image · sticker · video (VideoThumb) · audio/voice (VoiceNote scrubber) · document (icon+size) · location (OSM iframe + Maps link) · contacts · template · interactive button-reply · interactive list-reply · reaction (chip on parent) · button · **OTP auto-detect** (`/otp|verif|code|pin|auth/i` + 4–8 digits → copyable code) · deleted (`__DELETED__`) · forwarded.
Status ticks: pending/sent/delivered/read (blue)/failed.
Actions (hover + 450ms long-press mobile): react (6 quick + full picker) · reply · forward · copy · download · delete · resend · view error.

### C4 Composer (`Composer.tsx`)
- Text send (Enter/Shift+Enter), optimistic write (pending → sent+wamid / failed+errorReason).
- Conversation summary write on every send, counter increments (`users/{uid}.totalMessages`, `subscription/current.messagesUsed`), `markFirstResponseIfNeeded`, `maybeAutoAssignOnReply`.
- **24h window** enforcement (just added): banner + disabled controls + template CTA; warning countdown < 2h.
- Attach sheet · drag-drop (`wabees:chat-drop` CustomEvent) · paste from clipboard.
- Voice recording (opus-recorder → ogg/opus, `is_voice:true`).
- Emoji picker (lazy `emoji-picker-react`, insert at cursor).
- Canned responses: `/` trigger, arrow/Enter/Tab, `expandCanned` for `{{name|phone|agent|email|company}}`, unresolved warning.
- Interactive dialog: quick-reply / list / CTA-URL.
- Reply/quote (writes `replyToId/Body/Wamid/Type`).
- Typing indicator: 350ms debounce, 20s throttle → `mark-read.php {typing_indicator:"text"}`.

### C5–C18 Actions & drawers
mark-read.php · delete-message.php · forward · activity drawer · contact details drawer · notes panel · assign-agent (`assignments.ts`) · schedule dialog · bulk action bar · SLA badge (`evaluateSla`) · hotkeys + `?` help · media lightbox · canned picker.

## D. Contacts (`contacts.tsx`, `useContacts`)
`users/{uid}/contacts` fields: phone/name/email/company/notes/tags/group/profileImageUrl/counters. Search client-side; CRUD; CSV/VCF import batch; delete owner-only; increments `users/{uid}.totalContacts`.

## E. Templates
Routes: `/templates`, `/new`, `/$id/edit`.
`users/{uid}/templates`: name/category/language/status/body/header{Text,Format,MediaUrl}/footer/buttons[]/variables[]/qualityScore/hsm_id.
- **Create**: `create-template.php` → writes id+status.
- **Edit**: `edit-template.php` (fallback direct `POST /{hsm_id}` on Meta Graph).
- **Delete**: `delete-template.php` (fallback `DELETE /{waba}/message_templates?name=` on Graph) then Firestore delete.
- **Sync**: `get-templates.php` batch upsert + removal of missing.
- **Preview**: `WhatsAppPreview.tsx`.
- **Variables**: auto-extracted from `{{n}}` / `{{name}}`.
- **Buttons**: quick-reply (≤3) + CTA URL.
- Caps: write/delete owner-only; send all roles.

## F. Campaigns
Routes: `/campaigns`, `/new`, `/$id`.
Docs: `users/{uid}/campaigns/{id}` + logs `users/{uid}/campaign_logs/{cid}/entries/{lid}`.
Fields: status(draft/scheduled/running/completed/failed/paused)/messageType/template*/variableSource(static|contact)/staticVariableValues/contactFieldMap/audiencePhones/totals(sent/delivered/read/failed)/timestamps.
Client-side executor polls running campaigns → `send-message.php {type:template, template_name, language_code, components}`.
Pause-on-disconnect via `pauseOutboundWorkOnDisconnect()`.

## G. Message Links / QR (`/message-links`)
All via `message-links.php {action:list|create|delete}`.
Returns `{id, code, deep_link_url, prefilled_message, qr_image_url}` (QR from Meta).

## H. AI Bot / Bots / Auto-Triage
- **Bots** (`useBots`, `users/{uid}/bots`): name/trigger(keyword|regex|any)/response/enabled/priority/conditions.
- **AI Bot config** (`users/{uid}/settings/aiBot`): enabled/model/systemPrompt/handoffKeyword/maxAiMessages.
- **Auto-triage** (`useAutoTriage`, owner-only): new inbound → `triage.functions.ts` → writes `aiIntent/aiSentiment/aiSummary/aiConfidence/aiTriageAt/aiSuggestedTags/aiSuggestedPriority`; auto-apply tags & priority (never downgrades urgent/high).

## I. Agents / Supervisors (`/agents`)
- List (`useAgents`) reads `users/{owner}/agents`; hides `left` + own UID.
- Invite (`InviteAgentDialog`, `createAgentInvite`): 10-char code, `users/{uid}/agent_invites/{id}` + global `agent_invites/{code}`, TTL 1–60d (default 14), optional email lock; link `{origin}/join/{code}`.
- Revoke: batch invite + delete global doc; or set agent doc `status:"revoked"`.
- Roles: agent · supervisor · owner.
- Availability toggle (`available/away/dnd`).
- Presence heartbeat every 45s while visible; `isOnline:false` on hide/beforeunload.
- Working hours per day: `{enabled,start,end}` on agent doc.

## J. Analytics / Dashboard / Workload / Leads
- **Analytics**: `useAnalytics(range)`; ranges 7d/30d/month/lastMonth; metrics sent/delivered/read/failed/pending/incoming/outgoing/uniqueContacts/byDay/byType/topContacts.
- **Dashboard**: usage counts (messages/contacts/campaigns/bots vs limits).
- **Workload**: per-agent conversations, `firstResponseMs` avg.
- **Leads** (owner-only): `users/{uid}/bot_leads` — name/phone/altPhone/email/cnic/details/score(cold|warm|hot)/messageCount/timestamps/notes/status(new|contacted|qualified|won|lost).

## K. Settings
Business profile · Canned responses · SLA (`{firstResponseMinutes, resolutionMinutes}`) · CSAT (`{enabled, autoOnResolve, question, footer, askComment, commentPrompt}`) · Auto-triage · Developer API (`apiKey` on user doc) · Subscription messages editor (admin-only).

## L. Plans / Subscription
- `plans` collection (public read): name/desc/price(Monthly|Yearly)/currency/max(Messages|Contacts|Campaigns|Bots|Templates|AiMessages)/has(Analytics|PrioritySupport|ApiAccess)/features/expiry/isPopular/isWelcomePlan/showOnPublic/offer.
- Request: atomic tx on `pending_subscriptions/{uid}` + `admin_notifications` + support chat post.
- Current: `users/{uid}/subscription/current`.
- Welcome auto-created on signup.

## M. Notifications
- **FCM**: request permission → register `firebase-messaging-sw.js` + `postMessage(FIREBASE_CONFIG)` → getToken(vapidKey) → write `users/{uid}.fcmToken` + `users/{owner}/agents/{uid}.fcmToken`; foreground onMessage no-op.
- **In-app alerts** (`useIncomingMessageAlerts`): last 20 incoming; play chime + toast; suppress if viewing that thread; ignore <5s pre-listener docs.
- **Chime** (`notification-sound.ts`): WebAudio oscillator + autoplay unlocker on first gesture.
- **Notifications page**: `users/{uid}/notifications` filtered (agents only see `targetAgentId==self||null`); hides `new_message`/`bot_triggered` legacy noise.

## N. CSAT
- Send: cooldown check on `csatLastSentAt`; add `users/{uid}/csat_surveys` (pending); `send-message.php interactive list` 5 rows id=`csat:{surveyId}:{rating}`; stamp `csatLastSentAt`.
- Capture (`useCsatCapture`, owner-only): parse `buttonReplyId` starting `csat:` → record rating; optional follow-up comment prompt → next inbound stored as `comment`.
- Settings + surveys list hooks.

## O. Support Chat (`/support`)
`support_chats/{uid}/messages` (senderRole user|admin); parent doc tracks last message + `unreadByAdmin`. Uses `useFirebaseUid` (not effective) so support is per-signed-in user regardless of agent context. Subscription requests auto-post `kind:"subscription_request"`.

## P. Admin (`/admin`, role=="admin")
Users tab (all users approve/suspend) · Plans link · Subscription messages editor · Support link.

## Q. Scheduled Messages
- Create: `ScheduleDialog` → `users/{uid}/scheduled_messages` {contactPhone, body, scheduledFor, status:pending, recurrence(none|daily|weekly|monthly)}.
- Dispatcher (`useScheduledDispatcher`, client-side, 30s): tx-claim `pending|sending` where `scheduledFor<=now`; reclaim stale >5min; send; write message + conversation + counters + `sentMessageId`.

## R. Assign Log / Notes / Tags / State / Priority
- Assign log subcollection per conversation.
- Notes subcollection + `notesCount` on parent.
- Tag catalog `users/{uid}/tags/{id}` (name+color) + `arrayUnion/Remove` on conversation; rename cascades to all variants.
- States: open/pending/resolved/snoozed(+snoozeUntil).
- Priority: `priority` + `priorityRank` across variants.

## S. Utilities
Honeypot (`company_website`) · error-capture (5s TTL for SSR recovery) · Lovable error reporting · Firebase gate · Availability toggle · Side rail (unread badge) · Top bar (bell/avatar/signout) · Mobile tab bar · Wb* primitives.

---

## Open Gaps to Verify
1. `repairWhatsAppOwnerServer()` server implementation (Cloud Fn vs Worker).
2. Server-side campaign cron (currently client-only dispatcher).
3. API key generation exact mechanism.
4. `useWorkload` internals.
5. Bot auto-reply: PHP webhook vs client execution.
6. `response-time-backfill.ts` (likely one-time migration).
