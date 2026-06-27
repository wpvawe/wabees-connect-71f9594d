# Phase 3 — Smoke Test Checklist

Web ↔ Flutter ↔ PHP backend ka end-to-end sync test. Production deploy ke baad ya local preview pe run karo.

## Auth

- [ ] `/auth` → Email signup naya account banata hai
- [ ] `/auth` → Google OAuth sign-in kaam karta hai
- [ ] Sign-in ke baad `/inbox` auto-redirect hota hai
- [ ] Refresh karne pe session restore hota hai (no kick to `/auth`)

## WhatsApp Connect

- [ ] `/connect` (ya settings) → Meta embedded signup popup khulta hai
- [ ] Connect ke baad `whatsapp_config` row Supabase me ban jati hai (encrypted token)
- [ ] `profiles.firebase_uid` populate hota hai (Phase 3 custom token flow)

## Inbox — Web → Flutter

- [ ] `/inbox` me ConversationList load hoti hai (Firestore se realtime)
- [ ] Ek conversation open karo → composer dikhe
- [ ] Test message bhejo (apne hi WhatsApp pe)
- [ ] **≤ 3 sec me** message Flutter app me dikhe (`sentVia: web` flag ke saath)
- [ ] Web UI me message bubble instantly outgoing/sent status pe dikhe

## Inbox — Flutter → Web

- [ ] Flutter app se reply bhejo
- [ ] Web inbox me realtime aae (no manual refresh, ≤ 3 sec)
- [ ] Conversation list ka `lastMessage` + timestamp update ho

## Contacts

- [ ] `/contacts` page load
- [ ] CSV import: 10-50 row CSV upload → list me dikhen, count match kare
- [ ] Search filter kaam kare
- [ ] CSV export click → file download ho with same data

## Templates

- [ ] `/templates` page load
- [ ] **Sync from Meta** button click → Meta wali approved templates Firestore me aaen
- [ ] Templates grid me name + status + language dikhe

## Campaigns

- [ ] `/campaigns/new` → form fill karo (name, template, tag-based recipients)
- [ ] Create karne pe `/campaigns` list me draft dikhe
- [ ] `/campaigns/$id` → **Start** click → status `running` ho
- [ ] `campaign_logs` subcollection populate ho (per recipient)
- [ ] Sent / delivered / failed counts UI me update hon (realtime)
- [ ] Rate ~5/sec dikhe (10 recipients ≈ 2 sec total)

## Sign-out / Session

- [ ] Sign out → `/auth` pe redirect
- [ ] Sign in karne pe `/inbox` me wahi data wapas
- [ ] No 401 loop, no stale Firestore listeners (DevTools → Network → WS connections clean)

## PHP Backend (api.wabees.live)

- [ ] `curl https://api.wabees.live/` → `{"service":"Wabees API","status":"ok"}`
- [ ] X-Api-Key wali send call (Flutter app) abhi bhi kaam kare (backwards compat)
- [ ] JWT path: future test (web abhi direct Meta call karta hai)

## Known limitations (Phase 4)

- Bots / AI auto-reply
- Analytics dashboard
- Scheduled campaigns (cron)
- FCM web push notifications
- Admin panel