<?php
/**
 * WABEES — List all WhatsApp accounts reachable by an access token.
 *
 * POST https://api.wabees.live/api/whatsapp-list-accounts.php
 * Body: { id_token, access_token }
 * Response: {
 *   businesses: [{
 *     id, name,
 *     wabas: [{
 *       id, name,
 *       phones: [{ id, display_phone_number, verified_name, quality_rating }]
 *     }]
 *   }]
 * }
 *
 * Used by the website's Meta multi-step account picker so users with more
 * than one WABA / phone can choose which one to connect after Embedded
 * Signup, instead of us silently picking the first phone Meta returns.
 */

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/_origin.php';
wabees_cors(['POST', 'OPTIONS']);
wabees_require_origin();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']); exit;
}

require_once __DIR__ . '/../config/firebase-config.php';
require_once __DIR__ . '/../config/firebase-auth.php';

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$idToken     = (string)($body['id_token'] ?? '');
$accessToken = trim((string)($body['access_token'] ?? ''));

$uid = verify_firebase_id_token($idToken, $err);
if (!$uid) { http_response_code(401); echo json_encode(['error' => $err ?: 'Unauthorized']); exit; }
if ($accessToken === '') {
    http_response_code(400);
    echo json_encode(['error' => 'access_token required']); exit;
}

$gv = 'v21.0';

function graph_get(string $url, string $token) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $json = json_decode($resp, true);
    return [$code, is_array($json) ? $json : []];
}

// 1) Businesses the user granted access to
[$bc, $bj] = graph_get("https://graph.facebook.com/$gv/me/businesses?fields=id,name&limit=50", $accessToken);
if ($bc < 200 || $bc >= 300) {
    http_response_code(502);
    echo json_encode(['error' => $bj['error']['message'] ?? 'Failed to list businesses', 'httpCode' => $bc]);
    exit;
}

$out = [];
foreach ((array)($bj['data'] ?? []) as $b) {
    $bizId   = (string)($b['id'] ?? '');
    $bizName = (string)($b['name'] ?? '');
    if ($bizId === '') continue;

    // 2) WABAs owned by this business
    [$wc, $wj] = graph_get(
        "https://graph.facebook.com/$gv/$bizId/owned_whatsapp_business_accounts?fields=id,name&limit=50",
        $accessToken
    );
    if ($wc < 200 || $wc >= 300) continue;

    $wabas = [];
    foreach ((array)($wj['data'] ?? []) as $w) {
        $wabaId   = (string)($w['id'] ?? '');
        $wabaName = (string)($w['name'] ?? '');
        if ($wabaId === '') continue;

        // 3) Phones under this WABA
        [$pc, $pj] = graph_get(
            "https://graph.facebook.com/$gv/$wabaId/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=50",
            $accessToken
        );
        $phones = [];
        if ($pc >= 200 && $pc < 300) {
            foreach ((array)($pj['data'] ?? []) as $p) {
                $phones[] = [
                    'id'                    => (string)($p['id'] ?? ''),
                    'display_phone_number'  => (string)($p['display_phone_number'] ?? ''),
                    'verified_name'         => (string)($p['verified_name'] ?? ''),
                    'quality_rating'        => (string)($p['quality_rating'] ?? ''),
                ];
            }
        }
        $wabas[] = [
            'id'     => $wabaId,
            'name'   => $wabaName,
            'phones' => $phones,
        ];
    }

    $out[] = [
        'id'    => $bizId,
        'name'  => $bizName,
        'wabas' => $wabas,
    ];
}

echo json_encode(['businesses' => $out]);