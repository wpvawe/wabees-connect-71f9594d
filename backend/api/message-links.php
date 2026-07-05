<?php
/**
 * WABEES — Message Links (wa.me/message/XXX) Management
 *
 * POST /api/message-links.php
 * Body: { action, phone_number_id, access_token, prefilled_message?, link_id? }
 *
 * Actions:
 *   list   → GET all message links
 *   create → Create new message link with prefilled message
 *   delete → Delete a message link by ID
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => ['message' => 'Method not allowed']]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$auth = [];
require_once __DIR__ . '/../config/wa-bearer-auth.php';
if (is_array($input)) {
    $auth = wabees_apply_bearer_auth($input);
    if (!empty($auth['error'])) {
        http_response_code((int)($auth['status'] ?? 401));
        echo json_encode(['error' => ['message' => $auth['error']]]);
        exit;
    }
}
$action = $input['action'] ?? '';
$phoneNumberId = $input['phone_number_id'] ?? '';
$accessToken = $input['access_token'] ?? '';

if (empty($phoneNumberId) || empty($accessToken)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'phone_number_id and access_token are required']]);
    exit;
}

switch ($action) {
    case 'list':
        echo json_encode(listMessageLinks($phoneNumberId, $accessToken));
        break;

    case 'create':
        $prefilledMessage = $input['prefilled_message'] ?? '';
        if (empty($prefilledMessage)) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'prefilled_message is required']]);
            exit;
        }
        echo json_encode(createMessageLink($phoneNumberId, $accessToken, $prefilledMessage));
        break;

    case 'delete':
        $linkId = $input['link_id'] ?? '';
        if (empty($linkId)) {
            http_response_code(400);
            echo json_encode(['error' => ['message' => 'link_id is required']]);
            exit;
        }
        echo json_encode(deleteMessageLink($phoneNumberId, $accessToken, $linkId));
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => ['message' => 'Invalid action. Use: list, create, delete']]);
        break;
}

// ============ LIST MESSAGE LINKS ============
function listMessageLinks($phoneNumberId, $accessToken)
{
    $url = "https://graph.facebook.com/v21.0/{$phoneNumberId}/message_qrdls";

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: Bearer {$accessToken}",
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($response, true) ?? [];

    if ($httpCode === 200 && isset($data['data'])) {
        $links = [];
        foreach ($data['data'] as $link) {
            $links[] = [
                'id' => $link['id'] ?? '',
                'code' => $link['code'] ?? '',
                'deep_link_url' => $link['deep_link_url'] ?? '',
                'prefilled_message' => $link['prefilled_message'] ?? '',
                'qr_image_url' => $link['qr_image_url'] ?? '',
            ];
        }
        return ['links' => $links, 'total' => count($links)];
    }

    return ['error' => ['message' => $data['error']['message'] ?? 'Failed to fetch message links']];
}

// ============ CREATE MESSAGE LINK ============
function createMessageLink($phoneNumberId, $accessToken, $prefilledMessage)
{
    $url = "https://graph.facebook.com/v21.0/{$phoneNumberId}/message_qrdls";

    $postData = json_encode([
        'prefilled_message' => $prefilledMessage,
        'generate_qr_image' => 'PNG',
    ]);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: Bearer {$accessToken}",
        "Content-Type: application/json",
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($response, true) ?? [];

    if ($httpCode === 200 && !isset($data['error'])) {
        return [
            'link' => [
                'id' => $data['id'] ?? '',
                'code' => $data['code'] ?? '',
                'deep_link_url' => $data['deep_link_url'] ?? '',
                'prefilled_message' => $data['prefilled_message'] ?? $prefilledMessage,
                'qr_image_url' => $data['qr_image_url'] ?? '',
            ],
        ];
    }

    return ['error' => ['message' => $data['error']['message'] ?? 'Failed to create message link']];
}

// ============ DELETE MESSAGE LINK ============
function deleteMessageLink($phoneNumberId, $accessToken, $linkId)
{
    $url = "https://graph.facebook.com/v21.0/{$phoneNumberId}/message_qrdls?code={$linkId}";

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: Bearer {$accessToken}",
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($response, true) ?? [];

    if ($httpCode === 200 && !isset($data['error'])) {
        return ['deleted' => true];
    }

    return ['error' => ['message' => $data['error']['message'] ?? 'Failed to delete message link']];
}
?>
