## Option A — Production Handoff (auto karunga jahan possible)

### Step 1 — PHP backend: JWT verify in `api/send.php`

1. FTP se current `api/send.php` download karunga (RULES.md ki credentials use karke, `curl.exe -u ...` se).
2. Check karunga keh JWT verify pehle se hai ya nahi:
   - **Agar hai aur secret match karta hai** → skip, sirf `PHP_BACKEND_JWT_SECRET` ko Lovable secret me set kar dunga same value.
   - **Agar hai magar different shape** → web side ka JWT signing adjust karunga taa keh PHP wali expectation match ho (web code change, PHP touch nahi).
   - **Agar nahi hai** → top pe ~20-line snippet add karunga:
     - `Authorization: Bearer <token>` header read
     - HS256 verify with `PHP_BACKEND_JWT_SECRET` (env ya `config/jwt.php` me)
     - `exp` check (5 min window)
     - `uid` claim → request context me daalna
     - Fail → `401 {"error":"unauthorized"}` aur exit
   - Deploy via FTP: `curl.exe -T backend/api/send.php "ftp://.../api/send.php"`
3. `PHP_BACKEND_JWT_SECRET` (64 char) → `generate_secret` se Lovable Cloud me create + same value `config/jwt-secret.php` (gitignored) ya `.env` style file me FTP upload.
4. Web side `sendMessage` server fn me JWT sign karke header attach (already structured for this — verify only).

### Step 2 — Cloudflare Pages setup guide (tum karoge, main step-by-step screenshots-style instructions dunga)

Mere paas direct Cloudflare access nahi hai, tou guide doc bana dunga `docs/CLOUDFLARE-DEPLOY.md` me:

1. **Account banao** — cloudflare.com → Sign Up (free)
2. **GitHub connect** — Lovable ka GitHub integration enable karo (Plus menu → GitHub → Connect)
3. **Pages project create** — CF Dashboard → Workers & Pages → Create → Pages → Connect to Git → select repo
4. **Build settings:**
   - Framework: `None` (custom)
   - Build cmd: `bun run build`
   - Output dir: `dist`
   - Node version: `20`
5. **Env vars** (Production scope) — exact list dunga:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `TOKEN_ENC_KEY`, `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_GRAPH_VERSION`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_WEB_APP_ID`
   - `PHP_BACKEND_JWT_SECRET`
6. **Custom domain** — `app.wabees.live` (ya jo bhi prefer) → CF Pages → Custom Domains → Add → DNS CNAME guide
7. **Workers compat flags:** `nodejs_compat` enable (TanStack Start zaroorat)
8. **First deploy verify** — what to check on the live URL

### Step 3 — Smoke test checklist (tum run karoge)

Plain checklist `docs/PHASE3-SMOKE-TEST.md`:
- [ ] Auth: sign up + Google OAuth dono kaam karen
- [ ] Connect WhatsApp (Meta embedded signup) ✅ dikhe
- [ ] Web se text message bhejo → Flutter app me realtime aae (≤ 3 sec)
- [ ] Flutter se message bhejo → web inbox me realtime aae
- [ ] Contact CSV import 50 contacts → list me dikhen
- [ ] Template sync → Meta wali templates Firestore me aaen
- [ ] Campaign create (10 recipients) → run → logs subcollection populate ho, web UI me delivered/failed counts update hon
- [ ] Sign out + sign in → session restore ho, no 401 loop

---

## Execution order (jab approve karoge)

| # | Action | Tool |
|---|--------|------|
| 1 | `generate_secret PHP_BACKEND_JWT_SECRET` (64 char) | secrets |
| 2 | FTP fetch `api/send.php` current version | shell |
| 3 | Inspect → decide patch strategy | view |
| 4 | Local me `backend/api/send.php` likhna (JWT verify added) | apply_patch |
| 5 | FTP upload `api/send.php` + `config/jwt-secret.php` | shell |
| 6 | Web `sendMessage` me JWT signing pukka karna (already partially done — verify) | view/patch |
| 7 | Write `docs/CLOUDFLARE-DEPLOY.md` | add file |
| 8 | Write `docs/PHASE3-SMOKE-TEST.md` | add file |
| 9 | Build check (`bun run build`) | shell |

---

**Approve karo "Implement Plan" — phir build mode me yeh sab auto karunga. Ek hi cheez jo tum se chahye ho gi: Cloudflare account banane ke baad GitHub connect + env vars paste karna (Step 2 ka manual part). Baqi sab main handle kar lunga.**
