<?php
/**
 * WABEES — Public REST API (x-api-key authenticated)
 * POST /api/public-send.php
 *
 * Validates the caller's x-api-key against users/{uid}.apiKey, loads that
 * owner's WhatsApp credentials, and forwards to Meta Graph API.
 *
 * Body (JSON):
 *   { "to": "923001234567", "type": "text", "message": "..." }
 *   { "to": "...", "type": "image", "media_url": "..." }
 *   { "to": "...", "type": "template", "template_name": "...", "language_code": "en_US", "components": [...] }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, x-api-key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// --- API key ---------------------------------------------------------------
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if (!preg_match('/^wbk_[a-f0-9]{16,}$/i', $apiKey)) {
    http_response_code(401);
    echo json_encode(['error' => 'Missing or invalid x-api-key header']);
    exit;
}

require_once __DIR__ . '/../config/firebase-admin.php';
require_once __DIR__ . '/../config/firebase-config.php';

// --- Rate-limit (per key, per minute) --------------------------------------
$rateDir = __DIR__ . '/../logs/api-rate';
if (!is_dir($rateDir)) @mkdir($rateDir, 0755, true);
$rateFile = $rateDir . '/' . sha1($apiKey) . '.json';
$now = time();
$state = @json_decode(@file_get_contents($rateFile), true) ?: ['t' => $now, 'n' => 0];
if ($now - ($state['t'] ?? 0) >= 60) { $state = ['t' => $now, 'n' => 0]; }
$state['n'] = ($state['n'] ?? 0) + 1;
@file_put_contents($rateFile, json_encode($state), LOCK_EX);
if ($state['n'] > 60) {
    http_response_code(429);
    echo json_encode(['error' => 'Rate limit exceeded (60 requests/minute)']);
    exit;
}

// --- Look up owner uid by apiKey ------------------------------------------
$projectId = defined('FIREBASE_PROJECT_ID') ? FIREBASE_PROJECT_ID : 'wabees-app';
$queryUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:runQuery";
$q = [
    'structuredQuery' => [
        'from' => [['collectionId' => 'users']],
        'where' => [
            'fieldFilter' => [
                'field' => ['fieldPath' => 'apiKey'],
                'op' => 'EQUAL',
                'value' => ['stringValue' => $apiKey],
            ],
        ],
        'limit' => 1,
    ],
];

$ch = curl_init($queryUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($q),
    CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code !== 200) {
    error_log("[WABEES] public-send lookup failed HTTP=$code RESP=$resp");
    http_response_code(500);
    echo json_encode(['error' => 'Auth backend error']);
    exit;
}

$rows = json_decode($resp, true) ?: [];
$ownerUid = null;
foreach ($rows as $r) {
    if (!empty($r['document']['name']) &&
        preg_match('#/users/([^/]+)$#', $r['document']['name'], $m)) {
        $ownerUid = $m[1];
        break;
    }
}
if (!$ownerUid) {
    http_response_code(401);
    echo json_encode(['error' => 'Unknown API key']);
    exit;
}

// --- Load WhatsApp credentials --------------------------------------------
$credUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/users/"
    . rawurlencode($ownerUid) . '/whatsapp_config/config';
$ch = curl_init($credUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
]);
$credResp = curl_exec($ch);
$credCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($credCode !== 200) {
    http_response_code(400);
    echo json_encode(['error' => 'WhatsApp not connected for this account']);
    exit;
}
$credDoc = json_decode($credResp, true) ?: [];
$fields = $credDoc['fields'] ?? [];
$phoneNumberId = $fields['phone_number_id']['stringValue'] ?? '';
$accessToken   = $fields['access_token']['stringValue'] ?? '';
if (!$phoneNumberId || !$accessToken) {
    http_response_code(400);
    echo json_encode(['error' => 'WhatsApp credentials missing']);
    exit;
}

// --- Plan quota enforcement (developer API path) --------------------------
// Mirrors send.php + send-message.php: block outbound sends when the
// account has consumed its plan's message allowance.
$subUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/users/"
    . rawurlencode($ownerUid) . '/subscription/current';
$ch = curl_init($subUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
]);
$subResp = curl_exec($ch);
$subCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
if ($subCode === 200) {
    $subDoc = json_decode($subResp, true) ?: [];
    $subFields = $subDoc['fields'] ?? [];
    $maxMessages = (int)($subFields['maxMessages']['integerValue'] ?? 0);
    $msgsUsed    = (int)($subFields['messagesUsed']['integerValue'] ?? 0);
    if ($maxMessages > 0 && $msgsUsed >= $maxMessages) {
        http_response_code(429);
        echo json_encode(['error' => "Message quota exhausted ($msgsUsed/$maxMessages). Upgrade your plan to send more.", 'code' => 'plan_quota_exceeded']);
        exit;
    }
}

// --- Build & forward to Meta Graph ----------------------------------------
$input = json_decode(file_get_contents('php://input'), true) ?: [];
$to    = trim((string)($input['to'] ?? ''));
$type  = trim((string)($input['type'] ?? 'text'));
if ($to === '') {
    http_response_code(400);
    echo json_encode(['error' => "'to' is required"]);
    exit;
}

$payload = ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $to];

switch ($type) {
    case 'text':
        $msg = trim((string)($input['message'] ?? ''));
        if ($msg === '') { http_response_code(400); echo json_encode(['error' => "'message' required for text"]); exit; }
        $payload['type'] = 'text';
        $payload['text'] = ['preview_url' => true, 'body' => $msg];
        break;
    case 'template':
        $name = $input['template_name'] ?? '';
        $lang = $input['language_code'] ?? '';
        if (!$name || !$lang) { http_response_code(400); echo json_encode(['error' => 'template_name + language_code required']); exit; }
        $payload['type'] = 'template';
        $payload['template'] = ['name' => $name, 'language' => ['code' => $lang]];
        if (!empty($input['components'])) $payload['template']['components'] = $input['components'];
        break;
    case 'image': case 'video': case 'document': case 'audio':
        $mediaId  = $input['media_id']  ?? '';
        $mediaUrl = $input['media_url'] ?? '';
        if (!$mediaId && !$mediaUrl) { http_response_code(400); echo json_encode(['error' => 'media_id or media_url required']); exit; }
        $payload['type'] = $type;
        $media = $mediaId ? ['id' => $mediaId] : ['link' => $mediaUrl];
        if (!empty($input['caption']) && in_array($type, ['image','video','document'], true)) $media['caption'] = $input['caption'];
        if ($type === 'document' && !empty($input['filename'])) $media['filename'] = $input['filename'];
        $payload[$type] = $media;
        break;
    default:
        http_response_code(400);
        echo json_encode(['error' => "Unsupported type: $type"]);
        exit;
}

$graphUrl = "https://graph.facebook.com/v21.0/{$phoneNumberId}/messages";
$ch = curl_init($graphUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "Authorization: Bearer {$accessToken}",
    ],
]);
$graphResp = curl_exec($ch);
$graphCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr   = curl_error($ch);
curl_close($ch);

if ($curlErr) {
    http_response_code(502);
    echo json_encode(['error' => 'Network error: ' . $curlErr]);
    exit;
}

// --- Mirror to Firestore so the app/website see API-sent messages ----------
if ($graphCode >= 200 && $graphCode < 300) {
    $graphData = json_decode($graphResp, true) ?: [];
    $waMsgId   = $graphData['messages'][0]['id'] ?? null;
    $nowIso    = gmdate('Y-m-d\TH:i:s\Z');
    $docId     = 'msg_api_' . time() . '_' . rand(1000, 9999);

    // Short preview for conversation list
    $preview = '';
    if ($type === 'text')          $preview = mb_substr($input['message'] ?? '', 0, 100);
    elseif ($type === 'template')  $preview = '[Template] ' . ($input['template_name'] ?? '');
    else                            $preview = '[' . strtoupper($type) . ']';

    $msgDoc = [
        'contactPhone'    => $to,
        'contactName'     => $to,
        'type'            => $type,
        'direction'       => 'outgoing',
        'status'          => 'sent',
        'body'            => $preview,
        'createdAt'       => $nowIso,
        'sentVia'         => 'api',
        'waMessageId'     => $waMsgId,
    ];
    if ($type === 'template') {
        $msgDoc['templateName'] = $input['template_name'] ?? '';
        $msgDoc['languageCode'] = $input['language_code'] ?? '';
    }
    if (in_array($type, ['image','video','document','audio'], true)) {
        if (!empty($input['media_url'])) $msgDoc['mediaUrl']   = $input['media_url'];
        if (!empty($input['media_id']))  $msgDoc['mediaId']    = $input['media_id'];
        if (!empty($input['caption']))   $msgDoc['caption']    = $input['caption'];
        if (!empty($input['filename']))  $msgDoc['filename']   = $input['filename'];
    }

    @firestore_set("users/$ownerUid/messages/$docId", $msgDoc);
    @firestore_set("users/$ownerUid/conversations/$to", [
        'contactPhone'     => $to,
        'contactName'      => $to,
        'lastMessage'      => $preview,
        'lastMessageType'  => $type,
        'lastMessageAt'    => $nowIso,
    ], true);
    @firestore_increment("users/$ownerUid/subscription/current", 'messagesUsed', 1);
}

http_response_code(($graphCode >= 100 && $graphCode < 600) ? $graphCode : 502);
echo $graphResp ?: json_encode(['error' => 'No response from WhatsApp API']);

error_log("[WABEES] PUBLIC_API uid=$ownerUid to=$to type=$type http=$graphCode");
