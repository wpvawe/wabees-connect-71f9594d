<?php
/**
 * WABEES — WhatsApp API Proxy: Send Message
 * POST /api/send-message.php
 * Types: text, template, image, video, document, audio, sticker, reaction,
 *        location, interactive (button / cta_url / list)
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

$required = ['phone_number_id', 'access_token', 'to', 'type'];
foreach ($required as $field) {
    if (empty($input[$field])) {
        http_response_code(400);
        echo json_encode(['error' => ['message' => "$field is required"]]);
        exit;
    }
}

$phoneNumberId = $input['phone_number_id'];
$accessToken   = $input['access_token'];
$to            = $input['to'];
$type          = $input['type'];

// --- Plan quota enforcement --------------------------------------------
// The React client (src/lib/wabees/api.ts) attaches `auth_uid` to every
// send-message.php call. Reactions, marks-read etc. also flow through here
// but shouldn't consume the message quota. We only meter revenue-shaped
// sends (text / template / media / interactive / location).
$METERED_TYPES = ['text', 'template', 'image', 'video', 'document', 'audio',
                  'sticker', 'interactive', 'location'];
$authUid  = isset($input['auth_uid']) ? preg_replace('/[^A-Za-z0-9_-]/', '', (string)$input['auth_uid']) : '';
$ownerUid = '';
$shouldMeter = in_array($type, $METERED_TYPES, true) && $authUid !== '';

if ($shouldMeter) {
    // Best-effort include of the shared Firestore helpers used by
    // send.php / webhook.php. If the include path is unavailable in this
    // deploy, skip metering silently — the client-side gate still applies.
    $firestoreHelper = __DIR__ . '/../config/firebase-config.php';
    if (file_exists($firestoreHelper)) {
        require_once $firestoreHelper;
    }
    if (function_exists('firestore_get')) {
        $ownerUid = $authUid;
        $userResp = firestore_get("users/$authUid");
        if (($userResp['code'] ?? 0) !== 200) {
            http_response_code(503);
            echo json_encode(['error' => ['message' => 'Quota service unavailable. Try again shortly.']]);
            exit;
        }
        $userFields = $userResp['data']['fields'] ?? null;
        if (is_array($userFields)) {
            $dataOwner = $userFields['dataOwner']['stringValue'] ?? '';
            if (is_string($dataOwner) && $dataOwner !== '') {
                $ownerUid = preg_replace('/[^A-Za-z0-9_-]/', '', $dataOwner);
            }
        }
        $subResp = firestore_get("users/$ownerUid/subscription/current");
        if (($subResp['code'] ?? 0) !== 200) {
            http_response_code(503);
            echo json_encode(['error' => ['message' => 'Quota service unavailable. Try again shortly.']]);
            exit;
        }
        $subFields = $subResp['data']['fields'] ?? null;
        if (is_array($subFields)) {
            $maxMessages = (int)($subFields['maxMessages']['integerValue'] ?? 0);
            $msgsUsed    = (int)($subFields['messagesUsed']['integerValue'] ?? 0);
            // Audit §2.3 — the client no longer client-reserves the
            // messages quota (`reserveQuota(..., "messages", ...)` is a
            // documented no-op post-BUG-09). The previous `max(0,
            // $msgsUsed - 1)` compensation for `quota_reserved: true`
            // was silently raising the real cap by +1 on every call.
            // PHP is now the sole owner of the counter and compares
            // the true `messagesUsed` against `maxMessages` directly.
            if ($maxMessages > 0 && $msgsUsed >= $maxMessages) {
                http_response_code(429);
                echo json_encode(['error' => [
                    'message' => "Message quota exhausted ($msgsUsed/$maxMessages). Upgrade your plan to send more.",
                    'code' => 'plan_quota_exceeded',
                ]]);
                exit;
            }
        }
    } else {
        http_response_code(503);
        echo json_encode(['error' => ['message' => 'Quota service unavailable. Try again shortly.']]);
        exit;
    }
}

$url = "https://graph.facebook.com/v21.0/{$phoneNumberId}/messages";

$payload = [
    'messaging_product' => 'whatsapp',
    'recipient_type'    => 'individual',
    'to'                => $to,
];

switch ($type) {
    case 'text':
        if (empty($input['message'])) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'message is required for text type']]);
            exit;
        }
        $payload['type'] = 'text';
        $payload['text'] = ['preview_url' => true, 'body' => $input['message']];
        break;

    case 'template':
        if (empty($input['template_name']) || empty($input['language_code'])) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'template_name and language_code are required']]);
            exit;
        }
        $payload['type'] = 'template';
        $payload['template'] = [
            'name'     => $input['template_name'],
            'language' => ['code' => $input['language_code']],
        ];
        if (!empty($input['components'])) {
            $payload['template']['components'] = $input['components'];
        }
        break;

    case 'image':
    case 'video':
    case 'document':
    case 'audio':
    case 'sticker':
        $mediaId  = $input['media_id']  ?? '';
        $mediaUrl = $input['media_url'] ?? '';
        if (empty($mediaId) && empty($mediaUrl)) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'media_id or media_url is required for media type']]);
            exit;
        }
        $payload['type'] = $type;
        $mediaPayload = [];
        if (!empty($mediaId))      $mediaPayload['id']   = $mediaId;
        else                       $mediaPayload['link'] = $mediaUrl;
        if (!empty($input['caption']) && in_array($type, ['image','video','document'], true)) {
            $mediaPayload['caption'] = $input['caption'];
        }
        if ($type === 'document' && !empty($input['filename'])) {
            $mediaPayload['filename'] = $input['filename'];
        }
        if ($type === 'audio' && !empty($input['is_voice'])) {
            $mediaPayload['voice'] = true;
        }
        $payload[$type] = $mediaPayload;
        break;

    case 'reaction':
        if (empty($input['message_id'])) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'message_id is required for reaction']]);
            exit;
        }
        $payload['type'] = 'reaction';
        $payload['reaction'] = [
            'message_id' => $input['message_id'],
            'emoji'      => $input['emoji'] ?? '',
        ];
        break;

    case 'location':
        $lat = $input['latitude']  ?? null;
        $lng = $input['longitude'] ?? null;
        if ($lat === null || $lng === null) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'latitude and longitude are required for location']]);
            exit;
        }
        $payload['type']     = 'location';
        $payload['location'] = [
            'latitude'  => (float)$lat,
            'longitude' => (float)$lng,
        ];
        if (!empty($input['name']))    $payload['location']['name']    = (string)$input['name'];
        if (!empty($input['address'])) $payload['location']['address'] = (string)$input['address'];
        break;

    case 'interactive':
        // Sub-types: button (quick reply buttons), cta_url, list.
        $sub  = $input['interactive_type'] ?? '';
        $body = trim((string)($input['body_text'] ?? ''));
        if ($body === '') {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'body_text is required for interactive']]);
            exit;
        }
        $payload['type']        = 'interactive';
        $interactive            = ['type' => $sub, 'body' => ['text' => $body]];
        if (!empty($input['header_text'])) {
            $interactive['header'] = ['type' => 'text', 'text' => (string)$input['header_text']];
        }
        if (!empty($input['footer_text'])) {
            $interactive['footer'] = ['text' => (string)$input['footer_text']];
        }
        if ($sub === 'button') {
            // Meta allows up to 3 quick-reply buttons.
            $buttons = $input['buttons'] ?? [];
            if (!is_array($buttons) || count($buttons) === 0) {
                http_response_code(400);
                echo json_encode(['error' => ['message' => 'buttons[] is required']]);
                exit;
            }
            $btnPayload = [];
            foreach (array_slice($buttons, 0, 3) as $b) {
                $id    = (string)($b['id']    ?? uniqid('btn_', true));
                $title = trim((string)($b['title'] ?? ''));
                if ($title === '') continue;
                $btnPayload[] = [
                    'type'  => 'reply',
                    'reply' => ['id' => $id, 'title' => mb_substr($title, 0, 20)],
                ];
            }
            $interactive['action'] = ['buttons' => $btnPayload];
        } elseif ($sub === 'cta_url') {
            $btnText = trim((string)($input['display_text'] ?? 'Open'));
            $btnUrl  = trim((string)($input['url'] ?? ''));
            if ($btnUrl === '') {
                http_response_code(400);
                echo json_encode(['error' => ['message' => 'url is required for cta_url']]);
                exit;
            }
            $interactive['action'] = [
                'name'       => 'cta_url',
                'parameters' => ['display_text' => mb_substr($btnText, 0, 20), 'url' => $btnUrl],
            ];
        } elseif ($sub === 'list') {
            $btnText  = trim((string)($input['button_text'] ?? 'Choose'));
            $sections = $input['sections'] ?? [];
            if (!is_array($sections) || count($sections) === 0) {
                http_response_code(400);
                echo json_encode(['error' => ['message' => 'sections[] is required for list']]);
                exit;
            }
            $interactive['action'] = [
                'button'   => mb_substr($btnText, 0, 20),
                'sections' => $sections,
            ];
        } else {
            http_response_code(400);
            echo json_encode(['error' => ['message' => "Unsupported interactive_type: $sub"]]);
            exit;
        }
        $payload['interactive'] = $interactive;
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => ['message' => "Unsupported message type: $type"]]);
        exit;
}

// Reply context — only valid for non-reaction sends. Meta silently drops
// context when message_id is missing/empty, so we log both branches to
// diagnose why some replies (voice/document) land without a quote.
$ctxId = isset($input['context_message_id']) ? trim((string)$input['context_message_id']) : '';
if ($type !== 'reaction' && $ctxId !== '') {
    $payload['context'] = ['message_id' => $ctxId];
    error_log("[WABEES] SEND_CTX type=$type ctx=$ctxId to=$to");
} elseif ($type !== 'reaction' && isset($input['context_message_id'])) {
    error_log("[WABEES] SEND_CTX_EMPTY type=$type raw=" . json_encode($input['context_message_id']));
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

if ($httpCode !== 200) {
    $logFile = __DIR__ . '/../logs/send_errors_' . date('Y-m-d') . '.log';
    $logDir  = dirname($logFile);
    if (!is_dir($logDir)) mkdir($logDir, 0755, true);
    file_put_contents(
        $logFile,
        date('H:i:s') . " TO=$to TYPE=$type HTTP=$httpCode CURL_ERR=$curlError RESPONSE=$response\n",
        FILE_APPEND
    );
    error_log("[WABEES] SEND_ERROR TO=$to TYPE=$type HTTP=$httpCode RESP=$response");
} else {
    error_log("[WABEES] SEND_OK TO=$to TYPE=$type");
}

if ($curlError) {
    http_response_code(500);
    echo json_encode(['error' => ['message' => 'Network error: ' . $curlError]]);
    exit;
}

$data = json_decode($response, true);
// Guard against $httpCode == 0 (curl returned but no HTTP status) — otherwise
// http_response_code(0) is a no-op and the client sees a stale 200.
http_response_code(($httpCode >= 100 && $httpCode < 600) ? $httpCode : 502);

// After a successful Meta send, increment the owner's usage counters so
// the next request can enforce the cap. Non-fatal on failure.
//
// PHP is the single quota-counter owner for message sends. Browser/native
// clients only preflight; they do not reserve message quota client-side.
if (
    $shouldMeter
    && $ownerUid !== ''
    && $httpCode === 200
    && function_exists('firestore_increment')
) {
    @firestore_increment("users/$ownerUid/subscription/current", 'messagesUsed', 1);
    @firestore_increment("users/$ownerUid", 'totalMessages', 1);
}

// BUG-02/24 — bump today's analytics rollup so the dashboard chart can
// render from a bounded (30-doc) read instead of scanning the whole
// messages subcollection. Runs on every successful outgoing send, not
// just metered ones, so agent/native sends also show up in analytics.
if (
    $ownerUid !== ''
    && $httpCode === 200
    && function_exists('firestore_update_with_increment')
) {
    $date = gmdate('Y-m-d');
    try {
        @firestore_update_with_increment(
            "users/$ownerUid/analytics_daily/$date",
            ['date' => $date],
            ['messages' => 1, 'outgoing' => 1]
        );
    } catch (\Throwable $e) {
        // Analytics must never break the send response.
    }
}

echo json_encode($data ?: ['error' => ['message' => 'No response from WhatsApp API']]);