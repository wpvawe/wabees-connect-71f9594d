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

// Simple daily log so we can see reject/terminate hits + Meta responses.
// Mirrors backend/api/webhook.php::webhook_log().
function send_call_log(string $msg): void {
    $logFile = __DIR__ . '/../logs/send-call_' . date('Y-m-d') . '.log';
    $dir = dirname($logFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    @file_put_contents($logFile, date('H:i:s') . ' ' . $msg . "\n", FILE_APPEND);
    @error_log('[WABEES send-call] ' . $msg);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => ['message' => 'Method not allowed']]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
send_call_log('REQ action=' . ($input['action'] ?? '-') . ' call_id=' . ($input['call_id'] ?? '-') . ' to=' . ($input['to'] ?? '-'));

require_once __DIR__ . '/../config/wa-bearer-auth.php';
$auth = wabees_apply_bearer_auth($input);
if (!empty($auth['error'])) {
    send_call_log('AUTH_FAIL ' . ($auth['error'] ?? ''));
    http_response_code((int)($auth['status'] ?? 401));
    echo json_encode(['error' => ['message' => $auth['error']]]);
    exit;
}
if (($auth['applied'] ?? false) !== true) {
    send_call_log('AUTH_MISSING bearer');
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
if ($action === 'connect' && empty($input['session'])) {
    // Honest guard: Meta's /calls endpoint REQUIRES an SDP session offer
    // for `connect`. Without a WebRTC/SIP media gateway we cannot generate
    // one, so the request would 400 at Meta. Fail early with a clear,
    // actionable message instead of forwarding a broken payload.
    http_response_code(501);
    echo json_encode(['error' => [
        'message' => 'Outbound calling requires a WebRTC/SIP media gateway. Meta Calling API needs an SDP session offer for action=connect — this build does not include a media server. Configure a SIP gateway in Meta → WhatsApp → Call settings → "Use SIP" to enable outbound calls.',
        'code'    => 'media_gateway_required',
    ]]);
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

send_call_log('META action=' . $action . ' call_id=' . $callId . ' http=' . $httpCode . ' resp=' . substr((string)$response, 0, 400) . ' err=' . $curlError);

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
if ($ownerUid !== '') {
    $firestoreHelper = __DIR__ . '/../config/firebase-config.php';
    if (file_exists($firestoreHelper)) require_once $firestoreHelper;

    if (function_exists('firestore_set')) {
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $metaOk = ($httpCode >= 200 && $httpCode < 300);
        $metaErrorMsg = '';
        if (!$metaOk && is_array($data) && isset($data['error'])) {
            $metaErrorMsg = is_array($data['error'])
                ? (string)($data['error']['message'] ?? json_encode($data['error']))
                : (string)$data['error'];
        }
        if ($action === 'connect' && $metaOk) {
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
            $mergeFields = ['updatedAt' => ['timestampValue' => $now]];
            if ($metaOk) {
                $mergeStatus = $action === 'reject' ? 'rejected' :
                               ($action === 'terminate' ? 'terminated' :
                               ($action === 'accept' ? 'connected' : $action));
                $mergeFields['status'] = ['stringValue' => $mergeStatus];
                if (in_array($action, ['reject', 'terminate'], true)) {
                    $mergeFields['endedAt'] = ['timestampValue' => $now];
                }
                if ($action === 'accept') {
                    $mergeFields['connectedAt'] = ['timestampValue' => $now];
                }
            }
            if (!$metaOk) {
                $mergeFields['metaError']    = ['stringValue' => $metaErrorMsg ?: ('HTTP ' . $httpCode)];
                $mergeFields['metaErrorHttp'] = ['integerValue' => (string)$httpCode];
                $mergeFields['lastActionFailed'] = ['stringValue' => $action];
            }
            @firestore_set("users/$ownerUid/call_logs/$callId", $mergeFields, true);
            send_call_log('FIRESTORE merged ' . $callId . ' action=' . $action . ' metaOk=' . ($metaOk ? '1' : '0'));
        }
    }
}

echo json_encode($data ?: ['error' => ['message' => 'No response from WhatsApp API']]);