<?php
/** WABEES — Mark a WhatsApp message read and optionally send typing indicator. */

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
// SECURITY: require Firebase auth. Without this check a caller could bypass
// auth by supplying raw phone_number_id + access_token in the body.
if (($auth['applied'] ?? false) !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => ['message' => 'Unauthorized']]);
    exit;
}

$phoneNumberId = preg_replace('/[^0-9]/', '', (string)($input['phone_number_id'] ?? ''));
$accessToken = trim((string)($input['access_token'] ?? ''));
$messageId = trim((string)($input['message_id'] ?? ''));
if ($phoneNumberId === '' || $accessToken === '' || $messageId === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'phone_number_id, access_token and message_id are required']]);
    exit;
}

$payload = [
    'messaging_product' => 'whatsapp',
    'status' => 'read',
    'message_id' => $messageId,
];
if (!empty($input['typing_indicator'])) {
    $payload['typing_indicator'] = ['type' => (string)$input['typing_indicator']];
}

$gv = defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0';
$ch = curl_init("https://graph.facebook.com/$gv/$phoneNumberId/messages");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $accessToken],
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
