<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/CloudBackupApp.php';

function syncExpect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function syncCall(CloudBackupApp $app, string $method, string $path, array $body = [], ?string $token = null): array
{
    $headers = $token ? ['authorization' => 'Bearer ' . $token] : [];
    return $app->handle($method, $path, $headers, $body);
}

function syncEnvelope(string $label): array
{
    return [
        'version' => 1,
        'kdf' => [
            'name' => 'PBKDF2',
            'hash' => 'SHA-256',
            'iterations' => 210000,
            'salt' => base64_encode(str_repeat('s', 16)),
        ],
        'cipher' => [
            'name' => 'AES-GCM',
            'iv' => base64_encode(str_repeat('i', 12)),
            'ciphertext' => base64_encode(str_pad($label, 32, 'x')),
        ],
    ];
}

function syncMutation(
    string $mutationId,
    string $entityType,
    string $entityId,
    string $operation,
    int $updatedAt,
    string $label
): array {
    return [
        'mutation_id' => $mutationId,
        'entity_type' => $entityType,
        'entity_id' => $entityId,
        'operation' => $operation,
        'updated_at_ms' => $updatedAt,
        'envelope' => syncEnvelope($label),
    ];
}

function syncPush(CloudBackupApp $app, string $token, string $deviceId, array $mutations): array
{
    return syncCall($app, 'POST', '/api/v1/sync/push', [
        'protocol_version' => 1,
        'device_id' => $deviceId,
        'mutations' => $mutations,
    ], $token);
}

function syncPull(CloudBackupApp $app, string $token, int $cursor, int $limit = 100): array
{
    return syncCall($app, 'POST', '/api/v1/sync/pull', [
        'protocol_version' => 1,
        'cursor' => $cursor,
        'limit' => $limit,
    ], $token);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
CloudBackupApp::install($pdo);
$clock = 1_800_000_000;
$updatedAt = $clock * 1000;
$app = new CloudBackupApp($pdo, fn (): int => $clock);

[$status, $session] = syncCall($app, 'POST', '/api/v1/auth/register', [
    'email' => 'sync@example.com',
    'password' => 'correct horse battery staple',
]);
syncExpect($status === 201, 'sync test user registration should succeed');
$token = $session['access_token'];

[$status] = syncPush($app, '', 'device-a', []);
syncExpect($status === 401, 'sync push should require authentication');
[$status] = syncCall($app, 'GET', '/api/v1/sync/pull', [], $token);
syncExpect($status === 404, 'sync pull should only accept the versioned POST route');

$atomicGood = syncMutation('atomic-good', 'providers', 'will-not-commit', 'upsert', $updatedAt, 'atomic secret');
$atomicBad = $atomicGood;
$atomicBad['mutation_id'] = 'atomic-bad';
$atomicBad['envelope']['cipher']['iv'] = 'invalid';
[$status] = syncPush($app, $token, 'device-a', [$atomicGood, $atomicBad]);
syncExpect($status === 422, 'an invalid mutation should reject the complete batch');
[$status, $emptyPull] = syncPull($app, $token, 0);
syncExpect($status === 200 && $emptyPull['next_cursor'] === 0 && $emptyPull['changes'] === [], 'invalid batches must not advance the cursor');

$injectionId = "provider-' OR 1=1 --";
$first = syncMutation('mutation-1', 'providers', $injectionId, 'upsert', $updatedAt, 'business secret alpha');
[$status, $pushed] = syncPush($app, $token, 'device-a', [$first]);
syncExpect($status === 200, 'first sync push should succeed');
syncExpect($pushed['server_cursor'] === 1, 'first mutation should allocate revision 1');
syncExpect($pushed['results'][0]['accepted'] === true, 'first mutation should win');
syncExpect($pushed['results'][0]['record']['entity_id'] === $injectionId, 'entity ids must be stored with prepared SQL parameters');

[$status, $duplicate] = syncPush($app, $token, 'device-a', [$first]);
syncExpect($status === 200, 'idempotent mutation retry should succeed');
syncExpect($duplicate['server_cursor'] === 1, 'idempotent retry must not allocate another revision');
syncExpect($duplicate['results'][0]['mutation_revision'] === 1, 'idempotent retry should return the original revision');

$reused = $first;
$reused['updated_at_ms'] += 1;
[$status, $reusedError] = syncPush($app, $token, 'device-a', [$reused]);
syncExpect($status === 409 && $reusedError['error']['code'] === 'mutation_id_reused', 'mutation ids cannot be reused for different content');

$sameTimeUpdate = syncMutation('mutation-2', 'providers', $injectionId, 'upsert', $updatedAt, 'business secret beta');
[$status, $updated] = syncPush($app, $token, 'device-b', [$sameTimeUpdate]);
syncExpect($status === 200 && $updated['results'][0]['accepted'] === true, 'later server revision should break equal updatedAt upsert ties');
syncExpect($updated['results'][0]['record']['revision'] === 2, 'equal timestamp update should become revision 2');

$deletion = syncMutation('mutation-3', 'providers', $injectionId, 'delete', $updatedAt, 'encrypted tombstone');
[$status, $deleted] = syncPush($app, $token, 'device-a', [$deletion]);
syncExpect($status === 200 && $deleted['results'][0]['accepted'] === true, 'delete should win an equal updatedAt tie');
syncExpect($deleted['results'][0]['record']['operation'] === 'delete', 'current record should be a tombstone');

$oldResurrection = syncMutation('mutation-4', 'providers', $injectionId, 'upsert', $updatedAt, 'stale record');
[$status, $notResurrected] = syncPush($app, $token, 'device-c', [$oldResurrection]);
syncExpect($status === 200 && $notResurrected['results'][0]['accepted'] === false, 'equal timestamp upsert must not revive a tombstone');
syncExpect($notResurrected['results'][0]['record']['operation'] === 'delete', 'losing upsert should receive the canonical tombstone');

$olderResurrection = syncMutation('mutation-5', 'providers', $injectionId, 'upsert', $updatedAt - 1, 'older stale record');
[$status, $olderRejected] = syncPush($app, $token, 'device-d', [$olderResurrection]);
syncExpect($status === 200 && $olderRejected['results'][0]['accepted'] === false, 'older upsert must not revive a tombstone');

$more = [
    syncMutation('mutation-6', 'settings', 'appearance', 'upsert', $updatedAt + 1, 'setting ciphertext'),
    syncMutation('mutation-7', 'conversations', 'conversation-1', 'upsert', $updatedAt + 2, 'conversation ciphertext'),
    syncMutation('mutation-8', 'messages', 'message-1', 'upsert', $updatedAt + 3, 'message ciphertext'),
];
foreach ($more as $index => $mutation) {
    [$status, $result] = syncPush($app, $token, 'device-a', [$mutation]);
    syncExpect($status === 200 && $result['results'][0]['accepted'] === true, 'additional sync mutation should succeed');
    syncExpect($result['server_cursor'] === 6 + $index, 'rejected mutations should still leave monotonic revision gaps');
}

$cursor = 0;
$revisions = [];
$ids = [];
do {
    [$status, $page] = syncPull($app, $token, $cursor, 2);
    syncExpect($status === 200, 'paginated pull should succeed');
    foreach ($page['changes'] as $change) {
        $revisions[] = $change['revision'];
        $ids[] = $change['entity_id'];
    }
    syncExpect($page['next_cursor'] >= $cursor, 'pull cursor must be monotonic');
    if ($page['has_more']) syncExpect($page['next_cursor'] > $cursor, 'a continued page must advance the cursor');
    $cursor = $page['next_cursor'];
} while ($page['has_more']);
syncExpect($cursor === 8, 'final pull cursor should reach the user watermark');
syncExpect($revisions === [1, 2, 3, 6, 7, 8], 'pull should paginate accepted changes while safely crossing revision gaps');
syncExpect(in_array($injectionId, $ids, true), 'pull should preserve an SQL-looking entity id exactly');

$byteLimited = new CloudBackupApp($pdo, fn (): int => $clock, maxSyncPullBytes: 900);
[$status, $bytePage] = syncPull($byteLimited, $token, 0, 100);
syncExpect($status === 200, 'byte-limited pull should succeed');
syncExpect(count($bytePage['changes']) === 1, 'pull should stop before exceeding its response byte budget');
syncExpect($bytePage['has_more'] === true && $bytePage['next_cursor'] > 0, 'byte-limited pull should expose a resumable cursor');

[$status, $secondUser] = syncCall($app, 'POST', '/api/v1/auth/register', [
    'email' => 'sync-second@example.com',
    'password' => 'another secure password',
]);
syncExpect($status === 201, 'second sync user registration should succeed');
[$status, $isolated] = syncPull($app, $secondUser['access_token'], 0);
syncExpect($status === 200 && $isolated['changes'] === [] && $isolated['server_cursor'] === 0, 'sync changes must be isolated by user');

$stored = $pdo->query('SELECT envelope_json FROM sync_records')->fetchAll(PDO::FETCH_COLUMN);
foreach ($stored as $json) {
    syncExpect(!str_contains($json, 'business secret'), 'server storage must not contain business plaintext');
}

$limited = new CloudBackupApp(
    $pdo,
    fn (): int => $clock,
    maxSyncBatchBytes: 4096,
    maxSyncEnvelopeBytes: 190,
    maxSyncMutations: 1
);
[$status, $countLimited] = syncPush($limited, $token, 'device-a', [$more[0], $more[1]]);
syncExpect($status === 413 && $countLimited['error']['code'] === 'sync_mutation_limit', 'sync mutation count limit should be enforced');
$largeRecord = syncMutation('mutation-large', 'settings', 'large', 'upsert', $updatedAt + 4, str_repeat('z', 256));
[$status, $recordLimited] = syncPush($limited, $token, 'device-a', [$largeRecord]);
syncExpect($status === 413 && $recordLimited['error']['code'] === 'sync_record_too_large', 'per-record encrypted size limit should be enforced');

$pdo->exec("UPDATE sync_changes SET envelope_json = '{}' WHERE user_id = 1 AND revision = 1");
[$status, $corrupt] = syncPull($app, $token, 0, 1);
syncExpect($status === 500 && $corrupt['error']['code'] === 'sync_record_corrupt', 'pull should reject corrupted stored ciphertext');

echo "PHP incremental sync integration tests passed\n";
