## Audit Summary

### 1) Website features (from `docs/WEBSITE-FEATURE-INVENTORY.md`) that touch admin scope
| Area | Current admin surface on website | Gap vs Flutter app |
|---|---|---|
| **Users**: approve / suspend / role change | `/admin` → Users tab (list + Approve/Suspend, no detail) | Flutter has `admin-user-detail` with full profile, per-user stats, AI-bot toggle, subscription activation/reject, direct chat |
| **Plans CRUD** (`plans` collection) | Reuses `/plans` (user-facing page) — no create/edit/delete UI | Flutter `AdminPlansScreen` = full CRUD (name, price, expiry, limits, features[], popular flag, active toggle, welcome-plan protection) |
| **Pending subscriptions** (`pending_subscriptions` collection) | **Missing** entirely on website | Flutter dashboard lists them + Activate / Reject buttons |
| **Support chats** (`support_chats/*`) | `/support` is *user-side* only (writes to own doc) | Flutter `AdminSupportScreen` lists all chats + admin reply UI with unread counts, online dot, image send |
| **Admin notifications** (`admin_notifications` — new signups, plan requests) | **Missing** — no bell, no list | Flutter streams unread count + mark-read batch |
| **Platform stats** (users total/active/pending/suspended/online/connected, messages, contacts, campaigns) | **Missing** — website Users tab only shows counts of user rows | Flutter dashboard hero + 6 stat cards |
| **Announcement** (`config/announcement`) | **Missing** | Flutter dashboard: send/disable global banner |
| **Force app-update config** (`config/app_version`) | **Missing** | Flutter dashboard: min-version + download URL |
| **Global AI-Bot master prompt** (`app_config/ai_bot_master.masterPrompt`) | **Missing** | Flutter dashboard: edit master rules applied to every user’s bot |
| **Per-user AI-bot enable flag** (`users/{id}.aiBotEnabled`) | **Missing** — no UI to gate the feature per user | Flutter user-detail: switch tile |
| **Subscription messages editor** (`app_config/subscription_messages`) | `/admin` Messages tab (already good) | Parity ✅ |

### 2) Firestore access already open to admins (from `firestore.rules`)
`isAdmin()` (role=='admin') already has read/write on: `users/*` tree, `plans`, `pending_subscriptions`, `support_chats/*`, `admin_notifications`, `config/*`, `app_config/*`. So no rules change needed to build the panel — pure UI + client-side Firestore writes.

### 3) Current website `/admin` route (`src/routes/_authenticated/admin.tsx`) — what stays
- Role gate via `useProfile().role === 'admin'` ✅ keep
- 4 top-level tabs (Users / Plans / Messages / Support) — will be **replaced** with a professional sidebar layout with 7 sections.
- `SubscriptionMessagesEditor` component ✅ reused as-is.

---

## Plan — Build the admin panel (single `/admin` route, no new top-level routes)

Design language: Wabees dark/light tokens (`bg-background`, `text-foreground`, `WbCard`), left icon sidebar for md+, top pill-tabs for mobile — matches existing `/inbox` and `/dashboard` look.

### Layout
```
/admin
  ├─ AdminShell  (sidebar + header + section switch, role-gated)
  │    Sidebar sections:
  │       Overview · Users · Pending Subs · Plans · Support · Announcements · AI Master · Messages
  └─ TopBar shows "Admin — Wabees" + unread admin_notifications bell
```
Each section is a self-contained component under `src/components/admin/`; the route mounts `<AdminShell/>` and renders one section based on local state.

### New hooks (`src/hooks/admin/`)
- `usePlatformStats()` — one live `onSnapshot('users')` map/reduce → `{totalUsers, activeUsers, pendingUsers, suspendedUsers, connectedUsers, onlineUsers, totalMessages, totalContacts, totalCampaigns}`.
- `useAdminNotifications()` — stream unread `admin_notifications` + `markAllRead()` batch.
- `useAllUsers(status?)` — stream `users` collection ordered by `createdAt desc` with client-side status filter.
- `useUserById(uid)` — single doc snapshot for detail drawer.
- `usePendingSubscriptions()` — stream `pending_subscriptions`, join with `users/{userId}` display name.
- `useAdminSupportChats()` — stream `support_chats` ordered by `lastMessageAt desc` with unreadByAdmin field.
- `useAdminSupportMessages(chatId)` — stream `support_chats/{id}/messages`.
- `useAppConfigDoc(path)` — generic read/write for `config/announcement`, `config/app_version`, `app_config/ai_bot_master`.

### Section components (`src/components/admin/`)
1. **`OverviewSection`** — 6 stat cards (Total/Active/Pending/Suspended/Connected/Messages), Quick Actions grid (Announce, App Update, AI Master, Users, Plans, Support), Active-announcement banner card with close button, Pending signups shortlist (5 rows + Approve inline), Pending subs shortlist.
2. **`UsersSection`** — search + tab bar (All/Pending/Active/Suspended/Deactivated), table + row actions (Approve / Suspend / Reactivate / Deactivate / View), open **`UserDetailDrawer`** on click.
3. **`UserDetailDrawer`** — full profile (avatar/name/email/phone/business), Usage stats grid (messages/contacts/bots/campaigns), WhatsApp connection card (phone id/waba id), Account info (createdAt/updatedAt/UID), **AI-bot enable switch** (writes `aiBotEnabled`), Current subscription card with Activate/Reject buttons for pending, Role picker (user/admin), Status action menu, "Open support chat" button → jumps to Support with that user selected.
4. **`PendingSubsSection`** — full list with Activate/Reject per row (writes to `pending_subscriptions/{id}` + updates `users/{uid}/subscription/current`).
5. **`PlansSection`** — full CRUD (list, form dialog: name/description/price/expiryDays/limits/features[]/isPopular/isActive/showOnPublic, delete confirm, welcome-plan protected from delete/deactivate).
6. **`SupportSection`** — two-pane: left list of chats (avatar, name, last message, unread badge, online dot), right message thread with composer (text + image via existing `upload-media.php`), auto-mark-read on open.
7. **`AnnouncementSection`** — form to set `config/announcement.{message, active, createdAt}` + disable button + live preview of what users see.
8. **`AppVersionSection`** — form for `config/app_version.{minVersion, downloadUrl}`.
9. **`AiMasterSection`** — textarea for `app_config/ai_bot_master.masterPrompt` (8 rows) + save.
10. **`MessagesSection`** — reuse existing `SubscriptionMessagesEditor` component.

### Notifications
Bell icon in the admin header shows unread `admin_notifications` count; click → dropdown listing recent 20; "Mark all read" batches updates. Non-blocking, wired into `AdminShell` header.

### Security & guards
- Every write path guarded by `useProfile().role === 'admin'` check + `RequireCapability` wrapper on the whole route.
- Existing `firestore.rules` already restrict all touched collections to `isAdmin()`; no rules change required.
- Never expose Firebase project IDs / dashboard links / secrets in UI or errors (per `docs/RULES.md`).
- Rate: no bulk destructive operation without confirm dialog (`WbDialog` pattern already in the codebase — I'll add a small `ConfirmDialog` helper if missing).
- Sanitize any free-text before writing to `announcement`/`masterPrompt` (trim + length caps: announcement ≤ 500, master prompt ≤ 4000).

### Not included (out of scope for this pass — flag only)
- Server-side moderation of user-generated content (webhooks, PHP).
- Payment gateway admin (Stripe / manual receipts UI beyond activate/reject).
- Admin action audit log (Flutter also lacks this; can be a follow-up).

### Files to change / add
- **Edit** `src/routes/_authenticated/admin.tsx` — replace the tab body with `<AdminShell/>`, keep the role gate.
- **Add** `src/components/admin/AdminShell.tsx` + one file per section (10 files listed above).
- **Add** `src/hooks/admin/` — 7 hooks listed above.
- **Add** `src/components/admin/ConfirmDialog.tsx` if not present (thin wrapper around existing Dialog primitives).
- **Keep** `SubscriptionMessagesEditor.tsx` unchanged.

### Verification
- `bun run typecheck` (auto by build).
- Manual: open `/admin` as an admin user in preview, walk every section, confirm reads render and each write persists (I’ll drive Playwright with the `e2e-ownera@wabees.test` account promoted to admin only if the user asks — otherwise leave visual QA to them since they’re already logged in as admin).

Confirm and I’ll implement.
