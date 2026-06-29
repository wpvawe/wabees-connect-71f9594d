<?php
/**
 * WABEES — WhatsApp Analytics (Meta Graph "analytics" field on WABA)
 *
 * POST https://api.wabees.live/api/get-insights.php
 * Body: { phone_number_id, start (unix), end (unix), id_token }
 * Response: { data: [{ type: "SENT"|"DELIVERED"|..., data_points: [{start,end,value}] }] }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']); exit;
}

require_once __DIR__ . '/../config/firebase-config.php';
require_once __DIR__ . '/../config/firebase-auth.php';

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$idToken       = (string)($body['id_token'] ?? '');
$phoneNumberId = preg_replace('/[^0-9]/', '', (string)($body['phone_number_id'] ?? ''));
$start         = (int)($body['start'] ?? 0);
$end           = (int)($body['end'] ?? 0);

if (!$phoneNumberId || !$start || !$end || $end <= $start) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid params']); exit;
}

$uid = verify_firebase_id_token($idToken, $err);
if (!$uid) { http_response_code(401); echo json_encode(['error' => $err ?: 'Unauthorized']); exit; }

// Resolve effective owner uid (agent → owner)
$ownerUid = $uid;
$userResp = firestore_get("users/$uid");
if (($userResp['code'] ?? 404) === 200) {
    $f = $userResp['data']['fields'] ?? [];
    $dataOwner = trim($f['dataOwner']['stringValue'] ?? '');
    if ($dataOwner !== '' && $dataOwner !== $uid) $ownerUid = $dataOwner;
}

// Get WABA id + access token
$tokens = get_user_access_token($ownerUid);
$accessToken = $tokens['accessToken'] ?? '';
$wabaId      = $tokens['wabaId'] ?? '';

if (!$wabaId) {
    // Try to read from whatsapp_config
    $cfg = firestore_get("users/$ownerUid/whatsapp_config/connection");
    if (($cfg['code'] ?? 404) === 200) {
        $cf = $cfg['data']['fields'] ?? [];
        $wabaId = $cf['waba_id']['stringValue'] ?? ($cf['wabaId']['stringValue'] ?? '');
    }
}
if (!$wabaId) {
    $usr = firestore_get("users/$ownerUid");
    if (($usr['code'] ?? 404) === 200) {
        $uf = $usr['data']['fields'] ?? [];
        $wabaId = $uf['wabaId']['stringValue'] ?? ($uf['whatsappBusinessAccountId']['stringValue'] ?? '');
    }
}

if (!$accessToken || !$wabaId) {
    http_response_code(400);
    echo json_encode(['error' => 'WhatsApp not fully connected (missing token or WABA id)']);
    exit;
}

// Meta Graph analytics: GET /{waba-id}?fields=analytics.start(...).end(...).granularity(DAY).phone_numbers([...])
$gv = 'v21.0';
$fields = sprintf(
    'analytics.start(%d).end(%d).granularity(DAY).phone_numbers([%s])',
    $start, $end, json_encode($phoneNumberId)
);
$url = "https://graph.facebook.com/$gv/$wabaId?fields=" . rawurlencode($fields);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$json = json_decode($resp, true);
if ($code < 200 || $code >= 300 || !is_array($json)) {
    http_response_code(502);
    echo json_encode(['error' => $json['error']['message'] ?? 'Graph API error', 'httpCode' => $code]);
    exit;
}

$series = $json['analytics']['data_points'] ?? [];
// Meta returns one bucket per day with sent/delivered/read counts inline
$sent = []; $delivered = []; $read = [];
foreach ($series as $p) {
    $row = ['start' => (int)($p['start'] ?? 0), 'end' => (int)($p['end'] ?? 0), 'value' => 0];
    $sent[]      = array_merge($row, ['value' => (int)($p['sent']      ?? 0)]);
    $delivered[] = array_merge($row, ['value' => (int)($p['delivered'] ?? 0)]);
    $read[]      = array_merge($row, ['value' => (int)($p['read']      ?? $p['delivered'] ?? 0)]);
}

echo json_encode([
    'data' => [
        ['type' => 'SENT',      'data_points' => $sent],
        ['type' => 'DELIVERED', 'data_points' => $delivered],
        ['type' => 'READ',      'data_points' => $read],
    ],
]);