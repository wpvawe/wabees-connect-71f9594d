<?php
/**
 * WABEES — Public Plans Endpoint
 * Returns live public plan documents for the landing page pricing section.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300');

$cacheFile = dirname(__DIR__) . '/cache/public_plans.json';
$TTL = 300;

if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $TTL) {
    $cached = @file_get_contents($cacheFile);
    if ($cached) {
        echo $cached;
        exit;
    }
}

$out = ['plans' => [], 'source' => 'seed', 'cached_at' => time()];

if (file_exists($cacheFile)) {
    $prev = json_decode(@file_get_contents($cacheFile), true);
    if (is_array($prev) && !empty($prev['plans'])) {
        $prev['source'] = 'stale';
        $out = $prev;
    }
}

function _pp_field($f) {
    if (!is_array($f)) return null;
    if (isset($f['stringValue'])) return $f['stringValue'];
    if (isset($f['integerValue'])) return (int) $f['integerValue'];
    if (isset($f['doubleValue'])) return (float) $f['doubleValue'];
    if (isset($f['booleanValue'])) return (bool) $f['booleanValue'];
    if (isset($f['timestampValue'])) return $f['timestampValue'];
    if (isset($f['mapValue']['fields'])) {
        $m = [];
        foreach ($f['mapValue']['fields'] as $k => $v) $m[$k] = _pp_field($v);
        return $m;
    }
    if (isset($f['arrayValue']['values'])) return array_map('_pp_field', $f['arrayValue']['values']);
    return null;
}

function _pp_offer_live($offer) {
    if (!is_array($offer) || empty($offer['active'])) return false;
    if (empty($offer['endsAt'])) return true;
    $ts = is_numeric($offer['endsAt']) ? (int) $offer['endsAt'] : strtotime((string) $offer['endsAt']);
    return $ts && $ts > time();
}

function _pp_resolve_pricing($plan) {
    $base = (float) ($plan['priceMonthly'] ?? $plan['price'] ?? 0);
    $offer = $plan['offer'] ?? null;
    if (!_pp_offer_live($offer)) {
        return ['effective' => $base, 'original' => $base, 'discountPct' => 0, 'offer' => null];
    }
    if (isset($offer['priceOverride']) && (float) $offer['priceOverride'] >= 0) {
        $eff = (float) $offer['priceOverride'];
        $pct = $base > 0 ? round(100 * (1 - $eff / $base)) : 0;
    } else {
        $pct = max(0, (int) ($offer['discountPct'] ?? 0));
        $eff = $base * (1 - $pct / 100);
    }
    return ['effective' => round($eff), 'original' => $base, 'discountPct' => $pct, 'offer' => $offer];
}

function _pp_period($plan) {
    $t = strtolower((string) ($plan['expiryType'] ?? ''));
    if ($t === 'monthly') return '/mo';
    if ($t === 'quarterly') return '/quarter';
    if ($t === 'yearly') return '/year';
    if ($t === 'lifetime') return ' one-time';
    $days = (int) ($plan['expiryDays'] ?? 0);
    return $days > 0 ? '/' . $days . 'd' : '';
}

function _pp_billing_label($plan) {
    $t = strtolower((string) ($plan['expiryType'] ?? ''));
    if (in_array($t, ['monthly', 'quarterly', 'yearly', 'lifetime'], true)) return $t;
    $days = (int) ($plan['expiryDays'] ?? 0);
    return $days > 0 ? $days . '-day' : 'custom';
}

function _pp_per_cycle($plan) {
    $t = strtolower((string) ($plan['expiryType'] ?? ''));
    if ($t === 'monthly') return 'month';
    if ($t === 'quarterly') return 'quarter';
    if ($t === 'yearly') return 'year';
    if ($t === 'lifetime') return 'total';
    $days = (int) ($plan['expiryDays'] ?? 0);
    return $days > 0 ? $days . ' days' : '';
}

function _pp_validity_label($plan) {
    $t = strtolower((string) ($plan['expiryType'] ?? ''));
    if ($t === 'lifetime') return 'Lifetime access — never expires';
    $days = (int) ($plan['expiryDays'] ?? 0);
    if ($days > 0) return 'Valid for ' . $days . ' days';
    if ($t === 'monthly') return 'Valid for 30 days';
    if ($t === 'quarterly') return 'Valid for 90 days';
    if ($t === 'yearly') return 'Valid for 365 days';
    return '';
}

try {
    require_once dirname(__DIR__) . '/config/firebase-config.php';

    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID . '/databases/(default)/documents:runQuery';
    $body = [
        'structuredQuery' => [
            'from' => [['collectionId' => 'plans']],
            'orderBy' => [['field' => ['fieldPath' => 'sortOrder'], 'direction' => 'ASCENDING']],
            'limit' => 20,
        ],
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code === 200) {
        $data = json_decode($resp, true) ?: [];
        $plans = [];
        foreach ($data as $row) {
            if (empty($row['document']['fields'])) continue;
            $p = [];
            foreach ($row['document']['fields'] as $k => $v) $p[$k] = _pp_field($v);
            $p['id'] = basename($row['document']['name']);
            if (($p['showOnPublic'] ?? true) === false || ($p['isActive'] ?? true) === false) continue;
            $p['pricing'] = _pp_resolve_pricing($p);
            $p['period'] = _pp_period($p);
            $p['billingLabel'] = _pp_billing_label($p);
            $p['perCycle'] = _pp_per_cycle($p);
            $p['validityLabel'] = _pp_validity_label($p);
            $plans[] = $p;
        }
        if (!empty($plans)) {
            $out = ['plans' => $plans, 'source' => 'live', 'cached_at' => time()];
            @mkdir(dirname($cacheFile), 0755, true);
            @file_put_contents($cacheFile, json_encode($out));
        }
    }
} catch (Throwable $e) {
    // Serve previous cache/seed silently.
}

echo json_encode($out);