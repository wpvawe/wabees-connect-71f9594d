# Comprehensive Improvements Plan

Pehle se working code ko bilkul touch nahi karoon ga — sirf jo specific cheezein aap ne batayee hain.

## 1. Settings Page — 2 columns + auto-fetch

**File:** `src/routes/_authenticated/settings.tsx`, `src/components/settings/BusinessProfileSection.tsx`

- Layout: `max-w-5xl` + `lg:grid-cols-2` — left column "Account Profile" + Session, right column "WhatsApp Business Profile" + connection summary.
- WhatsApp Business Profile section:
  - **Auto-fetch on mount** — jab WhatsApp connected ho aur `phone_number_id` mile, automatically `business-profile.php` se data load ho (no button click needed). "Reload" button optional rakhen ge.
  - **Profile picture preview** — backend already `profile_picture_url` return karta hai; ab UI me round avatar ke saath show karen ge.
  - **Business name fetch** — `wa.business_name` (Firestore) already aata hai, usay clearly display karen ge top par avatar + name + display phone ke saath.
  - **Save fix** — current save sirf jo fields user ne change ki hain bhejta hai. Verify karen ge ke server kis field ko reject kar raha hai aur empty strings ko correctly handle karen ge (Meta Graph empty string ko skip karna chahta hai).

## 2. Left Sidebar — expandable + layout fix

**Files:** `src/components/shell/SideRail.tsx`, `src/routes/_authenticated/route.tsx`

- Add toggle button (hamburger/chevron) at top — collapsed `w-[72px]` (icons only) ↔ expanded `w-[220px]` (icon + label).
- State persist in `localStorage` (`wb_sidebar_collapsed`).
- Hover state, active highlight retain karen ge.
- **Layout space fix:** screenshot me dikha raha hai page content ke neeche bohot white space hai. Main reason: `<main className="... pb-14 md:pb-0">` + child pages me apna `min-h-screen` nahi. Fix: `<main>` ko `min-h-screen` aur child pages me unnecessary fixed height hatayen ge. Plus support page (jisme aapne screenshot bheja) ka inner scroll container check karen ge.

## 3. Firebase Cloud Messaging (FCM) — Bell notifications

**New files:**
- `public/firebase-messaging-sw.js` — service worker for background push
- `src/lib/firebase/fcm.ts` — request permission, get token, save under `users/{uid}/fcm_tokens/{token}`, foreground `onMessage` → `toast` + browser notification
- `src/hooks/useFcm.ts` — hook to wire up on mount

**Wire-up:** `route.tsx` me FCM init call. Bell icon (TopBar) me unread count + sound on new message. VAPID key user ke Firebase project (`wabees-app`) se aati hai — agar already configured nahi to user ko VAPID key add karne ka kahna paray ga (Firebase Console → Cloud Messaging → Web Push certificates).

Backend (`webhook.php`) ko FCM messages send karne ke liye Firebase Admin SDK chahye — wo already server pe hai. Lekin webhook ko FCM trigger karne ka code add karna server-side change hoga — abhi sirf client-side foreground notifications + browser permission flow add karen ge. Background push tab kaam karega jab backend webhook me FCM send call add ho jaye.

**Scope clarification needed:** Background FCM (jab tab band ho) ke liye backend webhook me code add karna paray ga jo `users/{uid}/fcm_tokens` se token le ke send karay. Yeh repo me karoon ya server pe alag se add karen ge?

## 4. Message Links — "Missing or insufficient permissions" fix

**File:** `src/routes/_authenticated/message-links.tsx`

Firestore rules (Flutter app/server) likely require a `userId` field matching `auth.uid` on the document. Currently doc me sirf `{message, url, createdAt}` save hota hai.

**Fix:** addDoc payload me `userId: uid` field add karen ge — yeh standard pattern hai jo aap ke baqi collections (contacts, campaigns) me bhi use hota hoga.

## 5. Plans Page — contacts count

**File:** `src/routes/_authenticated/plans.tsx`

Currently `usage.contacts = sub.contactsUsed || profile.totalContacts || 0` — agar dono 0 hen to live contacts count nahi dikhta. 

**Fix:** `useContacts()` hook se actual length le ke fallback me use karen ge: `sub.contactsUsed || profile.totalContacts || contacts?.length || 0`. Messages ke liye `useMessages` heavy hai is liye usay touch nahi karoon ga.

## Technical notes

- All edits keep existing working code intact — no refactors outside requested areas.
- FCM requires VAPID key. If absent in env, code degrades gracefully (no toast spam).
- Sidebar toggle uses CSS transitions + Tailwind responsive classes; mobile tab bar unchanged.

## Question for you

FCM background push (closed tab) ke liye `backend/api/webhook.php` me FCM send code add karna chahyay? Ya pehle client-side (open tab) notifications + permission flow add karoon, phir backend ka batayen ge?
