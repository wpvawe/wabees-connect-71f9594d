# Wabees Website — Full Fix Plan

Aap ne 13 major issues batae (aur 30+ aur expected). Itna kaam aik turn me carefully nahin ho sakta — quality bachane ke liye **4 batches** me karunga. Har batch ke baad aap test karke confirm karenge, phir agla batch.

Pehle clarifications zaroori hain (taake working code touch na ho):

## Clarifying questions

1. **Audio call (point 3):** WhatsApp Cloud API browser se direct voice/audio calling **support nahin karti** — sirf WhatsApp Business Calling API hai jo abhi limited beta me hai aur PHP backend se chahiye. Iska matlab:
   - (a) Skip audio call (sirf voice message + reactions + delete karun), ya
   - (b) Calling API ka placeholder UI banadun jo "Coming soon" dikhae?

2. **AI bots deploy (point 7):** Aap ne kaha "code ftp se deploy kar dena server pe". Mera sandbox **FTP egress se Hostinger pe push nahin kar sakta** reliably credentials ke saath (aur RULES.md says secrets hardcode na karo). Ya to:
   - (a) Main PHP code ready karke aap ko file dedun, aap khud FTP karein, ya
   - (b) Sirf website-side AI bot UI/logic fix karun, PHP backend aap khud handle karein?

3. **Settings page "Load from WhatsApp" HTTP 400:** Ye PHP backend ka response hai (`api.wabees.live/api/...`). Bug PHP me hai ya website me — pehle network request inspect karke confirm karunga. Theek?

## Batch breakdown

### Batch 1 — Dashboard + Settings + Connect (points 1, 10, 13)
- Dashboard ko premium redesign: latest contacts/messages/bots/agents sections (empty hide), plan card pe Upgrade button, contacts fix.
- Settings: business name field, profile image upload/show, data fetch fix, "Load from WhatsApp" 400 debug.
- Connect WhatsApp page UX polish.

### Batch 2 — Inbox/Chat premium (point 3)
- Message bubble premium redesign.
- Reactions (emoji picker, long-press/hover).
- Voice message recording + playback.
- Delete message (for me / for everyone, WhatsApp 1-day rule).
- Reply / forward / copy actions.
- Audio call — pending Q1 answer.

### Batch 3 — Campaigns + Templates + Bots + AI Bot (points 5, 6, 7, 8)
- New campaign create flow fix (missing pages/UI).
- Bot delete option.
- Templates: create new, delete, send-in-message.
- AI bots: working logic fix (pending Q2 for PHP side).

### Batch 4 — Analytics + Contacts I/E + Plans + Links + Support (points 2, 4, 9, 11, 12)
- Analytics HTTP 400 fix + real data.
- Contacts import/export verify.
- Plans message count fix.
- Message links permission fix (Firestore rules issue likely).
- Support page polish + image attachment.

## Estimated turns: 4–6 (one per batch, plus polish)

## Confirm karein:
- Q1, Q2, Q3 ka jawab dein.
- Batch order theek hai ya koi batch pehle chahiye?
- Aap ne kaha "30+ issues find karke fix karne hen" — baqi issues bhi mention karein ya main har batch me audit karke nikalun?
