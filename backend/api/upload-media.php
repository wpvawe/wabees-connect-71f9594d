<?php
/**
 * WABEES — Upload Media (Images, Videos, Documents, Audio)
 * 
 * POST /api/upload-media.php
 * Body: multipart/form-data with 'file' field and 'type' field
 * 
 * Returns: { success: true, url: "https://..." }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../config/site-config.php';
require_once __DIR__ . '/../config/wa-bearer-auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'No file uploaded']);
    exit;
}

$file = $_FILES['file'];
$type = $_POST['type'] ?? 'image';
$phoneNumberId = $_POST['phone_number_id'] ?? '';
$accessToken = $_POST['access_token'] ?? '';

if (empty($phoneNumberId) || empty($accessToken)) {
    $authInput = $_POST;
    $auth = wabees_apply_bearer_auth($authInput);
    if (!empty($auth['error'])) {
        http_response_code((int)($auth['status'] ?? 401));
        echo json_encode(['success' => false, 'message' => $auth['error']]);
        exit;
    }
    $phoneNumberId = $authInput['phone_number_id'] ?? $phoneNumberId;
    $accessToken = $authInput['access_token'] ?? $accessToken;
}

if (empty($phoneNumberId) || empty($accessToken)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'phone_number_id and access_token are required']);
    exit;
}

// Allowed MIME types per media type (document is intentionally broad to avoid false negatives)
$allowedTypes = [
    'image' => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    'video' => ['video/mp4', 'video/3gpp', 'video/quicktime'],
    'document' => [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel.sheet.macroEnabled.12',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
        'application/vnd.ms-word.document.macroEnabled.12',
        'application/vnd.ms-word.template.macroEnabled.12',
        'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
        'application/vnd.ms-powerpoint.template.macroEnabled.12',
        'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
        'application/rtf',
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/vnd.android.package-archive',
        'application/octet-stream',
        'text/plain',
        'text/rtf',
    ],
    'audio' => ['audio/mpeg', 'audio/ogg', 'application/ogg', 'audio/opus', 'audio/amr', 'audio/amr-wb', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'video/mp4', 'audio/mp4a-latm'],
];

$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);
$originalExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));

// finfo often reports APK/RTF/Office-ish uploads as application/octet-stream.
// Preserve the real document MIME from the original extension so Meta accepts
// the upload and the website can download with the correct extension later.
if ($type === 'document') {
    $extMimeMap = [
        'rtf' => 'application/rtf',
        'apk' => 'application/vnd.android.package-archive',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt' => 'application/vnd.ms-powerpoint',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'pdf' => 'application/pdf',
        'zip' => 'application/zip',
        'rar' => 'application/x-rar-compressed',
        '7z' => 'application/x-7z-compressed',
        'txt' => 'text/plain',
    ];
    if (($mimeType === 'application/octet-stream' || $mimeType === 'text/plain') && isset($extMimeMap[$originalExt])) {
        $mimeType = $extMimeMap[$originalExt];
    }
}

$validMimes = $allowedTypes[$type] ?? $allowedTypes['document'];

// WhatsApp Cloud does NOT support CSV (text/csv) — block early with clear message
if ($type === 'document' && $mimeType === 'text/csv') {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'message' => 'CSV files are not supported by WhatsApp. Please export as Excel (.xlsx) or PDF.',
    ]);
    exit;
}

if ($type === 'document') {
    if (strpos($mimeType, 'application/') !== 0 && strpos($mimeType, 'text/') !== 0 && !in_array($mimeType, $validMimes, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => "Invalid file type for document: $mimeType"]);
        exit;
    }
} else {
    if (!in_array($mimeType, $validMimes, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => "Invalid file type for $type: $mimeType"]);
        exit;
    }
}

// Max sizes: image 5MB, video 16MB, document 100MB, audio 16MB
$maxSizes = [
    'image' => 5 * 1024 * 1024,
    'video' => 16 * 1024 * 1024,
    'document' => 100 * 1024 * 1024,
    'audio' => 16 * 1024 * 1024,
];
$maxSize = $maxSizes[$type] ?? 16 * 1024 * 1024;

if ($file['size'] > $maxSize) {
    $maxMB = round($maxSize / 1024 / 1024);
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => "File too large. Max {$maxMB}MB for $type"]);
    exit;
}

// Get file extension
$ext = $originalExt;
if (empty($ext)) {
    $extMap = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
        'video/mp4' => 'mp4',
        'video/3gpp' => '3gp',
        'audio/mpeg' => 'mp3',
        'audio/ogg' => 'ogg',
        'audio/amr' => 'amr',
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
        'application/x-zip-compressed' => 'zip',
        'application/x-rar-compressed' => 'rar',
        'application/x-7z-compressed' => '7z',
        'application/vnd.android.package-archive' => 'apk',
    ];
    $ext = $extMap[$mimeType] ?? 'bin';
}

$filename = 'media_' . uniqid('', true) . '.' . $ext;

// Create uploads directory
$uploadDir = __DIR__ . '/../uploads/media/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

$targetPath = $uploadDir . $filename;

if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
    http_response_code(500);
    $logFile = __DIR__ . '/../logs/upload_media_' . date('Y-m-d') . '.log';
    $logDir = dirname($logFile);
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }
    file_put_contents(
        $logFile,
        date('H:i:s') . ' MOVE_FAILED name=' . ($file['name'] ?? '') . ' size=' . ($file['size'] ?? 0) . ' tmp=' . ($file['tmp_name'] ?? '') . "\n",
        FILE_APPEND
    );
    echo json_encode(['success' => false, 'message' => 'Failed to save file']);
    exit;
}

// Build public URL for app preview
$scheme = defined('PUBLIC_SCHEME') ? PUBLIC_SCHEME : ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
$host = defined('PUBLIC_HOST') ? PUBLIC_HOST : ($_SERVER['HTTP_HOST'] ?? 'wabees.live');
$publicUrl = $scheme . '://' . $host . '/uploads/media/' . $filename;

// Upload to WhatsApp Cloud /media so WhatsApp uses media_id (no weblink download)
$mediaUploadUrl = "https://graph.facebook.com/v21.0/{$phoneNumberId}/media";

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $mediaUploadUrl);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

// Fix MIME type for audio uploads:
// - finfo detects .m4a as video/mp4 → send as audio/mp4
// - finfo detects .ogg (opus) as audio/ogg → send as audio/ogg; codecs=opus
//   WhatsApp requires the codecs param for voice notes with waveform UI
$uploadMime = $mimeType;
if ($type === 'audio') {
    if ($mimeType === 'video/mp4' || $mimeType === 'audio/x-m4a') {
        $uploadMime = 'audio/mp4';
    } elseif ($mimeType === 'audio/ogg') {
        $uploadMime = 'audio/ogg; codecs=opus'; // Required for WhatsApp voice notes
    }
}

$curlFile = new CURLFile($targetPath, $uploadMime, $filename);
curl_setopt($ch, CURLOPT_POSTFIELDS, [
    'file' => $curlFile,
    'type' => $uploadMime,
    'messaging_product' => 'whatsapp',
]);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer {$accessToken}",
]);

$mediaResponse = curl_exec($ch);
$mediaHttpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

$mediaData = json_decode($mediaResponse, true) ?? [];
$mediaId = $mediaData['id'] ?? null;

if ($mediaHttpCode !== 200 || empty($mediaId)) {
    $logFile = __DIR__ . '/../logs/upload_media_' . date('Y-m-d') . '.log';
    $logDir = dirname($logFile);
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }
    file_put_contents(
        $logFile,
        date('H:i:s') . " MEDIA_HTTP={$mediaHttpCode} ERR={$curlError} RESP={$mediaResponse}\n",
        FILE_APPEND
    );
    // Best-effort prune old upload logs (>7 days)
    if (random_int(1, 50) === 1) {
        $dir = dirname($logFile);
        foreach (glob($dir . '/upload_media_*.log') as $f) {
            if (preg_match('/upload_media_(\d{4}-\d{2}-\d{2})\.log$/', $f, $m)) {
                $ts = strtotime($m[1] . ' 00:00:00');
                if ($ts !== false && $ts < (time() - 7*24*60*60)) @unlink($f);
            }
        }
    }
    http_response_code($mediaHttpCode ?: 500);
    echo json_encode([
        'success' => false,
        'message' => $mediaData['error']['message'] ?? 'Failed to upload media to WhatsApp',
    ]);
    exit;
}

echo json_encode([
    'success' => true,
    'url' => $publicUrl,
    'type' => $type,
    'mime' => $mimeType,
    'size' => $file['size'],
    'media_id' => $mediaId,
]);
?>
