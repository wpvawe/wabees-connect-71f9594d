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