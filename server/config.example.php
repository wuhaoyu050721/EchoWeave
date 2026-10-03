<?php
return [
    'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=ai_chat;charset=utf8mb4',
    'username' => 'ai_chat',
    'password' => 'replace-with-a-database-password',
    'public_base_url' => 'https://www.surtr.cn:8018',
    'max_backup_bytes' => 104857600,
    'max_request_bytes' => 115343360,
    'max_sync_batch_bytes' => 50331648,
    'max_sync_envelope_bytes' => 41943040,
    'max_sync_mutations' => 100,
    'max_sync_pull_limit' => 500,
    'max_sync_pull_bytes' => 50331648,
    'max_auth_attempts' => 10,
    'auth_rate_limit_window' => 900,
    'sync_mutation_retention' => 15552000,
    'json_export_ttl' => 604800, // Seven days; links expire even before cleanup runs.
    'max_json_exports_per_user' => 20,
    'max_json_export_total_bytes' => 524288000,
];
