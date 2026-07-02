# Wabees — Website ↔ App Parity & Bug-Fix Plan

Dono codebases ka deep audit complete. Yeh unified plan hai. Har batch ek turn me deliver hoga, TypeScript clean + Flutter compile clean, dono taraf.

---

## 1. Common Features (dono me already hain — parity OK)

Auth (email/google/forgot/reset), Dashboard, Analytics, Inbox list, Chat bubbles, Text/media/voice send, Templates list + create (advanced) + sync, Campaigns list + create + logs, Contacts CRUD + CSV, Bots, AI Bot, Agents, Connect (embedded + manual), Business Profile, Message Links, Notifications (in-app + FCM), Plans/Subscriptions, Support chat, Media upload/proxy.

---

## 2. Website me hai, App me nahi (App me add karna hai)

| # | Feature | Website file (ref) |
|---|---|---|
| W1 | **Forward message** dialog | `ForwardDialog.tsx` |
| W2 | **Assign agent** to conversation | `AssignAgentDialog.tsx`, `assignments.ts` |
| W3 | **Conversation notes** panel | `NotesPanel.tsx` |
| W4 | **Interactive composer** (reply buttons / list / CTA URL) | `InteractiveDialog.tsx` |
| W5 | **Scheduled messages from chat** | `ScheduleDialog.tsx` |
| W6 | **Drag-drop files** + **emoji picker** in composer | `Composer.tsx` |
| W7 | **Media lightbox** full-screen viewer | `MediaLightbox.tsx` |
| W8 | **Reply-to quoting** UI in composer | `Composer.tsx` (`replyTo` prop) |

## 3. App me hai, Website me nahi (Website me add karna hai)

| # | Feature | Flutter file (ref) |
|---|---|---|
| A1 | **Template EDIT** (body/header/footer/category → Meta) | `template_repository.dart` + `/edit-template.php` |
| A2 | **Unsend (delete for everyone)** message | `MessageRepository.deleteMessage` + `/delete-message.php` |
| A3 | **Campaign Pause / Resume / Restart / Cancel** controls | `CampaignRepository` |
| A4 | **Anti-ban rate-limiter** in campaign runner (2 msg/s + 3 s pause per 80) | `AntiBanService`, `CampaignExecutionService` |
| A5 | **Meta multi-step account picker** (Business → WABA → Phone) | `meta_account_picker.dart` + 3 detect-*.php endpoints |
| A6 | **Contact groups** (in addition to tags) + **sample CSV download** | `contacts_screen.dart`, `contact_import_export.dart` |
| A7 | **Phone health check** UI (quality rating history) | `/phone-health.php` |
| A8 | **Developer API key** section (settings) | `settings_screen.dart` |
| A9 | **Bot advanced fields** — CTA button, additional multi-message sequences, response header/footer | `bot_builder_screen.dart` |
| A10 | **Long-press message actions** (React emoji picker, resend on failed, view error, download) | `chat_screen.dart` |

## 4. Critical Bugs (dono taraf ke)

| # | Where | Bug | Fix |
|---|---|---|---|
| B1 | **Website** `TemplateGrid.tsx:110` | Template DELETE only calls `deleteDoc(...)`, Meta pe rehta hai | Add `/delete-template.php` PHP proxy → Meta Graph `DELETE /{waba-id}/message_templates?name=...&access_token=...`, only then Firestore delete |
| B2 | **Backend** `webhook.php` owner-resolve | Stale APCu / file cache → `NOT_FOUND` → message drop, kabhi Firestore me nahi likha | Fallback: if wa_map miss, ALWAYS scan `whatsapp_config` subcollection once and warm cache; log all drops to a `wa_map_misses` Firestore collection for visibility |
| B3 | **Backend** `webhook.php` phone normalize | PHP `normalize_phone` aur JS `normalizePhone` diverge — conversation doc ID mismatch | Ek canonical `normalize_phone_e164()` function dono me: strip non-digits, prepend `+`, always store as `+E164`. Client `useConversations` self-heal already fits |
| B4 | **App** `analytics_screen.dart` `_changeRange` | Date range chips visually update but `whatsappAnalyticsProvider` par pass nahi hote — data hamesha same | Pass `startDate`/`endDate` params to provider, invalidate on range change |
| B5 | **App** `inbox_screen.dart` swipe-dismiss | Sirf local Set me hide hota hai, restart pe wapas | Firestore `conversations/{phone}.isDeleted = true` set karo (website already reads this field) |
| B6 | **App** `chat_screen.dart` unsend UI | `_unsendMessage` implemented but ListTile commented `// ignore: unused_element` | Enable ListTile (only for outgoing < 15 min per Meta rule) |
| B7 | **Website** Campaign runner | Sirf tab-open pe chalta hai, `sent/delivered/read` counters webhook se update nahi hote | Anti-ban limiter add + webhook `handle_status_update` me `campaigns/{id}/logs` matching wamid pe deliveredCount/readCount increment |
| B8 | **Website** Scheduled messages | Batch 13 me fix ho gaya (txn claim + stuck-recovery). ✅ | — |
| B9 | **Both** FCM webpush link | Hardcoded to `wabees-plus.wabees.workers.dev`, actual URL alag | Owner ke saved domain se link banayen (env) |
| B10 | **App** template edit | Website me edit nahi (A1), app me hai — parity fix via A1 |

## 5. Batch Rollout (order matters — koi build error na aae)

### Batch 14 — Critical Bug Fixes (server + client, no new UI)
- B1 website template delete → Meta (add `backend/api/delete-template.php` + `deleteMetaTemplate()` in `templates.ts` + wire into `TemplateGrid.tsx`)
- B2 webhook owner-resolve fallback + miss logging
- B3 phone normalizer canonicalization audit (JS + PHP diff)
- B9 FCM link derived from config

### Batch 15 — App Bug Fixes (Flutter, wabees-plus repo)
- B4 analytics date range wire
- B5 swipe-dismiss → Firestore isDeleted
- B6 enable unsend ListTile

### Batch 16 — Template Edit + Unsend on Website (A1 + A2)
- Add website Template edit page (`/templates/$id/edit`) reusing `TemplateComposer` in edit mode → `/edit-template.php`
- Add "Unsend" action on outgoing message bubbles (< 15 min) → `/delete-message.php`

### Batch 17 — Campaign Parity Website (A3 + A4 + B7)
- Pause/Resume/Restart/Cancel buttons + `campaigns.ts` methods
- Anti-ban limiter in client runner (2 msg/s, 3 s / 80 msgs)
- Webhook status-update → campaign log delivered/read counter bump

### Batch 18 — App Chat Composer Parity (W1–W8)
Add Flutter equivalents: Forward dialog, Assign agent, Notes panel, Interactive composer, Schedule from chat, Reply-to UI (already partial), Media lightbox (partial), Emoji picker + drag-drop (mobile share intent).

### Batch 19 — Website Advanced Additions (A5 + A6 + A7 + A9)
- Multi-step Meta account picker (Business → WABA → Phone) reusing existing 3 detect-*.php endpoints
- Contact groups + sample CSV download
- Phone health card in Connect page
- Bot advanced: CTA button, multi-message sequences, header/footer

### Batch 20 — Developer API + Admin Panel (A8 + admin)
- `settings` → API key section (generate `wbk_...`, store `users/{uid}.apiKey`)
- Admin panel (approve users, plans CRUD, support inbox) — behind `isAdmin` flag

### Batch 21 — Long-press actions + Polish (A10 + housekeeping)
- Website bubble long-press → React emoji, Resend failed, View error, Download
- Fix all hydration warnings (current `/auth` mismatch)
- Final tsgo + Flutter analyze clean

---

## 6. Technical Notes

- **Backend**: All new PHP endpoints under `backend/api/` (auth via existing Firebase ID-token verification).
- **Firestore paths**: reuse existing (`users/{uid}/…`); no new top-level collections except `wa_map_misses` (debug-only).
- **Sync**: Har website change ke baad wabees-plus repo me equivalent Flutter change bhi push karunga (dono repos ka sync maintain).
- **Build safety**: har batch ke end me `bunx tsgo --noEmit` (website) + `flutter analyze` (app). GitHub Actions APK build sirf batch 15/18/19 ke baad trigger.
- **Verification**: Batch 14 done hone ke baad ek test template create → website se delete → Meta pe confirm gone (browser Playwright ya PHP curl).

---

**Aap approve karo to Batch 14 se shuru karta hun** (critical bugs pehle, feature parity baad me). Ya order badalna ho to bata do — e.g. "pehle A1 (template edit) chahiye" ya "pehle B1 (delete bug) fix karo" — hisaab se re-order kar dunga.