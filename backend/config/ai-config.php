<?php
/**
 * WABEES — AI bot config defaults.
 *
 * Keep API keys out of git. On the server, define DEEPSEEK_API_KEY in the
 * hosting environment or in a private config file that is not committed.
 */

if (!defined('DEEPSEEK_API_KEY')) {
    define('DEEPSEEK_API_KEY', getenv('DEEPSEEK_API_KEY') ?: '');
}

if (!defined('DEEPSEEK_API_URL')) {
    define('DEEPSEEK_API_URL', getenv('DEEPSEEK_API_URL') ?: 'https://api.deepseek.com/chat/completions');
}

if (!defined('AI_BOT_COOLDOWN_SECONDS')) {
    define('AI_BOT_COOLDOWN_SECONDS', 12);
}

if (!defined('AI_BOT_HANDOFF_TIMEOUT_MINUTES')) {
    define('AI_BOT_HANDOFF_TIMEOUT_MINUTES', 30);
}

if (!defined('AI_BOT_MAX_PER_CONVERSATION')) {
    define('AI_BOT_MAX_PER_CONVERSATION', 20);
}

if (!defined('AI_BOT_MAX_HISTORY')) {
    // Reduced 12 → 6 to shrink DeepSeek prompt size.
    // Smaller prompt = faster first-token latency (~1-2s saved per reply).
    define('AI_BOT_MAX_HISTORY', 6);
}

// Cap DeepSeek output size. WhatsApp replies are short (Rule 5 says 2-4 lines).
// 220 tokens ≈ 150 words ≈ 4 short lines. Generation time scales linearly with
// output tokens — cutting 500 → 220 shaves ~3-5s off the reply.
if (!defined('AI_BOT_MAX_TOKENS')) {
    define('AI_BOT_MAX_TOKENS', 220);
}