# Wabees — App (Flutter) vs Website (React) Parity Audit

> Evidence-based audit. Sources scanned: `wpvawe/wabees-plus` (Flutter — 146 dart files, screens/providers/repositories/services) and this Lovable project (`docs/WEBSITE-FEATURE-INVENTORY.md` + `src/`). No guessing — every row references real files.

---

## Part 1 — Flutter app: what actually exists

### 1.1 Screens present (`lib/screens/`)
- Auth: `login`, `register`, `forgot_password`, `pending_approval`, `splash`
- Admin: `admin_dashboard`, `admin_users`, `admin_user_detail`, `admin_plans`, `admin_support`
- Dashboard: `dashboard_screen.dart` (2 488 lines)
- Messaging: `inbox_screen`, `chat_screen` (3 012 lines), `new_message`, `interactive_composer_sheet`, `chat_actions_dialogs`
- Contacts: `contacts_screen`, `add_contact_screen`
- Templates: `templates_screen`, `template_builder_screen`, `template_send_dialog`
- Campaigns: `campaigns_screen`, `campaign_builder`, `campaign_detail`, `campaign_analytics`
- Bots: `bots_screen`, `bot_builder`, `ai_bot_settings`
- Agents: `agents_screen`
- Analytics: `analytics_screen`, `analytics_dashboard_screen`
- Plans: `plans_screen`
- Notifications: `notifications_screen`
- Settings: `settings_screen`, `business_profile_screen`, `notification_settings_screen`
- Support: `support_chat_screen`
- WhatsApp: `whatsapp_connection_screen`, `meta_account_picker`, `message_links_screen`
- Profile: `profile_screen`, `diagnostic_screen`
- Calling (app-only): `call_history`, `in_call`, `incoming_call_overlay`
- Misc: `force_update_screen`, `main_shell`

### 1.2 Data layer
- 13 repositories (auth, user, message, campaign, bot, contact, template, plan, admin, notification, support, whatsapp, call)
- 19 providers (Riverpod) covering above + calling + theme + cleanup
- Services: `notification_service`, `user_presence_service`, `webrtc_service`, `widget_service`, `subscription_expiry_service`, `conversation_extras_service` (notes/assignment/scheduled/forward — Firestore-only, mirrors web), `campaign_execution_service`, `campaign_scheduler_service`, `anti_ban_service`, `cleanup_service`

### 1.3 App-only capabilities (NOT on website)
| # | Feature | Files |
|---|---------|-------|
| APP-1 | WebRTC voice calling | `webrtc_service`, `webrtc_provider`, `incoming_call_provider`, `call_repository`, `in_call_screen`, `incoming_call_overlay`, `call_history_screen` |
| APP-2 | Home-screen widget | `widget_service.dart` |
| APP-3 | Force-update gate | `force_update_screen.dart` |
| APP-4 | Subscription expiry local reminder | `subscription_expiry_service.dart` |
| APP-5 | Anti-ban throttling | `anti_ban_service.dart` |
| APP-6 | Server-side campaign scheduler client | `campaign_scheduler_service.dart` |
| APP-7 | Cleanup provider (local cache prune) | `cleanup_provider.dart`, `cleanup_service.dart` |

---

## Part 2 — Website features (source: `docs/WEBSITE-FEATURE-INVENTORY.md`)

Full A–S sections already documented there — auth, connect, inbox, contacts, templates, campaigns, message-links, AI bot & auto-triage, agents, analytics/dashboard/workload/leads, settings, plans, notifications, CSAT, support, admin, scheduled messages, assign log/notes/tags/state/priority, utilities.

---

## Part 3 — Parity matrix (evidence-checked)

Legend: ✅ present · ⚠️ partial · ❌ missing

### A. Auth & Session
| Feature | Web | App | Notes |
|---|---|---|---|
| Email sign-in | ✅ | ✅ | `login_screen` |
| Sign-up + `ensureUserDoc` | ✅ | ✅ | `register_screen`, `auth_repository` |
| Google OAuth | ✅ | ✅ | in login screen |
| Forgot / reset password | ✅ | ⚠️ | `forgot_password_screen` present; **`oobCode` reset flow (`confirmPasswordReset`) not verified in app** |
| Agent invite join (`/join/{code}`) | ✅ | ❌ | No `join_screen`; `agent_invites` not referenced anywhere in `lib/` |
| Welcome subscription auto-create | ✅ | ⚠️ | Needs verification in `auth_repository` |
| Account status gate (pending/suspended) | ✅ | ✅ | `pending_approval_screen` |
| Agent revocation guard | ✅ | ❌ | No listener on `users/{owner}/agents/{self}` |
| Capability matrix (22 caps × 3 roles) | ✅ | ⚠️ | `user_role.dart` exists — need to confirm per-capability gating |

### B. Connect / Onboarding
| Feature | Web | App | Notes |
|---|---|---|---|
| Manual token connect | ✅ | ✅ | `whatsapp_connection_screen` |
| Embedded Signup (FB Login for Business) | ✅ | ❌ | No FB SDK integration found |
| Smart Connect autodiscover | ✅ | ⚠️ | `whatsapp_setup_provider` — verify call to `whatsapp-smart-connect.php` |
| Multi-account picker | ✅ | ✅ | `meta_account_picker.dart` |
| Phone health card + WABA-ID inline edit | ✅ | ❌ | Not surfaced in connection screen |
| Webhook setup card | ✅ | ❌ | No webhook URL / verify-token UI |
| Disconnect + cancel pending work | ✅ | ⚠️ | Disconnect exists; pause-outbound cascade not verified |
| Sync templates from Meta | ✅ | ⚠️ | `template_repository` — verify `get-templates.php` batch sync |

### C. Inbox / Chat
| Feature | Web | App | Notes |
|---|---|---|---|
| Realtime conversation list, pin/priority sort | ✅ | ✅ | `inbox_screen`, `messaging_provider` |
| Filters: state / assigned / tags | ✅ | ⚠️ | State/assign UI present; **tag filter not verified** |
| Phone-variant `in` query merging | ✅ | ⚠️ | verify `phoneQueryCandidates` equivalent |
| Message types (text/image/sticker/video/audio/voice/doc/location/contacts/template/interactive/reaction/button) | ✅ | ✅ | chat_screen renders |
| OTP auto-detect (copyable) | ✅ | ❌ | No regex-based OTP UI |
| Deleted / forwarded badges | ✅ | ⚠️ | Verify `__DELETED__` handling |
| 24-hour window enforcement + countdown | ✅ | ❌ | No banner / composer lock in app |
| Voice recording (opus) | ✅ | ✅ | `record` package |
| Emoji picker | ✅ | ✅ | (native) |
| Canned responses `/` trigger + variables | ✅ | ❌ | No canned pop-up in composer |
| Interactive quick-reply / list / CTA-URL composer | ✅ | ✅ | `interactive_composer_sheet` |
| Reply / quote | ✅ | ✅ | |
| Typing indicator | ✅ | ⚠️ | Verify `mark-read.php {typing_indicator}` |
| Reactions (6-quick + full picker) | ✅ | ⚠️ | Verify long-press menu |
| Forward dialog | ✅ | ⚠️ | via `conversation_extras_service` |
| Notes drawer | ✅ | ⚠️ | Extras service has it — verify UI |
| Assign-agent dialog | ✅ | ⚠️ | Extras service has it — verify UI |
| Schedule dialog | ✅ | ⚠️ | Extras service has it — verify UI |
| Bulk action bar (multi-select) | ✅ | ❌ | Not found |
| SLA badge on conversation row | ✅ | ❌ | No `evaluateSla` in app |
| Activity drawer (assign log) | ✅ | ⚠️ | Verify UI |
| Hotkeys `?` help | ✅ | N/A | mobile — not applicable |
| Media lightbox | ✅ | ⚠️ | Verify pinch/zoom viewer |
| Starred drawer | ✅ | ❌ | Not found |

### D. Contacts
CSV/VCF import batch, tags, groups, counters, delete owner-only — verify parity in `contact_repository` & `add_contact_screen`. Status: **⚠️ partial** (CSV import likely missing).

### E. Templates
Create / edit / delete / sync / preview / variables / buttons — screens exist. **⚠️** need to verify edit endpoint and Meta Graph fallbacks.

### F. Campaigns
Full builder/detail/analytics screens exist. Client-side executor via `campaign_execution_service`. **✅ mostly present**; verify pause-on-disconnect cascade.

### G. Message Links / QR
`message_links_screen` present. **✅**

### H. AI Bot / Bots / Auto-triage
| Feature | Web | App | Notes |
|---|---|---|---|
| Keyword/regex bots CRUD | ✅ | ✅ | |
| AI Bot config (model/prompt/handoff) | ✅ | ✅ | `ai_bot_settings_screen` |
| Auto-triage (intent/sentiment/summary/priority/tags on inbound) | ✅ | ❌ | No triage listener/service in app |

### I. Agents / Supervisors
| Feature | Web | App | Notes |
|---|---|---|---|
| List agents | ✅ | ✅ | |
| Create invite (code + link + TTL + email-lock) | ✅ | ❌ | `InviteAgentDialog` equivalent missing |
| Revoke agent | ✅ | ⚠️ | Verify in `agents_screen` |
| Availability toggle (available/away/dnd) | ✅ | ❌ | No toggle in main shell |
| Presence heartbeat (45s) | ✅ | ⚠️ | `user_presence_service` exists — verify interval + `isOnline:false` on hide |
| Working hours per day | ✅ | ❌ | No editor |

### J. Analytics / Dashboard / Workload / Leads
| Feature | Web | App | Notes |
|---|---|---|---|
| Analytics ranges & breakdowns | ✅ | ✅ | `analytics_dashboard_screen` |
| Dashboard usage vs limits | ✅ | ✅ | |
| Workload (per-agent conversations, avg firstResponseMs) | ✅ | ❌ | No workload screen |
| Leads (`bot_leads` — name/phone/score/status/notes) | ✅ | ❌ | No leads screen / model |

### K. Settings
| Sub-feature | Web | App | Notes |
|---|---|---|---|
| Business profile | ✅ | ✅ | |
| Canned responses editor | ✅ | ❌ | Missing |
| SLA settings (`firstResponseMinutes/resolutionMinutes`) | ✅ | ❌ | Missing |
| CSAT settings | ✅ | ✅ | `/settings/csat` — same doc |
| Auto-triage settings | ✅ | ❌ | Missing |
| Developer API (apiKey view/regenerate) | ✅ | ⚠️ | `_apiKey` shown in settings — verify regenerate |
| Subscription-messages editor (admin) | ✅ | ✅ | `admin_subscription_messages_screen.dart` — shared `settings/subscription_messages` doc |

### L. Plans / Subscription
`plans_screen` + `plan_repository` + request flow via admin — **✅ present**; verify atomic `pending_subscriptions` write + admin notification + support-chat post.

### M. Notifications
| Feature | Web | App | Notes |
|---|---|---|---|
| FCM token registration (user + agent doc) | ✅ | ✅ | `notification_service` |
| Incoming-message alerts + chime | ✅ | ✅ | native notif |
| Notifications page filtered by role | ✅ | ✅ | `notifications_screen` |

### N. CSAT
**✅ Shipped end-to-end.** `CsatService` mirrors website `csat.ts` (send list survey, parseCsatReply, recordCsatRating, attachCsatComment, cooldown-aware). `CsatCaptureService` runs owner-only Firestore listener on incoming messages to close the loop (30-min comment window, 7d TTL for pending surveys). Auto-send on resolve triggered from chat screen with 24 h cooldown; writes to shared `users/{owner}/csat_surveys` — website admin dashboard sees the same records.

### O. Support Chat
`support_chat_screen` present. **✅** — verify subscription-request auto-post.

### P. Admin
Full admin screens exist. **✅** — verify subscription-messages editor + approve/suspend actions.

### Q. Scheduled Messages
`conversation_extras_service.schedule*` methods exist. UI dispatcher client-side loop **❌ likely missing** (mobile app shouldn't run continuous poller — needs server cron instead).

### R. Assign Log / Notes / Tags / State / Priority
Extras service covers assign+notes; **tag catalog, state (open/pending/resolved/snoozed), priority editing UI** — verify in chat screen. Likely **⚠️ partial**.

### S. Utilities
Honeypot ❌ (app doesn't need it — no public form), error-capture ⚠️, availability toggle ❌, side rail / top bar N/A (mobile shell).

---

## Part 4 — Missing in APP (prioritized for implementation)

### P0 — Revenue / retention blockers (build first)
1. **Agent invite + join flow** (I) — biggest gap: owners on web invite agents, agent can't accept on phone. Adds `join_screen`, `agent_invite_repository`, deep-link handler.
2. **24-hour window enforcement in composer** (C) — sends outside window fail silently on app; users blame the product.
3. **Auto-triage listener** (H) — parity with website's owner-only AI intent/sentiment/priority tagging.
4. **Leads screen** (J) — `bot_leads` CRUD, score chips, status board.
5. **Canned responses** — editor in Settings + `/` picker in chat composer.

### P1 — Team-ops parity
6. **Availability toggle** (I) — ✅ Shipped (commit `b774359`). Chip in inbox app bar → `users/{owner}/agents/{uid}.availability`. Working-hours editor still pending.
7. **Workload screen** (J) — ✅ Shipped. `/workload` route, per-agent active-chat counts + unassigned bucket. Reachable from Settings → "Team Workload". First-response averages deferred (needs analytics rollup).
8. **SLA settings + badge** (K, C) — ✅ Shipped. `/settings/sla` writes `users/{owner}/settings/sla`; `SlaBadge` on every conversation tile; `SlaResponseStamper` writes `firstResponseAt`/`firstResponseMs` on the first outbound after an inbound (idempotent, session-cached).
9. **CSAT** (K, N) — ✅ Shipped end-to-end. `/settings/csat` writes `users/{owner}/settings/csat` (identical schema). `sendCsatSurvey`, `parseCsatReply`, `recordCsatRating`, `attachCsatComment` ported to `lib/data/services/csat_service.dart`. `CsatCaptureService` boots on owner sign-in via `csatCaptureProvider` in `MainShell`. Chat screen adds "Mark as resolved" / "Reopen" — writes `state`, appends system note via `ConversationExtrasService.setConversationState`, and auto-fires the survey when owner opted in (24 h cooldown).
10. **Bulk action bar** in inbox — ✅ Shipped (core actions). Long-press to select, tap to toggle; bar shows count + mark-read / assign-to-me / unassign. Tag/resolve/delete bulk still TODO.

### P2 — Polish & pro features
11. **Starred drawer** in inbox.
12. **OTP auto-detect** in message bubble (copyable chip).
13. **Phone health + Webhook setup cards** on connect screen.
14. **Embedded Signup (FB Login for Business)** — Flutter FB SDK.
15. **Subscription-messages admin editor**.
16. **CSV / VCF contact import** (if missing).
17. **Media lightbox** with pinch/zoom (if only basic viewer).
18. **Tag catalog UI** + colored chips on rows.

### P3 — Deferred / architectural
19. **Scheduled messages dispatcher** — should move to server cron (PHP + pg_cron equivalent or Firestore Cloud Fn); mobile app should NOT run a 30s poller. Backend work, not app.
20. **Response-time backfill** — one-time script, not app UI.
21. **Messaging Insights parity** — ✅ Shipped. Website's `/analytics` (sent/delivered/read/failed/incoming, daily bar, type pie, top contacts) is now the **Messaging** tab of the app's existing `/analytics` screen. Same shared cache (`users/{owner}/analytics_daily/{YYYY-MM-DD}`) with 5-minute today-write throttle. No duplicate screen — Billing (Meta Graph) + Messaging (Firestore rollup) live under one tabbed `/analytics`.
22. **Conversation tags parity** — ✅ Shipped. App already had backend CRUD + inbox filter chips + inline "Manage Tags" long-press dialog. Delta closed: dedicated **Settings → Tags** editor (`tag_manager_screen.dart`) with rename + recolour + delete (website `updateTag` parity), plus **chat header → Manage tags** bottom sheet with catalogue checkboxes + shortcut to the editor. Shared `users/{owner}/tags/*` collection unchanged.

---

## Part 5 — Verification still pending

File-level verification done against `wpvawe/wabees-plus` (main). Results:

- **Welcome subscription** — ✅ Present. `AuthNotifier.register()` and the Google new-user branch both call `_planRepo.assignWelcomePlan(user.uid)` right after `_userRepo.createUser(userModel)` (`lib/providers/auth/auth_notifier.dart` L248, L334).
- **Password reset** — ✅ Present (different design). App does NOT use the website's `oobCode` + `confirmPasswordReset` flow. Instead it runs a 3-step OTP flow via PHP: `POST /send-reset-code.php` → `POST /verify-reset-code.php` → falls back to `FirebaseAuth.sendPasswordResetEmail` (`lib/screens/auth/forgot_password_screen.dart`). Functionally equivalent, no gap to close.
- **CSV / VCF contact import** — ✅ Present. `lib/core/utils/contact_import_export.dart` (228 lines) — no need to build a new one. Row D "CSV import likely missing" in Part 3 is stale.
- **Template edit + delete on Meta** — ✅ Present. `TemplateRepository.editOnMeta` and `deleteOnMeta` call `WhatsAppRepository.editTemplateOnMeta` / `deleteTemplateOnMeta`, with Meta "sample template" / "already-deleted" error handling and local Firestore mirror updates (`lib/data/repositories/template_repository.dart` L92, L123).
- **Campaign pause-on-disconnect** — ❌ Missing. `lib/services/campaign_execution_service.dart` (580 lines) contains no reference to `isConnected` / `whatsappConnected` / a paused-on-disconnect cascade. If the tenant disconnects mid-campaign the client-side executor will keep trying. Should be added to P2.
- **Presence heartbeat (`user_presence_service.dart`)** — ❌ Missing. There is no such file — `lib/services/` only ships `anti_ban_service.dart`, `campaign_execution_service.dart`, `campaign_scheduler_service.dart`, `cleanup_service.dart`. The Part 1.2 mention of `user_presence_service` and the ⚠️ in Row I ("verify interval + hide/beforeunload equivalent") were both wrong — the feature is not implemented at all.
- **`chat_screen.dart` deep-dive** — done. Findings on the 3 012-line file:
  | # | Feature | Status | Evidence |
  |---|---|---|---|
  | 1 | Message reactions (quick-6) | ⚠️ partial | `chat_screen.dart:789–806, 959–1020` — 6 hardcoded emojis, no full emoji picker / `+` button |
  | 2 | Typing indicator | ✅ | `chat_screen.dart:82–84, 322–338` — 350 ms debounce, 20 s throttle, `sendTypingIndicator(userId, messageId: wamid)` |
  | 3 | Deleted-message rendering | ❌ | No `__DELETED__` sentinel branch, no `isDeleted` on `MessageModel` |
  | 4 | Forwarded badge | ❌ | No `forwarded` field on `MessageModel`; no "Forwarded" chip in bubble |
  | 5 | Conversation tags on header | ✅ | `chat_screen.dart:1380–1405, 1447–1448` — chip strip + "Manage tags" sheet |
  | 6 | Conversation state (open/resolved) | ✅ | `chat_screen.dart:1439–1482` — dynamic `resolve`/`reopen` menu, `_toggleResolve()` |
  | 7 | Conversation priority | ❌ | No `priority` field on `ConversationModel`; no picker |
  | 8 | Reply / quote | ✅ | `chat_screen.dart:80, 814–818, 1940–1981` + `replyTo*` sent with every send |
  | 9 | 24-h window enforcement | ⚠️ | Countdown + expired banner exist (`1289–1329, 1695–1755`) but composer is **not** hard-locked when window is closed |
  | 10 | OTP auto-detect | ❌ | No regex scan on inbound bodies, no copy-chip |
  | 11 | Starred messages | ✅ | `chat_screen.dart:868–883` + dedicated `starred_messages_screen.dart` |
  | 12 | Bulk-select in chat | ❌ | No multi-select state or bulk bar |

### Consolidated Flutter follow-ups (from Part 5 verification)

**P2 — high value, well-scoped:**
1. **Campaign pause-on-disconnect** in `campaign_execution_service.dart` — subscribe to `users/{owner}/whatsapp_config/config.isConnected` and mark in-flight campaigns `status: 'paused'` on disconnect.
2. **Agent presence service** — new `lib/services/user_presence_service.dart` writing `users/{owner}/agents/{self}.isOnline` + `lastSeenAt` on a 45 s heartbeat; `isOnline: false` on app-lifecycle-paused / logout.
3. **24-h window hard-lock** in chat composer — disable text field + attachments when `!withinWindow`, keep template picker enabled.
4. **Deleted-message placeholder** — treat inbound `body === '__DELETED__'` as an italic muted "This message was deleted" bubble.
5. **Forwarded badge** — add `forwarded: bool` on `MessageModel`, render "Forwarded" chip when true.

**P3 — polish:**
6. **Conversation priority** — add `priority: 'low'|'normal'|'high'` on `ConversationModel`, chat-header picker + inbox sort key.
7. **OTP auto-detect** — regex `\b\d{4,8}\b` on inbound bubbles, tap-to-copy chip.
8. **Full emoji picker** — add `emoji_picker_flutter` behind a `+` on the quick-6 reaction row.
9. **Bulk-select in chat** — long-press to enter multi-select, bulk bar with delete-local / forward.

### Newly promoted P2 items (from these findings)
- **Campaign pause-on-disconnect cascade** in `campaign_execution_service.dart` — listen to `users/{owner}/whatsapp_config/config.isConnected` and mark in-flight campaigns `status: 'paused'` with reason on disconnect (matches website behaviour).
- **Agent presence service** — new `lib/services/user_presence_service.dart` writing `users/{owner}/agents/{self}.isOnline` + `lastSeenAt` on a 45 s heartbeat, and `isOnline: false` on app-lifecycle-paused / logout — required for Workload / SLA parity.

---

## Part 6 — Implementation guardrails (from `mem://` + `RULES.md`)

- All writes go to same Firestore paths as web (memory: `firestore-schema`).
- Media via `https://api.wabees.live/api/upload-media.php` — never Firebase Storage.
- WhatsApp send / templates / verify only via PHP backend endpoints.
- Effective UID = `users/{uid}.dataOwner ?? uid`.
- No Firebase Admin / server code in app — client SDK only; rules enforce access.
- 3-surface deploy discipline: PHP changes → wabees-plus repo → Hostinger; Flutter changes → wabees-plus repo only (users install APK).

---

## Recommended next step

Pick a P0 slice to start (my recommendation: **#1 Agent invite/join** — smallest, highest leverage, unlocks team usage on mobile) and I ship that end-to-end (models + repo + provider + screen + router + tests) via the wabees-plus repo. Then #2, #3… in order.

---

## Part 6 — Reverse audit (Jul 2026): website features still missing in app

Verified against `wpvawe/wabees-plus@main` (178 dart files). Items previously
shipped are dropped; only real remaining gaps listed.

### Still missing (website → app)

| # | Website feature | App status | Where it should live | Priority |
|---|---|---|---|---|
| 1 | **Leads board** (`users/{owner}/bot_leads` — name/phone/score/status/notes CRUD) | ❌ no screen, no model, no repo | new `lib/screens/shared/leads/` + `lead_repository.dart` | **P0** |
| 2 | **Auto-triage listener** (owner-only AI intent/sentiment/priority/tags on inbound) | ✅ shipped — settings screen + Flutter listener + public server route `/api/public/triage-message` sharing the same classifier as the web server fn | app: `auto_triage_service.dart`; web: `src/lib/ai/triage.server.ts` + `src/routes/api/public/triage-message.ts` | **P0 ✅** |
| 3 | **Subscription-messages admin editor** (edit templated plan-request replies) | ✅ shipped — `admin_subscription_messages_screen.dart`, entry via Manage Plans app-bar | writes `settings/subscription_messages` (same doc as website) | **P1 done** |
| 4 | **Embedded Signup** (Facebook Login for Business — one-tap WA number attach) | ❌ only manual token paste flow | Flutter FB SDK on `whatsapp_connect_screen` | **P2** |
| 5 | **OTP auto-detect chip** in inbound bubbles (regex + copy) | ❌ no regex scan in `_MessageBubble` | small helper in `chat_screen.dart` bubble builder | **P2** |
| 6 | **Media lightbox gallery** — swipe between images, pinch zoom, save-to-gallery | ⚠️ single-image `InteractiveViewer` only | new `media_gallery_viewer.dart` (photo_view + PageView) | **P2** |
| 7 | **Scheduled-messages dispatcher** | architectural — belongs on **server cron**, NOT in app | PHP cron on Hostinger hitting Firestore | **P3** (backend, not app) |
| 8 | **Response-time backfill** (one-off analytics rollup) | script, not app UI | node script in wabees-plus repo | **P3** (out of app scope) |

### Already closed since original audit (for the record)

Agent invite + join (P0#1), 24-h composer lock (P0#2), Canned responses editor + `/` picker (P0#5), Availability toggle (P1#6), Workload screen (P1#7), SLA settings + badge (P1#8), CSAT end-to-end (P1#9), Bulk action bar (P1#10), Starred drawer (P2#11), Phone health card (P2#13), Tag catalog UI (P2#18), CSV/VCF import (P2#16), Conversation tags parity (P3#22), Messaging Insights parity (P3#21), Forwarded badge, Deleted-message placeholder, Campaign pause-on-disconnect, Agent presence heartbeat (45s + owner mirror).

### Recommended next slice

**Update (Jul 2026 — shipped):**

- **P0 #1 Leads — ✅ complete.** New route `/leads`, entry from Settings.
  Model + repo + Riverpod stream + screen + edit sheet. Reads/writes
  `users/{owner}/bot_leads`, same schema as website `useLeads.ts`.
  Owner-only guard mirrors website behavior.
- **P0 #2 Auto-triage — ⚠️ partial.** Settings screen shipped at
  `/settings/auto-triage` writing the same `users/{owner}/settings/autoTriage`
  doc the website reads (`triage.ts`). Toggling on the phone flips it
  everywhere. The **classifier call** itself still runs from the website
  session; a phone-side listener needs a PHP endpoint on `api.wabees.live`
  (`triage-message.php` proxying DeepSeek) to be equivalent. Next slice.

**Follow-up (Jul 2026 — P0 #2 closed):**

- Extracted DeepSeek classifier into `src/lib/ai/triage.server.ts` (shared).
- Existing `classifyMessage` server fn now delegates to the shared helper.
- New public server route `src/routes/api/public/triage-message.ts` — POST,
  same input shape, verifies Firebase idToken, returns identical JSON. No
  PHP surface introduced — the Cloudflare Worker already runs on
  `wabees-plus.wabees.workers.dev` with `DEEPSEEK_API_KEY` +
  `FIREBASE_WEB_API_KEY`.
- Flutter: `lib/data/services/auto_triage_service.dart` +
  `lib/providers/settings/auto_triage_capture_provider.dart` booted from
  `MainShell` (owner-only). 15-min per-phone cooldown, only text/button/
  interactive inbound, writes `aiIntent/aiSentiment/aiSummary/tags/priority`
  onto the conversation doc — never downgrades a human-set high/urgent.

Confirm priority and I'll begin.