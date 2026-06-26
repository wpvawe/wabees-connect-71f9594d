## Phase 2 — Authentication, Firebase wiring & Meta Embedded Signup

Goal: User can sign up / log in, land in an authenticated app shell, and connect their WhatsApp Business Account through Meta's Embedded Signup (no manual token paste). All security rules from `docs/RULES.md` (rate-limit, honeypot, zod, JWT, audit log) enforced from day one.

### 1. Backend foundation

- Enable **Lovable Cloud** (Supabase under the hood). Used for: session/JWT, `rate_limits` table, `audit_logs` table, encrypted secrets cache. Firestore stays the source of truth for app data (shared with Flutter app).
- Tables (migration, with GRANTs + RLS):
  - `profiles` (id → auth.users, display_name, avatar_url, firebase_uid, created_at)
  - `user_roles` (separate table + `app_role` enum: `admin|owner|agent` + `has_role()` security-definer fn)
  - `rate_limits` (key, window_start, count) — sliding-window helper
  - `audit_logs` (user_id, action, ip, ua, meta jsonb, created_at)
- Secrets to add: `META_APP_ID` (public-ish, also `VITE_META_APP_ID`), `META_APP_SECRET`, `META_CONFIG_ID`, `META_GRAPH_VERSION` (v21.0), `TOKEN_ENC_KEY` (generated 64-char), `FIREBASE_SERVICE_ACCOUNT_JSON` (for server-side Firestore writes from TanStack server fns).

### 2. Firebase Web SDK (client)

- Install `firebase` (web v10).
- `src/integrations/firebase/client.ts` — initialize with the same project options from the Flutter `firebase_options.dart` (web config). Export `auth`, `db` (Firestore), `messaging` lazy.
- `src/integrations/firebase/auth-bridge.ts` — on Supabase sign-in, mint a Firebase custom token via server fn → `signInWithCustomToken`. Keeps both auth systems in sync so Firestore rules see the same UID Flutter uses.

### 3. Auth surface

- Public routes (top-level, NOT under `_authenticated/`):
  - `/auth` — tabs: Sign in / Sign up. Email+password, Google. Honeypot field `company_url`. Zod schema (email, password ≥ 8, name 2–60). Rate-limit via server fn.
  - `/auth/forgot` + `/auth/reset-password` (mandatory pair).
- Protected shell under `src/routes/_authenticated/` (integration-managed gate):
  - `_authenticated/route.tsx` (already provided by Lovable Cloud integration) — redirects to `/auth`.
  - `_authenticated/app.tsx` — 3-column shell: `SideRail` (icons), `SecondaryPane` (changes per section), `MainPane` (Outlet). Mobile = bottom tab bar.
  - `_authenticated/dashboard.tsx` — landing after login (KPIs placeholder).
  - `_authenticated/connect.tsx` — WhatsApp connect screen (the Embedded Signup flow).
  - `_authenticated/settings.tsx` — profile / sign out.

### 4. Meta Embedded Signup

- `src/components/connect/FacebookSdkLoader.tsx` — loads `connect.facebook.net/en_US/sdk.js` once, calls `FB.init({ appId, version, xfbml: false })`.
- `src/components/connect/MetaConnectButton.tsx` — Facebook-blue button: calls `FB.login(cb, { config_id, response_type: 'code', override_default_response_type: true, extras: { setup: { } } })`. Listens to `FB.Event.subscribe('xfbml.register')` for `{ phone_number_id, waba_id }` via `message` event from `*.facebook.com`.
- Server route `src/routes/api/public/meta/exchange-token.ts` (HMAC-signed body from client + bearer from `requireSupabaseAuth` middleware on a sibling server fn — we'll actually use `createServerFn` with auth middleware instead of a public route to keep it simple):
  - Accept `{ code, phone_number_id, waba_id }`.
  - Exchange code → long-lived business token (`GET /v21.0/oauth/access_token?...`).
  - Subscribe app to WABA webhooks (`POST /{waba-id}/subscribed_apps`).
  - Register phone (`POST /{phone-number-id}/register` with PIN).
  - AES-256-GCM encrypt token with `TOKEN_ENC_KEY` → write to Firestore `users/{firebase_uid}/whatsapp_config` via Admin SDK in a `.server.ts` helper.
  - Insert `audit_logs` row.
- Manual-token fallback section (collapsed by default) for users whose Meta App is still in review — same as Flutter.
- Connected state card: shows phone display number, quality rating, WABA name, "Disconnect" + "Rotate token" actions.

### 5. Security & infra primitives (reusable)

- `src/lib/security/rate-limit.functions.ts` — `assertRateLimit(key, max, windowSec)` server fn used by auth + meta endpoints.
- `src/lib/security/honeypot.ts` — `HoneypotField` component + `assertHoneypot(formData)` helper.
- `src/lib/security/audit.server.ts` — `logAudit({ userId, action, meta })`.
- `src/lib/security/crypto.server.ts` — AES-256-GCM encrypt/decrypt with `TOKEN_ENC_KEY`.
- `src/lib/security/safe-error.ts` — strips stack/paths from client-facing errors.
- Zod schemas in `src/lib/schemas/` reused client+server.

### 6. UI patterns

- `src/components/wb/` reusable widgets: `WbButton` (variants: primary/ghost/danger), `WbCard`, `WbInput` (label+error+honeypot-aware), `WbEmpty`, `WbDialog`, `WbToast`, `WbAvatar`.
- All icons via Font Awesome (already installed). 3-color palette unchanged.
- Loading/empty/error 3-state UI on every list.

### 7. Landing page update

- Wire `SiteNav` "Sign in" + Hero CTAs → `/auth`.
- Already-authenticated users hitting `/auth` → redirect to `/_authenticated/dashboard`.

### 8. Files (≤ 200 lines each)

```text
src/integrations/firebase/{client.ts, auth-bridge.ts, admin.server.ts}
src/lib/security/{rate-limit.functions.ts, honeypot.ts, audit.server.ts, crypto.server.ts, safe-error.ts}
src/lib/auth/{sign-in.functions.ts, sign-up.functions.ts, mint-firebase-token.functions.ts}
src/lib/meta/{exchange-token.functions.ts, disconnect.functions.ts}
src/lib/schemas/{auth.ts, meta.ts}
src/components/wb/{WbButton, WbCard, WbInput, WbEmpty, WbDialog, WbAvatar}.tsx
src/components/auth/{SignInForm, SignUpForm, ForgotForm, ResetForm, AuthLayout}.tsx
src/components/connect/{FacebookSdkLoader, MetaConnectButton, ConnectedCard, ManualTokenFallback}.tsx
src/components/shell/{SideRail, SecondaryPane, MobileTabBar, TopBar}.tsx
src/routes/auth.tsx, src/routes/auth.forgot.tsx, src/routes/auth.reset-password.tsx
src/routes/_authenticated/app.tsx (layout w/ Outlet)
src/routes/_authenticated/dashboard.tsx
src/routes/_authenticated/connect.tsx
src/routes/_authenticated/settings.tsx
supabase migration: profiles, user_roles + enum + has_role(), rate_limits, audit_logs (with GRANTs + RLS)
```

### 9. Secrets I'll need from you (after enabling Cloud)

1. `META_APP_ID` — your Meta App ID
2. `META_APP_SECRET` — Meta App Secret
3. `META_CONFIG_ID` — Tech Provider Embedded Signup config_id
4. Firebase Web config (apiKey/authDomain/projectId/appId/messagingSenderId) — I'll lift from `firebase_options.dart` automatically
5. `FIREBASE_SERVICE_ACCOUNT_JSON` — for server-side Firestore writes (same one PHP backend uses)

`TOKEN_ENC_KEY` I'll auto-generate.

### 10. Acceptance / test checklist for Phase 2

- [ ] `/auth` sign-up creates Supabase user + profile + default `owner` role + Firebase custom token sign-in
- [ ] Honeypot trip → silent 200, no account created
- [ ] 6th failed login within 1 min → 429
- [ ] Reset-password flow end-to-end
- [ ] `/auth` while signed-in → redirect to `/dashboard`
- [ ] `/dashboard` while signed-out → redirect to `/auth`
- [ ] Meta Connect button opens FB popup; on success, `users/{uid}/whatsapp_config` doc appears with encrypted token, phone + WABA shown in UI
- [ ] Manual-token fallback still works
- [ ] `audit_logs` row for each login + connect
- [ ] No secrets in client bundle (`rg META_APP_SECRET dist/` = 0 hits)
- [ ] Lighthouse on `/auth` ≥ 95 across the board

### After Phase 2 approval, I'll need from you:

- Confirmation to enable Lovable Cloud
- The 3 Meta secrets + Firebase service account JSON (I'll request via secure form, not chat)

Ready to proceed?
