<?php
/**
 * WABEES — remove an agent from an owner's workspace.
 *
 * Frontend calls this after locally revoking the agent doc. This endpoint is
 * the authoritative cleanup path: it deletes the owner-scoped agent row,
 * clears the agent user's dataOwner mirror, and removes the stale dataOwner
 * custom claim so refreshed tokens cannot route back to the old workspace.
 */

header('Content-Type: application/json');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/firebase-auth.php';
require_once __DIR__ . '/../config/firebase-admin.php';
require_once __DIR__ . '/../config/firebase-config.php';

function wa_remove_fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $msg]);
    exit;
}

function wa_remove_delete_doc($path) {
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents/' . $path;
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($code >= 400 && $code !== 404) {
        error_log("[WABEES] remove-agent delete failed path=$path http=$code err=$err resp=$response");
    }
    return ['code' => $code, 'data' => json_decode($response, true) ?: []];
}

function wa_remove_update_claims_clear_owner($targetUid) {
    $adminToken = get_firebase_admin_token();
    if (!$adminToken) return ['ok' => false, 'code' => 500, 'error' => 'Admin token unavailable'];
    $project = defined('WABEES_FIREBASE_PROJECT_ID') ? WABEES_FIREBASE_PROJECT_ID : FIREBASE_PROJECT_ID;

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
    if ($lookupCode < 200 || $lookupCode >= 300) {
        return ['ok' => false, 'code' => $lookupCode, 'error' => 'Lookup failed'];
    }

    $claims = [];
    $lookupData = json_decode($lookupResp, true) ?: [];
    $existing = $lookupData['users'][0]['customAttributes'] ?? '';
    if ($existing) {
        $decoded = json_decode($existing, true);
        if (is_array($decoded)) $claims = $decoded;
    }
    unset($claims['dataOwner']);
    $claimsJson = json_encode((object)$claims);

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
    $err = curl_error($ch);
    curl_close($ch);
    if ($code < 200 || $code >= 300) {
        error_log("[WABEES] remove-agent claims clear failed uid=$targetUid http=$code err=$err resp=$resp");
        return ['ok' => false, 'code' => $code, 'error' => 'Claims update failed'];
    }
    return ['ok' => true];
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$idToken = trim((string)($input['id_token'] ?? ''));
if (!$idToken && $authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    $idToken = trim($m[1]);
}

$err = null;
$callerUid = verify_firebase_id_token($idToken, $err);
if (!$callerUid) wa_remove_fail(401, $err ?: 'Unauthorized');

$ownerId = trim((string)($input['owner_id'] ?? ''));
$agentId = trim((string)($input['agent_id'] ?? ''));
if ($ownerId === '' || $agentId === '') wa_remove_fail(400, 'Missing owner_id or agent_id');
if (!preg_match('/^[A-Za-z0-9_-]+$/', $ownerId) || !preg_match('/^[A-Za-z0-9_-]+$/', $agentId)) {
    wa_remove_fail(400, 'Invalid uid');
}
if ($ownerId === $agentId) wa_remove_fail(400, 'Owner cannot remove themselves as an agent');

$callerDoc = firestore_get('users/' . rawurlencode($callerUid));
$callerFields = (($callerDoc['code'] ?? 0) === 200) ? ($callerDoc['data']['fields'] ?? []) : [];
$callerRole = strtolower((string)($callerFields['role']['stringValue'] ?? ''));
if ($callerUid !== $ownerId && $callerRole !== 'admin') {
    wa_remove_fail(403, 'Owner only');
}

// Delete/revoke the owner-scoped agent row. 404 is idempotent success.
$delete = wa_remove_delete_doc('users/' . rawurlencode($ownerId) . '/agents/' . rawurlencode($agentId));
if (($delete['code'] ?? 500) >= 400 && ($delete['code'] ?? 0) !== 404) {
    wa_remove_fail(502, 'Could not delete agent row');
}

// Clear the agent user's owner mirror. Null is enough for the web client
// (`typeof dataOwner === "string"` check), and the update mask keeps other
// profile fields intact.
firestore_update('users/' . rawurlencode($agentId), [
    'dataOwner' => null,
    'dataOwnerJoinedAt' => null,
    'dataOwnerJoinedVia' => null,
    'dataOwnerClearedAt' => firestore_timestamp(),
    'dataOwnerClearedReason' => 'removed_by_owner',
    'updatedAt' => firestore_timestamp(),
], ['dataOwner','dataOwnerJoinedAt','dataOwnerJoinedVia','dataOwnerClearedAt','dataOwnerClearedReason','updatedAt']);

$claims = wa_remove_update_claims_clear_owner($agentId);
if (empty($claims['ok'])) {
    // The Firestore rule fix still blocks stale dataOwner claims because the
    // agent doc is gone; surface the partial cleanup so the caller can retry.
    http_response_code(207);
    echo json_encode([
        'success' => true,
        'warning' => 'Agent removed, but claim cleanup should be retried',
        'claims' => $claims,
    ]);
    exit;
}

echo json_encode(['success' => true, 'removed' => true]);
?>