# Cloudflare Pages — WABEES Web Deploy Guide

Hosting: Cloudflare Pages (free tier; ~$5/mo at scale).
Domain idea: `app.wabees.live` (recommended), `api.wabees.live` PHP backend pe rahega.

---

## 1. Cloudflare account banao

1. https://dash.cloudflare.com/sign-up — email + password.
2. Email verify karo.
3. Dashboard pe pohanchne pe **"Workers & Pages"** sidebar me dikhe ga.

---

## 2. GitHub se code connect karo

Lovable project GitHub pe push karna zaroori hai:

1. Lovable editor → top-right **GitHub** icon (Plus menu ke andar bhi ho sakta hai) → **Connect to GitHub**.
2. Repo name choose karo (e.g. `wabees-web`).
3. Lovable auto-push start kar dega — har preview update GitHub pe sync hoga.

---

## 3. Cloudflare Pages project banao

1. CF Dashboard → **Workers & Pages** → **Create application** → **Pages** tab → **Connect to Git**.
2. GitHub authorize karo → repo (`wabees-web`) select karo → **Begin setup**.
3. **Build settings:**
   - Project name: `wabees-web`
   - Production branch: `main`
   - Framework preset: **None** (custom)
   - Build command: `bun run build`
   - Build output directory: `dist`
   - Root directory: (blank)
   - Environment variables → **Add variable** → name: `NODE_VERSION`, value: `20`

---

## 4. Runtime environment variables (Production scope)

CF Dashboard → Pages → `wabees-web` → **Settings** → **Environment variables** → **Production** → ek-ek karke add karo. Values Lovable Cloud → Backend → Secrets se copy karo:

| Variable | Source |
|---|---|
| `VITE_SUPABASE_URL` | Lovable `.env` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Lovable `.env` |
| `VITE_SUPABASE_PROJECT_ID` | Lovable `.env` |
| `SUPABASE_URL` | same as VITE version |
| `SUPABASE_PUBLISHABLE_KEY` | same as VITE version |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable Cloud → Backend (auto-injected; ask support if missing) |
| `TOKEN_ENC_KEY` | Lovable Cloud secrets |
| `META_APP_ID` | Lovable Cloud secrets |
| `META_APP_SECRET` | Lovable Cloud secrets |
| `META_CONFIG_ID` | Lovable Cloud secrets |
| `META_GRAPH_VERSION` | Lovable Cloud secrets (e.g. `v21.0`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Lovable Cloud secrets (paste full JSON as one line) |
| `FIREBASE_WEB_API_KEY` | Lovable Cloud secrets |
| `FIREBASE_AUTH_DOMAIN` | Lovable Cloud secrets |
| `FIREBASE_WEB_APP_ID` | Lovable Cloud secrets |
| `PHP_BACKEND_JWT_SECRET` | Lovable Cloud secrets |

**Important:** har var ko **"Encrypt"** ke option ke saath save karo (default).

---

## 5. Workers Compatibility flags

TanStack Start ko Node APIs chahiyen:

1. Settings → **Functions** → **Compatibility flags**.
2. Production aur Preview dono me add karo: `nodejs_compat`
3. Compatibility date: latest (e.g. `2025-01-01`).

---

## 6. First deploy

1. Settings → **Deployments** → **Retry deployment** (ya GitHub pe naya commit push karo).
2. Build log dekho — 2-4 min lege ga.
3. Success pe `https://wabees-web.pages.dev` live ho jae ga. Open karo → home page render hona chahiye.

---

## 7. Custom domain — `app.wabees.live`

1. CF Dashboard → Pages → `wabees-web` → **Custom domains** → **Set up a custom domain**.
2. Domain: `app.wabees.live` → **Continue** → **Activate domain**.
3. **DNS setup** (jahan bhi `wabees.live` registered hai — agar Hostinger DNS hai):
   - Type: `CNAME`
   - Name: `app`
   - Value: `wabees-web.pages.dev`
   - Proxy/TTL: default
4. Wait 5-30 min DNS propagation. SSL automatic provision ho jae ga.

---

## 8. Post-deploy verify

- [ ] `https://app.wabees.live` open hota hai
- [ ] `/auth` page render hota hai aur Google sign-in kaam karta hai
- [ ] Sign in karne ke baad `/inbox` accessible
- [ ] Browser DevTools → Network: koi 500 error nahi
- [ ] Browser DevTools → Console: koi `Failed to fetch` ya CORS error nahi

Agar koi env var miss ho gaya → CF Pages → Deployments → latest → Function logs check karo.

---

## Hidden gotchas

- **`FIREBASE_SERVICE_ACCOUNT_JSON`** ko CF me paste karte waqt newlines escape ho sakte hain. Verify karo: CF logs me agar `JSON.parse error` aae to value re-paste karo as single line (no actual newlines, `\n` literal allowed).
- **Cron / Scheduled functions** Cloudflare Pages me directly nahi chalte — Workers Cron Triggers alag se setup karne hote hain (Phase 4 jab campaigns scheduling chahiye).
- **Logs** CF Pages → Functions tab me real-time stream milte hain (last 15 min retention free tier pe).