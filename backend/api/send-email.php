<?php
/**
 * WABEES — Simple transactional email sender.
 * POST /api/send-email.php  { to, subject, html, text?, from_name?, reply_to? }
 *
 * Used by the website to auto-send agent invite emails so we no longer
 * depend on the user's browser mail client (Gmail / Mail app).
 */

header('Content-Type: application/json');

$allowedOrigins = [
    'https://wabees.live',
    'https://www.wabees.live',
    'https://app.wabees.live',
    'https://wabees-plus.wabees.workers.dev',
    'http://localhost:8080',
    'http://localhost:5173',
    'http://127.0.0.1:8080',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$originOk =
    $origin === '' ||
    in_array($origin, $allowedOrigins, true) ||
    (bool) preg_match('#^https://[a-z0-9-]+\.lovable(?:project)?\.app$#i', $origin) ||
    (bool) preg_match('#^https://[a-z0-9-]+\.lovableproject\.com$#i', $origin) ||
    (bool) preg_match('#^https://[a-z0-9-]+\.lovable\.dev$#i', $origin);

if ($originOk && $origin !== '') {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if (!$originOk) {
    http_response_code(403);
    echo json_encode(['error' => ['message' => 'Origin not allowed']]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => ['message' => 'Method not allowed']]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$to      = trim((string) ($input['to'] ?? ''));
$subject = trim((string) ($input['subject'] ?? ''));
$html    = (string) ($input['html'] ?? '');
$text    = (string) ($input['text'] ?? '');
$fromName = trim((string) ($input['from_name'] ?? 'Wabees'));
$replyTo = trim((string) ($input['reply_to'] ?? ''));

if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'valid "to" email is required']]);
    exit;
}
if ($subject === '' || ($html === '' && $text === '')) {
    http_response_code(400);
    echo json_encode(['error' => ['message' => 'subject and html/text are required']]);
    exit;
}

$fromAddress = 'no-reply@wabees.live';
$boundary = 'wabees_' . bin2hex(random_bytes(8));
$headers  = 'From: ' . mb_encode_mimeheader($fromName) . ' <' . $fromAddress . ">\r\n";
$headers .= 'MIME-Version: 1.0' . "\r\n";
$headers .= 'X-Mailer: Wabees/1.0' . "\r\n";
if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
    $headers .= 'Reply-To: ' . $replyTo . "\r\n";
}

if ($html !== '' && $text !== '') {
    $headers .= 'Content-Type: multipart/alternative; boundary="' . $boundary . '"' . "\r\n";
    $body  = "--$boundary\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $text . "\r\n\r\n";
    $body .= "--$boundary\r\n";
    $body .= "Content-Type: text/html; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $html . "\r\n\r\n";
    $body .= "--$boundary--";
} elseif ($html !== '') {
    $headers .= 'Content-Type: text/html; charset=UTF-8' . "\r\n";
    $body = $html;
} else {
    $headers .= 'Content-Type: text/plain; charset=UTF-8' . "\r\n";
    $body = $text;
}

$ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers, '-f' . $fromAddress);
if (!$ok) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => ['message' => 'mail() failed']]);
    exit;
}

echo json_encode(['success' => true]);