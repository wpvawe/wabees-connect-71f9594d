# De-Hardcoding Plan — Batch Wise

Aap ke 3 points + audit se mili aur hardcoded cheezen — sab ek jagah, batches me. Har batch independently ship ho sakta hai.

## Extra Hardcoded Cheezen Jo Mujhe Aur Mili

**Website / Frontend**
- `PhoneHealthCard.tsx` me `https://api.wabees.live/api/phone-health.php` — env base ignore.
- `DeveloperApiSection.tsx` curl examples me full URL hardcoded (env base use nahi hota).
- Currency fallback `"PKR"` `usePlans.ts` me hardcoded — admin-level default hona chahiye.
- Contacts sample CSV, leads CSV filenames me `wabees-` prefix hardcoded (chalne do, minor).
- Graph API version `v21.0` 30+ jaghon pe scattered — koi central `META_GRAPH_VERSION` nahi.

**Backend (PHP)**
- `VERIFY_TOKEN = 'wabees_webhook_verify_2024'` `backend/api/webhook.php:17` — plain constant. Per-user rotate karne ka koi tareeqa nahi.
- CORS allowlist 4 files me duplicate hardcoded (`send-message.php`, `edit-template.php`, `delete-template.php`, etc.) — ek shared config chahiye.
- `WEB_APP_URL` / `PUBLIC_HOST` fallback `wabees.live` inline.
- `media-proxy.php` full URL `webhook.php` me 2 jagah literal.
- FCM webpush link fallback `https://wabees.live/` literal.
- JWT secret plain-text committed (`backend/config/jwt-secret.php`) — env-based hona chahiye.
- Firebase project id `wabees-app` 5 files me literal.
- `v22.0` `cron/dispatch-scheduled.php` me — baaqi codebase se mismatch.
- AI cooldown / max tokens / history `ai-config.php` me hardcoded, admin edit nahi kar sakta.
- DeepSeek endpoint `triage.functions.ts` me literal.

**Content / UX**
- `/download` page (PHP landing) me purana webhook callback URL. Multiple docs pages me purane URLs.
- "Contact admin for payment" auto-reply message app me hardcoded — admin edit nahi kar sakta.
- Welcome plan flag Firestore me hai lekin default plan settings admin UI se editable nahi (sirf `isWelcomePlan` boolean).
- Public landing pe plans hardcoded (wabees.live PHP side) — Firestore `plans` se sync nahi.
- Offer / discount ka koi field hi nahi Plan schema me.

---

## Batch 1 — Connect Page + Webhook Guide (aap ka Point 1)

**Goal:** User connect page pe hi callback URL + verify token dekhe, copy kare, aur step-by-step guide (permanent token wala) follow kare. Purane callback URLs har jagah update.

- `src/routes/_authenticated/connect.tsx`: naya "Webhook Setup" card add karein — Callback URL (`https://api.wabees.live/webhook.php`) + Verify Token (`wabees_webhook_verify_2024`) with Copy buttons + external "Open Meta App Dashboard" link + numbered steps (App create → WhatsApp product → Configure webhook → Subscribe fields → Generate permanent System User token → Add phone number → Paste here).
- Verify token ko `VITE_META_VERIFY_TOKEN` env se read + fallback current value. Doc me bhi env constant use ho.
- Manual token form ke upar collapsible "How to get a permanent access token?" guide (System User → Assign asset → Generate token → never expires) with Meta doc links.
- Backend PHP `download/index.php` + landing (wabees-plus repo `backend/`) me purane callback URLs (agar `/api/webhook.php` ya kuch aur) → `/webhook.php` update. SSH deploy live server bhi.
- `DeveloperApiSection.tsx` + `PhoneHealthCard.tsx` — env base use karein (`VITE_WABEES_API_BASE`).

## Batch 2 — Dynamic Welcome Plan + Public Plans + Offers (Point 2)

**Goal:** Welcome plan admin-editable. Public landing plans Firestore se aayen. Har plan pe optional "Offer" badge/discount.

Schema (Firestore `plans` doc, additive fields — koi migration break nahi):
- `offer: { active: boolean, label: string, discountPct?: number, priceOverride?: number, endsAt?: Timestamp }`
- `showOnPublic: boolean` (public landing pe dikhana hai ya nahi)
- Existing `isWelcomePlan` — sirf ek plan pe true rahe (admin app already handle karta hai, hum sirf UI-level guard add karenge).

Frontend:
- `usePlans.ts` me `offer` + `showOnPublic` parse.
- `plans.tsx` (auth) + naya public plans component: Offer badge, strikethrough original price, "Ends in X days" agar `endsAt`.
- Public landing PHP page (`backend/index.php` on wabees.live) → Firestore REST API se `plans` fetch (server-side, cached 5 min). Hardcoded plan cards remove.
- Welcome plan auto-assign flow `src/lib/firebase/users.ts:73` already dynamic hai — sirf verify + fallback message dynamic karo.

## Batch 3 — Dynamic Subscription Request Message (Point 3)

**Goal:** App aur website dono ek hi Firestore config se message padhen. Admin admin panel se edit kare.

Firestore path: `settings/subscription_messages` (single doc):
- `requestNotificationTemplate` (admin ko jane wala) — placeholders: `{userName}`, `{planName}`, `{price}`.
- `userReplyTemplate` (auto-reply user ko) — placeholders: `{planName}`, `{price}`, `{adminPhone}`, `{paymentInstructions}`.
- `paymentInstructions` (rich text / markdown).
- `adminContactPhone`, `adminContactEmail`.

Code:
- Naya hook `useSubscriptionMessages.ts`.
- `subscriptions.ts` `requestSubscription()` me hardcoded strings hata ke template rendering.
- App side (Flutter) already yahi doc padhega — schema Flutter ke sath finalize karna hoga (aap confirm karo doc path).
- Naya admin section `AdminSubscriptionSettings.tsx` (admin route pe) — editable form.

## Batch 4 — Central Constants (Meta version, URLs, CORS)

- `src/lib/constants.ts` — `META_GRAPH_VERSION = "v21.0"`, `WABEES_API_BASE`, `WEB_APP_URL`. Sab TS files ko is se import karayen.
- `backend/config/constants.php` — same PHP side (`META_GRAPH_VERSION`, `WEB_APP_URL`, `PUBLIC_HOST`, `MEDIA_PROXY_URL`, `CORS_ALLOWLIST`).
- Sab `graph.facebook.com/v21.0` literals refactor.
- `cron/dispatch-scheduled.php` `v22.0` → constant.
- 4 CORS-wale PHP files ek `cors.php` require karen.

## Batch 5 — Security & Sensitive Hardcoding

- `backend/config/jwt-secret.php` → `getenv('PHP_BACKEND_JWT_SECRET')` with commit-safe fallback removal. Secret Hostinger env pe set karo (SSH), file me sirf `getenv`.
- Firebase project id `wabees-app` — `getenv('FIREBASE_PROJECT_ID')` centralize (`firebase-config.php`).
- Verify token per-workspace: `whatsapp_config.verify_token` field. `webhook.php` incoming request pe token match per-user (fallback global for legacy).
- AI defaults (`AI_BOT_COOLDOWN_SECONDS`, `MAX_TOKENS`, `MAX_HISTORY`) → Firestore `settings/ai_defaults`, admin editable.

## Batch 6 — Content / Docs Cleanup

- `/download` PHP page: purane webhook URL, purane plan cards, purani tagline — sab refresh.
- `DeveloperApiSection.tsx` curl examples env-driven.
- Sample CSV / export filenames as-is (chalne do).
- Docs (`docs/RULES.md`, `PHASE3-SMOKE-TEST.md`) me purane URLs update.

---

## Execution Order (Recommendation)

1. **Batch 1** (fastest visible win, no schema change).
2. **Batch 4** (foundation — baaqi batches is pe depend karengi).
3. **Batch 2** (schema additive, safe).
4. **Batch 3** (needs Flutter side confirmation on doc path).
5. **Batch 5** (server SSH deploy needed, careful).
6. **Batch 6** (content polish).

---

## Technical Details (dev reference)

- Firestore rules: `settings/*` doc → read: public/authenticated, write: admin only. `plans/*` already so.
- Verify token per-user migration: `whatsapp_config` me nullable `verify_token`. Webhook.php pehle query params se uid → verify_token lookup, warna global VERIFY_TOKEN.
- Public landing Firestore REST: `https://firestore.googleapis.com/v1/projects/wabees-app/databases/(default)/documents/plans` — cached in PHP APCu 5 min.
- Placeholder rendering helper: simple `{key}` string replace (no template engine).

---

**Aap batao:**
1. Kya sequence theek hai ya kisi batch ko pehle chahiye?
2. Batch 3 ke liye Flutter app me exact Firestore doc path kya hai (agar already hai to woh use kar lete hain, warna naya `settings/subscription_messages` bana lete hain)?
3. Verify token per-user (Batch 5) chahiye ya global rakhna theek hai?
