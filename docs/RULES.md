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
