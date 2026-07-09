<?php
/** WABEES — Exchange Meta Embedded Signup code server-side. */

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => ['message' => 'POST required']]);
    exit;
}

require_once __DIR__ . '/../config/firebase-auth.php';

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$idToken = trim((string)($input['id_token'] ?? ''));
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!$idToken && $authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) $idToken = trim($m[1]);
$uid = verify_firebase_id_token($idToken, $err);
if (!$uid) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => ['message' => $err ?: 'Unauthorized']]);
    exit;
}

$code = trim((string)($input['code'] ?? ''));
$appId = getenv('META_APP_ID') ?: '2156417868496811';
$appSecret = getenv('META_APP_SECRET') ?: '';
$gv = getenv('META_GRAPH_VERSION') ?: (defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0');
if ($code === '' || $appSecret === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => $code === '' ? 'code is required' : 'Meta app secret is not configured']]);
    exit;
}

function wabees_exchange_get(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 5]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $json = json_decode($resp ?: '', true);
    return [$code, is_array($json) ? $json : [], $err];
}

$tokenUrl = "https://graph.facebook.com/$gv/oauth/access_token?" . http_build_query([
    'client_id' => $appId,
    'client_secret' => $appSecret,
    'code' => $code,
]);
[$tc, $tj, $te] = wabees_exchange_get($tokenUrl);
if ($tc < 200 || $tc >= 300 || empty($tj['access_token'])) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => ['message' => $tj['error']['message'] ?? ($te ?: 'Token exchange failed')]]);
    exit;
}
$accessToken = (string)$tj['access_token'];

function wabees_exchange_graph(string $path, string $token, string $fields = ''): array {
    $gv = getenv('META_GRAPH_VERSION') ?: 'v21.0';
    $url = "https://graph.facebook.com/$gv/$path" . ($fields !== '' ? '?fields=' . rawurlencode($fields) : '');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $json = json_decode($resp ?: '', true);
    return [$code, is_array($json) ? $json : []];
}

[$bc, $biz] = wabees_exchange_graph('me/businesses', $accessToken, 'id,name');
$businessId = (string)(($biz['data'][0]['id'] ?? '') ?: '');
$businessName = (string)(($biz['data'][0]['name'] ?? '') ?: '');
$wabaId = '';
$phone = [];
if ($businessId !== '') {
    [$wc, $wabas] = wabees_exchange_graph(rawurlencode($businessId) . '/owned_whatsapp_business_accounts', $accessToken, 'id,name');
    $wabaId = (string)(($wabas['data'][0]['id'] ?? '') ?: '');
    if ($wabaId !== '') {
        [$pc, $phones] = wabees_exchange_graph(rawurlencode($wabaId) . '/phone_numbers', $accessToken, 'id,display_phone_number,verified_name,quality_rating');
        $phone = is_array($phones['data'][0] ?? null) ? $phones['data'][0] : [];
    }
}

echo json_encode([
    'success' => true,
    'access_token' => $accessToken,
    'phone_number_id' => (string)($phone['id'] ?? ''),
    'waba_id' => $wabaId,
    'business_name' => $businessName ?: null,
    'display_phone' => isset($phone['display_phone_number']) ? (string)$phone['display_phone_number'] : null,
    'quality_rating' => isset($phone['quality_rating']) ? (string)$phone['quality_rating'] : null,
]);
