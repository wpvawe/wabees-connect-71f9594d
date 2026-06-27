<?php
/**
 * WABEES — External HTTP API: Send WhatsApp Message
 * 
 * POST https://api.wabees.live/api/send.php
 * 
 * Headers:
 *   X-Api-Key: your-api-key-here
 * 
 * JSON Body:
 *   { "phone": "923001234567", "message": "Hello from my website!" }
 * 
 * Response:
 *   { "success": true, "messageId": "wamid.xxx" }
 *   { "success": false, "error": "description" }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key');

// CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Only POST method allowed']);
    exit;
}

require_once __DIR__ . '/../config/firebase-config.php';

// ============ 1. AUTHENTICATE — JWT (Authorization: Bearer …) OR X-Api-Key ============
// JWT path is used by the WABEES web dashboard (signed with PHP_BACKEND_JWT_SECRET).
// X-Api-Key path remains for the Flutter app and external integrations.
$userId = null;          // set by whichever auth path succeeds
$phoneNumberId = null;
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');

if (preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    // ---- JWT verify (HS256) ----
    $jwt = trim($m[1]);
    $secret = getenv('PHP_BACKEND_JWT_SECRET');
    if (!$secret && is_file(__DIR__ . '/../config/jwt-secret.php')) {
        $secret = require __DIR__ . '/../config/jwt-secret.php';
    }
    if (!$secret) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'JWT secret not configured on server']);
        exit;
    }
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Malformed JWT']);
        exit;
    }
    [$h64, $p64, $s64] = $parts;
    $b64url_decode = function ($s) {
        $s = strtr($s, '-_', '+/');
        $pad = strlen($s) % 4;
        if ($pad) $s .= str_repeat('=', 4 - $pad);
        return base64_decode($s);
    };
    $expectedSig = hash_hmac('sha256', "$h64.$p64", $secret, true);
    $actualSig = $b64url_decode($s64);
    if (!hash_equals($expectedSig, $actualSig)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Invalid JWT signature']);
        exit;
    }
    $payload = json_decode($b64url_decode($p64), true);
    if (!is_array($payload)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Invalid JWT payload']);
        exit;
    }
    if (!empty($payload['exp']) && $payload['exp'] < time()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'JWT expired']);
        exit;
    }
    $uid = $payload['uid'] ?? ($payload['sub'] ?? '');
    if (empty($uid)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'JWT missing uid claim']);
        exit;
    }
    $userId = $uid;
    // Load phoneNumberId from user doc
    $userResp = firestore_get("users/$userId");
    if (($userResp['code'] ?? 404) === 200) {
        $f = $userResp['data']['fields'] ?? [];
        $phoneNumberId = $f['whatsappPhoneNumberId']['stringValue'] ?? '';
    }
} elseif (empty($apiKey)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Missing auth: provide Authorization: Bearer <jwt> or X-Api-Key']);
    exit;
}

// ============ 2. PARSE REQUEST ============
$body = json_decode(file_get_contents('php://input'), true);
if (!$body || empty($body['phone']) || empty($body['message'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Required fields: phone, message']);
    exit;
}

$phone = preg_replace('/[^0-9]/', '', $body['phone']);
$message = trim($body['message']);

if (strlen($phone) < 10) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid phone number']);
    exit;
}
if (strlen($message) < 1 || strlen($message) > 4096) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Message must be 1-4096 characters']);
    exit;
}

// Normalize: ensure + prefix
$phone = '+' . $phone;

// ============ 3. FIND USER BY API KEY (if JWT path didn't already set userId) ============
if (!$userId) {
    $queryResult = firestore_query('users', 'apiKey', 'EQUAL', $apiKey);
    foreach ($queryResult as $qr) {
        if (isset($qr['document'])) {
            $docName = $qr['document']['name'];
            $parts = explode('/', $docName);
            $userId = end($parts);
            $fields = $qr['document']['fields'] ?? [];
            $phoneNumberId = $fields['whatsappPhoneNumberId']['stringValue'] ?? '';
            break;
        }
    }
}

if (!$userId) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid API key']);
    exit;
}

// Get access token using robust helper (checks user doc + whatsapp_config subcollection)
$tokens = get_user_access_token($userId);
$accessToken = $tokens['accessToken'] ?? '';

if (empty($accessToken) || empty($phoneNumberId)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'WhatsApp not configured. Connect WhatsApp in the WABEES app first.']);
    exit;
}

// ============ 3b. SUBSCRIPTION CHECK — enforce plan limits ============
$subResp = firestore_get("users/$userId/subscription/current");
$subCode = $subResp['code'] ?? 404;
if ($subCode === 200) {
    $subFields = $subResp['data']['fields'] ?? [];
    $subStatus   = $subFields['status']['stringValue'] ?? 'inactive';
    $subEndRaw   = $subFields['endDate']['timestampValue']
                   ?? ($subFields['endDate']['stringValue'] ?? '');
    $expiryType  = $subFields['expiryType']['stringValue'] ?? 'monthly';
    $isLifetime  = ($expiryType === 'lifetime');
    $isExpired   = !$isLifetime && !empty($subEndRaw) && (strtotime($subEndRaw) < time());

    if ($subStatus !== 'active' || $isExpired) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Subscription expired or inactive. Please renew your plan.']);
        exit;
    }

    $maxMessages  = (int)($subFields['maxMessages']['integerValue'] ?? 0);
    $msgsUsed     = (int)($subFields['messagesUsed']['integerValue'] ?? 0);
    if ($maxMessages > 0 && $msgsUsed >= $maxMessages) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Monthly message limit reached. Please upgrade your plan.']);
        exit;
    }
}

// ============ 4. SEND VIA WHATSAPP ============
$waPayload = [
    'messaging_product' => 'whatsapp',
    'to' => ltrim($phone, '+'),
    'type' => 'text',
    'text' => ['body' => $message],
];

// Send directly to Meta Graph API (no relay needed on Hostinger)
$directUrl = "https://graph.facebook.com/v21.0/$phoneNumberId/messages";
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $directUrl,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($waPayload),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $accessToken,
    ],
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// ============ 5. PROCESS RESPONSE ============
$data = json_decode($response, true);

if ($httpCode >= 200 && $httpCode < 300) {
    $messageId = $data['messages'][0]['id'] ?? null;

    // Save outgoing message to Firestore
    $docId = 'msg_api_' . time() . '_' . rand(1000, 9999);
    $nowIso = gmdate('Y-m-d\TH:i:s\Z');

    firestore_set("users/$userId/messages/$docId", [
        'contactPhone' => $phone,
        'contactName' => $phone,
        'type' => 'text',
        'direction' => 'outgoing',
        'status' => 'sent',
        'body' => $message,
        'createdAt' => $nowIso,
        'sentVia' => 'api',
    ]);

    // Update conversation
    firestore_set("users/$userId/conversations/$phone", [
        'contactPhone' => $phone,
        'contactName' => $phone,
        'lastMessage' => mb_substr($message, 0, 100),
        'lastMessageType' => 'text',
        'lastMessageAt' => $nowIso,
    ], true);

    // Increment messagesUsed counter on subscription doc (non-fatal if it fails)
    firestore_increment("users/$userId/subscription/current", 'messagesUsed', 1);

    echo json_encode([
        'success' => true,
        'messageId' => $messageId,
        'phone' => $phone,
    ]);
} else {
    http_response_code(502);
    $errMsg = $data['error']['message'] ?? 'WhatsApp API error';
    echo json_encode([
        'success' => false,
        'error' => $errMsg,
        'httpCode' => $httpCode,
    ]);
}
