<?php
/**
 * WABEES — Admin Delete User (SEC-03)
 *
 * Deletes a Firebase Auth account. Admin-only.
 *
 * POST /api/delete-user.php
 *   Headers: Authorization: Bearer <admin-firebase-id-token>
 *   Body:    { "uid": "<target-uid>" }
 *
 * The caller must be an authenticated user whose users/{uid}.role == "admin".
 * We check the Firestore user doc (not the ID token claim) so this keeps
 * working during the custom-claims backfill window; once claims are rolled
 * out everywhere, the ID token also carries `role:admin` and either path
 * will short-circuit.
 *
 * On success this DOES NOT delete the target user's Firestore data — that
 * happens client-side via `mutations.deleteUserComplete()` before this
 * endpoint is called, so admin flows stay explicit and cancellable.
 */

header('Content-Type: application/json');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/firebase-auth.php';
require_once __DIR__ . '/../config/firebase-admin.php';
require_once __DIR__ . '/../config/firebase-config.php';

function _wabees_admin_json_fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $msg]);
    exit;
}

// ---- 1. Verify caller identity ----
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader || !preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    _wabees_admin_json_fail(401, 'Missing bearer token');
}
$err = null;
$callerUid = verify_firebase_id_token(trim($m[1]), $err);
if (!$callerUid) _wabees_admin_json_fail(401, 'Invalid token: ' . ($err ?? 'unknown'));

// ---- 2. Verify caller is admin (via Firestore role field) ----
$callerDoc = firestore_get("users/$callerUid");
$callerRole = $callerDoc['data']['fields']['role']['stringValue'] ?? '';
if ($callerRole !== 'admin') _wabees_admin_json_fail(403, 'Admin only');

// ---- 3. Parse target ----
$raw = file_get_contents('php://input');
$body = json_decode($raw, true) ?: [];
$targetUid = trim($body['uid'] ?? '');
if ($targetUid === '') _wabees_admin_json_fail(400, 'Missing uid');
if ($targetUid === $callerUid) _wabees_admin_json_fail(400, 'Cannot delete yourself');

// ---- 4. Call Firebase Identity Toolkit admin delete ----
$adminToken = get_firebase_admin_token();
if (!$adminToken) _wabees_admin_json_fail(500, 'Admin token unavailable');

$project = defined('WABEES_FIREBASE_PROJECT_ID') ? WABEES_FIREBASE_PROJECT_ID : 'wabees-app';
$url = "https://identitytoolkit.googleapis.com/v1/projects/$project/accounts:delete";
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['localId' => $targetUid]),
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $adminToken,
        'Content-Type: application/json',
    ],
    CURLOPT_TIMEOUT => 15,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($code < 200 || $code >= 300) {
    error_log("[WABEES] delete-user failed uid=$targetUid http=$code resp=$resp err=$curlErr");
    _wabees_admin_json_fail(502, 'Firebase delete failed (' . $code . ')');
}

echo json_encode(['success' => true, 'uid' => $targetUid]);