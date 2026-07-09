<?php
/**
 * WABEES — WhatsApp media proxy
 * Streams WhatsApp Cloud media with the correct content type and optional
 * Content-Disposition so documents download in their real format (docx, rtf,
 * pdf, apk, etc.) instead of a browser-generated .bin file.
 */

require_once __DIR__ . '/../config/firebase-config.php';

require __DIR__ . '/_origin.php';
wabees_cors(['GET', 'OPTIONS'], ['Range']);
wabees_require_origin();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo 'Method not allowed';
    exit;
}

$mediaId = trim($_GET['id'] ?? $_GET['media_id'] ?? '');
$requestedUid = trim($_GET['uid'] ?? $_GET['userId'] ?? '');
$forceDownload = isset($_GET['download']) && $_GET['download'] !== '0';
$requestedName = trim($_GET['filename'] ?? '');
$requestedMime = trim($_GET['mime'] ?? '');

if ($mediaId === '' || $requestedUid === '') {
    http_response_code(400);
    echo 'Missing media id or uid';
    exit;
}

function proxy_media_belongs_to_user($uid, $mediaId): bool {
    $rows = firestore_query('users/' . rawurlencode($uid) . '/messages', 'mediaId', 'EQUAL', $mediaId);
    foreach ($rows as $row) {
        if (isset($row['document'])) return true;
    }
    return false;
}

require_once __DIR__ . '/../config/firebase-auth.php';
require_once __DIR__ . '/../config/wa-bearer-auth.php';
$uid = $requestedUid;
$authHeader = wabees_auth_header();
$idToken = trim((string)($_GET['id_token'] ?? ''));
if (!$idToken && $authHeader && preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) $idToken = trim($m[1]);
if ($idToken !== '') {
    $err = null;
    $callerUid = verify_firebase_id_token($idToken, $err);
    if (!$callerUid) {
        http_response_code(401);
        echo 'Unauthorized';
        exit;
    }
    $uid = $callerUid;
    $callerResp = firestore_get('users/' . rawurlencode($callerUid));
    $callerFields = (($callerResp['code'] ?? 404) === 200) ? ($callerResp['data']['fields'] ?? []) : [];
    $dataOwner = trim((string)($callerFields['dataOwner']['stringValue'] ?? ''));
    if ($dataOwner !== '' && $dataOwner !== $callerUid) $uid = $dataOwner;
    if ($requestedUid !== $callerUid && $requestedUid !== $uid) {
        http_response_code(403);
        echo 'Forbidden';
        exit;
    }
}
if (!proxy_media_belongs_to_user($uid, $mediaId)) {
    http_response_code(403);
    echo 'Media not allowed';
    exit;
}

$tokens = get_user_access_token($uid);
$accessToken = $tokens['accessToken'] ?? null;
if (!$accessToken) {
    http_response_code(401);
    echo 'WhatsApp token not found';
    exit;
}

function proxy_extension_for_mime($mimeType)
{
    $mime = strtolower(trim(explode(';', (string) $mimeType)[0]));
    $map = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
        'video/mp4' => 'mp4',
        'video/3gpp' => '3gp',
        'audio/mpeg' => 'mp3',
        'audio/ogg' => 'ogg',
        'audio/amr' => 'amr',
        'audio/aac' => 'aac',
        'audio/mp4' => 'm4a',
        'application/pdf' => 'pdf',
        'application/rtf' => 'rtf',
        'text/rtf' => 'rtf',
        'text/plain' => 'txt',
        'text/csv' => 'csv',
        'application/msword' => 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
        'application/vnd.ms-excel' => 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
        'application/vnd.ms-powerpoint' => 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
        'application/zip' => 'zip',
        'application/x-rar-compressed' => 'rar',
        'application/x-7z-compressed' => '7z',
        'application/vnd.android.package-archive' => 'apk',
    ];
    if (isset($map[$mime])) return $map[$mime];
    if (strpos($mime, 'image/') === 0) return str_replace('jpeg', 'jpg', substr($mime, 6));
    if (strpos($mime, 'video/') === 0) return substr($mime, 6);
    if (strpos($mime, 'audio/') === 0) return str_replace('mpeg', 'mp3', substr($mime, 6));
    return 'bin';
}

function proxy_safe_filename($name, $mimeType, $fallback)
{
    $clean = trim((string) $name);
    if ($clean === '') $clean = $fallback;
    $clean = preg_replace('/[\\\/\:\*\?"\<\>\|]+/', '_', $clean);
    $ext = proxy_extension_for_mime($mimeType);
    if (!preg_match('/\.[A-Za-z0-9]{1,8}$/', $clean) || preg_match('/\.bin$/i', $clean)) {
        $clean = preg_replace('/\.bin$/i', '', $clean) . '.' . $ext;
    }
    return $clean;
}

// 1) Ask Meta for the temporary signed media URL and metadata.
$metaUrl = 'https://graph.facebook.com/v21.0/' . rawurlencode($mediaId);
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $metaUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    CURLOPT_NOSIGNAL => 1,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
]);
$metaResp = curl_exec($ch);
$metaCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($metaCode < 200 || $metaCode >= 300) {
    http_response_code(502);
    echo 'Could not fetch media metadata';
    exit;
}

$meta = json_decode($metaResp, true) ?: [];
$downloadUrl = $meta['url'] ?? '';
$mimeType = $requestedMime ?: ($meta['mime_type'] ?? 'application/octet-stream');
$fileSize = isset($meta['file_size']) ? (int) $meta['file_size'] : null;
$filename = proxy_safe_filename($requestedName, $mimeType, 'whatsapp-' . $mediaId);

if ($downloadUrl === '') {
    http_response_code(404);
    echo 'Media URL not found';
    exit;
}

// 2) Stream the real file through PHP. Buffering is acceptable here because
// WhatsApp business media is capped and PHP shared hosting handles this better
// than pass-through curl callbacks with auth headers.
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $downloadUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 60,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    CURLOPT_NOSIGNAL => 1,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
]);
$bytes = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$actualType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($code < 200 || $code >= 300 || $bytes === false || $bytes === '') {
    http_response_code(502);
    echo 'Could not download media';
    exit;
}

$contentType = $requestedMime ?: ($actualType ?: $mimeType ?: 'application/octet-stream');
header('Content-Type: ' . $contentType);
header('Content-Length: ' . strlen($bytes));
header('Cache-Control: private, max-age=300');
header('X-Content-Type-Options: nosniff');
if ($fileSize) header('X-Wabees-File-Size: ' . $fileSize);
$disp = $forceDownload ? 'attachment' : 'inline';
header("Content-Disposition: $disp; filename=\"" . addcslashes($filename, "\\\"") . "\"; filename*=UTF-8''" . rawurlencode($filename));
echo $bytes;
