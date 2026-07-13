<?php
/** WABEES — Verify a WhatsApp phone token and return phone metadata. */

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
require_once __DIR__ . '/../config/firebase-auth.php';
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$idToken = trim((string)($input['id_token'] ?? ''));
if (!$idToken && $authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) $idToken = trim($m[1]);
$uid = verify_firebase_id_token($idToken, $err);
if (!$uid) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => ['message' => $err ?: 'Unauthorized']]);
    exit;
}

$phoneNumberId = preg_replace('/[^0-9]/', '', (string)($input['phone_number_id'] ?? ''));
$accessToken = trim((string)($input['access_token'] ?? ''));
if ($phoneNumberId === '' || $accessToken === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'phone_number_id and access_token are required']]);
    exit;
}

$gv = defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0';

function wabees_verify_graph_get(string $url, string $token): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$resp, $code, $err];
}

// Try the full field set first. If Meta rejects `whatsapp_business_account`
// (error #100 — token lacks whatsapp_business_management scope on that node)
// retry with the safe subset so basic connect still works.
$fullFields = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,whatsapp_business_account';
$safeFields = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput';
[$resp, $code, $err] = wabees_verify_graph_get(
    "https://graph.facebook.com/$gv/$phoneNumberId?fields=" . rawurlencode($fullFields),
    $accessToken
);
$parsed = json_decode($resp ?: '', true);
$needsFallback = (
    $resp === false
    || $code < 200 || $code >= 300
    || (is_array($parsed) && !empty($parsed['error']) && (int)($parsed['error']['code'] ?? 0) === 100)
);
if ($needsFallback) {
    [$resp2, $code2, $err2] = wabees_verify_graph_get(
        "https://graph.facebook.com/$gv/$phoneNumberId?fields=" . rawurlencode($safeFields),
        $accessToken
    );
    if ($resp2 !== false && $code2 >= 200 && $code2 < 300) {
        $resp = $resp2; $code = $code2; $err = $err2;
    }
}

if ($resp === false) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => ['message' => $err ?: 'Meta unreachable']]);
    exit;
}

$json = json_decode($resp, true);
if (!is_array($json)) $json = ['raw' => $resp];
$ok = $code >= 200 && $code < 300 && empty($json['error']);
http_response_code($ok ? 200 : ($code ?: 502));
echo json_encode(array_merge([
    'success' => $ok,
    'business_account_id' => $json['whatsapp_business_account']['id'] ?? null,
], $json));
