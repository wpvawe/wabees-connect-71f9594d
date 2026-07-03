<?php
/**
 * WABEES — Firebase REST API Configuration
 * 
 * Used by webhook to write incoming messages and update statuses in Firestore.
 * All calls are authenticated via Firebase Admin SDK (service account).
 */

// Include guard — prevent "Cannot redeclare" fatal errors
if (defined('FIREBASE_CONFIG_LOADED'))
    return;
define('FIREBASE_CONFIG_LOADED', true);

// Firebase project configuration
// NOTE: Hostinger shared hosting — env vars not available, hardcoded
if (!defined('FIREBASE_PROJECT_ID')) {
    define('FIREBASE_PROJECT_ID', 'wabees-app');
}

// Load Firebase Admin SDK for authenticated access
require_once __DIR__ . '/firebase-admin.php';

/**
 * Shared reusable curl handle for Firestore REST API.
 * Keeps HTTP/2 + TLS connections alive across calls.
 * IMPORTANT: Never use CURLOPT_CUSTOMREQUEST with this handle.
 */
function _firestore_curl()
{
    static $ch = null;
    if ($ch === null) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
        curl_setopt($ch, CURLOPT_NOSIGNAL, 1);
        curl_setopt($ch, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_2_0);
        curl_setopt($ch, CURLOPT_FORBID_REUSE, false);
        curl_setopt($ch, CURLOPT_FRESH_CONNECT, false);
    }
    // Reset to GET mode (safe — no CUSTOMREQUEST used)
    curl_setopt($ch, CURLOPT_POST, false);
    curl_setopt($ch, CURLOPT_POSTFIELDS, '');
    curl_setopt($ch, CURLOPT_HTTPGET, true);
    return $ch;
}

/**
 * Google occasionally returns 401 when an OAuth token has expired but a shared
 * Hostinger cache still serves it. Clear every token cache and retry once.
 */
function _firestore_should_retry_auth($httpCode, $response)
{
    if ((int) $httpCode === 401) return true;
    if (!is_string($response) || $response === '') return false;
    return stripos($response, 'ACCESS_TOKEN_EXPIRED') !== false
        || stripos($response, 'UNAUTHENTICATED') !== false
        || stripos($response, 'invalid_token') !== false;
}

function _firestore_refresh_auth_headers()
{
    if (function_exists('clear_firebase_admin_token_cache')) {
        clear_firebase_admin_token_cache();
    }
    return get_firebase_auth_headers();
}

/**
 * Firestore REST API helper
 * Write/overwrite a document to Firestore via REST API (authenticated)
 * Defaults to MERGE behavior to prevent data loss.
 */
function firestore_set($path, $data, $merge = true)
{
    if ($merge) {
        $updateMask = array_keys($data);
        return firestore_update($path, $data, $updateMask);
    }

    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents/" . $path;

    $fields = convert_to_firestore_fields($data);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_setopt($ch, CURLOPT_NOSIGNAL, 1);
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['fields' => $fields]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode >= 400 || $httpCode === 0) {
        error_log("[WABEES] firestore_set FAILED ($httpCode) path=$path err=" . curl_error($ch));
    }
    curl_close($ch);

    return ['code' => $httpCode, 'data' => json_decode($response, true)];
}

/**
 * Firestore REST API — Update specific fields (authenticated)
 * Supports updateMask for merging. If updateMask is empty, it replaces the doc unless we are careful.
 * For true merge, pass keys in updateMask.
 */
function firestore_update($path, $data, $updateMask = [])
{
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents/" . $path;

    if (!empty($updateMask)) {
        $masks = array_map(fn($f) => "updateMask.fieldPaths=$f", $updateMask);
        $url .= '?' . implode('&', $masks);
    } else {
        $masks = array_map(fn($f) => "updateMask.fieldPaths=$f", array_keys($data));
        $url .= '?' . implode('&', $masks);
    }

    $fields = convert_to_firestore_fields($data);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_setopt($ch, CURLOPT_NOSIGNAL, 1);
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['fields' => $fields]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode >= 400 || $httpCode === 0) {
        error_log("[WABEES] firestore_update FAILED ($httpCode) path=$path err=" . curl_error($ch));
    }
    curl_close($ch);

    return ['code' => $httpCode, 'data' => json_decode($response, true)];
}

/**
 * Firestore REST API — Commit multiple writes (authenticated)
 * Lowers latency by batching updates/transforms in a single request.
 */
function firestore_commit($writes)
{
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents:commit";

    $body = ['writes' => $writes];

    $ch = _firestore_curl();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode >= 400 || $httpCode === 0) {
        $curlError = curl_error($ch);
        error_log("[WABEES] firestore_commit FAILED (HTTP $httpCode) curlErr=$curlError resp=" . substr($response ?: '', 0, 500));
    }

    return ['code' => $httpCode, 'data' => json_decode($response, true)];
}

/**
 * Update fields and increment numeric fields atomically in one commit.
 * $increments: ['fieldName' => intDelta, ...]
 */
function firestore_update_with_increment($path, $data, $increments = [])
{
    $docName = "projects/" . FIREBASE_PROJECT_ID . "/databases/(default)/documents/" . $path;
    $fields = convert_to_firestore_fields($data);
    $updateMask = array_keys($data);

    $writes = [];
    if (!empty($data)) {
        $writes[] = [
            'update' => [
                'name' => $docName,
                'fields' => $fields,
            ],
            'updateMask' => ['fieldPaths' => $updateMask],
        ];
    }

    if (!empty($increments)) {
        $transforms = [];
        foreach ($increments as $field => $delta) {
            $transforms[] = [
                'fieldPath' => $field,
                'increment' => ['integerValue' => (string) intval($delta)],
            ];
        }
        $writes[] = [
            'transform' => [
                'document' => $docName,
                'fieldTransforms' => $transforms,
            ],
        ];
    }

    return firestore_commit($writes);
}

/**
 * Increment a field by delta
 */
function firestore_increment($path, $field, $delta = 1)
{
    return firestore_update_with_increment($path, [], [$field => $delta]);
}

/**
 * Firestore REST API — Query documents (authenticated)
 */
function firestore_query($collectionPath, $field, $op, $value)
{
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents:runQuery";

    $structuredQuery = [
        'structuredQuery' => [
            'from' => [['collectionId' => basename($collectionPath)]],
            'where' => [
                'fieldFilter' => [
                    'field' => ['fieldPath' => $field],
                    'op' => $op,
                    'value' => convert_single_value($value),
                ],
            ],
            'limit' => 10,
        ],
    ];

    // Parent path for subcollection queries
    $parent = dirname($collectionPath);
    if ($parent && $parent !== '.') {
        $structuredQuery['structuredQuery']['from'][0]['allDescendants'] = false;
        $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
            . "/databases/(default)/documents/" . $parent . ":runQuery";
    }

    $ch = _firestore_curl();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($structuredQuery));
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode >= 400 || $httpCode === 0) {
        error_log("[WABEES] firestore_query FAILED ($httpCode) path=$collectionPath err=" . curl_error($ch));
    }

    return json_decode($response, true) ?: [];
}

/**
 * Find user by phone_number_id (WhatsApp)
 * Returns ['id' => userId, 'data' => documentFields]
 */
function find_user_by_phone_number_id($phoneNumberId)
{
    $all = find_all_users_by_phone_number_id($phoneNumberId);
    return !empty($all) ? $all[0] : null;
}

/**
 * Find ALL users with this phone_number_id (multi-user support)
 * Returns array of ['id' => userId, 'data' => documentFields]
 */
function find_all_users_by_phone_number_id($phoneNumberId)
{
    $results = firestore_query('users', 'whatsappPhoneNumberId', 'EQUAL', $phoneNumberId);
    $users = [];
    foreach ($results as $result) {
        if (!isset($result['document']))
            continue;
        $fields = $result['document']['fields'] ?? [];
        $docPath = $result['document']['name'];
        $parts = explode('/', $docPath);
        $userId = end($parts);
        $users[] = ['id' => $userId, 'data' => $fields];
    }

    if (empty($users))
        error_log("[WABEES] find_all_users_by_phone_number_id: No user found for phoneNumberId=$phoneNumberId");
    return $users;
}

/**
 * Find user by whatsapp_config subcollection (collection group query fallback)
 * Searches all users/{uid}/whatsapp_config/config docs for matching phoneNumberId
 * Returns ['id' => userId, 'data' => []]
 */
function find_user_by_whatsapp_config($phoneNumberId)
{
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents:runQuery";

    $body = [
        'structuredQuery' => [
            'from' => [
                ['collectionId' => 'whatsapp_config', 'allDescendants' => true]
            ],
            'where' => [
                'fieldFilter' => [
                    'field' => ['fieldPath' => 'phoneNumberId'],
                    'op' => 'EQUAL',
                    'value' => ['stringValue' => $phoneNumberId],
                ],
            ],
            'limit' => 5,
        ],
    ];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_setopt($ch, CURLOPT_NOSIGNAL, 1);


    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 400) {
        error_log("[WABEES] find_user_by_whatsapp_config FAILED ($httpCode) response=$response");
        return null;
    }

    $results = json_decode($response, true) ?: [];
    foreach ($results as $result) {
        if (!isset($result['document']))
            continue;
        $docName = $result['document']['name'] ?? '';
        // Path: .../users/{userId}/whatsapp_config/config
        if (preg_match('#/users/([^/]+)/whatsapp_config/#', $docName, $m)) {
            $userId = $m[1];
            $fields = $result['document']['fields'] ?? [];
            $isConnected = $fields['isConnected']['booleanValue'] ?? false;
            if ($isConnected) {
                return ['id' => $userId, 'data' => []];
            }
        }
    }

    // If no connected config found, return first match
    foreach ($results as $result) {
        if (!isset($result['document']))
            continue;
        $docName = $result['document']['name'] ?? '';
        if (preg_match('#/users/([^/]+)/whatsapp_config/#', $docName, $m)) {
            return ['id' => $m[1], 'data' => []];
        }
    }

    return null;
}

/**
 * Find ALL users by whatsapp_config subcollection (multi-user support)
 */
function find_all_users_by_whatsapp_config($phoneNumberId)
{
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents:runQuery";

    $body = [
        'structuredQuery' => [
            'from' => [
                ['collectionId' => 'whatsapp_config', 'allDescendants' => true]
            ],
            'where' => [
                'fieldFilter' => [
                    'field' => ['fieldPath' => 'phoneNumberId'],
                    'op' => 'EQUAL',
                    'value' => ['stringValue' => $phoneNumberId],
                ],
            ],
            'limit' => 20,
        ],
    ];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_setopt($ch, CURLOPT_NOSIGNAL, 1);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 400) {
        error_log("[WABEES] find_all_users_by_whatsapp_config FAILED ($httpCode)");
        return [];
    }

    $results = json_decode($response, true) ?: [];
    $users = [];
    $seenUids = [];
    foreach ($results as $result) {
        if (!isset($result['document']))
            continue;
        $docName = $result['document']['name'] ?? '';
        if (preg_match('#/users/([^/]+)/whatsapp_config/#', $docName, $m)) {
            $uid = $m[1];
            if (in_array($uid, $seenUids))
                continue;
            $seenUids[] = $uid;
            $users[] = ['id' => $uid, 'data' => []];
        }
    }

    return $users;
}

/**
 * Get user's WhatsApp access token from Firestore (authenticated)
 * Checks user doc first, then falls back to whatsapp_config subcollection
 */
function get_user_access_token($userId)
{
    // Token cache can safely hold WhatsApp accessToken for a while, but an
    // empty fcmToken must refresh quickly because the browser may grant push
    // permission after the first webhook cache was created.
    $tokenCacheTTL = 3600;
    $emptyFcmCacheTTL = 60;

    // 0. APCu cache — avoids Firestore calls for repeated requests
    $apcuKey = "wabees_token_$userId";
    if (function_exists('apcu_fetch')) {
        $cached = apcu_fetch($apcuKey, $ok);
        if ($ok && $cached && !empty($cached['accessToken'])) {
            $age = time() - ($cached['ts'] ?? 0);
            $maxAge = !empty($cached['fcmToken']) ? $tokenCacheTTL : $emptyFcmCacheTTL;
            if ($age < $maxAge)
                return $cached;
        }
    }

    // 1. File cache (survives worker restarts on shared hosting)
    // TTL reduced to 3600s (1 hour) so that a token update in the app takes
    // effect within 1 hour rather than 24 hours.
    $cacheFile = __DIR__ . "/../cache/token_$userId.json";
    if (file_exists($cacheFile)) {
        $cache = json_decode(@file_get_contents($cacheFile), true);
        if ($cache && !empty($cache['accessToken'])) {
            $age = time() - ($cache['ts'] ?? 0);
            $maxAge = !empty($cache['fcmToken']) ? $tokenCacheTTL : $emptyFcmCacheTTL;
            if ($age < $maxAge) {
                if (function_exists('apcu_store')) apcu_store($apcuKey, $cache, $maxAge);
                return $cache;
            }
            // Old cache had no browser push token. Force a fresh user-doc read.
            if (empty($cache['fcmToken']))
                @unlink($cacheFile);
        }
    }

    // 2. Try user doc first
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents/users/" . $userId;

    $ch = _firestore_curl();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode < 400 && $httpCode > 0) {
        $doc = json_decode($response, true);
        $token = $doc['fields']['whatsappAccessToken']['stringValue'] ?? null;
        $fcmToken = $doc['fields']['fcmToken']['stringValue'] ?? null;
        if ($token) {
            $result = ['accessToken' => $token, 'fcmToken' => $fcmToken, 'ts' => time()];
            if (function_exists('apcu_store')) apcu_store($apcuKey, $result, $fcmToken ? $tokenCacheTTL : $emptyFcmCacheTTL);
            _save_token_to_file_cache($userId, $result);
            return $result;
        }
    }

    // Fallback: check whatsapp_config subcollection
    error_log("[WABEES] get_user_access_token: user doc has no token (HTTP=$httpCode), checking whatsapp_config");
    $configUrl = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents/users/" . $userId . "/whatsapp_config";

    curl_setopt($ch, CURLOPT_URL, $configUrl);
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode >= 400 || $httpCode === 0) {
        error_log("[WABEES] get_user_access_token: whatsapp_config query FAILED ($httpCode)");
        return null;
    }

    $data = json_decode($response, true);
    $docs = $data['documents'] ?? [];
    foreach ($docs as $doc) {
        $token = $doc['fields']['accessToken']['stringValue'] ?? null;
        if ($token) {
            $result = ['accessToken' => $token, 'fcmToken' => null, 'ts' => time()];
            if (function_exists('apcu_store')) apcu_store($apcuKey, $result, $emptyFcmCacheTTL);
            _save_token_to_file_cache($userId, $result);
            return $result;
        }
    }

    error_log("[WABEES] get_user_access_token: no token found anywhere for userId=$userId");
    return null;
}

/**
 * Firestore REST API — Read a single document (authenticated)
 */
function firestore_get($path)
{
    $url = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
        . "/databases/(default)/documents/" . $path;

    $ch = _firestore_curl();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($httpCode >= 400 || $httpCode === 0) {
        error_log("[WABEES] firestore_get FAILED ($httpCode) path=$path err=" . curl_error($ch));
    }

    return ['code' => $httpCode, 'data' => json_decode($response, true)];
}

/**
 * Convert PHP array to Firestore fields format
 */
function convert_to_firestore_fields($data)
{
    $fields = [];
    foreach ($data as $key => $value) {
        $fields[$key] = convert_single_value($value);
    }
    return $fields;
}

function convert_single_value($value)
{
    if (is_null($value)) {
        return ['nullValue' => null];
    } elseif (is_bool($value)) {
        return ['booleanValue' => $value];
    } elseif (is_int($value)) {
        return ['integerValue' => (string) $value];
    } elseif (is_float($value)) {
        return ['doubleValue' => $value];
    } elseif (is_string($value)) {
        // Auto-detect ISO 8601 date strings and store as timestampValue
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/', $value)) {
            return ['timestampValue' => $value];
        }
        return ['stringValue' => $value];
    } elseif (is_array($value)) {
        if (empty($value)) {
            return ['arrayValue' => ['values' => []]];
        }
        if (array_keys($value) === range(0, count($value) - 1)) {
            // Indexed array → Firestore array
            return [
                'arrayValue' => [
                    'values' => array_map('convert_single_value', $value)
                ]
            ];
        } else {
            // Associative array → Firestore map
            return [
                'mapValue' => [
                    'fields' => convert_to_firestore_fields($value)
                ]
            ];
        }
    }
    return ['stringValue' => (string) $value];
}

/**
 * Get current timestamp in Firestore format
 */
function firestore_timestamp()
{
    return ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')];
}

/**
 * Save user token to file cache
 */
function _save_token_to_file_cache($userId, $data) {
    $dir = __DIR__ . '/../cache';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    @file_put_contents($dir . "/token_$userId.json", json_encode($data));
}

/**
 * CACHED Firestore GET — Reduces latency on shared hosting
 * Stores results in /cache/fs/ directory
 */
function firestore_get_cached($path, $ttl = 3600)
{
    $cacheKey = str_replace(['/', '(', ')'], ['_', '', ''], $path);
    $cacheFile = __DIR__ . "/../cache/fs/$cacheKey.json";

    // Check cache
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
        $data = json_decode(@file_get_contents($cacheFile), true);
        if ($data) return ['code' => 200, 'data' => $data, 'cached' => true];
    }

    // Cache miss, fetch from Firestore
    $result = firestore_get($path);
    if ($result['code'] === 200) {
        $dir = dirname($cacheFile);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        @file_put_contents($cacheFile, json_encode($result['data']));
    }
    return $result;
}

/**
 * CACHED Firestore Query — Best for lists like 'bots'
 */
function firestore_query_cached($collectionPath, $field, $op, $value, $ttl = 600)
{
    $cacheKey = 'query_' . str_replace(['/', '(', ')'], ['_', '', ''], $collectionPath) . '_' . md5($field . $op . serialize($value));
    $cacheFile = __DIR__ . "/../cache/fs/$cacheKey.json";

    if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
        $data = json_decode(@file_get_contents($cacheFile), true);
        if ($data) return $data;
    }

    $result = firestore_query($collectionPath, $field, $op, $value);
    if (!empty($result)) {
        $dir = dirname($cacheFile);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        @file_put_contents($cacheFile, json_encode($result));
    }
    return $result;
}
?>
