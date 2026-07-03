<?php
/**
 * WABEES — Firebase Admin SDK (PHP)
 * 
 * Gets OAuth2 access tokens for Firestore REST API.
 * 
 * TOKEN STRATEGY (for Hostinger shared hosting):
 *   1. In-memory cache            (~0ms, same request only)
 *   2. APCu cache (if available)  (~0ms, optional on hosting)
 *   3. File cache                 (~1ms, PRIMARY persistent cache)
 *   4. JWT + oauth2 exchange      (~2-3s, when cache expired)
 */

// Path to service account key JSON file
// NOTE: Hostinger shared hosting — always local file, no env vars or secrets mount
define('SERVICE_ACCOUNT_PATH', __DIR__ . '/service-account.json');

// Cache keys
// v2 intentionally ignores older APCu/file entries because the old loader
// re-saved cached tokens with a fresh `time() + 300` expiry. A cron/webhook
// hit every minute could therefore keep an already-expired Google OAuth token
// alive forever, causing Firestore 401 ACCESS_TOKEN_EXPIRED and breaking both
// incoming-message writes and scheduled-message dispatch.
define('TOKEN_CACHE_VERSION', 2);
define('APCU_TOKEN_KEY', 'wabees_fb_admin_token_v2');
define('APCU_TOKEN_EXP_KEY', 'wabees_fb_admin_token_exp_v2');
define('TOKEN_CACHE_PATH', __DIR__ . '/../logs/token-cache.json');

/**
 * Get a valid OAuth2 access token for Firebase Admin.
 * Uses file cache → APCu (if available) → JWT exchange.
 * 
 * Optimized for Hostinger shared hosting (no metadata server).
 */
function get_firebase_admin_token()
{
    $t = microtime(true);

    // 1. In-memory cache (same request only — fastest)
    if (!empty($GLOBALS['_fb_admin_token']) && time() < (($GLOBALS['_fb_admin_token_exp'] ?? 0) - 30)) {
        return $GLOBALS['_fb_admin_token'];
    }

    // 2. APCu cache (if available on hosting — persists across requests)
    if (function_exists('apcu_fetch')) {
        $token = apcu_fetch(APCU_TOKEN_KEY, $ok);
        $exp = apcu_fetch(APCU_TOKEN_EXP_KEY, $expOk);
        if ($ok && $expOk && $token && time() < ($exp - 30)) {
            $GLOBALS['_fb_admin_token'] = $token;
            $GLOBALS['_fb_admin_token_exp'] = $exp;
            return $token;
        }
    }

    // 3. File cache (PRIMARY on shared hosting — survives across requests)
    $cached = _load_cached_token();
    if ($cached) {
        // Preserve the real OAuth expiry. Never extend a cached token's life.
        _store_token_all_caches($cached['token'], $cached['expires_at']);
        return $cached['token'];
    }

    // 4. JWT exchange using wabees-app service account
    $jwtToken = _get_token_from_jwt_exchange();
    if ($jwtToken) {
        _store_token_all_caches($jwtToken['token'], $jwtToken['expires_at']);
        error_log('[WABEES] TOKEN: from JWT exchange (' . round((microtime(true) - $t) * 1000, 1) . 'ms)');
        return $jwtToken['token'];
    }

    // 5. Retry once with longer timeout
    error_log('[WABEES] TOKEN: JWT exchange failed, retrying...');
    sleep(1);
    $jwtToken = _get_token_from_jwt_exchange(20);
    if ($jwtToken) {
        _store_token_all_caches($jwtToken['token'], $jwtToken['expires_at']);
        return $jwtToken['token'];
    }

    error_log('[WABEES] TOKEN: ALL methods failed!');
    return null;
}

// NOTE: _get_token_from_metadata_server() REMOVED
// Was GCP Cloud Run only. Not needed on Hostinger shared hosting.

/**
 * Get token via JWT + oauth2.googleapis.com exchange (2-3s).
 * Used for cross-project access (Cloud Run in 'wabees', Firestore in 'wabees-app').
 */
function _get_token_from_jwt_exchange($timeout = 10)
{
    if (!file_exists(SERVICE_ACCOUNT_PATH)) {
        error_log('[WABEES] Service account file not found: ' . SERVICE_ACCOUNT_PATH);
        return null;
    }

    $sa = json_decode(file_get_contents(SERVICE_ACCOUNT_PATH), true);

    if (!$sa || empty($sa['private_key']) || empty($sa['client_email'])) {
        error_log('[WABEES] Invalid service account file');
        return null;
    }

    $now = time();
    $header = _base64url_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = _base64url_encode(json_encode([
        'iss' => $sa['client_email'],
        'sub' => $sa['client_email'],
        'aud' => 'https://oauth2.googleapis.com/token',
        'iat' => $now,
        'exp' => $now + 3600,
        'scope' => 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform',
    ]));

    $unsigned = "$header.$payload";
    $privateKey = openssl_pkey_get_private($sa['private_key']);
    if (!$privateKey) {
        error_log('[WABEES] Failed to parse service account private key');
        return null;
    }

    $signature = '';
    if (!openssl_sign($unsigned, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
        error_log('[WABEES] Failed to sign JWT');
        return null;
    }

    $jwt = $unsigned . '.' . _base64url_encode($signature);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://oauth2.googleapis.com/token');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion' => $jwt,
    ]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_setopt($ch, CURLOPT_NOSIGNAL, 1);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);
    curl_close($ch);

    if ($httpCode !== 200) {
        error_log("[WABEES] JWT token exchange failed (HTTP $httpCode): errno=$curlErrno error=$curlError");
        if ($response)
            error_log("[WABEES] Token response: $response");
        return null;
    }

    $tokenData = json_decode($response, true);
    $accessToken = $tokenData['access_token'] ?? null;

    if (!$accessToken) {
        error_log('[WABEES] No access_token in JWT exchange response');
        return null;
    }

    return [
        'token' => $accessToken,
        'expires_at' => $now + 3300, // ~55 min
    ];
}

/**
 * Store token in all cache layers at once.
 */
function _store_token_all_caches($token, $expiresAt)
{
    $ttl = (int) $expiresAt - time();
    if ($ttl <= 30) {
        clear_firebase_admin_token_cache();
        return;
    }

    // APCu (persists across PHP-FPM requests, ~0ms access)
    if (function_exists('apcu_store')) {
        apcu_store(APCU_TOKEN_KEY, $token, $ttl);
        apcu_store(APCU_TOKEN_EXP_KEY, $expiresAt, $ttl);
    }

    // In-memory (current request only)
    $GLOBALS['_fb_admin_token'] = $token;
    $GLOBALS['_fb_admin_token_exp'] = $expiresAt;

    // File cache (survives worker restarts)
    _save_cached_token($token, $expiresAt);
}

/**
 * Clear all admin-token caches. Firestore helpers call this before retrying a
 * 401 so cron/webhook can self-heal without waiting for PHP/APCu expiry.
 */
function clear_firebase_admin_token_cache()
{
    unset($GLOBALS['_fb_admin_token'], $GLOBALS['_fb_admin_token_exp']);
    if (function_exists('apcu_delete')) {
        @apcu_delete(APCU_TOKEN_KEY);
        @apcu_delete(APCU_TOKEN_EXP_KEY);
        // Best-effort cleanup for the legacy keys too.
        @apcu_delete('wabees_fb_admin_token');
        @apcu_delete('wabees_fb_admin_token_exp');
    }
    @unlink(TOKEN_CACHE_PATH);
}

/**
 * Load cached token from file if still valid.
 */
function _load_cached_token()
{
    if (!file_exists(TOKEN_CACHE_PATH))
        return null;

    $cache = json_decode(@file_get_contents(TOKEN_CACHE_PATH), true);
    if (!$cache || empty($cache['token']) || empty($cache['expires_at']))
        return null;

    // Do not trust legacy cache files that may contain an artificially
    // extended expiry from the previous cache refresh bug.
    if (($cache['cache_version'] ?? 0) !== TOKEN_CACHE_VERSION)
        return null;

    if (time() >= ($cache['expires_at'] - 30))
        return null;

    return [
        'token' => $cache['token'],
        'expires_at' => (int) $cache['expires_at'],
    ];
}

/**
 * Save token to file cache.
 */
function _save_cached_token($token, $expiresAt)
{
    $dir = dirname(TOKEN_CACHE_PATH);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    @file_put_contents(TOKEN_CACHE_PATH, json_encode([
        'cache_version' => TOKEN_CACHE_VERSION,
        'token' => $token,
        'expires_at' => $expiresAt,
        'created_at' => date('Y-m-d H:i:s'),
    ]));
}

/**
 * Get auth headers for Firestore REST API.
 */
function get_firebase_auth_headers()
{
    $token = get_firebase_admin_token();
    $headers = ['Content-Type: application/json'];

    if ($token) {
        $headers[] = "Authorization: Bearer $token";
    } else {
        error_log('[WABEES] WARNING: No admin token — Firestore calls may be rejected');
    }

    return $headers;
}

/**
 * Base64url encode (RFC 4648).
 */
function _base64url_encode($data)
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
?>
