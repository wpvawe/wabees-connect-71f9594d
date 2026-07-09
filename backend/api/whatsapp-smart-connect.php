<?php
/** WABEES — Smart WhatsApp connect discovery from phone_number_id + token. */

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

$phoneNumberId = preg_replace('/[^0-9]/', '', (string)($input['phone_number_id'] ?? ''));
$accessToken = trim((string)($input['access_token'] ?? ''));
if ($phoneNumberId === '' || $accessToken === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'phone_number_id and access_token are required']]);
    exit;
}

function wabees_graph_get_json(string $url, string $token): array {
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
    $json = json_decode($resp ?: '', true);
    return [$code, is_array($json) ? $json : [], $err];
}

$gv = defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0';
$fields = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,whatsapp_business_account';
[$pc, $phoneJson, $perr] = wabees_graph_get_json("https://graph.facebook.com/$gv/$phoneNumberId?fields=" . rawurlencode($fields), $accessToken);
if ($pc < 200 || $pc >= 300 || !empty($phoneJson['error'])) {
    http_response_code($pc >= 400 ? $pc : 502);
    echo json_encode(['success' => false, 'error' => ['message' => $phoneJson['error']['message'] ?? ($perr ?: 'Could not verify phone')]]);
    exit;
}

$wabaId = (string)($phoneJson['whatsapp_business_account']['id'] ?? '');
$businessId = '';
$businessName = '';
if ($wabaId !== '') {
    [$wc, $wabaJson] = wabees_graph_get_json("https://graph.facebook.com/$gv/" . rawurlencode($wabaId) . '?fields=id,name,owner_business', $accessToken);
    if ($wc >= 200 && $wc < 300) {
        $businessId = (string)($wabaJson['owner_business']['id'] ?? '');
        $businessName = (string)($wabaJson['owner_business']['name'] ?? ($wabaJson['name'] ?? ''));
    }
}

echo json_encode([
    'success' => true,
    'phone' => [
        'id' => (string)($phoneJson['id'] ?? $phoneNumberId),
        'display_phone_number' => (string)($phoneJson['display_phone_number'] ?? ''),
        'verified_name' => (string)($phoneJson['verified_name'] ?? ''),
        'quality_rating' => (string)($phoneJson['quality_rating'] ?? ''),
    ],
    'waba_id' => $wabaId,
    'business_id' => $businessId,
    'business_name' => $businessName,
]);
