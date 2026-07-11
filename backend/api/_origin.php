<?php
/**
 * Shared origin allowlist + CORS headers for wabees browser callers.
 *
 * Usage — include at the very top of every browser-facing endpoint:
 *   require __DIR__ . '/_origin.php';
 *   wabees_cors(['POST', 'OPTIONS']);                  // sends CORS headers
 *   wabees_require_origin();                           // 403s bad origins
 *
 * Rules:
 *  - Empty Origin (native/mobile: Flutter, curl, cron) is ALLOWED so the
 *    same endpoint serves web + app + cron without a second copy.
 *  - Explicit allow-list of wabees production domains + localhost dev.
 *  - Wildcarded regex for Lovable preview subdomains so id-preview--*,
 *    <hash>.lovableproject.com, <hash>.lovable.app, <hash>.lovable.dev
 *    all work without a redeploy per preview.
 *
 * NEVER echo an untrusted Origin as `Access-Control-Allow-Origin` without
 * running it past wabees_origin_ok() first — doing so turns this into an
 * open CORS relay.
 */

function wabees_origin_allowlist(): array {
    return [
        'https://wabees.live',
        'https://www.wabees.live',
        'https://app.wabees.live',
        'https://wabees-plus.wabees.workers.dev',
        'https://id-preview--373ad4e5-6ba4-4dab-91f0-2449fc57dc00.lovable.app',
        'https://373ad4e5-6ba4-4dab-91f0-2449fc57dc00.lovableproject.com',
        'http://localhost:8080',
        'http://localhost:5173',
        'http://127.0.0.1:8080',
    ];
}

function wabees_origin_ok(string $origin): bool {
    $origin = trim($origin);
    if ($origin === '') return true; // native / mobile / cron
    // Sandboxed iframes (Lovable preview, some embeds) send Origin: null.
    // Auth-sensitive endpoints still require a Firebase bearer token, so
    // treat "null" the same as an empty native origin here.
    if ($origin === 'null') return true;
    if (in_array($origin, wabees_origin_allowlist(), true)) return true;

    // Browser Origin values can vary across Lovable preview, project, and
    // custom sandbox hosts. Match by parsed host instead of one narrow regex
    // so preview aliases do not break profile/call APIs with false 403s.
    $host = strtolower((string)(parse_url($origin, PHP_URL_HOST) ?: ''));
    if ($host === '') return false;
    if ($host === 'localhost' || $host === '127.0.0.1') return true;
    if ($host === 'wabees.live' || str_ends_with($host, '.wabees.live')) return true;
    if ($host === 'wabees.workers.dev' || str_ends_with($host, '.wabees.workers.dev')) return true;
    if ($host === 'lovable.app' || str_ends_with($host, '.lovable.app')) return true;
    if ($host === 'lovableproject.com' || str_ends_with($host, '.lovableproject.com')) return true;
    if ($host === 'lovable.dev' || str_ends_with($host, '.lovable.dev')) return true;
    return false;
}

function wabees_cors(array $methods = ['POST', 'OPTIONS'], array $extraHeaders = []): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && wabees_origin_ok($origin)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: ' . implode(', ', $methods));
    $headers = array_merge(
        ['Content-Type', 'Authorization', 'X-Wabees-Client', 'X-Requested-With', 'Accept', 'Origin'],
        $extraHeaders
    );
    header('Access-Control-Allow-Headers: ' . implode(', ', array_unique($headers)));
    header('Access-Control-Max-Age: 86400');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function wabees_require_origin(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (!wabees_origin_ok($origin)) {
        error_log('[wabees-origin] blocked origin=' . $origin . ' uri=' . ($_SERVER['REQUEST_URI'] ?? ''));
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => ['message' => 'Origin not allowed']]);
        exit;
    }
}
