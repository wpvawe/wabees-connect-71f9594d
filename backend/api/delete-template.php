<?php
/**
 * WABEES — WhatsApp Message Template DELETE proxy.
 * POST /api/delete-template.php
 *
 * Body (JSON):
 *   business_account_id : string   (WABA id)
 *   access_token        : string   (long-lived business access token)
 *   name                : string   (template name — exact match)
 *   hsm_id?             : string   (optional — deletes a specific
 *                                   language version rather than all)
 *
 * Mirrors the Flutter app's direct Meta call
 * (`lib/data/datasources/api/whatsapp_api_ds.dart::deleteTemplate`).
 * The React website prefers this proxy so the deletion is logged
 * server-side; if this endpoint is missing (older host), the client
 * falls back to a direct Graph call.
 */

header('Content-Type: application/json');

$allowedOrigins = [
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
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$originOk =
    $origin === '' ||
    in_array($origin, $allowedOrigins, true) ||
    (bool) preg_match('#^https://(?:id-preview--)?[a-z0-9-]+\.lovable\.app$#i', $origin) ||
    (bool) preg_match('#^https://[a-z0-9-]+\.lovableproject\.com$#i', $origin) ||
    (bool) preg_match('#^https://[a-z0-9-]+\.lovable(?:project)?\.app$#i', $origin) ||
    (bool) preg_match('#^https://[a-z0-9-]+\.lovable\.dev$#i', $origin);

if ($originOk && $origin !== '') {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Wabees-Client, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if (!$originOk) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => ['message' => 'Origin not allowed']]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => ['message' => 'POST required']]);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'Invalid JSON']]);
    exit;
}

require_once __DIR__ . '/../config/wa-bearer-auth.php';
$auth = wabees_apply_bearer_auth($data);
if (!empty($auth['error'])) {
    http_response_code((int)($auth['status'] ?? 401));
    echo json_encode(['success' => false, 'error' => ['message' => $auth['error']]]);
    exit;
}

if (empty($data['business_account_id']) && !empty($auth['owner_uid'])) {
    $ownerUid = preg_replace('/[^A-Za-z0-9_-]/', '', (string)$auth['owner_uid']);
    $cfg = firestore_get('users/' . rawurlencode($ownerUid) . '/whatsapp_config/config');
    $cf = (($cfg['code'] ?? 404) === 200) ? ($cfg['data']['fields'] ?? []) : [];
    $data['business_account_id'] = $cf['businessAccountId']['stringValue'] ?? ($cf['wabaId']['stringValue'] ?? ($cf['waba_id']['stringValue'] ?? ''));
    if (empty($data['business_account_id'])) {
        $usr = firestore_get('users/' . rawurlencode($ownerUid));
        $uf = (($usr['code'] ?? 404) === 200) ? ($usr['data']['fields'] ?? []) : [];
        $data['business_account_id'] = $uf['whatsappBusinessAccountId']['stringValue'] ?? ($uf['wabaId']['stringValue'] ?? '');
    }
}

$wabaId       = trim((string)($data['business_account_id'] ?? ''));
$accessToken  = trim((string)($data['access_token'] ?? ''));
$name         = trim((string)($data['name'] ?? ''));
$hsmId        = trim((string)($data['hsm_id'] ?? ''));

if ($wabaId === '' || $accessToken === '' || $name === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => ['message' => 'business_account_id, access_token and name are required']]);
    exit;
}

$graphVersion = defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0';
$query = ['name' => $name];
if ($hsmId !== '') $query['hsm_id'] = $hsmId;
$url = "https://graph.facebook.com/{$graphVersion}/" . rawurlencode($wabaId)
     . "/message_templates?" . http_build_query($query);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_CUSTOMREQUEST  => 'DELETE',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $accessToken],
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => ['message' => $curlErr ?: 'Meta unreachable']]);
    exit;
}

$parsed = json_decode($response, true);
if (!is_array($parsed)) $parsed = ['raw' => $response];

$hasError = isset($parsed['error']);
$ok = !$hasError && ($httpCode >= 200 && $httpCode < 300);

http_response_code($ok ? 200 : ($httpCode ?: 500));
echo json_encode(array_merge(
    ['success' => $ok],
    $parsed
));