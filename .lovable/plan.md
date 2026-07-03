## Findings (kya galat mila)

Live server `/domains/wabees.live/public_html/index.php` scan karne pe:


| #   | Issue                                                                                                                                                                                                                                                                          | Location                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1   | **Live stats khali** (screenshot) — 6 tiles `id="s-msgs"` etc. me `—` show ho raha hai. JS `public-stats.php` fetch karta hai lekin **wo file server pe exist hi nahi karti** (Hostinger 404 return kar raha): pehle code sahi tha file exist karti hogi tum dobara check karo | `index.php:1140-1170` + missing `api/public-stats.php` |
| 2   | **WhatsApp FAB** right-bottom pe                                                                                                                                                                                                                                               | `index.php:1569-1571`                                  |
| 3   | **"Start 7-Day Trial"** button                                                                                                                                                                                                                                                 | `index.php:1400`                                       |
| 4   | **Wrong WA number** `+923001234567` in Contact Sales & FAB                                                                                                                                                                                                                     | `index.php:1416, 1570`                                 |
| 5   | **DeepSeek leaked** — "DeepSeek-powered AI" label + "Calling DeepSeek API" log line                                                                                                                                                                                            | `index.php:1273, 1327`                                 |
| 6   | **Dark-only color scheme** — user chahta light/softer                                                                                                                                                                                                                          | root CSS vars + `hero-bg` classes                      |
| 7   | `/download/index.php` bhi same dark scheme                                                                                                                                                                                                                                     | `download/index.php`                                   |
| 8   | **Plans hardcoded** in landing page, Firestore me offer/pricing edits reflect nahi hote                                                                                                                                                                                        | `index.php:1360-1430`                                  |


## Answers to your questions

**Q: Offer object plans/{id} me main save karun ya admin?**
Admin karega — plans admin panel me already `usePlans` hook + Firestore write UI hai (Batch 2 me `Plan` type me `offer` field add kiya hai). Admin bas Firestore doc me `offer: {active,label,discountPct,priceOverride,endsAt}` set karega, dono jagah (website + app) turant reflect ho jayega. Main koi hardcoded offer save nahi karunga.

**Q: Public landing pe live plans grid + Firestore fetch + PHP cache?**
Haan, is batch me kar raha hun.

## Plan — Batch 2b (landing page + dynamic plans)

### Step 1 — New PHP endpoints (server-side, cached)

Create in `wabees-plus` repo → deploy to Hostinger:

- `**api/public-stats.php**` — aggregates counts from Firestore (`users` count, `contacts` collectionGroup, `messages` count from `stats/global` doc if exists, active bots from `bot_configs`). File cache 5-min TTL via existing `firestore_query_cached()`. Response shape: `{"msgs":N,"users":N,"agents":N,"contacts":N,"bots":N,"convs":N}`.
- `**api/public-plans.php**` — fetches `plans/*` where `showOnPublic == true`, returns normalized JSON with resolved pricing (using same `resolvePricing` logic ported to PHP). Cache 2-min TTL. Fixes the "hardcoded plans" issue — admin ke Firestore edits turant landing pe aayenge.: /api kion laga rahay ho? url sahi karo.. [api.wabees.live](http://api.wabees.live) se test karo

### Step 2 — Rewrite plans section in `index.php`

Replace hardcoded 3-card grid (~lines 1360-1430) with a server-render loop over `public-plans.php` output. Har card:

- Name, price (with strikethrough + discount% if offer active)
- "🔥 {offer.label}" badge
- Countdown "Ends in X days" agar `endsAt` set hai
- Features list from Firestore
- CTA button (link to `$webPortal`)

Empty state agar Firestore me plans nahi → show "Coming soon".

### Step 3 — Landing page fixes


| Fix                  | Change                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp FAB         | **Delete** lines 1569-1573 + `.wa-fab` CSS                                                                                                                    |
| 7-Day Trial          | Change to "Start Free" / "Get Started"                                                                                                                        |
| Wrong WA number      | Read from `config/site-config.php` (`$supportWhatsApp`). Aap ko sahi number bhejna hoga — filhal placeholder rakhunga `+92XXX` aur config me note likh dunga. |
| DeepSeek leak        | "DeepSeek-powered AI" → "Advanced AI Automation". Log line "Calling DeepSeek API" → "Processing with AI engine". "4 msgs context" → "conversation context".   |
| Color scheme (light) | CSS vars update: `--bg: #f7f9fb`, `--surface: #ffffff`, `--ink: #0f172a`, keep WA green accent. Test on `/` and `/download/`. Dark toggle preserve.           |


### Step 4 — Deploy

1. Git push to `wpvawe/wabees-plus` (backend/ + landing PHP updates).
2. SSH deploy to Hostinger: `api/public-stats.php`, `api/public-plans.php`, `index.php`, `download/index.php`.
3. Test:
  - `curl https://wabees.live/api/public-stats.php` → JSON with counts
  - `curl https://wabees.live/api/public-plans.php` → JSON array
  - Visit `wabees.live` → stats numbers dikhen, plans Firestore se aayen, no FAB, no DeepSeek mention, light theme:

## Batch 3 — deferred (as you asked)

Dynamic subscription/payment messages — main abhi shuru **nahi** karunga. Pehle Flutter app ka code deeply padhunga (`wpvawe/wabees-plus` → `lib/` me subscription flow, Firestore paths jaisa `subscription_messages` ya jo bhi actual name hai), phir aap ko exact paths + current structure bata ke plan dunga. Assumption nahi karunga.

## Requests from you before I start

1. **Correct WhatsApp support number** kya hai? (contact sales + agar chahye to koi CTA link ke liye)
2. Light theme confirm — pure white background chahye ya soft grey (`#f7f9fb`)?