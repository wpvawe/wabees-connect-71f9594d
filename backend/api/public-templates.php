<?php
/**
 * WABEES — Public REST API: list approved WhatsApp templates
 * GET /api/public-templates.php
 * Header: x-api-key: wbk_xxx
 *
 * Response: { templates: [{ name, language, status, category, components }] }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, x-api-key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if (!preg_match('/^wbk_[a-f0-9]{16,}$/i', $apiKey)) {
    http_response_code(401);
    echo json_encode(['error' => 'Missing or invalid x-api-key header']);
    exit;
}

require_once __DIR__ . '/../config/firebase-admin.php';
require_once __DIR__ . '/../config/firebase-config.php';

// --- rate limit (60/min shared bucket per key) ------------------------------
$rateDir = __DIR__ . '/../logs/api-rate';
if (!is_dir($rateDir)) @mkdir($rateDir, 0755, true);
$rateFile = $rateDir . '/' . sha1($apiKey) . '.json';
$now = time();
$fp = @fopen($rateFile, 'c+');
if (!$fp) { http_response_code(503); echo json_encode(['error' => 'Rate limiter unavailable']); exit; }
flock($fp, LOCK_EX);
$rawState = stream_get_contents($fp);
$state = @json_decode($rawState ?: '', true) ?: ['t' => $now, 'n' => 0];
if ($now - ($state['t'] ?? 0) >= 60) { $state = ['t' => $now, 'n' => 0]; }
$state['n'] = ($state['n'] ?? 0) + 1;
rewind($fp); ftruncate($fp, 0); fwrite($fp, json_encode($state)); fflush($fp);
flock($fp, LOCK_UN); fclose($fp);
if ($state['n'] > 60) {
    http_response_code(429);
    echo json_encode(['error' => 'Rate limit exceeded (60 requests/minute)']);
    exit;
}

// --- resolve API key -> ownerUid -------------------------------------------
$projectId = defined('FIREBASE_PROJECT_ID') ? FIREBASE_PROJECT_ID : 'wabees-app';
$queryUrl  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:runQuery";
$q = [
    'structuredQuery' => [
        'from'  => [['collectionId' => 'users']],
        'where' => ['fieldFilter' => [
            'field' => ['fieldPath' => 'apiKey'],
            'op'    => 'EQUAL',
            'value' => ['stringValue' => $apiKey],
        ]],
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

if ($code !== 200) { http_response_code(500); echo json_encode(['error' => 'Auth backend error']); exit; }
$rows = json_decode($resp, true) ?: [];
$ownerUid = null;
foreach ($rows as $r) {
    if (!empty($r['document']['name']) && preg_match('#/users/([^/]+)$#', $r['document']['name'], $m)) {
        $ownerUid = $m[1]; break;
    }
}
if (!$ownerUid) { http_response_code(401); echo json_encode(['error' => 'Unknown API key']); exit; }

// --- load WhatsApp credentials ---------------------------------------------
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

if ($credCode !== 200) { http_response_code(400); echo json_encode(['error' => 'WhatsApp not connected']); exit; }
$fields      = (json_decode($credResp, true)['fields'] ?? []);
$accessToken = $fields['accessToken']['stringValue'] ?? '';
$wabaId      = $fields['wabaId']['stringValue'] ?? ($fields['businessAccountId']['stringValue'] ?? '');
if (!$accessToken || !$wabaId) { http_response_code(400); echo json_encode(['error' => 'WhatsApp credentials missing (waba_id/token)']); exit; }

// --- fetch templates from Meta ---------------------------------------------
$graphUrl = "https://graph.facebook.com/v21.0/{$wabaId}/message_templates?limit=200&fields=name,language,status,category,components";
$ch = curl_init($graphUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
]);
$graphResp = curl_exec($ch);
$graphCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($graphCode < 200 || $graphCode >= 300) {
    http_response_code($graphCode ?: 502);
    echo $graphResp ?: json_encode(['error' => 'Failed to fetch templates']);
    exit;
}

$parsed = json_decode($graphResp, true) ?: [];
$out = [];
foreach (($parsed['data'] ?? []) as $t) {
    if (($t['status'] ?? '') !== 'APPROVED') continue;
    $out[] = [
        'name'       => $t['name'] ?? '',
        'language'   => $t['language'] ?? '',
        'status'     => $t['status'] ?? '',
        'category'   => $t['category'] ?? '',
        'components' => $t['components'] ?? [],
    ];
}

echo json_encode(['templates' => $out], JSON_UNESCAPED_UNICODE);
error_log("[WABEES] PUBLIC_API templates uid=$ownerUid count=" . count($out));