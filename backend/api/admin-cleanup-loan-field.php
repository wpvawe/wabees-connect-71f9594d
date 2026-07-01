<?php
/**
 * One-shot admin script: removes the deprecated `loanCheckEnabled` field
 * from every doc in the `users` collection.
 *
 * Usage (run once, then delete this file):
 *   curl "https://api.wabees.live/api/admin-cleanup-loan-field.php?key=WABEES_ADMIN_CLEANUP_2026"
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/firebase-config.php';

// Simple shared-secret gate (change / delete after running)
$SECRET = 'WABEES_ADMIN_CLEANUP_2026';
if (($_GET['key'] ?? '') !== $SECRET) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

// List all user docs (paginated)
$base = "https://firestore.googleapis.com/v1/projects/" . FIREBASE_PROJECT_ID
    . "/databases/(default)/documents/users";

$pageToken = null;
$scanned = 0;
$cleared = 0;
$errors = [];

do {
    $url = $base . '?pageSize=300';
    if ($pageToken) $url .= '&pageToken=' . urlencode($pageToken);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, get_firebase_auth_headers());
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200) {
        echo json_encode(['error' => 'list_failed', 'code' => $code, 'body' => substr($resp, 0, 500)]);
        exit;
    }

    $data = json_decode($resp, true);
    foreach (($data['documents'] ?? []) as $doc) {
        $scanned++;
        $name = $doc['name']; // projects/.../documents/users/{uid}
        $uid = basename($name);
        $fields = $doc['fields'] ?? [];
        if (!array_key_exists('loanCheckEnabled', $fields)) continue;

        // PATCH with updateMask=loanCheckEnabled and empty fields → deletes the field
        $patchUrl = "https://firestore.googleapis.com/v1/" . $name
            . "?updateMask.fieldPaths=loanCheckEnabled";
        $ch2 = curl_init($patchUrl);
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_CUSTOMREQUEST, 'PATCH');
        curl_setopt($ch2, CURLOPT_HTTPHEADER, get_firebase_auth_headers());
        curl_setopt($ch2, CURLOPT_POSTFIELDS, json_encode(['fields' => new stdClass()]));
        curl_setopt($ch2, CURLOPT_TIMEOUT, 8);
        $r2 = curl_exec($ch2);
        $c2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        curl_close($ch2);

        if ($c2 >= 200 && $c2 < 300) {
            $cleared++;
        } else {
            $errors[] = ['uid' => $uid, 'code' => $c2, 'body' => substr($r2, 0, 200)];
        }
    }

    $pageToken = $data['nextPageToken'] ?? null;
} while ($pageToken);

echo json_encode([
    'ok' => true,
    'scanned' => $scanned,
    'cleared' => $cleared,
    'errors' => $errors,
    'note' => 'Delete this file after running.',
], JSON_PRETTY_PRINT);