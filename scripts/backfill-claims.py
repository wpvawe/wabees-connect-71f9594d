"""One-off: copy users/{uid}.role + .dataOwner into Firebase Auth custom claims.
Idempotent — safe to re-run. Reads FIREBASE_SERVICE_ACCOUNT_JSON."""
import os, json, time, requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
PROJECT = sa["project_id"]
creds = service_account.Credentials.from_service_account_info(sa, scopes=[
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/firebase",
  "https://www.googleapis.com/auth/identitytoolkit",
])
creds.refresh(Request())
H = {"Authorization": f"Bearer {creds.token}"}

# Page through users collection via Firestore REST
def list_users():
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/users"
    page = None
    while True:
        params = {"pageSize": 300}
        if page: params["pageToken"] = page
        r = requests.get(url, headers=H, params=params); r.raise_for_status()
        j = r.json()
        for d in j.get("documents", []):
            uid = d["name"].split("/")[-1]
            f = d.get("fields", {})
            role = f.get("role", {}).get("stringValue")
            data_owner = f.get("dataOwner", {}).get("stringValue")
            yield uid, role, data_owner
        page = j.get("nextPageToken")
        if not page: break

updated = skipped = failed = 0
for uid, role, data_owner in list_users():
    attrs = {}
    if role: attrs["role"] = role
    if data_owner: attrs["dataOwner"] = data_owner
    if not attrs:
        skipped += 1; continue
    payload = {"localId": uid, "customAttributes": json.dumps(attrs)}
    r = requests.post(f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:update",
                      headers={**H, "Content-Type":"application/json"}, data=json.dumps(payload))
    if r.status_code == 200:
        updated += 1
        print(f"OK  {uid} -> {attrs}")
    else:
        failed += 1
        print(f"ERR {uid} {r.status_code} {r.text[:120]}")
    time.sleep(0.05)
print(f"\nDone. updated={updated} skipped={skipped} failed={failed}")
