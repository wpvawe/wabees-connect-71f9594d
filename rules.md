# Wabees dev-server operator notes

Ye file agent (Lovable) ke liye hai — bar bar bhoolne wali cheezon ki jagah.

## Firebase CLI

- Package ka naam **`firebase-tools`** hai, `firebase` nahi.
  Sandbox mein globally install nahi hai — hamesha `bunx firebase-tools ...` chalao.
  ```bash
  bunx firebase-tools --version   # → 15.x
  ```

## Firestore rules deploy

`bunx firebase-tools deploy --only firestore:rules` **fail hota hai** —
service account ke pass `serviceusage.services.get` permission nahi hai
(HTTP 403 on `firestore.googleapis.com` API-enable check).

**Workaround: Firebase Rules REST API directly use karo.** Service account
credentials `$FIREBASE_SERVICE_ACCOUNT_JSON` mein already available hain.
Ye snippet chalao (jab bhi `firebase/firestore.rules` change ho):

```bash
python3 <<'PY'
import json, os, time, base64, urllib.request, urllib.parse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
project = sa["project_id"]
now = int(time.time())
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b"=")
header = b64u(json.dumps({"alg":"RS256","typ":"JWT"},separators=(",",":")).encode())
claim  = b64u(json.dumps({
  "iss": sa["client_email"],
  "scope": "https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform",
  "aud": "https://oauth2.googleapis.com/token",
  "iat": now, "exp": now+3600,
},separators=(",",":")).encode())
signing_input = header + b"." + claim
key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
jwt = signing_input + b"." + b64u(key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256()))

tok = json.load(urllib.request.urlopen(urllib.request.Request(
  "https://oauth2.googleapis.com/token",
  data=urllib.parse.urlencode({"grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer","assertion":jwt.decode()}).encode(),
  headers={"Content-Type":"application/x-www-form-urlencoded"})))["access_token"]

rules = open("firebase/firestore.rules").read()
rs = json.load(urllib.request.urlopen(urllib.request.Request(
  f"https://firebaserules.googleapis.com/v1/projects/{project}/rulesets",
  data=json.dumps({"source":{"files":[{"name":"firestore.rules","content":rules}]}}).encode(),
  headers={"Authorization":f"Bearer {tok}","Content-Type":"application/json"})))["name"]

urllib.request.urlopen(urllib.request.Request(
  f"https://firebaserules.googleapis.com/v1/projects/{project}/releases/cloud.firestore",
  data=json.dumps({"release":{"name":f"projects/{project}/releases/cloud.firestore","rulesetName":rs}}).encode(),
  headers={"Authorization":f"Bearer {tok}","Content-Type":"application/json"}, method="PATCH")).read()
print("deployed:", rs)
PY
```

## Firestore indexes deploy

`bunx firebase-tools deploy --only firestore:indexes` bhi CLI se **fail hota
hai** (same `serviceusage` permission gap). Direct REST API use karo. Service
account ke pass **Cloud Datastore Index Admin** role already granted hai
(agar 403 aaye to user se bolo Google Cloud IAM me ye role add karein —
`firebase-adminsdk-fbsvc@wabees-app.iam.gserviceaccount.com`).

Ye snippet chalao jab bhi `firebase/firestore.indexes.json` change ho.
Existing indexes pe API `409 already exists` deta hai — snippet us ko OK
count me include karta hai, safe re-run hota hai:

```bash
python3 -m pip install --quiet cryptography
python3 <<'PY'
import json, os, time, base64, urllib.request, urllib.parse, urllib.error
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
project = sa["project_id"]
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
now = int(time.time())
claim = {"iss":sa["client_email"],"scope":"https://www.googleapis.com/auth/datastore",
  "aud":"https://oauth2.googleapis.com/token","iat":now,"exp":now+3600}
header = {"alg":"RS256","typ":"JWT","kid":sa["private_key_id"]}
signing_input = f"{b64u(json.dumps(header).encode())}.{b64u(json.dumps(claim).encode())}".encode()
key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
jwt = signing_input.decode() + "." + b64u(key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256()))

data = urllib.parse.urlencode({"grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer","assertion":jwt}).encode()
tok = json.loads(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data)).read())["access_token"]

idx = json.load(open("firebase/firestore.indexes.json"))
ok=0; fail=0; errs=[]
for i in idx["indexes"]:
    coll = i["collectionGroup"]
    body = {"queryScope": i["queryScope"], "fields":[{"fieldPath":f["fieldPath"],"order":f["order"]} for f in i["fields"]]}
    url = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/collectionGroups/{coll}/indexes"
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
        headers={"Authorization":f"Bearer {tok}","Content-Type":"application/json"}, method="POST")
    try:
        urllib.request.urlopen(req).read(); ok+=1
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:200]
        if "already exists" in msg or e.code==409: ok+=1
        else: fail+=1; errs.append(f"{coll}: {e.code} {msg}")
print(f"OK={ok} FAIL={fail}")
for e in errs[:5]: print(e)
PY
```

Build ~2–5 min leta hai per index; chhote collections pe instant. Tab tak
queries jo naye index pe depend karti hain silent-fail rahengi (Firestore
`failed-precondition` error).

## Backend / PHP endpoints (Hostinger)

Media, send, templates, webhook — sab **https://api.wabees.live/api/*.php**.
Kabhi bhi browser se Meta Graph direct call mat karo, kabhi bhi Firebase
Storage mat use karo. PHP repo aur credentials `mem://infra-access` me.

## Web app URL

Live deployment (Cloudflare Worker): **https://wabees-plus.wabees.workers.dev**.
Root domain `wabees.live` PHP backend hai — website nahi.

## E2E test accounts (fixed pool — REUSE, don't recreate)

Password (sab): `E2ePass!Wabees2026`

| Role     | Email                         |
| -------- | ----------------------------- |
| Owner A  | `e2e-ownera@wabees.test`      |
| Owner C  | `e2e-ownerc@wabees.test`      |
| Agent B  | `e2e-agentb@wabees.test`      |
| Agent B2 | `e2e-agentb2@wabees.test`     |

Ye 4 accounts already Firebase mein exist karte hain aur platform owner ne
approve kar diya hai. **Naye accounts kabhi create mat karna** — `makeUser()`
in fixed emails ko return karta hai. Agar naya user chahiye, pehle user se
approval le lo.

## E2E run

```bash
export LD_LIBRARY_PATH="$(cat /tmp/ld.txt)"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/chromium-1228/chrome-linux64/chrome
export E2E_BASE_URL=http://localhost:8080
bun run test:e2e
```

Full suite ~6 min. Har test ke start mein `purgeAgentRows` chalta hai
jo pichhle run se bache huve revoked/left rows delete kar deta hai — tests
idempotent hain.

## Revoked agent — expected flow

1. Owner "Revoke" karta hai → `users/{owner}/agents/{agent}.status = 'revoked'`.
2. Rules (`isAgentOf`) revoked ko block karti hain → agent ki reads/writes owner tree pe fail (permission denied).
3. Agent ke browser me `useAgentRevocationGuard` khud `users/{agent}.dataOwner` clear kar deta hai + notification banata hai.
4. Agent apne empty workspace pe chala jata hai (owner of self).
5. Wohi banda same WhatsApp reconnect karega to `owner-repair` server function line ~899 pe throw karta hai (`revoked/left/missing` agent doc → "ask owner for fresh invite").
6. Fresh invite accept karne ke baad agent doc `active` ban jata hai, reads/writes phir se allow.

## Same-phone connect from a brand-new email

Precheck `checkExistingWhatsAppOwner` MUST be fail-closed in
`src/components/connect/ManualTokenForm.tsx` — agar server function error de
to connect abort karo. Warna precheck silently skip ho jata hai aur 2nd email
phone hijack kar sakti hai. Agar precheck kehta hai "no existing owner" to
wo legit hai (matlab pehla owner disconnect kar chuka hai; wa_map delete ho
chuka hai) — ye by design hai.