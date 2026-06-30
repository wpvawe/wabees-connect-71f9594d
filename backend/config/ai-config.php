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
    define('AI_BOT_MAX_HISTORY', 12);
}