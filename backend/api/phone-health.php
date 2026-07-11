<?php
/**
 * WABEES — Phone Health (Meta Graph quality_rating on Phone Number)
 *
 * POST https://api.wabees.live/api/phone-health.php
 * Body: { phone_number_id, id_token }
 * Response: {
 *   quality_rating: "GREEN"|"YELLOW"|"RED"|"UNKNOWN",
 *   messaging_limit_tier: string,
 *   verified_name: string,
 *   name_status: string,
 *   display_phone_number: string,
 *   code_verification_status: string,
 *   throughput_level: string
 * }
 *
 * Mirrors the Flutter app's phone health screen so website + app show
 * the same live signal, straight from Meta.
 */

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']); exit;
}

require_once __DIR__ . '/../config/wa-bearer-auth.php';

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$auth = wabees_apply_bearer_auth($body);
if (!empty($auth['error'])) {
    http_response_code((int)($auth['status'] ?? 401));
    echo json_encode(['error' => $auth['error']]); exit;
}

if (($auth['applied'] ?? false) === true) {
    $ownerUid = (string)($auth['owner_uid'] ?? '');
    $phoneNumberId = preg_replace('/[^0-9]/', '', (string)($body['phone_number_id'] ?? ''));
    $accessToken = (string)($body['access_token'] ?? '');
} else {
    // Backward-compatible fallback for older app builds that still send only
    // id_token in the JSON body.
    $idToken = (string)($body['id_token'] ?? '');
    if ($idToken === '') { http_response_code(401); echo json_encode(['error' => 'Firebase bearer token required']); exit; }
    $uid = verify_firebase_id_token($idToken, $err);
    if (!$uid) { http_response_code(401); echo json_encode(['error' => $err ?: 'Unauthorized']); exit; }
    $ownerUid = $uid;
    $userResp = firestore_get('users/' . rawurlencode($uid));
    if (($userResp['code'] ?? 404) === 200) {
        $f = $userResp['data']['fields'] ?? [];
        $dataOwner = trim((string)($f['dataOwner']['stringValue'] ?? ''));
        if ($dataOwner !== '' && $dataOwner !== $uid) $ownerUid = $dataOwner;
    }
    $creds = wabees_load_owner_credentials($ownerUid);
    if (!empty($creds['error'])) {
        http_response_code((int)($creds['status'] ?? 400));
        echo json_encode(['error' => $creds['error']]); exit;
    }
    $phoneNumberId = preg_replace('/[^0-9]/', '', (string)($creds['phone_number_id'] ?? ''));
    $accessToken = (string)($creds['access_token'] ?? '');
}

if (!$phoneNumberId || $accessToken === '') {
    http_response_code(400);
    echo json_encode(['error' => 'WhatsApp not fully connected']); exit;
}

$gv = 'v21.0';
$fields = 'verified_name,display_phone_number,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput';
$url = "https://graph.facebook.com/$gv/$phoneNumberId?fields=" . rawurlencode($fields);

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

// Best-effort cache back to Firestore so useWhatsAppConfig picks it up even
// when this endpoint is offline. Guarded because `firestore_patch` is not
// always available across backend versions — never let it 500 the response.
$quality = strtoupper((string)($json['quality_rating'] ?? ''));
if ($quality !== '' && function_exists('firestore_patch')) {
    try {
        firestore_patch("users/$ownerUid/whatsapp_config/config", [
            'qualityRating' => ['stringValue' => $quality],
            'qualityRatingCheckedAt' => ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')],
        ], ['qualityRating','qualityRatingCheckedAt']);
    } catch (\Throwable $e) {
        error_log('[phone-health] firestore_patch failed: ' . $e->getMessage());
    }
}

echo json_encode([
    'quality_rating'            => $quality ?: 'UNKNOWN',
    'messaging_limit_tier'      => (string)($json['messaging_limit_tier'] ?? ''),
    'verified_name'             => (string)($json['verified_name'] ?? ''),
    'name_status'               => (string)($json['name_status'] ?? ''),
    'display_phone_number'      => (string)($json['display_phone_number'] ?? ''),
    'code_verification_status'  => (string)($json['code_verification_status'] ?? ''),
    'throughput_level'          => (string)(($json['throughput']['level'] ?? '')),
]);