<?php
/**
 * WABEES — Public Stats Endpoint
 * Computes real public counters from Firestore aggregate queries, cached briefly.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300');

$cacheFile = dirname(__DIR__) . '/cache/stats_live.json';
$TTL = 300;

if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $TTL) {
    $cached = json_decode(@file_get_contents($cacheFile), true);
    if (is_array($cached)) {
        $cached['cached_at'] = filemtime($cacheFile);
        $cached['source'] = 'cache';
        echo json_encode($cached);
        exit;
    }
}

$out = [
    'messages' => 0,
    'users' => 0,
    'agents' => 0,
    'contacts' => 0,
    'bots' => 0,
    'conversations' => 0,
    'cached_at' => time(),
    'source' => 'seed',
];

if (file_exists($cacheFile)) {
    $prev = json_decode(@file_get_contents($cacheFile), true);
    if (is_array($prev)) {
        foreach (['messages', 'users', 'agents', 'contacts', 'bots', 'conversations'] as $k) {
            if (isset($prev[$k])) $out[$k] = (int) $prev[$k];
        }
        $out['source'] = 'stale';
    }
}

function _stats_agg_value($query, $alias) {
    $url = 'https://firestore.googleapis.com/v1/projects/' . FIREBASE_PROJECT_ID
        . '/databases/(default)/documents:runAggregationQuery';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($query),
        CURLOPT_HTTPHEADER => get_firebase_auth_headers(),
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (function_exists('_firestore_should_retry_auth') && _firestore_should_retry_auth($code, $resp)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, _firestore_refresh_auth_headers());
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    }
    curl_close($ch);
    if ($code !== 200) return null;
    $rows = json_decode($resp, true) ?: [];
    $field = $rows[0]['result']['aggregateFields'][$alias] ?? null;
    if (!is_array($field)) return null;
    return (int) ($field['integerValue'] ?? $field['doubleValue'] ?? 0);
}

function _stats_count_query($collectionId, $alias, $allDescendants = false) {
    $from = ['collectionId' => $collectionId];
    if ($allDescendants) $from['allDescendants'] = true;
    return [
        'structuredAggregationQuery' => [
            'structuredQuery' => ['from' => [$from]],
            'aggregations' => [['alias' => $alias, 'count' => (object) []]],
        ],
    ];
}

function _stats_sum_query($collectionId, $fieldPath, $alias) {
    return [
        'structuredAggregationQuery' => [
            'structuredQuery' => ['from' => [['collectionId' => $collectionId]]],
            'aggregations' => [[
                'alias' => $alias,
                'sum' => ['field' => ['fieldPath' => $fieldPath]],
            ]],
        ],
    ];
}

try {
    require_once dirname(__DIR__) . '/config/firebase-config.php';

    $metrics = [
        'users' => _stats_agg_value(_stats_count_query('users', 'users'), 'users'),
        'messages' => _stats_agg_value(_stats_sum_query('users', 'totalMessages', 'messages'), 'messages'),
        'contacts' => _stats_agg_value(_stats_sum_query('users', 'totalContacts', 'contacts'), 'contacts'),
        'bots' => _stats_agg_value(_stats_sum_query('users', 'totalBots', 'bots'), 'bots'),
        'agents' => _stats_agg_value(_stats_count_query('agents', 'agents', true), 'agents'),
        'conversations' => _stats_agg_value(_stats_count_query('conversations', 'conversations', true), 'conversations'),
    ];

    $picked = 0;
    foreach ($metrics as $k => $v) {
        if ($v !== null) {
            $out[$k] = $v;
            $picked++;
        }
    }

    if ($picked >= 4) {
        $out['cached_at'] = time();
        $out['source'] = 'live_aggregate';
        @mkdir(dirname($cacheFile), 0755, true);
        @file_put_contents($cacheFile, json_encode($out));
    }
} catch (Throwable $e) {
    // Serve previous cache/seed silently.
}

echo json_encode($out);