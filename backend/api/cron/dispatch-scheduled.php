<?php
/**
 * WABEES — Scheduled Message Dispatcher (server cron)
 * Runs from Hostinger crontab every minute:
 *   * * * * * /usr/bin/curl -fsS "https://api.wabees.live/api/cron/dispatch-scheduled.php?key=REPLACE_ME" > /dev/null 2>&1
 *
 * - CollectionGroup query over users/{uid}/scheduled_messages where
 *   status IN ('pending','sending') AND scheduledFor <= now.
 * - Atomic claim (status -> 'sending' + claimedAt) so parallel cron ticks
 *   never double-send.
 * - Sends via Meta Graph using the owner's stored WhatsApp credentials.
 * - Writes an outgoing message doc + updates conversation to match what
 *   the website's client-side dispatcher used to do, so both surfaces show
 *   the message the same way.
 */

require_once __DIR__ . '/../../config/firebase-config.php';

header('Content-Type: application/json');

// ---- Auth ---------------------------------------------------------------
$expectedKey = getenv('WABEES_CRON_KEY') ?: '';
if ($expectedKey === '') {
    // Fallback for shared-hosting where env vars are painful — read from a
    // local file that is NOT committed to git.
    $keyFile = __DIR__ . '/../../config/cron-key.txt';
    if (is_file($keyFile)) $expectedKey = trim((string) @file_get_contents($keyFile));
}
$providedKey = $_GET['key'] ?? ($_SERVER['HTTP_X_CRON_KEY'] ?? '');
if ($expectedKey === '' || !hash_equals($expectedKey, (string) $providedKey)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// Guard against overlapping runs when a batch is slow.
$lock = @fopen(sys_get_temp_dir() . '/wabees_cron_dispatch.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo json_encode(['skipped' => 'busy']);
    exit;
}

$startedAt = microtime(true);
$now = new DateTime('now', new DateTimeZone('UTC'));
$nowIso = $now->format('Y-m-d\TH:i:s.v\Z');

// ---- Query: due pending/sending across every user (collection group) ----
$dueDocs = _fetch_due_scheduled($nowIso, 50);
$processed = [];
$staleWindowSec = 5 * 60;

foreach ($dueDocs as $doc) {
    $name = $doc['name'] ?? ''; // projects/.../documents/users/{uid}/scheduled_messages/{id}
    if (!$name) continue;
    if (!preg_match('#/documents/users/([^/]+)/scheduled_messages/([^/]+)$#', $name, $m)) continue;
    $uid = $m[1];
    $schedId = $m[2];
    $fields = $doc['fields'] ?? [];

    $status = _fs_string($fields['status'] ?? null, 'pending');
    $body = _fs_string($fields['body'] ?? null, '');
    $phone = _fs_string($fields['contactPhone'] ?? null, '');
    $updatedAt = _fs_timestamp($fields['updatedAt'] ?? null);
    $claimedAt = _fs_timestamp($fields['claimedAt'] ?? null);
    if ($body === '' || $phone === '') { _mark_failed($uid, $schedId, 'Missing body/phone'); continue; }

    // Skip fresh "sending" rows another worker owns; steal stale ones.
    if ($status === 'sending') {
        $lastAt = $updatedAt ?: $claimedAt;
        if ($lastAt && (time() - strtotime($lastAt)) < $staleWindowSec) continue;
    }

    // Atomic claim: only update if status still matches expected.
    $claim = firestore_update("users/$uid/scheduled_messages/$schedId", [
        'status' => 'sending',
        'claimedAt' => firestore_timestamp(),
        'updatedAt' => firestore_timestamp(),
    ], ['status', 'claimedAt', 'updatedAt']);
    if (($claim['code'] ?? 0) >= 400) continue;

    // Load owner's WA credentials.
    $ownerResp = firestore_get_cached("users/$uid", 60);
    $ownerFields = $ownerResp['fields'] ?? [];
    $phoneNumberId = _fs_string($ownerFields['whatsappPhoneNumberId'] ?? null, '');
    $accessToken = _fs_string($ownerFields['whatsappAccessToken'] ?? null, '');
    if ($phoneNumberId === '' || $accessToken === '') {
        _mark_failed($uid, $schedId, 'Owner has no WhatsApp credentials');
        continue;
    }

    // Send via Meta Graph.
    [$httpCode, $respJson] = _send_whatsapp_text($phoneNumberId, $accessToken, $phone, $body);
    $wamid = $respJson['messages'][0]['id'] ?? null;

    if ($httpCode >= 400 || !$wamid) {
        $err = $respJson['error']['message'] ?? "Meta error $httpCode";
        _mark_failed($uid, $schedId, $err);
        continue;
    }

    // Mirror what the website dispatcher wrote: a message doc + conversation summary.
    $msgId = 'sch_' . bin2hex(random_bytes(8));
    firestore_set("users/$uid/messages/$msgId", [
        'contactPhone' => $phone,
        'contactName' => $phone,
        'type' => 'text',
        'direction' => 'outgoing',
        'status' => 'sent',
        'body' => $body,
        'whatsappMessageId' => $wamid,
        'sentVia' => 'scheduled',
        'createdAt' => firestore_timestamp(),
    ], false);

    firestore_set("users/$uid/conversations/$phone", [
        'contactPhone' => $phone,
        'lastMessage' => $body,
        'lastMessageType' => 'text',
        'lastMessageAt' => firestore_timestamp(),
    ], true);

    firestore_update("users/$uid/scheduled_messages/$schedId", [
        'status' => 'sent',
        'sentMessageId' => $msgId,
        'sentWamid' => $wamid,
        'updatedAt' => firestore_timestamp(),
    ], ['status', 'sentMessageId', 'sentWamid', 'updatedAt']);

    firestore_increment("users/$uid", 'totalMessages', 1);

    $processed[] = ['uid' => $uid, 'id' => $schedId, 'wamid' => $wamid];
}

@flock($lock, LOCK_UN);
@fclose($lock);

echo json_encode([
    'ok' => true,
    'ranAt' => $nowIso,
    'checked' => count($dueDocs),
    'sent' => count($processed),
    'ms' => (int) ((microtime(true) - $startedAt) * 1000),
    'processed' => $processed,
]);

// -------- helpers --------------------------------------------------------

function _fetch_due_scheduled(string $nowIso, int $limit): array {
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents:runQuery';
    $q = [
        'structuredQuery' => [
            'from' => [[
                'collectionId' => 'scheduled_messages',
                'allDescendants' => true,
            ]],
            'where' => [
                'compositeFilter' => [
                    'op' => 'AND',
                    'filters' => [
                        ['fieldFilter' => [
                            'field' => ['fieldPath' => 'status'],
                            'op' => 'IN',
                            'value' => ['arrayValue' => ['values' => [
                                ['stringValue' => 'pending'],
                                ['stringValue' => 'sending'],
                            ]]],
                        ]],
                        ['fieldFilter' => [
                            'field' => ['fieldPath' => 'scheduledFor'],
                            'op' => 'LESS_THAN_OR_EQUAL',
                            'value' => ['timestampValue' => $nowIso],
                        ]],
                    ],
                ],
            ],
            'orderBy' => [
                ['field' => ['fieldPath' => 'scheduledFor'], 'direction' => 'ASCENDING'],
                ['field' => ['fieldPath' => '__name__'], 'direction' => 'ASCENDING'],
            ],
            'limit' => $limit,
        ],
    ];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($q),
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code >= 400) {
        error_log("[WABEES cron] runQuery failed $code $resp");
        return [];
    }
    $rows = json_decode($resp, true) ?: [];
    $out = [];
    foreach ($rows as $r) if (!empty($r['document'])) $out[] = $r['document'];
    return $out;
}

function _send_whatsapp_text(string $phoneNumberId, string $token, string $to, string $body): array {
    $url = "https://graph.facebook.com/v22.0/$phoneNumberId/messages";
    $payload = [
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => $to,
        'type' => 'text',
        'text' => ['preview_url' => true, 'body' => $body],
    ];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $token,
        ],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($resp, true) ?: []];
}

function _mark_failed(string $uid, string $schedId, string $reason): void {
    firestore_update("users/$uid/scheduled_messages/$schedId", [
        'status' => 'failed',
        'errorReason' => $reason,
        'updatedAt' => firestore_timestamp(),
    ], ['status', 'errorReason', 'updatedAt']);
}

function _fs_string($v, string $def = ''): string {
    if (!is_array($v)) return $def;
    return isset($v['stringValue']) ? (string) $v['stringValue'] : $def;
}
function _fs_timestamp($v): ?string {
    if (!is_array($v)) return null;
    return $v['timestampValue'] ?? null;
}
