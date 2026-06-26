## Confirmed decisions

- **Hosting:** Cloudflare Pages (free tier → $5/month at scale). Setup baad me — abhi development preview pe build karenge.
- **Send route:** Web → TanStack server fn → POST `https://api.wabees.live/api/send.php` (JWT signed) → PHP backend → Meta Graph + Firestore.
- **JWT secret:** Auto-generate karunga (`PHP_BACKEND_JWT_SECRET`, 64 chars) build mode me pehla kaam.

---

## Phase 3 — Build sequence (parallel files, ek hi PR)

### Step 1: Firebase Web SDK + custom-token auth
- Install `firebase` (v10, tree-shaken)
- `src/integrations/firebase/client.ts` — init auth + firestore only
- `src/lib/firebase/custom-token.functions.ts` — server fn mints token from `FIREBASE_SERVICE_ACCOUNT_JSON` scoped to `profiles.firebase_uid`
- `src/hooks/useFirebaseSession.ts` — auto-sign in on Supabase session
- Generate `PHP_BACKEND_JWT_SECRET`

### Step 2: Realtime hooks
`useConversations`, `useMessages`, `useContacts`, `useTemplates`, `useCampaigns`, `useCampaignLogs` — each one `onSnapshot` with proper cleanup.

### Step 3: Inbox (core)
- `inbox.tsx` — conversation list (3-col desktop, stacked mobile)
- `inbox.$phone.tsx` — message thread + composer + media preview
- Components: `ConversationList`, `MessageBubble`, `Composer`, `MediaPreview`
- `sendMessage` server fn → POST `api.wabees.live/api/send.php` with JWT

### Step 4: Contacts
- `contacts.tsx` — list, search, tags filter
- CSV import/export via PapaParse
- Components: `ContactList`, `ContactRow`, `TagFilter`, `ImportDialog`

### Step 5: Templates
- `templates.tsx` — list + create + sync from Meta
- Components: `TemplateList`, `TemplateEditor`, `SyncButton`

### Step 6: Campaigns
- `campaigns.tsx`, `campaigns.new.tsx`, `campaigns.$id.tsx`
- `createCampaign`, `startCampaign` (rate-limited send loop via `send.php`), `pauseCampaign`
- Components: `CampaignList`, `CampaignWizard`, `CampaignStats`, `LogsTable`

### Step 7: PHP backend handoff note
JWT verify add karna parega `api/send.php` ke top pe — chhoti PHP snippet di jayegi, tum FTP se deploy kar dena.

### Out of scope (Phase 4)
Bots/AI, analytics, calling, admin panel, FCM web push, scheduled cron.

### Deps to install
`firebase`, `papaparse` + `@types/papaparse`, `linkify-react`, `linkifyjs`, `date-fns`.

---

**"Implement Plan" dabao — build mode me jaa ke pehle JWT secret generate karunga, phir Step 1 se start.**