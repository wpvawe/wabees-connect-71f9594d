<?php
/**
 * WABEES — authoritative WhatsApp connect/repair endpoint.
 *
 * Rule:
 * - if a phone_number_id is actively connected to another owner, block.
 * - if the previous owner disconnected it, the current user may connect it.
 * - when moving to the current user, copy historical workspace data so data
 *   follows the WhatsApp number; never auto-turn the new owner into an agent.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
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

$phone = trim((string)($input['phone_number_id'] ?? ''));
$token = trim((string)($input['access_token'] ?? ''));
if ($phone === '' || $token === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'phone_number_id and access_token are required']]);
    exit;
}

function wa_field_string($fields, $key) {
    return trim((string)($fields[$key]['stringValue'] ?? ''));
}
function wa_field_bool($fields, $key) {
    return array_key_exists($key, $fields) && array_key_exists('booleanValue', $fields[$key])
        ? (bool)$fields[$key]['booleanValue']
        : null;
}
function wa_uid_from_user_doc($name) {
    return preg_match('#/users/([^/]+)$#', $name, $m) ? $m[1] : null;
}
function wa_uid_from_config_doc($name) {
    return preg_match('#/users/([^/]+)/whatsapp_config/#', $name, $m) ? $m[1] : null;
}
function wa_collection_count($uid, $collection, $max = 500) {
    $resp = firestore_get('users/' . rawurlencode($uid) . '/' . $collection);
    if (($resp['code'] ?? 0) !== 200) return 0;
    return min($max, count($resp['data']['documents'] ?? []));
}
function wa_user_activity_score($uid) {
    return wa_collection_count($uid, 'conversations') * 5
        + wa_collection_count($uid, 'messages')
        + wa_collection_count($uid, 'contacts') * 3
        + wa_collection_count($uid, 'templates')
        + wa_collection_count($uid, 'bots') * 4
        + wa_collection_count($uid, 'campaigns') * 4;
}
function wa_list_collection_docs($path) {
    $resp = firestore_get($path);
    if (($resp['code'] ?? 0) !== 200) return [];
    $docs = [];
    foreach (($resp['data']['documents'] ?? []) as $doc) {
        $name = $doc['name'] ?? '';
        $id = basename($name);
        if ($id) $docs[] = ['id' => $id, 'fields' => $doc['fields'] ?? []];
    }
    return $docs;
}
function wa_patch_raw_fields($path, $fields) {
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents/' . $path;
    $masks = [];
    foreach (array_keys($fields) as $field) $masks[] = 'updateMask.fieldPaths=' . rawurlencode($field);
    $url .= '?' . implode('&', $masks);
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_CUSTOMREQUEST => 'PATCH',
        CURLOPT_POSTFIELDS => json_encode(['fields' => $fields]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'data' => json_decode($response, true)];
}
function wa_copy_data_island($sourceUid, $targetUid) {
    if (!$sourceUid || !$targetUid || $sourceUid === $targetUid) return;
    $collections = [
        'conversations', 'messages', 'contacts', 'templates', 'bots', 'campaigns',
        'scheduled_messages', 'tags', 'canned', 'settings', 'csat_surveys',
        'bot_leads', 'bot_config', 'bot_usage', 'subscription'
    ];
    $copied = [];
    foreach ($collections as $collection) {
        $docs = wa_list_collection_docs('users/' . rawurlencode($sourceUid) . '/' . $collection);
        $copied[$collection] = $docs;
        foreach ($docs as $doc) {
            $fields = $doc['fields'];
            $fields['migratedFromUid'] = ['stringValue' => $sourceUid];
            $fields['migratedAt'] = firestore_timestamp();
            wa_patch_raw_fields('users/' . rawurlencode($targetUid) . '/' . $collection . '/' . rawurlencode($doc['id']), $fields);
        }
    }
    foreach (($copied['conversations'] ?? []) as $conv) {
        foreach (['notes', 'assign_log'] as $child) {
            foreach (wa_list_collection_docs('users/' . rawurlencode($sourceUid) . '/conversations/' . rawurlencode($conv['id']) . '/' . $child) as $doc) {
                $fields = $doc['fields'];
                $fields['migratedFromUid'] = ['stringValue' => $sourceUid];
                $fields['migratedAt'] = firestore_timestamp();
                wa_patch_raw_fields('users/' . rawurlencode($targetUid) . '/conversations/' . rawurlencode($conv['id']) . '/' . $child . '/' . rawurlencode($doc['id']), $fields);
            }
        }
    }
    foreach (($copied['campaigns'] ?? []) as $campaign) {
        foreach (wa_list_collection_docs('users/' . rawurlencode($sourceUid) . '/campaigns/' . rawurlencode($campaign['id']) . '/logs') as $doc) {
            $fields = $doc['fields'];
            $fields['migratedFromUid'] = ['stringValue' => $sourceUid];
            $fields['migratedAt'] = firestore_timestamp();
            wa_patch_raw_fields('users/' . rawurlencode($targetUid) . '/campaigns/' . rawurlencode($campaign['id']) . '/logs/' . rawurlencode($doc['id']), $fields);
        }
    }
}

$candidates = [];
foreach (find_all_users_by_phone_number_id($phone) as $row) {
    $candidates[$row['id']] = ['id' => $row['id'], 'fields' => $row['data'] ?? [], 'fromPhone' => true];
}
foreach (find_all_users_by_whatsapp_config($phone) as $row) {
    $fields = $row['data'] ?? [];
    $candidates[$row['id']] = array_merge($candidates[$row['id']] ?? ['id' => $row['id'], 'fields' => []], ['fields' => array_merge($candidates[$row['id']]['fields'] ?? [], $fields), 'fromConfig' => true]);
}
$map = firestore_get('wa_map/' . rawurlencode($phone));
if (($map['code'] ?? 404) === 200) {
    $fields = $map['data']['fields'] ?? [];
    foreach ([wa_field_string($fields, 'ownerId'), wa_field_string($fields, 'userId')] as $id) {
        if ($id) $candidates[$id] = $candidates[$id] ?? ['id' => $id, 'fields' => [], 'fromMap' => true];
    }
}

$activeOwner = null;
$priorOwners = [];
foreach ($candidates as $id => $candidate) {
    $user = firestore_get('users/' . rawurlencode($id));
    $userFields = (($user['code'] ?? 0) === 200) ? ($user['data']['fields'] ?? []) : [];
    $cfg = firestore_get('users/' . rawurlencode($id) . '/whatsapp_config/config');
    $cfgFields = (($cfg['code'] ?? 0) === 200) ? ($cfg['data']['fields'] ?? []) : [];
    $connectedTop = wa_field_bool($userFields, 'whatsappConnected');
    $connectedCfg = wa_field_bool($cfgFields, 'isConnected');
    $hasToken = wa_field_string($userFields, 'whatsappAccessToken') !== '' || wa_field_string($cfgFields, 'accessToken') !== '';
    $hasPhone = wa_field_string($userFields, 'whatsappPhoneNumberId') === $phone || wa_field_string($cfgFields, 'phoneNumberId') === $phone;
    $isConnected = $hasPhone && $hasToken && ($connectedTop === true || $connectedCfg === true);
    if ($isConnected && $id !== $uid) {
        $activeOwner = $id;
        break;
    }
    if ($id !== $uid) $priorOwners[] = $id;
}
if ($activeOwner) {
    http_response_code(409);
    echo json_encode(['success' => false, 'error' => ['message' => 'This WhatsApp number is already connected to another workspace. Disconnect it there first, then connect here.']]);
    exit;
}

$waba = trim((string)($input['waba_id'] ?? $input['business_account_id'] ?? ''));
$display = trim((string)($input['display_phone'] ?? ''));
$business = trim((string)($input['business_name'] ?? ''));
$quality = trim((string)($input['quality_rating'] ?? ''));
$via = (($input['connected_via'] ?? '') === 'embedded_signup') ? 'embedded_signup' : 'manual';

firestore_update('users/' . rawurlencode($uid), [
    'whatsappPhoneNumberId' => $phone,
    'whatsappAccessToken' => $token,
    'whatsappBusinessAccountId' => $waba ?: null,
    'whatsappDisplayPhone' => $display ?: null,
    'whatsappQualityRating' => $quality ?: null,
    'whatsappConnected' => true,
    'dataOwner' => null,
    'updatedAt' => firestore_timestamp(),
], ['whatsappPhoneNumberId','whatsappAccessToken','whatsappBusinessAccountId','whatsappDisplayPhone','whatsappQualityRating','whatsappConnected','dataOwner','updatedAt']);

firestore_update('users/' . rawurlencode($uid) . '/whatsapp_config/config', [
    'phoneNumberId' => $phone,
    'accessToken' => $token,
    'businessAccountId' => $waba,
    'webhookVerifyToken' => '',
    'displayPhoneNumber' => $display ?: null,
    'businessName' => $business ?: null,
    'qualityRating' => $quality ?: null,
    'isConnected' => true,
    'connectedVia' => $via,
    'connectedAt' => firestore_timestamp(),
    'lastVerifiedAt' => firestore_timestamp(),
], ['phoneNumberId','accessToken','businessAccountId','webhookVerifyToken','displayPhoneNumber','businessName','qualityRating','isConnected','connectedVia','connectedAt','lastVerifiedAt']);

firestore_update('wa_map/' . rawurlencode($phone), [
    'ownerId' => $uid,
    'userId' => $uid,
    'users' => [['userId' => $uid]],
    'active' => true,
    'updatedAt' => firestore_timestamp(),
], ['ownerId','userId','users','active','updatedAt']);

$bestPrior = null;
$bestScore = 0;
foreach ($priorOwners as $prior) {
    $score = wa_user_activity_score($prior);
    if ($score > $bestScore) { $bestScore = $score; $bestPrior = $prior; }
}
if ($bestPrior) wa_copy_data_island($bestPrior, $uid);

echo json_encode([
    'success' => true,
    'data' => ['ownerId' => $uid, 'migratedFrom' => $bestPrior],
]);
?>