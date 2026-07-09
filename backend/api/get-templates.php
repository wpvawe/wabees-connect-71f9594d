<?php
/** WABEES — WhatsApp Message Templates LIST proxy. */

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
$originOk = $origin === '' || in_array($origin, $allowedOrigins, true)
    || (bool) preg_match('#^https://(?:id-preview--)?[a-z0-9-]+\.lovable\.app$#i', $origin)
    || (bool) preg_match('#^https://[a-z0-9-]+\.lovableproject\.com$#i', $origin)
    || (bool) preg_match('#^https://[a-z0-9-]+\.lovable\.dev$#i', $origin);
if ($originOk && $origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Wabees-Client, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if (!$originOk) { http_response_code(403); echo json_encode(['success' => false, 'error' => ['message' => 'Origin not allowed']]); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success' => false, 'error' => ['message' => 'POST required']]); exit; }

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) { http_response_code(400); echo json_encode(['success' => false, 'error' => ['message' => 'Invalid JSON']]); exit; }

require_once __DIR__ . '/../config/wa-bearer-auth.php';
$auth = wabees_apply_bearer_auth($data);
if (!empty($auth['error'])) { http_response_code((int)($auth['status'] ?? 401)); echo json_encode(['success' => false, 'error' => ['message' => $auth['error']]]); exit; }
if (($auth['applied'] ?? false) !== true) { http_response_code(401); echo json_encode(['success' => false, 'error' => ['message' => 'Unauthorized']]); exit; }

function wabees_templates_waba_id(array $data, array $auth): string {
    $waba = trim((string)($data['business_account_id'] ?? ($data['waba_id'] ?? '')));
    if ($waba !== '') return $waba;
    $ownerUid = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($auth['owner_uid'] ?? ($data['owner_uid'] ?? ($data['auth_uid'] ?? ''))));
    if ($ownerUid === '') return '';
    $cfg = firestore_get('users/' . rawurlencode($ownerUid) . '/whatsapp_config/config');
    $cf = (($cfg['code'] ?? 404) === 200) ? ($cfg['data']['fields'] ?? []) : [];
    $waba = trim((string)($cf['businessAccountId']['stringValue'] ?? ($cf['wabaId']['stringValue'] ?? ($cf['waba_id']['stringValue'] ?? ''))));
    if ($waba !== '') return $waba;
    $usr = firestore_get('users/' . rawurlencode($ownerUid));
    $uf = (($usr['code'] ?? 404) === 200) ? ($usr['data']['fields'] ?? []) : [];
    return trim((string)($uf['whatsappBusinessAccountId']['stringValue'] ?? ($uf['wabaId']['stringValue'] ?? '')));
}

$accessToken = trim((string)($data['access_token'] ?? ''));
$wabaId = wabees_templates_waba_id($data, $auth);
if ($accessToken === '' || $wabaId === '') { http_response_code(400); echo json_encode(['success' => false, 'error' => ['message' => 'Missing token or WABA id']]); exit; }

$graphVersion = defined('META_GRAPH_VERSION') ? META_GRAPH_VERSION : 'v21.0';
$url = "https://graph.facebook.com/{$graphVersion}/" . rawurlencode($wabaId) . "/message_templates?limit=200&fields=name,language,status,category,components,quality_score";
$ch = curl_init($url);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken]]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);
if ($response === false) { http_response_code(502); echo json_encode(['success' => false, 'error' => ['message' => $curlErr ?: 'Meta unreachable']]); exit; }
$parsed = json_decode($response, true);
if (!is_array($parsed)) $parsed = ['raw' => $response];
$ok = !isset($parsed['error']) && $httpCode >= 200 && $httpCode < 300;
http_response_code($ok ? 200 : ($httpCode ?: 500));
echo json_encode(array_merge(['success' => $ok, 'templates' => $parsed['data'] ?? []], $parsed));