<?php
/**
 * Resolve WhatsApp credentials from a Firebase bearer token.
 *
 * Modern React calls send only Authorization: Bearer <Firebase id token>.
 * This helper verifies the user, follows dataOwner for active agents, checks
 * the workspace is still connected, then injects phone_number_id/access_token
 * into the request array for legacy PHP handlers.
 */

require_once __DIR__ . '/firebase-config.php';
require_once __DIR__ . '/firebase-auth.php';

function wabees_auth_header(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $key => $value) {
            if (strtolower($key) === 'authorization') return (string)$value;
        }
    }
    return (string)$header;
}

function wabees_firestore_string(array $fields, string $key): string {
    return trim((string)($fields[$key]['stringValue'] ?? ''));
}

function wabees_firestore_bool(array $fields, string $key): ?bool {
    return array_key_exists($key, $fields) && array_key_exists('booleanValue', $fields[$key])
        ? (bool)$fields[$key]['booleanValue']
        : null;
}

function wabees_load_owner_credentials(string $ownerUid): array {
    $userResp = firestore_get('users/' . rawurlencode($ownerUid));
    $userFields = (($userResp['code'] ?? 404) === 200) ? ($userResp['data']['fields'] ?? []) : [];

    $cfgResp = firestore_get('users/' . rawurlencode($ownerUid) . '/whatsapp_config/config');
    $cfgFields = (($cfgResp['code'] ?? 404) === 200) ? ($cfgResp['data']['fields'] ?? []) : [];

    $connectedTop = wabees_firestore_bool($userFields, 'whatsappConnected');
    $connectedCfg = wabees_firestore_bool($cfgFields, 'isConnected');
    if ($connectedTop === false || $connectedCfg === false) {
        return ['error' => 'WhatsApp is disconnected for this workspace', 'status' => 409];
    }

    $phone = wabees_firestore_string($cfgFields, 'phoneNumberId') ?: wabees_firestore_string($userFields, 'whatsappPhoneNumberId');
    $token = wabees_firestore_string($cfgFields, 'accessToken') ?: wabees_firestore_string($userFields, 'whatsappAccessToken');
    if ($phone === '' || $token === '') {
        $cached = get_user_access_token($ownerUid);
        $token = $token ?: (string)($cached['accessToken'] ?? '');
    }
    if ($phone === '' || $token === '') {
        return ['error' => 'WhatsApp not fully connected', 'status' => 400];
    }
    return ['phone_number_id' => $phone, 'access_token' => $token, 'owner_uid' => $ownerUid];
}

function wabees_apply_bearer_auth(array &$input): array {
    $header = wabees_auth_header();
    $token = '';
    if (preg_match('/Bearer\s+(.+)/i', $header, $m)) {
        $token = trim($m[1]);
    } elseif (!empty($input['id_token']) && is_string($input['id_token'])) {
        // Hostinger/Cloudflare can strip Authorization in some PHP modes.
        // Modern web/app clients also send id_token in the JSON body as a
        // fallback so authenticated actions do not degrade to AUTH_MISSING.
        $token = trim($input['id_token']);
    }
    if ($token === '') {
        return ['applied' => false];
    }

    $uid = verify_firebase_id_token($token, $err);
    if (!$uid) return ['applied' => false, 'error' => $err ?: 'Unauthorized', 'status' => 401];

    $ownerUid = $uid;
    $userResp = firestore_get('users/' . rawurlencode($uid));
    $userFields = (($userResp['code'] ?? 404) === 200) ? ($userResp['data']['fields'] ?? []) : [];
    $dataOwner = wabees_firestore_string($userFields, 'dataOwner');
    if ($dataOwner !== '' && $dataOwner !== $uid) {
        $agentResp = firestore_get('users/' . rawurlencode($dataOwner) . '/agents/' . rawurlencode($uid));
        if (($agentResp['code'] ?? 404) !== 200) {
            return ['applied' => false, 'error' => 'Agent access revoked', 'status' => 403];
        }
        $agentFields = $agentResp['data']['fields'] ?? [];
        $status = wabees_firestore_string($agentFields, 'status') ?: 'active';
        if ($status === 'revoked' || $status === 'left') {
            return ['applied' => false, 'error' => 'Agent access revoked', 'status' => 403];
        }
        $ownerUid = $dataOwner;
    }

    $creds = wabees_load_owner_credentials($ownerUid);
    if (!empty($creds['error'])) return ['applied' => false, 'error' => $creds['error'], 'status' => $creds['status'] ?? 400];

    $input['phone_number_id'] = $creds['phone_number_id'];
    $input['access_token'] = $creds['access_token'];
    $input['auth_uid'] = $uid;
    $input['owner_uid'] = $ownerUid;
    return ['applied' => true, 'uid' => $uid, 'owner_uid' => $ownerUid];
}
?>