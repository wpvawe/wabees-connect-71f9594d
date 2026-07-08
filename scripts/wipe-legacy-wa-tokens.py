"""SEC-01 — Null legacy users/{uid}.whatsappAccessToken when the same token
exists in users/{uid}/whatsapp_config/config. Idempotent."""
import os, json, requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
PROJECT = sa["project_id"]
creds = service_account.Credentials.from_service_account_info(sa, scopes=[
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/cloud-platform",
])
creds.refresh(Request())
H = {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

def list_users():
    page = None
    while True:
        params = {"pageSize": 300, "mask.fieldPaths": "whatsappAccessToken"}
        if page: params["pageToken"] = page
        r = requests.get(f"{FS}/users", headers=H, params=params); r.raise_for_status()
        j = r.json()
        for d in j.get("documents", []):
            uid = d["name"].split("/")[-1]
            tok = d.get("fields", {}).get("whatsappAccessToken", {}).get("stringValue")
            if tok: yield uid, tok
        page = j.get("nextPageToken")
        if not page: break

wiped = kept = 0
for uid, legacy_tok in list_users():
    r = requests.get(f"{FS}/users/{uid}/whatsapp_config/config", headers=H)
    cfg_tok = None
    if r.status_code == 200:
        cfg_tok = r.json().get("fields", {}).get("accessToken", {}).get("stringValue")
    if not cfg_tok:
        print(f"KEEP {uid} (no whatsapp_config.accessToken yet)")
        kept += 1
        continue
    # Wipe legacy field
    r = requests.patch(
        f"{FS}/users/{uid}?updateMask.fieldPaths=whatsappAccessToken",
        headers=H,
        data=json.dumps({"fields": {"whatsappAccessToken": {"nullValue": None}}})
    )
    if r.status_code == 200:
        wiped += 1
        print(f"WIPE {uid}")
    else:
        print(f"ERR  {uid} {r.status_code} {r.text[:120]}")
print(f"\nDone. wiped={wiped} kept={kept}")
