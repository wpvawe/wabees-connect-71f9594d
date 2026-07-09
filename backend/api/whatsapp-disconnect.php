<?php
/**
 * WABEES — authoritative WhatsApp disconnect/flush endpoint.
 *
 * Client-side Firestore writes can be blocked by rules or leave wa_map/cache
 * stale. This endpoint verifies the Firebase user, clears that user's active
 * WhatsApp credentials with backend privileges, and releases wa_map when the
 * signed-in user is the current owner.
 */

header('Content-Type: application/json');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => ['message' => 'Method not allowed']]);
    exit;
}

require_once __DIR__ . '/../config/firebase-config.php';
require_once __DIR__ . '/../config/firebase-auth.php';

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$idToken = trim((string)($input['id_token'] ?? ''));
if (!$idToken && $authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    $idToken = trim($m[1]);
}
$err = null;
$uid = verify_firebase_id_token($idToken, $err);
if (!$uid) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => ['message' => $err ?: 'Unauthorized']]);
    exit;
}

function wa_disc_string($fields, $key) {
    return trim((string)($fields[$key]['stringValue'] ?? ''));
}
function wa_disc_delete_doc($path) {
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
    curl_close($ch);
    return ['code' => $code, 'data' => json_decode($response, true) ?: []];
}
function wa_disc_map_user_ids($fields) {
    $ids = [];
    foreach (['ownerId', 'userId'] as $key) {
        $id = wa_disc_string($fields, $key);
        if ($id && !in_array($id, $ids, true)) $ids[] = $id;
    }
    foreach (($fields['users']['arrayValue']['values'] ?? []) as $entry) {
        $id = $entry['mapValue']['fields']['userId']['stringValue'] ?? '';
        if ($id && !in_array($id, $ids, true)) $ids[] = $id;
    }
    return $ids;
}
function wa_disc_clear_runtime_cache($phone, $uids = []) {
    if (!$phone) return;
    $cacheFile = __DIR__ . '/../cache/wa_map.json';
    if (file_exists($cacheFile)) {
        $map = @json_decode(@file_get_contents($cacheFile), true) ?: [];
        if (isset($map[$phone])) {
            unset($map[$phone]);
            @file_put_contents($cacheFile, json_encode($map));
        }
    }
    if (function_exists('apcu_delete')) apcu_delete("wabees_owner_$phone");
    foreach ($uids as $id) {
        if (!$id) continue;
        if (function_exists('apcu_delete')) apcu_delete("wabees_token_$id");
        $tokenCacheFile = __DIR__ . '/../cache/token_' . $id . '.json';
        if (file_exists($tokenCacheFile)) @unlink($tokenCacheFile);
    }
}

$user = firestore_get('users/' . rawurlencode($uid));
$userFields = (($user['code'] ?? 0) === 200) ? ($user['data']['fields'] ?? []) : [];
$cfg = firestore_get('users/' . rawurlencode($uid) . '/whatsapp_config/config');
$cfgFields = (($cfg['code'] ?? 0) === 200) ? ($cfg['data']['fields'] ?? []) : [];
$phone = trim((string)($input['phone_number_id'] ?? ''));
if ($phone === '') {
    $phone = wa_disc_string($userFields, 'whatsappPhoneNumberId') ?: wa_disc_string($cfgFields, 'phoneNumberId');
}
$dataOwner = wa_disc_string($userFields, 'dataOwner');

firestore_update('users/' . rawurlencode($uid), [
    'whatsappPhoneNumberId' => null,
    'whatsappAccessToken' => null,
    'whatsappBusinessAccountId' => null,
    'whatsappDisplayPhone' => null,
    'whatsappQualityRating' => null,
    'whatsappConnected' => false,
    'dataOwner' => null,
    'updatedAt' => firestore_timestamp(),
], ['whatsappPhoneNumberId','whatsappAccessToken','whatsappBusinessAccountId','whatsappDisplayPhone','whatsappQualityRating','whatsappConnected','dataOwner','updatedAt']);

firestore_update('users/' . rawurlencode($uid) . '/whatsapp_config/config', [
    'phoneNumberId' => $phone ?: null,
    'accessToken' => '',
    'businessAccountId' => '',
    'displayPhoneNumber' => null,
    'businessName' => null,
    'qualityRating' => null,
    'isConnected' => false,
    'disconnectedAt' => firestore_timestamp(),
    'updatedAt' => firestore_timestamp(),
], ['phoneNumberId','accessToken','businessAccountId','displayPhoneNumber','businessName','qualityRating','isConnected','disconnectedAt','updatedAt']);

if ($dataOwner) {
    wa_disc_delete_doc('users/' . rawurlencode($dataOwner) . '/agents/' . rawurlencode($uid));
}

$released = false;
$knownUids = [$uid];
if ($phone !== '') {
    $map = firestore_get('wa_map/' . rawurlencode($phone));
    if (($map['code'] ?? 404) === 200) {
        $fields = $map['data']['fields'] ?? [];
        $knownUids = array_values(array_unique(array_merge($knownUids, wa_disc_map_user_ids($fields))));
        $owner = wa_disc_string($fields, 'ownerId') ?: wa_disc_string($fields, 'userId');
        $original = wa_disc_string($fields, 'originalOwnerUid');
        if ($owner === $uid || !$owner) {
            // First-bind lock: preserve originalOwnerUid across disconnects so
            // no other account can steal the number. Only clear active-owner
            // fields; keep the map doc alive as a permanent lock record.
            firestore_update('wa_map/' . rawurlencode($phone), [
                'ownerId' => null,
                'userId' => null,
                'users' => [],
                'active' => false,
                'originalOwnerUid' => $original !== '' ? $original : $uid,
                'disconnectedAt' => firestore_timestamp(),
                'updatedAt' => firestore_timestamp(),
            ], ['ownerId','userId','users','active','originalOwnerUid','disconnectedAt','updatedAt']);
            $released = true;
        }
    }
    wa_disc_clear_runtime_cache($phone, $knownUids);
}

echo json_encode([
    'success' => true,
    'data' => ['phoneNumberId' => $phone ?: null, 'released' => $released],
]);
?>