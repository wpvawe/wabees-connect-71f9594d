<?php
/**
 * WABEES — Scheduled Message Dispatcher (server cron)
 * Runs from Hostinger crontab every minute:
 *   * * * * * /usr/bin/curl -fsS "https://api.wabees.live/cron/dispatch-scheduled.php?key=REPLACE_ME" > /dev/null 2>&1
 *
 * - Per-user query on users/{uid}/scheduled_messages using ONLY a
 *   single-field filter (scheduledFor <= now). Single-field indexes are
 *   automatic in Firestore, so no composite / collection-group index is
 *   required. Status is filtered in PHP.
 * - Atomic claim (status -> 'sending' + claimedAt) so parallel cron ticks
 *   never double-send.
 * - Sends via Meta Graph using the owner's stored WhatsApp credentials.
 * - Writes an outgoing message doc + updates conversation to match what
 *   the website's client-side dispatcher used to do, so both surfaces show
 *   the message the same way.
 */

require_once __DIR__ . '/../../config/firebase-config.php';

header('Content-Type: application/json');
ignore_user_abort(true);
if (function_exists('set_time_limit')) @set_time_limit(55);

// ---- Auth ---------------------------------------------------------------
$expectedKey = getenv('WABEES_CRON_KEY') ?: '';
if ($expectedKey === '') {
    // Fallback for shared-hosting where env vars are painful — read from a
    // local file that is NOT committed to git.
    $keyFile = __DIR__ . '/../../config/cron-key.txt';
    if (is_file($keyFile)) $expectedKey = trim((string) @file_get_contents($keyFile));
}
$providedKey = $_GET['key'] ?? ($_SERVER['HTTP_X_CRON_KEY'] ?? '');

// Allow local PHP-CLI invocations without a key (hPanel cron running
// `/usr/bin/php .../dispatch-scheduled.php` directly). Never bypass auth for
// loopback HTTP: shared-host co-tenants can call 127.0.0.1 too.
$isCli = (PHP_SAPI === 'cli');
$localBypass = $isCli;

if (!$localBypass && ($expectedKey === '' || !hash_equals($expectedKey, (string) $providedKey))) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// Guard against overlapping runs when a batch is slow.
$lockPath = sys_get_temp_dir() . '/wabees_cron_dispatch.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false) {
    error_log('[WABEES cron] Cannot open lock file: ' . $lockPath);
    http_response_code(500);
    echo json_encode(['error' => 'lock unavailable']);
    exit;
}
if (!flock($lock, LOCK_EX | LOCK_NB)) {
    echo json_encode(['skipped' => 'busy']);
    exit;
}

$startedAt = microtime(true);
$now = new DateTime('now', new DateTimeZone('UTC'));
$nowIso = $now->format('Y-m-d\TH:i:s.v\Z');

// ---- Query: due pending/sending globally -------------------------------
$dueDocs = _fetch_due_scheduled_global($nowIso, 500);
if (empty($dueDocs) && !empty($GLOBALS['_wabees_cron_global_query_failed'])) {
    // If a Firestore project is missing the scheduled_messages collection-group
    // index, fall back to a bounded per-user scan instead of doing nothing.
    $dueDocs = _fetch_due_scheduled_per_user($nowIso, 10);
}
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

    // Atomic claim: use the document updateTime as an optimistic lock so
    // two cron workers on different hosts cannot both send the same row.
    $claim = _claim_scheduled_message($uid, $schedId, [
        'status' => 'sending',
        'claimedAt' => firestore_timestamp(),
        'updatedAt' => firestore_timestamp(),
    ], $doc['updateTime'] ?? null);
    if (($claim['code'] ?? 0) >= 400) continue;

    // Load owner's WA credentials.
    $ownerResp = firestore_get("users/$uid");
    $ownerFields = $ownerResp['data']['fields'] ?? [];
    $phoneNumberId = _fs_string($ownerFields['whatsappPhoneNumberId'] ?? null, '');
    $accessToken = _fs_string($ownerFields['whatsappAccessToken'] ?? null, '');
    if ($phoneNumberId === '' || $accessToken === '') {
        $configResp = firestore_get("users/$uid/whatsapp_config/config");
        $configFields = $configResp['data']['fields'] ?? [];
        if ($phoneNumberId === '') $phoneNumberId = _fs_string($configFields['phoneNumberId'] ?? null, '');
        if ($accessToken === '') $accessToken = _fs_string($configFields['accessToken'] ?? null, '');
    }
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

    // Re-queue next occurrence for recurring schedules.
    $recurrence = _fs_string($fields['recurrence'] ?? null, 'none');
    if (in_array($recurrence, ['daily', 'weekly', 'monthly'], true)) {
        $origIso = _fs_timestamp($fields['scheduledFor'] ?? null);
        $nextTs = _next_occurrence($origIso, $recurrence);
        if ($nextTs) {
            $nextId = 'rec_' . bin2hex(random_bytes(8));
            firestore_set("users/$uid/scheduled_messages/$nextId", [
                'contactPhone' => $phone,
                'body' => $body,
                'scheduledFor' => ['timestampValue' => $nextTs],
                'status' => 'pending',
                'errorReason' => null,
                'sentMessageId' => null,
                'recurrence' => $recurrence,
                'createdAt' => firestore_timestamp(),
            ], false);
        }
    }

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

/**
 * Pull only DUE scheduled_messages via a collection-group query with a
 * compositeFilter on (scheduledFor <= now) AND (status IN [pending,sending]).
 * This requires a COLLECTION_GROUP index on scheduled_messages:
 *   fields: status ASC, scheduledFor ASC
 * Deploy via `firebase deploy --only firestore:indexes`.
 *
 * If the index is missing, Firestore returns FAILED_PRECONDITION (400); the
 * caller falls back to the bounded per-user scan so cron still fires.
 */
function _fetch_due_scheduled_global(string $nowIso, int $limit): array {
    $out = [];
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents:runQuery';
    $q = [
        'structuredQuery' => [
            'from' => [['collectionId' => 'scheduled_messages', 'allDescendants' => true]],
            'where' => [
                'compositeFilter' => [
                    'op' => 'AND',
                    'filters' => [
                        [
                            'fieldFilter' => [
                                'field' => ['fieldPath' => 'scheduledFor'],
                                'op' => 'LESS_THAN_OR_EQUAL',
                                'value' => ['timestampValue' => $nowIso],
                            ],
                        ],
                        [
                            'fieldFilter' => [
                                'field' => ['fieldPath' => 'status'],
                                'op' => 'IN',
                                'value' => [
                                    'arrayValue' => [
                                        'values' => [
                                            ['stringValue' => 'pending'],
                                            ['stringValue' => 'sending'],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
            'orderBy' => [
                ['field' => ['fieldPath' => 'scheduledFor'], 'direction' => 'ASCENDING'],
            ],
            'limit' => $limit,
        ],
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($q),
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (_firestore_should_retry_auth($code, $resp)) {
        error_log('[WABEES cron] global due query auth retry');
        curl_setopt($ch, CURLOPT_HTTPHEADER, _firestore_refresh_auth_headers());
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    }
    curl_close($ch);

    if ($code >= 400 || $code === 0) {
        $GLOBALS['_wabees_cron_global_query_failed'] = true;
        error_log("[WABEES cron] global due query $code " . substr((string) $resp, 0, 500));
        return [];
    }
    $rows = json_decode($resp, true) ?: [];
    foreach ($rows as $r) {
        if (empty($r['document'])) continue;
        $doc = $r['document'];
        $status = _fs_string(($doc['fields']['status'] ?? null), 'pending');
        if ($status !== 'pending' && $status !== 'sending') continue;
        $scheduledFor = _fs_timestamp($doc['fields']['scheduledFor'] ?? null);
        if ($scheduledFor && strtotime($scheduledFor) > strtotime($nowIso)) continue;
        $out[] = $doc;
    }
    return $out;
}

function _claim_scheduled_message(string $uid, string $schedId, array $data, ?string $updateTime): array {
    if (!$updateTime) {
        return ['code' => 409, 'data' => ['error' => ['message' => 'missing updateTime']]];
    }
    $path = "users/$uid/scheduled_messages/$schedId";
    $params = [
        'currentDocument.updateTime=' . urlencode($updateTime),
        'updateMask.fieldPaths=status',
        'updateMask.fieldPaths=claimedAt',
        'updateMask.fieldPaths=updatedAt',
    ];
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents/' . $path . '?' . implode('&', $params);
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_NOSIGNAL => 1,
        CURLOPT_URL => $url,
        CURLOPT_CUSTOMREQUEST => 'PATCH',
        CURLOPT_POSTFIELDS => json_encode(['fields' => convert_to_firestore_fields($data)]),
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (_firestore_should_retry_auth($httpCode, $response)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, _firestore_refresh_auth_headers());
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    }
    if ($httpCode >= 400 || $httpCode === 0) {
        error_log("[WABEES cron] claim skipped/failed ($httpCode) path=$path err=" . curl_error($ch));
    }
    curl_close($ch);
    return ['code' => $httpCode, 'data' => json_decode((string)$response, true)];
}

function _fetch_due_scheduled_per_user(string $nowIso, int $perUserLimit): array {
    $out = [];
    $pageToken = null;
    $maxUsers = 80;
    $scanned = 0;
    $started = microtime(true);
    do {
        [$userIds, $pageToken] = _list_user_ids($pageToken, 100);
        foreach ($userIds as $uid) {
            if (++$scanned > $maxUsers) break 2;
            if ((microtime(true) - $started) > 40) break 2;
            $docs = _query_user_due($uid, $nowIso, $perUserLimit);
            foreach ($docs as $d) $out[] = $d;
            if (count($out) >= 50) break 2;
        }
    } while ($pageToken);
    return $out;
}

// Kept as bounded fallback for projects missing collection-group indexes.
function _list_user_ids(?string $pageToken, int $pageSize): array {
    // listDocuments returns only document names — cheap read.
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents/users?pageSize=' . $pageSize
        . '&mask.fieldPaths=_';
    if ($pageToken) $url .= '&pageToken=' . urlencode($pageToken);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (_firestore_should_retry_auth($code, $resp)) {
        error_log('[WABEES cron] list users auth retry');
        curl_setopt($ch, CURLOPT_HTTPHEADER, _firestore_refresh_auth_headers());
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    }
    curl_close($ch);
    if ($code >= 400) { error_log("[WABEES cron] list users $code $resp"); return [[], null]; }
    $j = json_decode($resp, true) ?: [];
    $ids = [];
    foreach (($j['documents'] ?? []) as $d) {
        if (preg_match('#/documents/users/([^/]+)$#', $d['name'] ?? '', $m)) $ids[] = $m[1];
    }
    return [$ids, $j['nextPageToken'] ?? null];
}

function _query_user_due(string $uid, string $nowIso, int $limit): array {
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents/users/' . rawurlencode($uid) . ':runQuery';
    $q = [
        'structuredQuery' => [
            'from' => [['collectionId' => 'scheduled_messages']],
            'where' => [
                'fieldFilter' => [
                    'field' => ['fieldPath' => 'scheduledFor'],
                    'op' => 'LESS_THAN_OR_EQUAL',
                    'value' => ['timestampValue' => $nowIso],
                ],
            ],
            'orderBy' => [
                ['field' => ['fieldPath' => 'scheduledFor'], 'direction' => 'ASCENDING'],
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
    if (_firestore_should_retry_auth($code, $resp)) {
        error_log("[WABEES cron] user $uid query auth retry");
        curl_setopt($ch, CURLOPT_HTTPHEADER, _firestore_refresh_auth_headers());
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    }
    curl_close($ch);
    if ($code >= 400) { error_log("[WABEES cron] user $uid query $code $resp"); return []; }
    $rows = json_decode($resp, true) ?: [];
    $out = [];
    foreach ($rows as $r) {
        if (empty($r['document'])) continue;
        $doc = $r['document'];
        // Filter status in PHP to avoid composite index.
        $status = _fs_string(($doc['fields']['status'] ?? null), 'pending');
        if ($status !== 'pending' && $status !== 'sending') continue;
        $out[] = $doc;
    }
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

function _next_occurrence(?string $origIso, string $recurrence): ?string {
    $base = $origIso ? strtotime($origIso) : time();
    if (!$base) return null;
    $nowTs = time();
    // Roll forward until strictly in the future (skip missed cycles).
    $ts = $base;
    $guard = 0;
    do {
        switch ($recurrence) {
            case 'daily': $ts = strtotime('+1 day', $ts); break;
            case 'weekly': $ts = strtotime('+1 week', $ts); break;
            case 'monthly': $ts = strtotime('+1 month', $ts); break;
            default: return null;
        }
        if (++$guard > 500) return null;
    } while ($ts <= $nowTs);
    return gmdate('Y-m-d\TH:i:s.000\Z', $ts);
}
