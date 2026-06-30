<?php
/**
 * WABEES — Cache Clear Endpoint
 *
 * Clears the server-side wa_map file cache and APCu cache for a specific
 * phone number ID. Use this after connecting a new WhatsApp account if
 * messages are not being received.
 *
 * POST /api/clear-cache.php
 * Body: { "phone_number_id": "...", "secret": "wabees_cache_clear_2024" }
 *
 * GET /api/clear-cache.php?phone_number_id=...&secret=wabees_cache_clear_2024
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

define('CACHE_CLEAR_SECRET', 'wabees_cache_clear_2024');

// Get params from POST body or GET
$input = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true) ?: [];
}

$phoneNumberId = $input['phone_number_id'] ?? ($_GET['phone_number_id'] ?? '');
$secret = $input['secret'] ?? ($_GET['secret'] ?? '');
$clearAll = isset($input['clear_all']) || isset($_GET['clear_all']);

// Auth check
if ($secret !== CACHE_CLEAR_SECRET) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Invalid secret']);
    exit;
}

$cacheFile = __DIR__ . '/../cache/wa_map.json';
$cleared = [];

if ($clearAll) {
    // Clear entire cache file
    if (file_exists($cacheFile)) {
        @unlink($cacheFile);
        $cleared[] = 'entire wa_map.json cache deleted';
    }
    // Clear all wabees_owner_* APCu entries
    if (function_exists('apcu_clear_cache')) {
        apcu_clear_cache();
        $cleared[] = 'APCu cache cleared entirely';
    }
    echo json_encode(['success' => true, 'cleared' => $cleared]);
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
