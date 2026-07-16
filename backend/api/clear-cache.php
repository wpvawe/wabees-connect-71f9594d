<?php
/**
 * WABEES — Cache Clear Endpoint
 *
 * Clears the server-side wa_map file cache and APCu cache for a specific
 * phone number ID. Use this after connecting a new WhatsApp account if
 * messages are not being received.
 *
 * POST /api/clear-cache.php
 * Body: { "phone_number_id": "..." }
 * Auth: Authorization: Bearer <Firebase id token>
 */

header('Content-Type: application/json');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'POST required']);
    exit;
}

// Get params from POST body or GET
$input = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true) ?: [];
}

$phoneNumberId = $input['phone_number_id'] ?? '';
$clearAll = isset($input['clear_all']);
// Bust the 5–10 min file cache for a specific user's `users/{uid}` and
// `users/{uid}/bot_config/settings` docs. Called after saving the AI bot
// toggle so the webhook immediately picks up enabled=false instead of
// waiting out the cache TTL.
$botConfigUid = trim((string)($input['bot_config_uid'] ?? ''));

require_once __DIR__ . '/../config/firebase-auth.php';
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$bearerOk = false;
$callerUidFromToken = null;
if ($authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    $err = null;
    $callerUidFromToken = verify_firebase_id_token(trim($m[1]), $err);
    $bearerOk = (bool) $callerUidFromToken;
}
if (!$bearerOk) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// SECURITY: clear_all wipes token, dedup, and APCu caches for ALL users —
// a regular user calling this can disrupt webhook processing / message
// delivery across the entire tenant. Only admins may clear-all. Fetch the
// caller's uid from the verified token and check custom claim OR
// users/{uid}.role == 'admin' (mirrors firestore.rules isAdmin()).
if ($clearAll) {
    $callerUid = null;
    if ($authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $mm)) {
        $errAdmin = null;
        $callerUid = verify_firebase_id_token(trim($mm[1]), $errAdmin);
    }
    $isAdmin = false;
    if ($callerUid) {
        require_once __DIR__ . '/../config/firebase-config.php';
        $userDoc = firestore_get('users/' . rawurlencode($callerUid));
        $userFields = (($userDoc['code'] ?? 404) === 200) ? ($userDoc['data']['fields'] ?? []) : [];
        $role = trim((string)($userFields['role']['stringValue'] ?? ''));
        $isAdmin = ($role === 'admin');
    }
    if (!$isAdmin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Admin only']);
        exit;
    }
}

$cacheFile = __DIR__ . '/../cache/wa_map.json';
$cleared = [];

if ($clearAll) {
    // Clear entire cache file
    if (file_exists($cacheFile)) {
        @unlink($cacheFile);
        $cleared[] = 'entire wa_map.json cache deleted';
    }
    foreach (glob(__DIR__ . '/../cache/token_*.json') ?: [] as $tokenFile) {
        @unlink($tokenFile);
    }
    foreach (glob(__DIR__ . '/../cache/fs/*.json') ?: [] as $fsFile) {
        @unlink($fsFile);
    }
    foreach (glob(__DIR__ . '/../cache/dedup/*.lock') ?: [] as $dedupFile) {
        @unlink($dedupFile);
    }
    foreach (glob(sys_get_temp_dir() . '/wabees_msg_*.lock') ?: [] as $msgLockFile) {
        @unlink($msgLockFile);
    }
    $cleared[] = 'token, Firestore list, webhook dedup, and processing lock caches deleted';
    // Clear all wabees_owner_* APCu entries
    if (function_exists('apcu_clear_cache')) {
        apcu_clear_cache();
        $cleared[] = 'APCu cache cleared entirely';
    }
    echo json_encode(['success' => true, 'cleared' => $cleared]);
    exit;
}

// Bot-config cache bust — caller must be the same uid or an admin.
if ($botConfigUid !== '') {
    $allowed = ($callerUidFromToken === $botConfigUid);
    if (!$allowed) {
        require_once __DIR__ . '/../config/firebase-config.php';
        $callerDoc = firestore_get('users/' . rawurlencode((string)$callerUidFromToken));
        $callerFields = (($callerDoc['code'] ?? 404) === 200) ? ($callerDoc['data']['fields'] ?? []) : [];
        $callerRole = trim((string)($callerFields['role']['stringValue'] ?? ''));
        $allowed = ($callerRole === 'admin');
    }
    if (!$allowed) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Forbidden']);
        exit;
    }
    $safeUid = preg_replace('/[^A-Za-z0-9_-]/', '', $botConfigUid);
    $targets = [
        __DIR__ . "/../cache/fs/users_{$safeUid}_bot_config_settings.json",
        __DIR__ . "/../cache/fs/users_{$safeUid}.json",
    ];
    $bustCleared = [];
    foreach ($targets as $file) {
        if (file_exists($file)) {
            @unlink($file);
            $bustCleared[] = basename($file);
        }
    }
    echo json_encode([
        'success' => true,
        'bot_config_uid' => $safeUid,
        'cleared' => $bustCleared,
        'message' => 'bot_config + user doc cache cleared',
    ]);
    exit;
}

if (empty($phoneNumberId)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'phone_number_id required (or use clear_all=1)']);
    exit;
}

// Clear from file cache
if (file_exists($cacheFile)) {
    $map = @json_decode(@file_get_contents($cacheFile), true) ?: [];
    if (isset($map[$phoneNumberId])) {
        $oldEntry = $map[$phoneNumberId];
        unset($map[$phoneNumberId]);
        @file_put_contents($cacheFile, json_encode($map));
        $cleared[] = "removed from wa_map.json (was: " . json_encode($oldEntry) . ")";
    } else {
        $cleared[] = "phone_number_id not found in wa_map.json (already clean)";
    }
} else {
    $cleared[] = "wa_map.json does not exist (already clean)";
}

// Clear from APCu
$apcuKey = "wabees_owner_$phoneNumberId";
if (function_exists('apcu_delete')) {
    $deleted = apcu_delete($apcuKey);
    $cleared[] = "APCu key '$apcuKey': " . ($deleted ? 'deleted' : 'not found');
}

// Also clear the token cache for all users linked to this phone
// (they'll be re-fetched fresh on next webhook)
require_once __DIR__ . '/../config/firebase-config.php';
$ownerId = null; // Hoisted so it can be returned in the JSON response below
$waMapDoc = firestore_get("wa_map/$phoneNumberId");
if (($waMapDoc['code'] ?? 404) === 200) {
    $fields = $waMapDoc['data']['fields'] ?? [];
    $ownerId = $fields['ownerId']['stringValue'] ?? $fields['userId']['stringValue'] ?? null;
    if ($ownerId) {
        $tokenKey = "wabees_token_$ownerId";
        if (function_exists('apcu_delete')) {
            apcu_delete($tokenKey);
            $cleared[] = "APCu token cache for owner '$ownerId' cleared";
        }
        $tokenCacheFile = __DIR__ . "/../cache/token_$ownerId.json";
        if (file_exists($tokenCacheFile)) {
            @unlink($tokenCacheFile);
            $cleared[] = "file token cache for owner '$ownerId' deleted";
        }
        $agentsCacheFile = __DIR__ . '/../cache/fs/' . str_replace(['/', '(', ')'], ['_', '', ''], "users/$ownerId/agents") . '.json';
        if (file_exists($agentsCacheFile)) {
            @unlink($agentsCacheFile);
            $cleared[] = "agents Firestore cache for owner '$ownerId' deleted";
        }
        $cleared[] = "Firestore wa_map/$phoneNumberId → ownerId=$ownerId";
    } else {
        $cleared[] = "WARNING: wa_map/$phoneNumberId exists but has no ownerId/userId field!";
        $cleared[] = "Firestore doc fields: " . json_encode(array_keys($fields));
    }
} else {
    $cleared[] = "WARNING: Firestore wa_map/$phoneNumberId NOT FOUND (HTTP " . ($waMapDoc['code'] ?? 'unknown') . ")";
    $cleared[] = "This means the client's wa_map document was not created. Check Flutter connect flow.";
}

echo json_encode([
    'success' => true,
    'phone_number_id' => $phoneNumberId,
    'ownerId' => $ownerId,
    'cleared' => $cleared,
    'message' => 'Cache cleared. Next incoming webhook will re-resolve this phone from Firestore.',
]);
?>
