<?php
/**
 * WABEES — Admin Set Custom Claims
 *
 * Sets Firebase Auth custom claims (`role`, `dataOwner`) on a target user.
 * Called by `mutations.adminSetRole()` after it updates users/{uid}.role
 * in Firestore so the ID token also carries the claim on next refresh.
 *
 * POST /api/set-user-claims.php
 *   Headers: Authorization: Bearer <admin-firebase-id-token>
 *   Body:    { "uid": "<target-uid>",
 *              "role": "admin" | "manager" | "agent" | "user" | null,
 *              "dataOwner": "<owner-uid>" | null }
 *
 * Passing `null` for a field clears that claim. Any field omitted keeps its
 * previous value (we read the existing account, merge, then write back).
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

function _wabees_claims_fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $msg]);
    exit;
}

// ---- 1. Verify caller ----
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader || !preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    _wabees_claims_fail(401, 'Missing bearer token');
}
$err = null;
$callerUid = verify_firebase_id_token(trim($m[1]), $err);
if (!$callerUid) _wabees_claims_fail(401, 'Invalid token: ' . ($err ?? 'unknown'));

$callerDoc = firestore_get("users/$callerUid");
$callerRole = $callerDoc['data']['fields']['role']['stringValue'] ?? '';
if ($callerRole !== 'admin') _wabees_claims_fail(403, 'Admin only');

// ---- 2. Parse target + claims ----
$raw = file_get_contents('php://input');
$body = json_decode($raw, true) ?: [];
$targetUid = trim($body['uid'] ?? '');
if ($targetUid === '') _wabees_claims_fail(400, 'Missing uid');

$allowedRoles = ['admin', 'agent', 'user'];
$hasRole = array_key_exists('role', $body);
$hasOwner = array_key_exists('dataOwner', $body);
$newRole = $hasRole ? $body['role'] : null;
$newOwner = $hasOwner ? $body['dataOwner'] : null;

if ($hasRole && $newRole !== null && !in_array($newRole, $allowedRoles, true)) {
    _wabees_claims_fail(400, 'Invalid role');
}
if ($hasOwner && $newOwner !== null && (!is_string($newOwner) || $newOwner === '')) {
    _wabees_claims_fail(400, 'Invalid dataOwner');
}

// ---- 3. Load existing claims and merge ----
$adminToken = get_firebase_admin_token();
if (!$adminToken) _wabees_claims_fail(500, 'Admin token unavailable');
$project = defined('WABEES_FIREBASE_PROJECT_ID') ? WABEES_FIREBASE_PROJECT_ID : 'wabees-app';

$lookupUrl = "https://identitytoolkit.googleapis.com/v1/projects/$project/accounts:lookup";
$ch = curl_init($lookupUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['localId' => [$targetUid]]),
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $adminToken,
        'Content-Type: application/json',
    ],
    CURLOPT_TIMEOUT => 10,
]);
$lookupResp = curl_exec($ch);
$lookupCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$claims = [];
if ($lookupCode >= 200 && $lookupCode < 300) {
    $lookupData = json_decode($lookupResp, true) ?: [];
    $existing = $lookupData['users'][0]['customAttributes'] ?? '';
    if ($existing) {
        $decoded = json_decode($existing, true);
        if (is_array($decoded)) $claims = $decoded;
    }
}

// Apply changes (null → remove key)
if ($hasRole) {
    if ($newRole === null) unset($claims['role']);
    else $claims['role'] = $newRole;
}
if ($hasOwner) {
    if ($newOwner === null) unset($claims['dataOwner']);
    else $claims['dataOwner'] = $newOwner;
}

// Firebase custom claims must be < 1000 bytes when JSON-encoded.
$claimsJson = json_encode((object)$claims);
if (strlen($claimsJson) > 900) _wabees_claims_fail(400, 'Claims payload too large');

// ---- 4. Write claims ----
$updateUrl = "https://identitytoolkit.googleapis.com/v1/projects/$project/accounts:update";
$ch = curl_init($updateUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode([
        'localId' => $targetUid,
        'customAttributes' => $claimsJson,
    ]),
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
    error_log("[WABEES] set-user-claims failed uid=$targetUid http=$code resp=$resp err=$curlErr");
    _wabees_claims_fail(502, 'Firebase update failed (' . $code . ')');
}

echo json_encode(['success' => true, 'uid' => $targetUid, 'claims' => $claims]);