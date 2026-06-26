# WABEES — Project Rules & Reference Guide

> **Ye file har naye task ke saath as a reference de do. Isme saari instructions, deployment steps, aur rules hain.**

---

## 🔴 GOLDEN RULES (Kabhi Mat Todo)

1. **Working code ko KABHI kharab mat karo** — Jo code pehle se chal raha hai usko modify karne se pehle backup lo ya confirm karo.
2. **Sawal poochho, assume mat karo** — Agar koi cheez unclear hai to pehle USER se poochho, code likhne se pehle.
3. **Token waste mat karo** — Lambi research, bar bar same file padhna, ya unnecessary code generation se baccho. Focused kaam karo.
4. **Skills use karo** — Agar koi relevant skill available hai (debugger, powershell-windows, etc.) to usko use karo.
5. **Test checklist do** — Kaam complete hone ke baad USER ko testing checklist points de do.

---

## 📱 APP (Flutter/Android)

### Version Upgrade
- File: `pubspec.yaml` line 4
- Format: `version: X.Y.Z+buildNumber`
- Har deployment par version upgrade karo (minor ya patch)
- Example: `1.5.0+2013` → `1.5.1+2014`

### APK Build (Shrink/Compress)
```powershell
# Step 1: Build split APK (smallest size)
flutter build apk --release --split-per-abi

# Step 2: Copy arm64 APK (most common, modern phones) to download folder
Copy-Item "build\app\outputs\flutter-apk\app-arm64-v8a-release.apk" "backend\download\wabees.apk" -Force
```

### Shrink Settings (Already Configured)
- `build.gradle.kts` mein ye pehle se ON hai:
  - `isMinifyEnabled = true` (code shrink)
  - `isShrinkResources = true` (resource shrink)
  - ProGuard rules: `proguard-rules.pro`
- Flutter automatic font tree-shaking karta hai (~98% reduction)
- `--split-per-abi` flag se fat APK 64MB → ~25MB ho jati hai

### Build Errors
- **Crashlytics mapping upload fail:** Network issue — retry karo ya `--no-pub` flag use karo
- **Gradle download fail:** Network issue — Flutter auto-retry karega

---

## 🖥️ BACKEND (PHP / Hostinger)

### Server Info
- **Platform:** Hostinger Shared Hosting (PHP 8.x)
- **Domain:** wabees.live
- **API Subdomain:** api.wabees.live
- **Real Web Root:** `/home/u664356407/domains/wabees.live/public_html/`

### FTP Credentials
```
Hostname: ftp.wabees.live
Username: u664356407.ftppwabeeslive
Password: Ht@143*#$
```

### ⚠️ FTP ROOT = WEB ROOT
- FTP login seedha `public_html/` mein land karta hai
- **KABHI `public_html/` path FTP command mein mat likho** — warna nested folders ban jayenge!
- Sahi: `ftp://...@ftp.wabees.live/api/webhook.php`
- Ghalat: `ftp://...@ftp.wabees.live/public_html/api/webhook.php` ❌

### Deploy Commands (PowerShell)
```powershell
# Backend files deploy karo (seedha root par, koi extra folder nahi)
curl.exe -T backend/api/webhook.php "ftp://u664356407.ftppwabeeslive:Ht%40143%2A%23%24@ftp.wabees.live/api/webhook.php"

curl.exe -T backend/config/firebase-config.php "ftp://u664356407.ftppwabeeslive:Ht%40143%2A%23%24@ftp.wabees.live/config/firebase-config.php"

# APK deploy karo download folder mein
curl.exe -T backend/download/wabees.apk "ftp://u664356407.ftppwabeeslive:Ht%40143%2A%23%24@ftp.wabees.live/download/wabees.apk"
```

### PowerShell Pitfalls
- `&&` operator PowerShell mein KAAM NAHI KARTA — har command alag run karo
- Percent signs URL encode karo: `@` → `%40`, `*` → `%2A`, `#` → `%23`, `$` → `%24`

### Key Directories
```
/api/           → PHP API endpoints (webhook.php, send.php, etc.)
/config/        → Firebase config, service account
/cache/fs/      → File-based Firestore cache (TTL-based)
/download/      → Website + APK download page
/uploads/media/ → Incoming WhatsApp media cache
/logs/          → Webhook logs
```

### Important Files
| File | Purpose |
|------|---------|
| `api/webhook.php` | WhatsApp webhook handler (main file) |
| `config/firebase-config.php` | Firestore REST API + caching layer |
| `config/firebase-admin.php` | OAuth2 token management |
| `config/site-config.php` | Site URLs and public config |
| `download/wabees.apk` | Latest APK for download page |
| `download/index.php` | Download landing page |

---

## 🔥 ARCHITECTURE & OPTIMIZATIONS

### Webhook Lifecycle (Optimized Order)
1. Receive WhatsApp message
2. Parse & validate
3. **FCM notifications (parallel curl_multi)** — owner + agents ko instant alert
4. **Firestore commit** — message save karo
5. **Bot/AI processing** — background mein (user ko block nahi karta)

### Caching System
- **File-based cache:** `/cache/fs/` (disk-based, TTL-managed)
- `firestore_get_cached()` — single document cache
- `firestore_query_cached()` — query results cache
- Agents list: 10 min TTL
- Bot configs: 30 min TTL
- APCu not available on shared hosting

### APIs Used
- **Google Firestore REST API** — Database
- **FCM v1 API** — Push notifications
- **DeepSeek API** — AI bot responses
- **WhatsApp Business API (Meta)** — Messaging

---

## 🔒 SECURITY RULES (Har Code Change Mein Follow Karo)

### Input Validation & Sanitization
- **Har user input sanitize karo** — `htmlspecialchars()`, `strip_tags()`, `trim()` use karo
- **SQL/NoSQL injection se bachao** — Firestore REST API mein raw user input kabhi directly mat dalo
- **Phone numbers validate karo** — Format check (`+923xxxxxxxxx`) before processing
- **File upload validation** — MIME type check karo, executable files block karo (.php, .exe, .sh)
- **Message body length limit** — Bohot lambe messages truncate karo (DoS prevention)

### API & Endpoint Protection
- **Webhook verification** — Meta verify token check har request par hona chahiye
- **Rate limiting** — Same IP se zyada requests block karo (dedup lock already hai)
- **CORS headers** — Sirf allowed origins se requests accept karo
- **Error messages mein secrets mat dikhao** — Stack traces, DB paths, credentials kabhi response mein mat bhejo
- **API endpoints par authentication** — `verify-token.php` aur `_security.php` ko bypass mat hone do

### Credentials & Secrets
- **FTP credentials code mein hardcode mat karo** — Environment variables ya config files use karo
- **Service account JSON** ko public accessible mat banao (`.htaccess` se block karo)
- **Firebase access tokens** cache karo lekin logs mein mat print karo
- **WhatsApp access tokens** — Logs mein mask karo (`****` se replace karo)
- **Git mein secrets push mat karo** — `.gitignore` mein `service-account.json`, `key.properties` hona chahiye

### Firestore & Database
- **Firestore Rules** — `firestore.rules` file mein proper read/write permissions set karo
- **User data isolation** — Ek user doosre ka data access na kar sake
- **Agent permissions** — Agent sirf apne owner ka data dekh sake
- **Cache files** mein sensitive data (passwords, tokens) store mat karo

### XSS & Injection Prevention
- **WhatsApp messages mein HTML/JS inject ho sakta hai** — Display karte waqt escape karo
- **Contact names sanitize karo** — Unicode injection se bachao
- **Media filenames sanitize karo** — Path traversal attacks (`../../`) se bachao
- **Bot responses sanitize karo** — AI output mein malicious content ho sakta hai

### Server Hardening
- **Directory listing OFF** — `.htaccess` mein `Options -Indexes`
- **PHP errors production mein hide karo** — `display_errors = Off`
- **Config folder block karo** — Direct access se `.htaccess` se protect karo
- **Upload folder mein PHP execution band karo** — `php_flag engine off`
- **HTTPS enforce karo** — HTTP se HTTPS redirect hona chahiye
- **Temp/debug scripts server par mat chhodho** — Kaam hone ke baad delete karo

### Security Checklist (Har New Code Par)
- [ ] User input sanitized hai?
- [ ] API endpoints authenticated hain?
- [ ] Secrets/tokens logs mein print to nahi ho rahe?
- [ ] Error responses mein internal paths/credentials to nahi hain?
- [ ] File uploads validated hain (type, size, name)?
- [ ] New endpoints par rate limiting hai?
- [ ] Cross-user data access blocked hai?
- [ ] Debug/temp scripts server se delete kiye?

---

## ✅ TESTING CHECKLIST (Har Deployment Ke Baad)

### Backend Testing
- [ ] WhatsApp par message bhejo → app mein receive hua?
- [ ] App se message bhejo → WhatsApp par gaya?
- [ ] Photo/media send karo → dono taraf dikhti hai?
- [ ] Bot reply aa raha hai? (agar enabled hai)
- [ ] Agent ko notification aa raha hai?
- [ ] Owner ko notification aa raha hai?
- [ ] Response time 2-5 seconds ke andar hai?

### APK Testing
- [ ] Download page se APK download hoti hai?
- [ ] APK install hoti hai phone par?
- [ ] Login kaam karta hai?
- [ ] Version number sahi dikh raha hai? (Settings > About)
- [ ] Notifications kaam kar rahe hain?

### Server Health
- [ ] `https://api.wabees.live/` → `{"service":"Wabees API","status":"ok"}`
- [ ] `https://wabees.live/api/webhook.php` → verification response
- [ ] Koi 500 error to nahi aa raha?
- [ ] Logs mein koi error to nahi? (`/logs/` folder check karo)

---

## 🛠️ USEFUL SKILLS (Available)

| Skill | Kab Use Karo |
|-------|-------------|
| `debugger` | Errors ya bugs fix karte waqt |
| `powershell-windows` | Windows commands ke liye |
| `systematic-debugging` | Complex bugs investigate karte waqt |
| `firebase` | Firebase related kaam ke liye |
| `api-patterns` | API design decisions ke liye |
| `performance-profiling` | Speed optimization ke liye |
| `security` workflow | Security checklist follow karo new code par |

---

## 📋 WORKFLOW (Har Task Ke Liye)

### Before Coding
1. Task samjho — kya chahiye?
2. Agar unclear hai → **USER se poochho**
3. Existing code dekho — kya already hai?
4. Plan banao (agar complex task hai)

### During Coding
5. Working code ko touch mat karo (jab tak zaroorat na ho)
6. Focused changes karo — minimum files modify karo
7. Token waste mat karo — unnecessary research se baccho

### After Coding
8. **Deploy karo** Hostinger par (FTP commands use karo)
9. **Version upgrade** karo (agar APK build hai)
10. **APK shrink** karo (`--split-per-abi`)
11. **APK download folder** mein copy karo
12. **Testing checklist** USER ko do
13. Summary do — kya kiya, kya change hua

---

## ⚡ QUICK REFERENCE

### Verify Deployment
```powershell
# Server structure check (no extra folders?)
curl.exe "ftp://u664356407.ftppwabeeslive:Ht%40143%2A%23%24@ftp.wabees.live/"

# Webhook accessible?
curl.exe -s "https://wabees.live/api/webhook.php"

# API subdomain working?
curl.exe -s "https://api.wabees.live/"
```

### Emergency Rollback
- Hostinger File Manager se purani file restore karo
- Ya local `backend/` folder se purani version upload karo


### App version check
- Current version: 1.5.7
- `backend/download/version.txt` is file ko bhi latest version se update karna hai

---

# 🌐 WABEES WEB — TanStack Start (NEW)

> Yeh section purely **web app** (wabees.live) ke liye hai. Flutter app ke rules upar wale section me hain — un ko mat torho.
> **Har naye web task ke saath yeh file reference ke tor pe attach karo.** Phir koi rule miss nahi hoga.

## 🧱 STACK (locked — change na karo)

| Layer | Tech |
|-------|------|
| Framework | **TanStack Start v1** (React 19 + Vite 7, SSR on Cloudflare Worker) |
| Styling | **Tailwind v4** (CSS-first, `@theme` in `src/styles.css`) |
| Components | **shadcn/ui** (new-york, semantic tokens only) |
| State | **TanStack Query** + Firestore realtime (`onSnapshot`) |
| Auth/DB | **Firebase Web SDK** (same project as app) + **Lovable Cloud (Supabase)** for web-only secrets, rate-limit, audit |
| Icons | **Font Awesome** (`@fortawesome/react-fontawesome` + free-solid + free-brands). NEVER hand-draw an icon in JSX. |
| Forms | `react-hook-form` + `zod` (same schema client + server) |
| Animation | `motion/react` (subtle only — Meta/WhatsApp feel) |
| 3D | `three` (only for the hero bee — re-used from legacy /download page) |

## 🎨 DESIGN RULES (strict)

1. **3 colors only.** WhatsApp green (`--wb-green`), deep ink (`--wb-ink`), off-white paper (`--wb-paper`). Tints / opacity allowed, NEW hues are NOT.
2. **No hardcoded colors** in components. Always use semantic tokens: `bg-primary`, `text-foreground`, `border-border`, etc. Define new tokens in `src/styles.css` if needed.
3. **Font:** Inter Variable only (loaded via `@fontsource-variable/inter`). No Poppins, no purple gradients, no generic AI-slop look. Should feel hand-crafted, like Meta Business Suite / WhatsApp Web.
4. **Icons:** ALWAYS Font Awesome via `<FontAwesomeIcon icon={faX} />`. Never `<svg>` you wrote by hand, never emojis as functional icons.
5. **Spacing rhythm:** 4/6/8/12/16/24 only. Border-radius: `rounded-md` for buttons, `rounded-2xl` for cards.
6. **Responsive:** 360 → 4K. Mobile = hamburger nav + bottom-stacked sections. Desktop = 3-column inbox layout. Use `grid-cols-[minmax(0,1fr)_auto]` pattern (see responsive-layout-patterns).
7. **Dark mode:** WA Business dark palette already defined in `.dark`. Toggle is optional and NOT a priority.
8. **Animation:** subtle only — `hover:-translate-y-0.5`, `transition-colors`, message bubble pop-in. Zero on text. Respect `prefers-reduced-motion`.
9. **Empty states:** every list/table needs loading + error + empty (3-state UI mandatory). No generic stock images.

## 📁 FILE & CODE RULES

- **Files ≤ 200 lines.** Bara screen 3-4 chhote components me split karo (Section / Card / Row).
- **Reusable widgets:** `src/components/ui/*` (shadcn) aur project-specific `src/components/wb/*` (`WbCard`, `WbAvatar`, `WbEmpty`, `WbDialog`, `WbToast`). Inline duplicate UI mat banao.
- **One hook per feature:** `useConversations`, `useTemplates`, `useCampaigns`. Hooks me sirf data — UI components me JSX.
- **Server fn naming:** `getX`, `listX`, `createX`, `updateX`, `deleteX`. Place in `src/lib/<feature>.functions.ts` — NEVER under `src/server/` (blocked from client bundle).
- **Lazy-load** heavy routes (campaigns builder, analytics charts, WebRTC call screen).
- **Bundle hygiene:** tree-shake icons (import individually, not the barrel), dynamic-import `recharts`, no `moment.js` (use `date-fns`).
- **Zero ESLint warnings** policy. Strict TypeScript.
- **NEVER edit** `src/routeTree.gen.ts` (auto-generated).

## 🔌 META EMBEDDED SIGNUP FLOW (the big one)

App me user manually `phone_number_id` + `access_token` paste karta tha. Web me **embedded signup** use karo (jaise 360dialog/Wati/Twilio karte hain).

1. User clicks **"Connect WhatsApp Business"** (Facebook-blue button).
2. `FB.login()` popup with our `app_id` + `config_id` (Tech Provider config from Meta).
3. User selects Business + WABA + phone in Meta's popup → Meta provisions our System User.
4. Popup returns `{ code, phone_number_id, waba_id }` via `FB.Event.subscribe('xfbml.register')` callback.
5. Browser POSTs `code` to `/api/public/meta/exchange-token` (TanStack server route).
6. Server (with `META_APP_SECRET` from Lovable secrets) exchanges code → long-lived business token.
7. Server subscribes our app to WABA webhooks, registers phone, fetches business + catalog.
8. Token AES-256-GCM encrypted (`TOKEN_ENC_KEY`) → saved in Firestore `users/{uid}/whatsapp_config`.
9. UI shows ✅ Connected with phone + WABA + quality rating. **Zero manual paste.**

**Always keep a "Manual token" fallback** for users whose Meta App is still in review.

## 🔒 WEB SECURITY CHECKLIST (har endpoint pe enforce karo)

| # | Concern | Implementation |
|---|---------|----------------|
| 1 | **Authentication** | Every server fn → `requireFirebaseAuth` middleware (verifies ID-token signature + expiry server-side). |
| 2 | **Authorization** | Custom-claim role check (`admin`, `owner`, `agent`). NEVER trust a client-side flag. Agent → only own owner's data. |
| 3 | **JWT** | Short-lived (15min) access + httpOnly SameSite=Lax refresh cookie, HS256, secret in Lovable Cloud. |
| 4 | **Rate limit** | Per-IP + per-UID sliding window in Supabase `rate_limits` table. Login 5/min, OAuth 10/hr, send 60/min, generic 120/min. Return 429. |
| 5 | **Honeypot** | Hidden input `website` / `company_url` on every public form (auth, contact, signup). Filled → silent 200 + drop. |
| 6 | **Input validation** | Zod schema CLIENT + RE-PARSED SERVER. Never trust client. Length caps everywhere. |
| 7 | **XSS** | React auto-escapes. NEVER `dangerouslySetInnerHTML` on user content. Use `linkify-react` for URLs. |
| 8 | **CSRF** | SameSite=Lax cookies + `Origin` header check on every mutation. |
| 9 | **Secrets** | `META_APP_SECRET`, `DEEPSEEK_KEY`, `TOKEN_ENC_KEY`, Firebase service account → Lovable secrets. **Never** in client bundle, never in error messages, never in logs (mask with `****`). |
| 10 | **CORS** | Server fns same-origin only. Public webhooks → HMAC signature verify before doing anything. |
| 11 | **Error leakage** | All server errors through `safeError(err)` helper → generic message to client, full stack to server logs only. |
| 12 | **Firestore Rules** | User isolation, agent scoping, admin via custom claim. Mirror PHP backend's rules. |
| 13 | **File uploads** | MIME sniff + extension whitelist + max-size + filename = `crypto.randomUUID()`. NEVER user-supplied path (path traversal). |
| 14 | **Brute force** | Login 5 fails / 15min IP+email lockout. CAPTCHA after 3 fails. |
| 15 | **Token storage** | WA access tokens → AES-256-GCM before Firestore write. Key rotated quarterly. |
| 16 | **Headers** | CSP (no `unsafe-inline` in prod), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin`, `Permissions-Policy`. |
| 17 | **Audit log** | `audit_logs` collection: who, what, when, IP, UA — for: login, token rotate, agent add/remove, plan change, admin action. |
| 18 | **HTTPS** | Enforced by platform. Never link to `http://` resources (mixed content). |
| 19 | **Dependency** | Run `bun audit` weekly. Pin major versions in `package.json`. |
| 20 | **Auth pages** | `/auth/*` is PUBLIC. Protected app routes live under `src/routes/_authenticated/` (integration-managed pathless layout). |

### Forbidden patterns (PR will be rejected)
- `dangerouslySetInnerHTML` with anything not statically known
- Client-trusted role (`if (user.role === 'admin')` without server re-check)
- Hardcoded color (`text-white`, `bg-[#...]`)
- Hand-drawn `<svg>` icons
- `process.env.*` at module scope of a shared/client-imported file
- `supabaseAdmin` / `service_role` imported at top of a `*.functions.ts` file
- Public route loader calling a `requireSupabaseAuth` server fn (SSR will 401)
- Inline `<a href="/route/$id">` for dynamic routes — use `<Link to params={...}>`

## ⚡ WEB PERFORMANCE BUDGET

- LCP < 2.0s on 4G mid-tier mobile
- Initial JS ≤ 180KB gzip per route (excluding charts/three)
- Lighthouse Perf/Best-Practices/SEO/A11y all ≥ 95
- Images: always `loading="lazy"`, `width`/`height` set, served as WebP/AVIF where possible
- Query keys: `["feature", "scope", ...params]` — always array, never string
- Realtime: one Firestore `onSnapshot` per logical channel, cleaned in `useEffect` return
- Tree-shake FontAwesome icons (named imports only, never the barrel)

## 🚀 WEB DEPLOYMENT CHECKLIST (har publish se pehle)

- [ ] `bun run build` clean — no warnings
- [ ] Lighthouse on prod URL ≥ 95 across the board
- [ ] All forms have honeypot + zod validation + rate-limit attached
- [ ] No secret strings in client bundle (`rg "META_APP_SECRET\|service_role" dist/`)
- [ ] OG meta + favicon set on every route
- [ ] Sitemap.xml + robots.txt up-to-date
- [ ] Security scan: 0 unresolved critical findings
- [ ] Test sign-in, Meta connect, send message, broadcast on staging
- [ ] Confirm realtime works after auth state change (no `INITIAL_SESSION` loops)

## 🧭 WHEN ADDING A NEW PAGE (web)

1. Create `src/routes/<path>.tsx` with `createFileRoute` + `head()` (unique title/description/og).
2. If auth-required → put under `src/routes/_authenticated/`.
3. Pull data via server fn + TanStack Query — `ensureQueryData` in loader, `useSuspenseQuery` in component.
4. Split UI: page route ≤ 80 lines, delegate to feature components under `src/components/<feature>/`.
5. Add to sitemap.xml entries.
6. Add to nav (`SiteNav` for public, sidebar for authenticated).
7. Test: mobile 360, tablet 768, desktop 1280, dark mode.

---

## 🔗 SHARED BETWEEN APP + WEB

- **Firestore collections** stay identical — both clients read/write same docs.
- **PHP backend** (`api.wabees.live`) stays the source of truth for WhatsApp send/receive and webhooks. Web calls it via signed JWT.
- **Plan / subscription state** read by both — single source of truth in Firestore.
- **Push notifications** — web uses FCM Web SDK on top of the same project.
