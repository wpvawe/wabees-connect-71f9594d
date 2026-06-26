## Phase 2.5 — App ↔ Web Account & WhatsApp Sync

Goal: A user who already signed up in the Flutter app (Firebase Auth) and connected WhatsApp there must be able to sign in on the website with the **same email + password** and immediately see their WhatsApp connected — no second signup, no second Meta flow. And vice versa: signing up on web → signing in on the app works the same way. Firebase remains the source of truth for cross-platform identity and WhatsApp config (because Flutter is already live on it); Supabase is the web session/JWT layer.

### 1. Identity bridge (Firebase ↔ Supabase)

- Add `src/integrations/firebase/admin.server.ts` — server-only Firebase Admin SDK initialized from `FIREBASE_SERVICE_ACCOUNT_JSON`. Used to:
  - Look up a Firebase user by email
  - Verify a password by calling Identity Toolkit `signInWithPassword` REST (Admin SDK can't verify passwords directly)
  - Mint Firebase custom tokens for web→app handoff later
  - Read/write Firestore `users/{firebase_uid}/whatsapp_config`
- Add `src/integrations/firebase/client.ts` — Firebase Web SDK init for browser (project options pulled from Flutter `firebase_options.dart`). Used later for Firestore realtime in inbox.
- Required new secret: `FIREBASE_WEB_API_KEY` (public, also exposed as `VITE_FIREBASE_WEB_API_KEY` for client SDK). Used server-side for password verification REST call.

### 2. Unified sign-in flow

`src/lib/auth/unified-signin.functions.ts` — server fn `unifiedSignIn({ email, password })`:

```text
1. Try Supabase signInWithPassword
   └─ success → ensure profile.firebase_uid is set (look up in Firebase by email; link if missing); return { mode: 'supabase' }
   └─ "Invalid login credentials" → step 2
2. Look up Firebase user by email (Admin SDK)
   └─ not found → return original Supabase error
   └─ found → call Identity Toolkit signInWithPassword to verify password
       └─ fails → return generic invalid credentials (no enumeration)
       └─ succeeds → step 3
3. App-first user on web:
   - Create Supabase user (admin.createUser) with same email + a random password
   - Set profile.firebase_uid = firebase user uid, display_name from Firebase
   - Update Supabase user password to the one user just typed (so future logins go fast path)
   - Generate Supabase session (admin.generateLink + token) OR sign in normally with the new password
   - Return { mode: 'linked', session }
4. Audit log
```

Client `SignInForm` calls `unifiedSignIn` first, then on `{ mode: 'linked', session }` calls `supabase.auth.setSession(session)`. Honeypot + rate-limit (`auth:signin` 10/min) reused.

### 3. Unified sign-up flow

`unifiedSignUp({ email, password, display_name })`:
- If Firebase user already exists with that email → reject "Account already exists, please sign in"
- Else create Supabase user (normal flow) AND create Firebase user via Admin SDK with the same password → store firebase_uid on profile
- Result: a fresh web signup is immediately usable in the Flutter app too

### 4. WhatsApp config auto-fetch

`src/lib/meta/sync.functions.ts` — `syncWhatsAppFromFirebase()` server fn (auth-required):
- Read `profiles.firebase_uid`
- If no Supabase `whatsapp_config` row but Firestore `users/{uid}/whatsapp_config` exists → copy `phone_number_id`, `waba_id`, `display_phone`, `business_name`, `quality_rating`. Encrypt the access token with `TOKEN_ENC_KEY` if Firestore stores it plaintext (Flutter app currently does); if already encrypted with the same scheme, copy as-is. Set `method = 'app_synced'`.
- Reverse: in `exchangeMetaToken` and `manualConnect`, also write the same fields back to Firestore so the Flutter app sees a web-initiated connect instantly.

Trigger points:
- After successful `unifiedSignIn` (server-side, before returning) → silent sync
- On Connect screen mount → fallback sync + `useQuery(['whatsapp-config'])`

Result: app-first user lands on `/dashboard` with WhatsApp already showing as connected.

### 5. Schema additions

One small migration:
- Add `profiles.firebase_uid` UNIQUE index (column already exists)
- Add `whatsapp_config.source` text column (`'app' | 'web' | 'embedded_signup' | 'manual'`) — replaces overloaded `method`. Keep `method` for backwards compat for now.
- Add `whatsapp_config.synced_at` timestamptz

### 6. Security

- All Firebase Admin calls inside `.server.ts` files, loaded with `await import(...)` inside handlers (never module scope of `.functions.ts`).
- `FIREBASE_SERVICE_ACCOUNT_JSON` never reaches client bundle (verified).
- Password verification REST call uses generic error to prevent account enumeration.
- Rate-limit `auth:signin` 10/min/IP+email composite key.
- Audit log every linked sign-in with `{ source: 'firebase-link' }`.
- Reuse `safeError` everywhere.

### 7. Files (all ≤ 200 lines)

```text
src/integrations/firebase/client.ts                    (web SDK init)
src/integrations/firebase/admin.server.ts              (Admin SDK + REST password verify)
src/integrations/firebase/firestore-wa.server.ts       (read/write users/{uid}/whatsapp_config)
src/lib/auth/unified-signin.functions.ts
src/lib/auth/unified-signup.functions.ts
src/lib/auth/link-firebase.server.ts                   (helpers: linkOrCreateSupabaseUser)
src/lib/meta/sync.functions.ts                         (syncWhatsAppFromFirebase + writeWhatsAppToFirebase)
edit: src/components/auth/SignInForm.tsx               (call unifiedSignIn)
edit: src/components/auth/SignUpForm.tsx               (call unifiedSignUp)
edit: src/lib/meta/connect.functions.ts                (also write to Firestore)
edit: src/routes/_authenticated/connect.tsx           (auto-sync on mount)
edit: src/routes/_authenticated/dashboard.tsx         (call syncWhatsAppFromFirebase on first load)
migration: profiles.firebase_uid unique, whatsapp_config.source + synced_at
```

### 8. Required secret (only 1 new)

- `FIREBASE_WEB_API_KEY` — Firebase Web API key (also exposed as `VITE_FIREBASE_WEB_API_KEY`). Lifted from `firebase_options.dart` web config.

`FIREBASE_SERVICE_ACCOUNT_JSON` is already added. ✅

### 9. Acceptance checklist

- [ ] App-only user signs in on web with same email+password → lands in dashboard, WhatsApp shows connected, no Meta flow needed
- [ ] Web-only user signs into Flutter app with same credentials → works (Firebase user was created during web signup)
- [ ] Web user connects WhatsApp via Meta → Flutter app sees connection within seconds (Firestore write)
- [ ] App user connects WhatsApp in Flutter → web shows it on next dashboard load (Firestore read)
- [ ] Wrong password on either path → generic "Invalid email or password", no enumeration
- [ ] Honeypot + 429 still work
- [ ] No service account JSON or web API key with sensitive scope in client bundle
- [ ] `audit_logs` row per linked sign-in / per sync

### 10. After Phase 2.5 approval → Phase 3 (Inbox & Realtime)

Firestore realtime mirror of conversations, contacts list, campaigns table, templates browser. The identity + WA sync built here makes Phase 3 trivial because `firebase_uid` and connection are already wired.

**Need from you:** confirm I can add `FIREBASE_WEB_API_KEY` (I'll request it after you approve this plan). Ready to build?
