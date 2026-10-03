<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/CloudBackupApp.php';

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$pdo = new PDO('sqlite::memory:');
CloudBackupApp::install($pdo);
$now = 1_800_000_000;
$app = new CloudBackupApp($pdo, function () use (&$now): int { return $now; }, jsonExportTtl: 60, maxJsonExportsPerUser: 2);
$register = static function (string $email) use ($app): array {
    [$status, $session] = $app->handle('POST', '/api/v1/auth/register', [], ['email' => $email, 'password' => 'long test password']);
    check($status === 201, 'test account must register');
    return ['Authorization' => 'Bearer ' . $session['access_token']];
};
$owner = $register('owner@example.com');
$other = $register('other@example.com');
$backup = ['formatVersion' => 1, 'providers' => [], 'conversations' => [], 'messages' => [], 'settings' => [
    'app' => ['appLockEnabled' => true, 'appLock' => ['hash' => 'private-pin-hash']],
    'networkProxy' => ['url' => 'http://192.168.1.1:7890'],
]];
$upload = static function () use ($app, $owner, $backup): array {
    [$status, $body] = $app->handle('POST', '/api/v1/json-exports', $owner, ['backup' => $backup]);
    check($status === 201, 'share should upload');
    return $body['export'];
};
$first = $upload();
check($first['expires_at'] === $now + 60, 'share must have bounded expiry');
$firstPath = $first['download_url'];
[$status, $download] = $app->handle('GET', $firstPath);
check($status === 200, 'live bearer link remains shareable');
check(!str_contains(json_encode($download), 'private-pin-hash'), 'PIN material must not be shared by old clients');
check(!str_contains(json_encode($download), '192.168.1.1'), 'device proxy must not be shared');
check(is_object(json_decode(json_encode($download))->settings), 'empty settings must be a JSON object, not an array');
[$status] = $app->handle('GET', '/api/v1/json-exports');
check($status === 401, 'share listing requires authentication');
[$status, $listing] = $app->handle('GET', '/api/v1/json-exports', $other);
check($status === 200 && $listing['exports'] === [], 'one account cannot list another account shares');
[$status] = $app->handle('DELETE', '/api/v1/json-exports/' . $first['id'], $other);
check($status === 404, 'one account cannot revoke another account share');
[$status] = $app->handle('DELETE', '/api/v1/json-exports/' . $first['id']);
check($status === 401, 'revocation requires authentication');
$second = $upload();
[$status, $quota] = $app->handle('POST', '/api/v1/json-exports', $owner, ['backup' => $backup]);
check($status === 409 && $quota['error']['code'] === 'json_export_quota_exceeded', 'count quota must reject more shares');
check((int) $pdo->query('SELECT COUNT(*) FROM json_exports')->fetchColumn() === 2, 'quota rejection must not insert a record');
[$status, $listing] = $app->handle('GET', '/api/v1/json-exports', $owner);
check($status === 200 && count($listing['exports']) === 2, 'owner can manage active shares');
check(!str_contains(json_encode($listing), 'token') && !str_contains(json_encode($listing), 'backup_json'), 'listing must contain metadata only');
[$status] = $app->handle('DELETE', '/api/v1/json-exports/' . $first['id'], $owner);
check($status === 204, 'owner can revoke a share');
[$status] = $app->handle('GET', $firstPath);
check($status === 404, 'revoked token must stop downloading immediately');
$now += 60;
[$status] = $app->handle('GET', $second['download_url']);
check($status === 404, 'download fails at the expiry boundary, without waiting for cleanup');
[$status, $listing] = $app->handle('GET', '/api/v1/json-exports', $owner);
check($status === 200 && $listing['exports'] === [], 'expired shares are pruned from storage and list');
check((int) $pdo->query('SELECT COUNT(*) FROM json_exports')->fetchColumn() === 0, 'expired payloads are removed');
$upload();

$smallApp = new CloudBackupApp($pdo, fn (): int => $now, maxJsonExportTotalBytes: 1);
[$status, $quota] = $smallApp->handle('POST', '/api/v1/json-exports', $owner, ['backup' => $backup]);
check($status === 409 && $quota['error']['code'] === 'json_export_quota_exceeded', 'total byte quota must be enforced');

$entry = file_get_contents(dirname(__DIR__) . '/public/index.php');
check(str_contains($entry, "header('Cache-Control: no-store')"), 'API entry must disable response caching');
check(str_contains($entry, "header('Referrer-Policy: no-referrer')"), 'share tokens must not leak in referrers');
echo "PHP JSON share security tests passed\n";
