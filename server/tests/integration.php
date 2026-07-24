<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/CloudBackupApp.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function callApi(CloudBackupApp $app, string $method, string $path, array $body = [], ?string $token = null): array
{
    $headers = $token ? ['authorization' => 'Bearer ' . $token] : [];
    return $app->handle($method, $path, $headers, $body);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
CloudBackupApp::install($pdo);
$clock = 1_800_000_000;
$app = new CloudBackupApp($pdo, fn (): int => $clock, publicBaseUrl: 'https://cloud.example.com');

[$status, $registered] = callApi($app, 'POST', '/api/v1/auth/register', [
    'email' => ' User@Example.com ',
    'password' => 'correct horse battery staple',
    'username' => '  Codex 用户  ',
]);
expect($status === 201, 'registration should return 201');
expect($registered['user']['email'] === 'user@example.com', 'email should be normalized');
expect($registered['user']['username'] === 'Codex 用户', 'username should be normalized');
expect(isset($registered['access_token'], $registered['refresh_token']), 'registration should issue tokens');

[$status] = callApi($app, 'POST', '/api/v1/auth/register', [
    'email' => 'user@example.com',
    'password' => 'correct horse battery staple'
]);
expect($status === 409, 'duplicate registration should return 409');

[$status] = callApi($app, 'POST', '/api/v1/auth/login', [
    'email' => 'user@example.com',
    'password' => 'wrong password'
]);
expect($status === 401, 'wrong password should return 401');

[$status, $login] = callApi($app, 'POST', '/api/v1/auth/login', [
    'email' => 'user@example.com',
    'password' => 'correct horse battery staple'
]);
expect($status === 200, 'login should return 200');
expect($login['user']['username'] === 'Codex 用户', 'login should return the stored username');

[$status] = callApi($app, 'PUT', '/api/v1/profile', ['username' => '未登录用户']);
expect($status === 401, 'profile updates should require authentication');

[$status, $updatedProfile] = callApi($app, 'PUT', '/api/v1/profile', [
    'username' => '  新用户名  ',
], $login['access_token']);
expect($status === 200, 'username update should succeed');
expect($updatedProfile['user']['username'] === '新用户名', 'username update should return the normalized username');

[$status] = callApi($app, 'PUT', '/api/v1/profile', ['username' => ''], $login['access_token']);
expect($status === 422, 'an empty username should be rejected');

[$status] = callApi($app, 'PUT', '/api/v1/profile', ['username' => str_repeat('a', 33)], $login['access_token']);
expect($status === 422, 'a username longer than 32 characters should be rejected');

[$status, $refreshed] = callApi($app, 'POST', '/api/v1/auth/refresh', [
    'refresh_token' => $login['refresh_token']
]);
expect($status === 200, 'refresh should return 200');
expect($refreshed['refresh_token'] !== $login['refresh_token'], 'refresh token should rotate');
expect($refreshed['user']['username'] === '新用户名', 'refreshed sessions should contain the current username');

[$status] = callApi($app, 'POST', '/api/v1/auth/refresh', [
    'refresh_token' => $login['refresh_token']
]);
expect($status === 401, 'rotated refresh token should be revoked');

[$status, $claimTestSession] = callApi($app, 'POST', '/api/v1/auth/login', [
    'email' => 'user@example.com',
    'password' => 'correct horse battery staple'
]);
expect($status === 200, 'claim failure test login should succeed');
$tokensBeforeFailedClaim = (int) $pdo->query('SELECT COUNT(*) FROM auth_tokens')->fetchColumn();
$pdo->exec("CREATE TRIGGER ignore_refresh_claim
    BEFORE UPDATE OF revoked_at ON auth_tokens
    WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    BEGIN
        SELECT RAISE(IGNORE);
    END");
[$status] = callApi($app, 'POST', '/api/v1/auth/refresh', [
    'refresh_token' => $claimTestSession['refresh_token']
]);
$pdo->exec('DROP TRIGGER ignore_refresh_claim');
expect($status === 401, 'a refresh token claim that affects zero rows must be rejected');
expect(
    (int) $pdo->query('SELECT COUNT(*) FROM auth_tokens')->fetchColumn() === $tokensBeforeFailedClaim,
    'a failed refresh token claim must not issue another session'
);

$envelope = [
    'version' => 1,
    'kdf' => ['name' => 'PBKDF2', 'hash' => 'SHA-256', 'iterations' => 210000, 'salt' => 'salt'],
    'cipher' => ['name' => 'AES-GCM', 'iv' => 'iv', 'ciphertext' => 'ciphertext']
];
[$status, $uploaded] = callApi($app, 'PUT', '/api/v1/backup', [
    'device_id' => 'device-a',
    'envelope' => $envelope
], $refreshed['access_token']);
expect($status === 200 && $uploaded['backup']['device_id'] === 'device-a', 'backup upload should succeed');

$limitedApp = new CloudBackupApp($pdo, fn (): int => $clock, maxBackupBytes: 128);
$oversizedEnvelope = [
    'version' => 1,
    'kdf' => ['name' => 'PBKDF2', 'salt' => 'salt'],
    'cipher' => ['name' => 'AES-GCM', 'ciphertext' => str_repeat('x', 256)]
];
[$status, $tooLarge] = callApi($limitedApp, 'PUT', '/api/v1/backup', [
    'device_id' => 'device-too-large',
    'envelope' => $oversizedEnvelope
], $refreshed['access_token']);
expect($status === 413, 'oversized backup should return 413');
expect(($tooLarge['error']['code'] ?? '') === 'backup_too_large', 'oversized backup should return backup_too_large');

[$status, $metadata] = callApi($app, 'GET', '/api/v1/backup/meta', [], $refreshed['access_token']);
expect($status === 200 && $metadata['backup']['version'] === 1, 'metadata should be available');

[$status, $download] = callApi($app, 'GET', '/api/v1/backup', [], $refreshed['access_token']);
expect($status === 200 && $download['envelope'] === $envelope, 'download should return the opaque envelope');

$jsonBackup = [
    'formatVersion' => 3,
    'exportedAt' => '2027-01-15T08:00:00.000Z',
    'providers' => [],
    'conversations' => [],
    'messages' => [],
    'attachments' => [],
    'characters' => [],
    'worldBooks' => [],
    'characterAssets' => [],
    'settings' => ['app' => ['appLockEnabled' => false]],
];
[$status] = callApi($app, 'POST', '/api/v1/json-exports', ['backup' => $jsonBackup]);
expect($status === 401, 'JSON export upload should require authentication');

[$status, $jsonExport] = callApi($app, 'POST', '/api/v1/json-exports', [
    'backup' => $jsonBackup,
], $refreshed['access_token']);
expect($status === 201, 'JSON export upload should return 201');
$downloadUrl = $jsonExport['export']['download_url'] ?? '';
expect(str_starts_with($downloadUrl, 'https://cloud.example.com/api/v1/json-exports/'), 'JSON export should return an absolute download URL');
$jsonExportToken = basename($downloadUrl);
expect(strlen($jsonExportToken) === 43, 'JSON export token should contain 256 bits of entropy');

[$status, $downloadedJson] = callApi($app, 'GET', '/api/v1/json-exports/' . $jsonExportToken);
expect($status === 200 && $downloadedJson === $jsonBackup, 'public JSON export link should return the original backup');
[$status, $missingJson] = callApi($app, 'GET', '/api/v1/json-exports/' . str_repeat('a', 43));
expect($status === 404 && ($missingJson['error']['code'] ?? '') === 'json_export_not_found', 'unknown JSON export links should return 404');

$legacyJsonBackup = $jsonBackup;
unset($legacyJsonBackup['formatVersion']);
[$status, $legacyJsonExport] = callApi($app, 'POST', '/api/v1/json-exports', [
    'backup' => $legacyJsonBackup,
], $refreshed['access_token']);
expect($status === 201, 'legacy JSON export without a format version should be accepted');
$legacyJsonToken = basename($legacyJsonExport['export']['download_url'] ?? '');
[$status, $normalizedLegacyJson] = callApi($app, 'GET', '/api/v1/json-exports/' . $legacyJsonToken);
expect($status === 200 && ($normalizedLegacyJson['formatVersion'] ?? 0) === 3, 'legacy JSON export should be normalized before storage');

$groupJsonBackup = $jsonBackup;
$groupJsonBackup['formatVersion'] = 4;
$groupJsonBackup['conversations'] = [[
    'id' => 'group-1',
    'conversationKind' => 'group',
    'participants' => [],
]];
[$status] = callApi($app, 'POST', '/api/v1/json-exports', [
    'backup' => $groupJsonBackup,
], $refreshed['access_token']);
expect($status === 201, 'group JSON export format 4 should be accepted');

$legacyGroupJsonBackup = $groupJsonBackup;
unset($legacyGroupJsonBackup['formatVersion']);
[$status, $legacyGroupJsonExport] = callApi($app, 'POST', '/api/v1/json-exports', [
    'backup' => $legacyGroupJsonBackup,
], $refreshed['access_token']);
expect($status === 201, 'legacy group JSON export should be accepted');
$legacyGroupJsonToken = basename($legacyGroupJsonExport['export']['download_url'] ?? '');
[$status, $normalizedLegacyGroupJson] = callApi($app, 'GET', '/api/v1/json-exports/' . $legacyGroupJsonToken);
expect($status === 200 && ($normalizedLegacyGroupJson['formatVersion'] ?? 0) === 4, 'legacy group JSON export should infer format 4');

$providerGroupJsonBackup = $jsonBackup;
$providerGroupJsonBackup['formatVersion'] = 5;
$providerGroupJsonBackup['providers'] = [[
    'id' => 'provider-member',
    'name' => 'Independent provider',
]];
$providerGroupJsonBackup['conversations'] = [[
    'id' => 'provider-group-1',
    'conversationKind' => 'group',
    'participants' => [[
        'memberKind' => 'provider',
        'providerProfileId' => 'provider-member',
        'nameSnapshot' => 'Independent provider',
    ]],
]];
$providerGroupJsonBackup['messages'] = [[
    'id' => 'provider-message-1',
    'conversationId' => 'provider-group-1',
    'speakerProviderProfileId' => 'provider-member',
    'speakerNameSnapshot' => 'Independent provider',
]];
[$status] = callApi($app, 'POST', '/api/v1/json-exports', [
    'backup' => $providerGroupJsonBackup,
], $refreshed['access_token']);
expect($status === 201, 'provider group JSON export format 5 should be accepted');

$legacyProviderGroupJsonBackup = $providerGroupJsonBackup;
unset($legacyProviderGroupJsonBackup['formatVersion']);
[$status, $legacyProviderGroupJsonExport] = callApi($app, 'POST', '/api/v1/json-exports', [
    'backup' => $legacyProviderGroupJsonBackup,
], $refreshed['access_token']);
expect($status === 201, 'legacy provider group JSON export should be accepted');
$legacyProviderGroupJsonToken = basename($legacyProviderGroupJsonExport['export']['download_url'] ?? '');
[$status, $normalizedLegacyProviderGroupJson] = callApi($app, 'GET', '/api/v1/json-exports/' . $legacyProviderGroupJsonToken);
expect($status === 200 && ($normalizedLegacyProviderGroupJson['formatVersion'] ?? 0) === 5, 'legacy provider group JSON export should infer format 5');

$oversizedJson = $jsonBackup;
$oversizedJson['settings']['padding'] = str_repeat('x', 256);
[$status, $tooLargeJson] = callApi($limitedApp, 'POST', '/api/v1/json-exports', [
    'backup' => $oversizedJson,
], $refreshed['access_token']);
expect($status === 413, 'oversized JSON export should return 413');
expect(($tooLargeJson['error']['code'] ?? '') === 'json_export_too_large', 'oversized JSON export should identify its error code');

[$status, $secondUser] = callApi($app, 'POST', '/api/v1/auth/register', [
    'email' => 'second@example.com',
    'password' => 'another secure password'
]);
expect($status === 201, 'second registration should succeed');
expect($secondUser['user']['username'] === 'second', 'accounts without a username should use the email prefix');
[$status] = callApi($app, 'GET', '/api/v1/backup', [], $secondUser['access_token']);
expect($status === 404, 'backups must be isolated by user');

[$status] = callApi($app, 'POST', '/api/v1/auth/logout', [
    'refresh_token' => $refreshed['refresh_token']
], $refreshed['access_token']);
expect($status === 204, 'logout should return 204');
[$status] = callApi($app, 'GET', '/api/v1/backup/meta', [], $refreshed['access_token']);
expect($status === 401, 'logout should revoke the access token');

[$status] = callApi($app, 'DELETE', '/api/v1/backup', [], $registered['access_token']);
expect($status === 204, 'backup deletion should return 204');
[$status] = callApi($app, 'GET', '/api/v1/backup', [], $registered['access_token']);
expect($status === 404, 'deleted backup should be absent');

echo "PHP cloud backup integration tests passed\n";
