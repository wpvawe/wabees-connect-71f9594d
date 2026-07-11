<?php
/**
 * WABEES — WhatsApp Business Calling API Proxy
 * POST /api/send-call.php
 *
 * Actions (mirrors Meta Graph POST /{phone-number-id}/calls):
 *   - connect     → initiate outbound call (requires "to")
 *   - accept      → accept incoming (requires call_id + sdp answer)
 *   - pre_accept  → early media
 *   - reject      → reject incoming call
 *   - terminate   → end active call
 *
 * Auth: bearer Firebase ID token (same pattern as send-message.php). PHP
 * resolves phone_number_id + access_token from Firestore via dataOwner.
 *
 * The webhook (backend/api/webhook.php::handle_call_event) writes inbound
 * call events to users/{ownerUid}/call_logs/{callId} in Firestore, so the
 * browser only needs Firestore listeners to render live status. This
 * endpoint records outbound-initiated call intents there too.
 */

header('Content-Type: application/json');

require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => ['message' => 'Method not allowed']]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];

require_once __DIR__ . '/../config/wa-bearer-auth.php';
$auth = wabees_apply_bearer_auth($input);
if (!empty($auth['error'])) {
    http_response_code((int)($auth['status'] ?? 401));
    echo json_encode(['error' => ['message' => $auth['error']]]);
    exit;
}
if (($auth['applied'] ?? false) !== true) {
    http_response_code(401);
    echo json_encode(['error' => ['message' => 'Authorization bearer token is required']]);
    exit;
}

$phoneNumberId = $input['phone_number_id'] ?? '';
$accessToken   = $input['access_token']   ?? '';
$action        = $input['action']         ?? '';
$callId        = $input['call_id']        ?? '';
$to            = $input['to']             ?? '';

$allowedActions = ['connect', 'accept', 'pre_accept', 'reject', 'terminate'];
if (!in_array($action, $allowedActions, true)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => "action must be one of: " . implode(', ', $allowedActions)]]);
    exit;
}
if (empty($phoneNumberId) || empty($accessToken)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'phone_number_id / access_token missing']]);
    exit;
}
if ($action === 'connect' && empty($to)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'to is required for connect']]);
    exit;
}
if ($action !== 'connect' && empty($callId)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'call_id is required for ' . $action]]);
    exit;
}

$url = "https://graph.facebook.com/v24.0/{$phoneNumberId}/calls";

$payload = [
    'messaging_product' => 'whatsapp',
    'action'            => $action,
];
if ($action === 'connect') {
    $payload['to'] = $to;
    if (!empty($input['session'])) $payload['session'] = $input['session'];
} else {
    $payload['call_id'] = $callId;
    if (!empty($input['session']) && in_array($action, ['accept', 'pre_accept'], true)) {
        $payload['session'] = $input['session'];
    }
}
if (!empty($input['biz_opaque_callback_data'])) {
    $payload['biz_opaque_callback_data'] = (string)$input['biz_opaque_callback_data'];
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    "Authorization: Bearer {$accessToken}",
]);

$response  = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(500);
    echo json_encode(['error' => ['message' => 'Network error: ' . $curlError]]);
    exit;
}

$data = json_decode($response, true);
http_response_code(($httpCode >= 100 && $httpCode < 600) ? $httpCode : 502);

// Log outbound intents in Firestore so the browser sees status transitions
// even before Meta's first webhook event arrives.
$ownerUid = $auth['owner_uid'] ?? ($auth['auth_uid'] ?? '');
if ($ownerUid !== '' && $httpCode === 200) {
    $firestoreHelper = __DIR__ . '/../config/firebase-config.php';
    if (file_exists($firestoreHelper)) require_once $firestoreHelper;

    if (function_exists('firestore_set')) {
        $now = gmdate('Y-m-d\TH:i:s\Z');
        if ($action === 'connect') {
            $newId = is_array($data) && !empty($data['calls'][0]['id'])
                ? $data['calls'][0]['id']
                : ('local_' . bin2hex(random_bytes(6)));
            @firestore_set("users/$ownerUid/call_logs/$newId", [
                'callId'        => ['stringValue' => $newId],
                'to'            => ['stringValue' => (string)$to],
                'from'          => ['stringValue' => (string)$to],
                'type'          => ['stringValue' => 'outgoing'],
                'callType'      => ['stringValue' => 'voice'],
                'status'        => ['stringValue' => 'initiated'],
                'phoneNumberId' => ['stringValue' => (string)$phoneNumberId],
                'startedAt'     => ['timestampValue' => $now],
                'createdAt'     => ['timestampValue' => $now],
            ]);
        } elseif (!empty($callId)) {
            $mergeStatus = $action === 'reject' ? 'rejected' :
                           ($action === 'terminate' ? 'terminated' :
                           ($action === 'accept' ? 'connected' : $action));
            @firestore_set("users/$ownerUid/call_logs/$callId", [
                'status'    => ['stringValue' => $mergeStatus],
                'endedAt'   => ['timestampValue' => $now],
                'updatedAt' => ['timestampValue' => $now],
            ], true);
        }
    }
}

echo json_encode($data ?: ['error' => ['message' => 'No response from WhatsApp API']]);