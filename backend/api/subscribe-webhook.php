<?php
/** WABEES — Subscribe the connected WABA/phone app to WhatsApp webhooks. */

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => ['message' => 'POST required']]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
require_once __DIR__ . '/../config/wa-bearer-auth.php';
$auth = wabees_apply_bearer_auth($input);
if (!empty($auth['error'])) {
    http_response_code((int)($auth['status'] ?? 401));
    echo json_encode(['success' => false, 'error' => ['message' => $auth['error']]]);
    exit;
}

$accessToken = trim((string)($input['access_token'] ?? ''));
$wabaId = trim((string)($input['business_account_id'] ?? ($input['waba_id'] ?? '')));
if ($wabaId === '' && !empty($auth['owner_uid'])) {
    $ownerUid = preg_replace('/[^A-Za-z0-9_-]/', '', (string)$auth['owner_uid']);
    $cfg = firestore_get('users/' . rawurlencode($ownerUid) . '/whatsapp_config/config');
    $cf = (($cfg['code'] ?? 404) === 200) ? ($cfg['data']['fields'] ?? []) : [];
    $wabaId = trim((string)($cf['businessAccountId']['stringValue'] ?? ($cf['wabaId']['stringValue'] ?? '')));
}
if ($accessToken === '' || $wabaId === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'access_token and WABA id are required']]);
    exit;
}

$gv = defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0';
$ch = curl_init("https://graph.facebook.com/$gv/" . rawurlencode($wabaId) . '/subscribed_apps');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);
$json = json_decode($resp ?: '', true);
if (!is_array($json)) $json = [];
$ok = $code >= 200 && $code < 300 && empty($json['error']);
http_response_code($ok ? 200 : ($code ?: 502));
echo json_encode(array_merge(['success' => $ok], $json ?: ['error' => ['message' => $err ?: 'Meta unreachable']]));
