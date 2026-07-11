<?php
/**
 * WABEES — WhatsApp Business Profile (get/update)
 *
 * POST https://api.wabees.live/api/business-profile.php
 * Body (get):    { action: "get",    phone_number_id, id_token }
 * Body (update): { action: "update", phone_number_id, id_token, about, description, email, address, websites, vertical }
 *
 * Reads/writes Meta Graph: /{phone-number-id}/whatsapp_business_profile
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
$action = (string)($body['action'] ?? 'get');

// Resolve the exact phone_number_id + access_token from the authenticated
// workspace, not from caller-supplied body values. This prevents profile fetch
// from using a stale/mismatched token and also supports agents via dataOwner.
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
    if ($idToken === '') {
        http_response_code(401);
        echo json_encode(['error' => 'Firebase bearer token required']); exit;
    }
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
$url = "https://graph.facebook.com/$gv/$phoneNumberId/whatsapp_business_profile";

if ($action === 'get') {
    $fields = 'about,address,description,email,profile_picture_url,websites,vertical';
    $ch = curl_init("$url?fields=" . rawurlencode($fields));
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
    $row = $json['data'][0] ?? $json;
    echo json_encode([
        'about'               => $row['about']               ?? '',
        'address'             => $row['address']             ?? '',
        'description'         => $row['description']         ?? '',
        'email'               => $row['email']               ?? '',
        'profile_picture_url' => $row['profile_picture_url'] ?? '',
        'websites'            => $row['websites']            ?? [],
        'vertical'            => $row['vertical']            ?? 'UNDEFINED',
    ]);
    exit;
}

if ($action === 'update') {
    $payload = ['messaging_product' => 'whatsapp'];
    foreach (['about', 'address', 'description', 'email', 'vertical'] as $k) {
        if (isset($body[$k]) && $body[$k] !== '') $payload[$k] = (string)$body[$k];
    }
    if (isset($body['websites']) && is_array($body['websites'])) {
        $payload['websites'] = array_values(array_filter(array_map('strval', $body['websites'])));
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $accessToken,
        ],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $json = json_decode($resp, true);
    if ($code < 200 || $code >= 300) {
        http_response_code(502);
        echo json_encode(['error' => $json['error']['message'] ?? 'Graph API error', 'httpCode' => $code]);
        exit;
    }
    echo json_encode(['success' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unknown action']);