<?php
/**
 * Firebase ID Token verifier (RS256).
 * Verifies tokens minted by Firebase Auth client SDKs.
 *
 * Usage:
 *   require_once __DIR__ . '/../config/firebase-auth.php';
 *   $uid = verify_firebase_id_token($idToken, $errorOut);
 *   if (!$uid) { http_response_code(401); echo json_encode(['error'=>$errorOut]); exit; }
 *
 * Caches Google public keys on disk (TTL from Cache-Control max-age).
 */

if (!defined('WABEES_FIREBASE_PROJECT_ID')) {
    define('WABEES_FIREBASE_PROJECT_ID', 'wabees-app');
}

function _fb_b64url_decode(string $s): string {
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    return base64_decode($s);
}

function _fb_get_google_keys(): array {
    $cacheFile = sys_get_temp_dir() . '/wabees_fb_keys.json';
    if (is_file($cacheFile)) {
        $raw = @file_get_contents($cacheFile);
        $data = $raw ? json_decode($raw, true) : null;
        if (is_array($data) && !empty($data['expires']) && $data['expires'] > time()) {
            return $data['keys'] ?? [];
        }
    }

    $ch = curl_init('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_TIMEOUT => 8,
    ]);
    $resp = curl_exec($ch);
    $hdrSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    if (!$resp) return [];
    $headers = substr($resp, 0, $hdrSize);
    $body    = substr($resp, $hdrSize);
    $keys = json_decode($body, true);
    if (!is_array($keys)) return [];

    $maxAge = 3600;
    if (preg_match('/max-age=(\d+)/i', $headers, $m)) {
        $maxAge = max(300, (int)$m[1]);
    }
    @file_put_contents($cacheFile, json_encode([
        'expires' => time() + $maxAge,
        'keys'    => $keys,
    ]));
    return $keys;
}

/**
 * @return string|null  uid on success, null on failure (errOut set)
 */
function verify_firebase_id_token(string $jwt, ?string &$errOut = null): ?string {
    $errOut = null;
    if (!$jwt) { $errOut = 'Missing id_token'; return null; }
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) { $errOut = 'Malformed token'; return null; }
    [$h64, $p64, $s64] = $parts;

    $header  = json_decode(_fb_b64url_decode($h64), true);
    $payload = json_decode(_fb_b64url_decode($p64), true);
    if (!is_array($header) || !is_array($payload)) { $errOut = 'Bad token JSON'; return null; }
    if (($header['alg'] ?? '') !== 'RS256') { $errOut = 'Unexpected alg'; return null; }
    $kid = $header['kid'] ?? '';
    if (!$kid) { $errOut = 'Missing kid'; return null; }

    $project = WABEES_FIREBASE_PROJECT_ID;
    if (($payload['aud'] ?? '') !== $project) { $errOut = 'Invalid audience'; return null; }
    if (($payload['iss'] ?? '') !== "https://securetoken.google.com/$project") { $errOut = 'Invalid issuer'; return null; }
    if (empty($payload['sub'])) { $errOut = 'Missing sub'; return null; }
    $now = time();
    if (!empty($payload['exp']) && $payload['exp'] < $now - 30) { $errOut = 'Token expired'; return null; }
    if (!empty($payload['iat']) && $payload['iat'] > $now + 300) { $errOut = 'Token issued in future'; return null; }

    $keys = _fb_get_google_keys();
    $cert = $keys[$kid] ?? null;
    if (!$cert) { $errOut = 'Unknown key id'; return null; }

    $publicKey = openssl_pkey_get_public($cert);
    if (!$publicKey) { $errOut = 'Bad public key'; return null; }
    $signature = _fb_b64url_decode($s64);
    $ok = openssl_verify("$h64.$p64", $signature, $publicKey, OPENSSL_ALGO_SHA256);
    if (function_exists('openssl_free_key')) { @openssl_free_key($publicKey); }
    if ($ok !== 1) { $errOut = 'Invalid signature'; return null; }

    return (string)$payload['sub'];
}