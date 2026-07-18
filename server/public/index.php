<?php
declare(strict_types=1);

require __DIR__ . '/resolve-bootstrap-paths.php';
$paths = resolveBootstrapPaths(__DIR__);
require $paths['app'];
$config = require $paths['config'];

$pdo = new PDO($config['dsn'], $config['username'], $config['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$port = (int) ($_SERVER['SERVER_PORT'] ?? ($scheme === 'https' ? 443 : 80));
$defaultPort = $scheme === 'https' ? 443 : 80;
if (!str_contains($host, ':') && $port !== $defaultPort) $host .= ':' . $port;
$requestBaseUrl = $scheme . '://' . $host;
$app = new CloudBackupApp(
    $pdo,
    maxBackupBytes: (int) ($config['max_backup_bytes'] ?? 104857600),
    publicBaseUrl: $config['public_base_url'] ?? $requestBaseUrl,
    maxSyncBatchBytes: (int) ($config['max_sync_batch_bytes'] ?? 50331648),
    maxSyncEnvelopeBytes: (int) ($config['max_sync_envelope_bytes'] ?? 41943040),
    maxSyncMutations: (int) ($config['max_sync_mutations'] ?? 100),
    maxSyncPullLimit: (int) ($config['max_sync_pull_limit'] ?? 500),
    maxSyncPullBytes: (int) ($config['max_sync_pull_bytes'] ?? 50331648)
);
$headers = function_exists('getallheaders') ? getallheaders() : [];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$isSyncPush = $path === '/api/v1/sync/push';
$maxRequestBytes = $isSyncPush
    ? (int) ($config['max_sync_batch_bytes'] ?? 50331648)
    : (int) ($config['max_request_bytes'] ?? 115343360);
$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
$rawPayload = '';
if ($contentLength <= $maxRequestBytes) {
    $stream = fopen('php://input', 'rb');
    $rawPayload = $stream ? stream_get_contents($stream, $maxRequestBytes + 1) : '';
    if (is_resource($stream)) fclose($stream);
}
if ($contentLength > $maxRequestBytes || strlen($rawPayload) > $maxRequestBytes) {
    $status = 413;
    $response = ['error' => [
        'code' => $isSyncPush ? 'sync_batch_too_large' : 'request_too_large',
        'message' => 'Request body is too large',
    ]];
} else {
    $payload = json_decode($rawPayload ?: '{}', true);
    if (!is_array($payload)) $payload = [];
    [$status, $response] = $app->handle($_SERVER['REQUEST_METHOD'], $path, $headers, $payload);
}

http_response_code($status);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
if ($status === 200 && $_SERVER['REQUEST_METHOD'] === 'GET' && preg_match('#^/api/v1/json-exports/[A-Za-z0-9_-]{43}$#', $path)) {
    header('Content-Disposition: attachment; filename="ai-chat-backup.json"');
}
if ($status !== 204) echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
