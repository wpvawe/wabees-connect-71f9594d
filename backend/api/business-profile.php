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

require_once __DIR__ . '/../config/firebase-config.php';
require_once __DIR__ . '/../config/firebase-auth.php';

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$action        = (string)($body['action'] ?? 'get');
$idToken       = (string)($body['id_token'] ?? '');
$phoneNumberId = preg_replace('/[^0-9]/', '', (string)($body['phone_number_id'] ?? ''));

if (!$phoneNumberId) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing phone_number_id']); exit;
}

// High-sev fix: Firebase auth is now required. Previously this endpoint
// accepted a caller-supplied `access_token` in the body, which let anyone
// with (or who could brute-force) a Meta Graph token hit /whatsapp_business_profile
// under our origin's CORS. Server now resolves the token from the caller's
// own workspace via their verified Firebase id_token only.
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if ($idToken === '' && $authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    $idToken = trim($m[1]);
}
if ($idToken === '') {
    http_response_code(401);
    echo json_encode(['error' => 'Firebase id_token required']); exit;
}
$uid = verify_firebase_id_token($idToken, $err);
if (!$uid) { http_response_code(401); echo json_encode(['error' => $err ?: 'Unauthorized']); exit; }

// Resolve owner (agents use their owner's WA credentials).
$ownerUid = $uid;
$userResp = firestore_get("users/$uid");
if (($userResp['code'] ?? 404) === 200) {
    $f = $userResp['data']['fields'] ?? [];
    $dataOwner = trim($f['dataOwner']['stringValue'] ?? '');
    if ($dataOwner !== '' && $dataOwner !== $uid) $ownerUid = $dataOwner;
}
$tokens = get_user_access_token($ownerUid);
$accessToken = (string)($tokens['accessToken'] ?? '');
if ($accessToken === '') {
    http_response_code(400);
    echo json_encode(['error' => 'WhatsApp not connected']); exit;
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