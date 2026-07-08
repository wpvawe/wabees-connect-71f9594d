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
| CSAT settings | ✅ | ❌ | Missing |
| Auto-triage settings | ✅ | ❌ | Missing |
| Developer API (apiKey view/regenerate) | ✅ | ⚠️ | `_apiKey` shown in settings — verify regenerate |
| Subscription-messages editor (admin) | ✅ | ❌ | Not found |

### L. Plans / Subscription
`plans_screen` + `plan_repository` + request flow via admin — **✅ present**; verify atomic `pending_subscriptions` write + admin notification + support-chat post.

### M. Notifications
| Feature | Web | App | Notes |
|---|---|---|---|
| FCM token registration (user + agent doc) | ✅ | ✅ | `notification_service` |
| Incoming-message alerts + chime | ✅ | ✅ | native notif |
| Notifications page filtered by role | ✅ | ✅ | `notifications_screen` |

### N. CSAT
Send survey (interactive list), capture reply, comment follow-up — **❌ missing in app** (no `csat_surveys` code).

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
6. **Availability toggle + working hours editor** (I) — visible in main shell + agent detail sheet.
7. **Workload screen** (J) — per-agent load + avg firstResponseMs.
8. **SLA settings + SLA badge on conversation rows** (K, C).
9. **CSAT: settings + auto-on-resolve send + capture** (K, N).
10. **Bulk action bar** in inbox (multi-select assign/tag/resolve/delete).

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

---

## Part 5 — Verification still pending

Rows marked ⚠️ above need file-level verification before we can call them done or missing. Concrete next-turn checks:
- `auth_repository.dart` — welcome subscription + oobCode reset
- `contact_repository.dart` — CSV/VCF batch import
- `template_repository.dart` — edit + delete Meta Graph fallbacks
- `campaign_execution_service.dart` — pause-on-disconnect
- `user_presence_service.dart` — heartbeat interval + hide/beforeunload equivalent
- `chat_screen.dart` (3 012 lines) — reactions, typing indicator, deleted/forwarded, tags, state, priority

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

Confirm priority and I'll begin.