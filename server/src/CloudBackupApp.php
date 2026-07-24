<?php
declare(strict_types=1);

final class CloudSyncHttpException extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message
    ) {
        parent::__construct($message);
    }
}

final class CloudBackupApp
{
    private const ACCESS_TTL = 900;
    private const REFRESH_TTL = 2592000;
    private const JSON_EXPORT_TOKEN_PATTERN = '[A-Za-z0-9_-]{43}';
    private const SYNC_PROTOCOL_VERSION = 1;
    private const SYNC_KDF_ITERATIONS = 210000;
    private const SYNC_ENTITY_TYPES = [
        'providers', 'conversations', 'messages', 'attachments',
        'characters', 'worldBooks', 'characterAssets', 'settings',
    ];

    private string $publicBaseUrl;

    public function __construct(
        private PDO $pdo,
        private $clock = null,
        private int $maxBackupBytes = 104857600,
        string $publicBaseUrl = '',
        private int $maxSyncBatchBytes = 50331648,
        private int $maxSyncEnvelopeBytes = 41943040,
        private int $maxSyncMutations = 100,
        private int $maxSyncPullLimit = 500,
        private int $maxSyncPullBytes = 50331648
    )
    {
        $this->clock ??= static fn (): int => time();
        $this->publicBaseUrl = rtrim(trim($publicBaseUrl), '/');
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }

    public static function install(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email VARCHAR(255) NOT NULL UNIQUE,
            username VARCHAR(64) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )');
        $pdo->exec('CREATE TABLE auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            token_type VARCHAR(16) NOT NULL,
            expires_at INTEGER NOT NULL,
            revoked_at INTEGER NULL,
            created_at INTEGER NOT NULL
        )');
        $pdo->exec('CREATE INDEX idx_auth_tokens_user_type ON auth_tokens (user_id, token_type)');
        $pdo->exec('CREATE TABLE backups (
            user_id INTEGER PRIMARY KEY,
            device_id VARCHAR(128) NOT NULL,
            envelope_json TEXT NOT NULL,
            checksum CHAR(64) NOT NULL,
            byte_size INTEGER NOT NULL,
            version INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )');
        $pdo->exec('CREATE TABLE json_exports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            backup_json TEXT NOT NULL,
            checksum CHAR(64) NOT NULL,
            byte_size INTEGER NOT NULL,
            format_version INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )');
        $pdo->exec('CREATE INDEX idx_json_exports_user_created ON json_exports (user_id, created_at)');
        $pdo->exec('CREATE TABLE sync_user_state (
            user_id INTEGER PRIMARY KEY,
            current_revision INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        )');
        $pdo->exec('CREATE TABLE sync_records (
            user_id INTEGER NOT NULL,
            entity_type VARCHAR(32) NOT NULL,
            entity_id VARCHAR(191) NOT NULL,
            operation VARCHAR(16) NOT NULL,
            envelope_json TEXT NOT NULL,
            checksum CHAR(64) NOT NULL,
            byte_size INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            device_id VARCHAR(128) NOT NULL,
            revision INTEGER NOT NULL,
            PRIMARY KEY (user_id, entity_type, entity_id)
        )');
        $pdo->exec('CREATE INDEX idx_sync_records_user_revision ON sync_records (user_id, revision)');
        $pdo->exec('CREATE TABLE sync_mutations (
            user_id INTEGER NOT NULL,
            mutation_id VARCHAR(128) NOT NULL,
            request_hash CHAR(64) NOT NULL,
            entity_type VARCHAR(32) NOT NULL,
            entity_id VARCHAR(191) NOT NULL,
            revision INTEGER NOT NULL,
            accepted INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, mutation_id),
            UNIQUE (user_id, revision)
        )');
        $pdo->exec('CREATE TABLE sync_changes (
            user_id INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            entity_type VARCHAR(32) NOT NULL,
            entity_id VARCHAR(191) NOT NULL,
            operation VARCHAR(16) NOT NULL,
            envelope_json TEXT NOT NULL,
            checksum CHAR(64) NOT NULL,
            byte_size INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            device_id VARCHAR(128) NOT NULL,
            PRIMARY KEY (user_id, revision)
        )');
        $pdo->exec('CREATE INDEX idx_sync_changes_user_entity ON sync_changes (user_id, entity_type, entity_id)');
    }

    public function handle(string $method, string $path, array $headers = [], array $body = []): array
    {
        try {
            $method = strtoupper($method);
            if ($method === 'GET' && preg_match('#^/api/v1/json-exports/(' . self::JSON_EXPORT_TOKEN_PATTERN . ')$#', $path, $matches)) {
                return $this->downloadJsonExport($matches[1]);
            }

            return match ($method . ' ' . $path) {
                'POST /api/v1/auth/register' => $this->register($body),
                'POST /api/v1/auth/login' => $this->login($body),
                'POST /api/v1/auth/refresh' => $this->refresh($body),
                'POST /api/v1/auth/logout' => $this->logout($headers, $body),
                'PUT /api/v1/profile' => $this->updateProfile($headers, $body),
                'POST /api/v1/json-exports' => $this->uploadJsonExport($headers, $body),
                'PUT /api/v1/backup' => $this->uploadBackup($headers, $body),
                'GET /api/v1/backup/meta' => $this->backupMetadata($headers),
                'GET /api/v1/backup' => $this->downloadBackup($headers),
                'DELETE /api/v1/backup' => $this->deleteBackup($headers),
                'POST /api/v1/sync/push' => $this->pushSync($headers, $body),
                'POST /api/v1/sync/pull' => $this->pullSync($headers, $body),
                default => [404, ['error' => ['code' => 'not_found', 'message' => 'Route not found']]],
            };
        } catch (CloudSyncHttpException $error) {
            return [$error->status, ['error' => ['code' => $error->errorCode, 'message' => $error->getMessage()]]];
        } catch (InvalidArgumentException $error) {
            return [422, ['error' => ['code' => 'validation_error', 'message' => $error->getMessage()]]];
        } catch (Throwable $error) {
            return [500, ['error' => ['code' => 'server_error', 'message' => 'Internal server error']]];
        }
    }

    private function register(array $body): array
    {
        [$email, $password] = $this->credentials($body);
        $username = $this->username($body['username'] ?? null, $email);
        $existing = $this->fetchOne('SELECT id FROM users WHERE email = ?', [$email]);
        if ($existing) return [409, ['error' => ['code' => 'email_exists', 'message' => 'Email already registered']]];

        $now = $this->now();
        $statement = $this->pdo->prepare('INSERT INTO users (email, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
        $statement->execute([$email, $username, password_hash($password, PASSWORD_DEFAULT), $now, $now]);
        return [201, $this->issueSession((int) $this->pdo->lastInsertId(), $email, $username)];
    }

    private function login(array $body): array
    {
        [$email, $password] = $this->credentials($body);
        $user = $this->fetchOne('SELECT id, email, username, password_hash FROM users WHERE email = ?', [$email]);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            return [401, ['error' => ['code' => 'invalid_credentials', 'message' => 'Invalid email or password']]];
        }
        return [200, $this->issueSession((int) $user['id'], $user['email'], $user['username'])];
    }

    private function refresh(array $body): array
    {
        $token = trim((string) ($body['refresh_token'] ?? ''));
        if ($token === '') throw new InvalidArgumentException('refresh_token is required');
        $tokenHash = $this->tokenHash($token);
        $now = $this->now();

        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(
                'UPDATE auth_tokens SET revoked_at = ? '
                . 'WHERE token_hash = ? AND token_type = ? AND revoked_at IS NULL AND expires_at > ?'
            );
            $statement->execute([$now, $tokenHash, 'refresh', $now]);
            if ($statement->rowCount() !== 1) {
                $this->pdo->rollBack();
                return [401, ['error' => ['code' => 'invalid_refresh_token', 'message' => 'Refresh token is invalid']]];
            }
            $record = $this->fetchOne(
                'SELECT auth_tokens.user_id, users.email, users.username '
                . 'FROM auth_tokens JOIN users ON users.id = auth_tokens.user_id '
                . 'WHERE auth_tokens.token_hash = ? AND auth_tokens.token_type = ?',
                [$tokenHash, 'refresh']
            );
            if (!$record) throw new RuntimeException('Refresh token user no longer exists');
            $session = $this->issueSession((int) $record['user_id'], $record['email'], $record['username']);
            $this->pdo->commit();
        } catch (Throwable $error) {
            $this->pdo->rollBack();
            throw $error;
        }
        return [200, $session];
    }

    private function logout(array $headers, array $body): array
    {
        $accessToken = $this->bearerToken($headers);
        if (!$this->findActiveToken($accessToken, 'access')) {
            return [401, ['error' => ['code' => 'unauthorized', 'message' => 'Authentication required']]];
        }
        $this->revokeTokenHash($this->tokenHash($accessToken));
        $refreshToken = trim((string) ($body['refresh_token'] ?? ''));
        if ($refreshToken !== '') $this->revokeTokenHash($this->tokenHash($refreshToken));
        return [204, []];
    }

    private function updateProfile(array $headers, array $body): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();

        $username = $this->username($body['username'] ?? null);
        $statement = $this->pdo->prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?');
        $statement->execute([$username, $this->now(), $user['id']]);
        return [200, ['user' => $this->userView((int) $user['id'], $user['email'], $username)]];
    }

    private function uploadBackup(array $headers, array $body): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();
        $deviceId = trim((string) ($body['device_id'] ?? ''));
        $envelope = $body['envelope'] ?? null;
        if ($deviceId === '' || strlen($deviceId) > 128) throw new InvalidArgumentException('device_id is invalid');
        if (!is_array($envelope) || (int) ($envelope['version'] ?? 0) !== 1) throw new InvalidArgumentException('backup envelope is invalid');

        $json = json_encode($envelope, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $bytes = strlen($json);
        if ($bytes > $this->maxBackupBytes) return [413, ['error' => ['code' => 'backup_too_large', 'message' => 'Backup is too large']]];
        $now = $this->now();
        $existing = $this->fetchOne('SELECT user_id, created_at FROM backups WHERE user_id = ?', [$user['id']]);
        if ($existing) {
            $statement = $this->pdo->prepare('UPDATE backups SET device_id = ?, envelope_json = ?, checksum = ?, byte_size = ?, version = ?, updated_at = ? WHERE user_id = ?');
            $statement->execute([$deviceId, $json, hash('sha256', $json), $bytes, 1, $now, $user['id']]);
            $createdAt = (int) $existing['created_at'];
        } else {
            $statement = $this->pdo->prepare('INSERT INTO backups (user_id, device_id, envelope_json, checksum, byte_size, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $statement->execute([$user['id'], $deviceId, $json, hash('sha256', $json), $bytes, 1, $now, $now]);
            $createdAt = $now;
        }
        return [200, ['backup' => $this->backupView($deviceId, 1, $bytes, $createdAt, $now)]];
    }

    private function backupMetadata(array $headers): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();
        $backup = $this->fetchOne('SELECT device_id, version, byte_size, created_at, updated_at FROM backups WHERE user_id = ?', [$user['id']]);
        if (!$backup) return $this->missingBackup();
        return [200, ['backup' => $this->backupView($backup['device_id'], (int) $backup['version'], (int) $backup['byte_size'], (int) $backup['created_at'], (int) $backup['updated_at'])]];
    }

    private function downloadBackup(array $headers): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();
        $backup = $this->fetchOne('SELECT envelope_json, checksum FROM backups WHERE user_id = ?', [$user['id']]);
        if (!$backup) return $this->missingBackup();
        if (!hash_equals($backup['checksum'], hash('sha256', $backup['envelope_json']))) {
            return [500, ['error' => ['code' => 'backup_corrupt', 'message' => 'Stored backup failed checksum validation']]];
        }
        return [200, ['envelope' => json_decode($backup['envelope_json'], true, 512, JSON_THROW_ON_ERROR)]];
    }

    private function deleteBackup(array $headers): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();
        $statement = $this->pdo->prepare('DELETE FROM backups WHERE user_id = ?');
        $statement->execute([$user['id']]);
        return [204, []];
    }

    private function pushSync(array $headers, array $body): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();
        $this->requireSyncProtocol($body);

        $bodyJson = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (strlen($bodyJson) > $this->maxSyncBatchBytes) {
            return [413, ['error' => ['code' => 'sync_batch_too_large', 'message' => 'Sync batch is too large']]];
        }
        $deviceId = $this->syncDeviceId($body['device_id'] ?? null);
        $mutations = $body['mutations'] ?? null;
        if (!is_array($mutations) || !array_is_list($mutations)) {
            throw new InvalidArgumentException('mutations must be an array');
        }
        if (count($mutations) > $this->maxSyncMutations) {
            return [413, ['error' => ['code' => 'sync_mutation_limit', 'message' => 'Sync mutation count exceeds the limit']]];
        }
        $normalized = array_map(fn (mixed $mutation): array => $this->normalizeSyncMutation($mutation, $deviceId), $mutations);
        $userId = (int) $user['id'];

        $this->pdo->beginTransaction();
        try {
            $this->ensureSyncState($userId);
            $results = [];
            foreach ($normalized as $mutation) {
                $receipt = $this->fetchOne(
                    'SELECT request_hash, revision, accepted, entity_type, entity_id FROM sync_mutations WHERE user_id = ? AND mutation_id = ?',
                    [$userId, $mutation['mutation_id']]
                );
                if ($receipt) {
                    if (!hash_equals($receipt['request_hash'], $mutation['request_hash'])) {
                        throw new CloudSyncHttpException(409, 'mutation_id_reused', 'mutation_id was already used for a different mutation');
                    }
                    $current = $this->fetchSyncRecord($userId, $receipt['entity_type'], $receipt['entity_id']);
                    $results[] = [
                        'mutation_id' => $mutation['mutation_id'],
                        'mutation_revision' => (int) $receipt['revision'],
                        'accepted' => (bool) ((int) $receipt['accepted']),
                        'record' => $current ? $this->syncRecordView($current) : null,
                    ];
                    continue;
                }

                $revision = $this->nextSyncRevision($userId);
                $current = $this->fetchSyncRecord($userId, $mutation['entity_type'], $mutation['entity_id']);
                $accepted = !$current || $this->compareSyncCandidate($mutation, $revision, $current) > 0;
                if ($accepted) {
                    $this->storeCurrentSyncRecord($userId, $mutation, $revision, (bool) $current);
                    $this->appendSyncChange($userId, $mutation, $revision);
                }
                $statement = $this->pdo->prepare(
                    'INSERT INTO sync_mutations (user_id, mutation_id, request_hash, entity_type, entity_id, revision, accepted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $statement->execute([
                    $userId,
                    $mutation['mutation_id'],
                    $mutation['request_hash'],
                    $mutation['entity_type'],
                    $mutation['entity_id'],
                    $revision,
                    $accepted ? 1 : 0,
                    $this->now(),
                ]);
                $current = $this->fetchSyncRecord($userId, $mutation['entity_type'], $mutation['entity_id']);
                $results[] = [
                    'mutation_id' => $mutation['mutation_id'],
                    'mutation_revision' => $revision,
                    'accepted' => $accepted,
                    'record' => $current ? $this->syncRecordView($current) : null,
                ];
            }
            $state = $this->fetchOne('SELECT current_revision FROM sync_user_state WHERE user_id = ?', [$userId]);
            $cursor = (int) ($state['current_revision'] ?? 0);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }

        return [200, [
            'protocol_version' => self::SYNC_PROTOCOL_VERSION,
            'server_cursor' => $cursor,
            'results' => $results,
        ]];
    }

    private function pullSync(array $headers, array $body): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();
        $this->requireSyncProtocol($body);
        $cursor = $this->syncInteger($body['cursor'] ?? 0, 'cursor', 0);
        $limit = $this->syncInteger($body['limit'] ?? 100, 'limit', 1);
        if ($limit > $this->maxSyncPullLimit) throw new InvalidArgumentException('limit exceeds the maximum');
        $userId = (int) $user['id'];

        $this->pdo->beginTransaction();
        try {
            $state = $this->fetchOne('SELECT current_revision FROM sync_user_state WHERE user_id = ?', [$userId]);
            $watermark = (int) ($state['current_revision'] ?? 0);
            if ($cursor > $watermark) {
                throw new CloudSyncHttpException(409, 'sync_cursor_ahead', 'Sync cursor is ahead of the server');
            }
            $rows = [];
            $pageBytes = 0;
            $scanCursor = $cursor;
            $hasMore = false;
            $statement = $this->pdo->prepare(
                'SELECT entity_type, entity_id, operation, envelope_json, checksum, byte_size, updated_at_ms, device_id, revision '
                . 'FROM sync_changes WHERE user_id = ? AND revision > ? AND revision <= ? ORDER BY revision ASC LIMIT 1'
            );
            while (count($rows) < $limit) {
                $statement->execute([$userId, $scanCursor, $watermark]);
                $row = $statement->fetch();
                $statement->closeCursor();
                if (!$row) break;
                $rowBytes = (int) $row['byte_size']
                    + strlen($row['entity_type'])
                    + strlen($row['entity_id'])
                    + strlen($row['device_id'])
                    + 512;
                if ($rows && $pageBytes + $rowBytes > $this->maxSyncPullBytes) {
                    $hasMore = true;
                    break;
                }
                $rows[] = $row;
                $pageBytes += $rowBytes;
                $scanCursor = (int) $row['revision'];
            }
            if (!$hasMore && count($rows) === $limit) {
                $statement->execute([$userId, $scanCursor, $watermark]);
                $hasMore = (bool) $statement->fetch();
                $statement->closeCursor();
            }
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }

        $changes = array_map(fn (array $row): array => $this->syncRecordView($row), $rows);
        $nextCursor = $hasMore && $changes
            ? (int) $changes[array_key_last($changes)]['revision']
            : $watermark;
        return [200, [
            'protocol_version' => self::SYNC_PROTOCOL_VERSION,
            'changes' => $changes,
            'next_cursor' => $nextCursor,
            'has_more' => $hasMore,
            'server_cursor' => $watermark,
        ]];
    }

    private function uploadJsonExport(array $headers, array $body): array
    {
        $user = $this->authenticate($headers);
        if (!$user) return $this->unauthorized();

        $backup = $body['backup'] ?? null;
        if (!is_array($backup)) throw new InvalidArgumentException('backup is invalid');
        $backup = $this->normalizeJsonExport($backup);
        $formatVersion = $this->validateJsonExport($backup);
        $json = json_encode($backup, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $bytes = strlen($json);
        if ($bytes > $this->maxBackupBytes) {
            return [413, ['error' => ['code' => 'json_export_too_large', 'message' => 'JSON export is too large']]];
        }

        $token = $this->randomToken();
        $now = $this->now();
        $statement = $this->pdo->prepare('INSERT INTO json_exports (user_id, token_hash, backup_json, checksum, byte_size, format_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $statement->execute([
            $user['id'],
            $this->tokenHash($token),
            $json,
            hash('sha256', $json),
            $bytes,
            $formatVersion,
            $now,
        ]);

        $path = '/api/v1/json-exports/' . $token;
        return [201, ['export' => [
            'download_url' => $this->publicBaseUrl . $path,
            'byte_size' => $bytes,
            'format_version' => $formatVersion,
            'created_at' => $now,
        ]]];
    }

    private function downloadJsonExport(string $token): array
    {
        $export = $this->fetchOne(
            'SELECT backup_json, checksum FROM json_exports WHERE token_hash = ?',
            [$this->tokenHash($token)]
        );
        if (!$export) {
            return [404, ['error' => ['code' => 'json_export_not_found', 'message' => 'JSON export not found']]];
        }
        if (!hash_equals($export['checksum'], hash('sha256', $export['backup_json']))) {
            return [500, ['error' => ['code' => 'json_export_corrupt', 'message' => 'Stored JSON export failed checksum validation']]];
        }
        return [200, json_decode($export['backup_json'], true, 512, JSON_THROW_ON_ERROR)];
    }

    private function validateJsonExport(array $backup): int
    {
        $formatVersion = (int) ($backup['formatVersion'] ?? 0);
        if (!in_array($formatVersion, [1, 2, 3, 4, 5], true)) {
            throw new InvalidArgumentException('backup formatVersion is unsupported');
        }
        foreach (['providers', 'conversations', 'messages', 'settings'] as $field) {
            if (!isset($backup[$field]) || !is_array($backup[$field])) {
                throw new InvalidArgumentException('backup ' . $field . ' is invalid');
            }
        }
        if ($formatVersion >= 2 && (!isset($backup['attachments']) || !is_array($backup['attachments']))) {
            throw new InvalidArgumentException('backup attachments is invalid');
        }
        if ($formatVersion >= 3) {
            foreach (['characters', 'worldBooks', 'characterAssets'] as $field) {
                if (!isset($backup[$field]) || !is_array($backup[$field])) {
                    throw new InvalidArgumentException('backup ' . $field . ' is invalid');
                }
            }
        }
        return $formatVersion;
    }

    private function normalizeJsonExport(array $backup): array
    {
        if (array_key_exists('formatVersion', $backup)) return $backup;

        $legacyVersion = (int) ($backup['cloudFormatVersion'] ?? 0);
        if (in_array($legacyVersion, [1, 2, 3, 4, 5], true)) {
            $backup['formatVersion'] = $legacyVersion;
            return $backup;
        }

        $hasProviderMemberData = array_filter(
            $backup['conversations'] ?? [],
            fn (mixed $conversation): bool => is_array($conversation) && array_filter(
                is_array($conversation['participants'] ?? null) ? $conversation['participants'] : [],
                fn (mixed $participant): bool => is_array($participant) && !empty($participant['providerProfileId'])
            ) !== []
        ) !== [] || array_filter(
            $backup['messages'] ?? [],
            fn (mixed $message): bool => is_array($message) && !empty($message['speakerProviderProfileId'])
        ) !== [];

        $hasGroupData = array_filter(
            $backup['conversations'] ?? [],
            fn (mixed $conversation): bool => is_array($conversation) && ($conversation['conversationKind'] ?? null) === 'group'
        ) !== [] || array_filter(
            $backup['messages'] ?? [],
            fn (mixed $message): bool => is_array($message) && (
                !empty($message['speakerCharacterId']) || !empty($message['speakerNameSnapshot'])
            )
        ) !== [];

        if ($hasProviderMemberData) {
            $backup['formatVersion'] = 5;
        } elseif ($hasGroupData) {
            $backup['formatVersion'] = 4;
        } elseif (array_key_exists('characters', $backup) || array_key_exists('worldBooks', $backup) || array_key_exists('characterAssets', $backup)) {
            $backup['formatVersion'] = 3;
        } elseif (array_key_exists('attachments', $backup)) {
            $backup['formatVersion'] = 2;
        } else {
            $backup['formatVersion'] = 1;
        }
        return $backup;
    }

    private function issueSession(int $userId, string $email, string $username): array
    {
        $access = $this->randomToken();
        $refresh = $this->randomToken();
        $now = $this->now();
        $statement = $this->pdo->prepare('INSERT INTO auth_tokens (user_id, token_hash, token_type, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)');
        $statement->execute([$userId, $this->tokenHash($access), 'access', $now + self::ACCESS_TTL, $now]);
        $statement->execute([$userId, $this->tokenHash($refresh), 'refresh', $now + self::REFRESH_TTL, $now]);
        return [
            'user' => $this->userView($userId, $email, $username),
            'access_token' => $access,
            'access_expires_at' => $now + self::ACCESS_TTL,
            'refresh_token' => $refresh,
            'refresh_expires_at' => $now + self::REFRESH_TTL,
        ];
    }

    private function authenticate(array $headers): ?array
    {
        $token = $this->bearerToken($headers);
        return $token === '' ? null : $this->findActiveToken($token, 'access');
    }

    private function findActiveToken(string $token, string $type): ?array
    {
        if ($token === '') return null;
        return $this->fetchOne(
            'SELECT auth_tokens.user_id, auth_tokens.user_id AS id, users.email, users.username FROM auth_tokens JOIN users ON users.id = auth_tokens.user_id WHERE auth_tokens.token_hash = ? AND auth_tokens.token_type = ? AND auth_tokens.revoked_at IS NULL AND auth_tokens.expires_at > ?',
            [$this->tokenHash($token), $type, $this->now()]
        ) ?: null;
    }

    private function revokeTokenHash(string $hash): void
    {
        $statement = $this->pdo->prepare('UPDATE auth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL');
        $statement->execute([$this->now(), $hash]);
    }

    private function requireSyncProtocol(array $body): void
    {
        if (($body['protocol_version'] ?? null) !== self::SYNC_PROTOCOL_VERSION) {
            throw new InvalidArgumentException('protocol_version is unsupported');
        }
    }

    private function normalizeSyncMutation(mixed $value, string $deviceId): array
    {
        if (!is_array($value) || array_is_list($value)) throw new InvalidArgumentException('mutation is invalid');
        $mutationId = $value['mutation_id'] ?? null;
        if (!is_string($mutationId) || !preg_match('/^[A-Za-z0-9._:-]{1,128}$/D', $mutationId)) {
            throw new InvalidArgumentException('mutation_id is invalid');
        }
        $entityType = $value['entity_type'] ?? null;
        if (!is_string($entityType) || !in_array($entityType, self::SYNC_ENTITY_TYPES, true)) {
            throw new InvalidArgumentException('entity_type is invalid');
        }
        $entityId = $this->syncEntityId($value['entity_id'] ?? null);
        $operation = $value['operation'] ?? null;
        if (!is_string($operation) || !in_array($operation, ['upsert', 'delete'], true)) {
            throw new InvalidArgumentException('operation is invalid');
        }
        $updatedAt = $this->syncInteger($value['updated_at_ms'] ?? null, 'updated_at_ms', 0);
        if ($updatedAt > (($this->now() + 86400) * 1000)) {
            throw new InvalidArgumentException('updated_at_ms is too far in the future');
        }
        [$envelope, $envelopeJson] = $this->normalizeSyncEnvelope($value['envelope'] ?? null);
        $envelopeBytes = strlen($envelopeJson);
        if ($envelopeBytes > $this->maxSyncEnvelopeBytes) {
            throw new CloudSyncHttpException(413, 'sync_record_too_large', 'Encrypted sync record is too large');
        }
        $request = [
            'device_id' => $deviceId,
            'mutation_id' => $mutationId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'operation' => $operation,
            'updated_at_ms' => $updatedAt,
            'envelope' => $envelope,
        ];
        return [
            ...$request,
            'envelope_json' => $envelopeJson,
            'envelope_bytes' => $envelopeBytes,
            'checksum' => hash('sha256', $envelopeJson),
            'request_hash' => hash('sha256', json_encode(
                $this->canonicalizeSyncValue($request),
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
            )),
        ];
    }

    private function normalizeSyncEnvelope(mixed $value): array
    {
        if (!is_array($value) || array_is_list($value)) throw new InvalidArgumentException('envelope is invalid');
        $valid = ($value['version'] ?? null) === self::SYNC_PROTOCOL_VERSION
            && ($value['kdf']['name'] ?? null) === 'PBKDF2'
            && ($value['kdf']['hash'] ?? null) === 'SHA-256'
            && ($value['kdf']['iterations'] ?? null) === self::SYNC_KDF_ITERATIONS
            && ($value['cipher']['name'] ?? null) === 'AES-GCM';
        if (!$valid) throw new InvalidArgumentException('envelope is invalid');
        $salt = $this->decodeSyncBase64($value['kdf']['salt'] ?? null, 'envelope salt');
        $iv = $this->decodeSyncBase64($value['cipher']['iv'] ?? null, 'envelope iv');
        $ciphertext = $this->decodeSyncBase64($value['cipher']['ciphertext'] ?? null, 'envelope ciphertext');
        if (strlen($salt) !== 16 || strlen($iv) !== 12 || strlen($ciphertext) < 16) {
            throw new InvalidArgumentException('envelope byte lengths are invalid');
        }
        $normalized = $this->canonicalizeSyncValue($value);
        return [$normalized, json_encode(
            $normalized,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        )];
    }

    private function decodeSyncBase64(mixed $value, string $field): string
    {
        if (!is_string($value) || $value === '' || !preg_match('/^[A-Za-z0-9+\/]+={0,2}$/D', $value)) {
            throw new InvalidArgumentException($field . ' is invalid');
        }
        $decoded = base64_decode($value, true);
        if ($decoded === false) throw new InvalidArgumentException($field . ' is invalid');
        return $decoded;
    }

    private function canonicalizeSyncValue(mixed $value): mixed
    {
        if (!is_array($value)) return $value;
        if (array_is_list($value)) return array_map(fn (mixed $item): mixed => $this->canonicalizeSyncValue($item), $value);
        ksort($value, SORT_STRING);
        foreach ($value as $key => $item) $value[$key] = $this->canonicalizeSyncValue($item);
        return $value;
    }

    private function syncDeviceId(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^[A-Za-z0-9._:-]{1,128}$/D', $value)) {
            throw new InvalidArgumentException('device_id is invalid');
        }
        return $value;
    }

    private function syncEntityId(mixed $value): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 191 || preg_match('//u', $value) !== 1 || preg_match('/\p{C}/u', $value)) {
            throw new InvalidArgumentException('entity_id is invalid');
        }
        return $value;
    }

    private function syncInteger(mixed $value, string $field, int $minimum): int
    {
        if (!is_int($value) || $value < $minimum) throw new InvalidArgumentException($field . ' is invalid');
        return $value;
    }

    private function ensureSyncState(int $userId): void
    {
        $driver = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $sql = $driver === 'sqlite'
            ? 'INSERT OR IGNORE INTO sync_user_state (user_id, current_revision, updated_at) VALUES (?, 0, ?)'
            : 'INSERT IGNORE INTO sync_user_state (user_id, current_revision, updated_at) VALUES (?, 0, ?)';
        $statement = $this->pdo->prepare($sql);
        $statement->execute([$userId, $this->now()]);
    }

    private function nextSyncRevision(int $userId): int
    {
        $statement = $this->pdo->prepare('UPDATE sync_user_state SET current_revision = current_revision + 1, updated_at = ? WHERE user_id = ?');
        $statement->execute([$this->now(), $userId]);
        $state = $this->fetchOne('SELECT current_revision FROM sync_user_state WHERE user_id = ?', [$userId]);
        if (!$state) throw new RuntimeException('Sync state was not initialized');
        return (int) $state['current_revision'];
    }

    private function fetchSyncRecord(int $userId, string $entityType, string $entityId): array|false
    {
        return $this->fetchOne(
            'SELECT entity_type, entity_id, operation, envelope_json, checksum, byte_size, updated_at_ms, device_id, revision '
            . 'FROM sync_records WHERE user_id = ? AND entity_type = ? AND entity_id = ?',
            [$userId, $entityType, $entityId]
        );
    }

    private function compareSyncCandidate(array $mutation, int $revision, array $current): int
    {
        $comparison = $mutation['updated_at_ms'] <=> (int) $current['updated_at_ms'];
        if ($comparison !== 0) return $comparison;
        $comparison = ($mutation['operation'] === 'delete' ? 1 : 0) <=> ($current['operation'] === 'delete' ? 1 : 0);
        if ($comparison !== 0) return $comparison;
        $comparison = $revision <=> (int) $current['revision'];
        if ($comparison !== 0) return $comparison;
        return strcmp($mutation['device_id'], $current['device_id']);
    }

    private function storeCurrentSyncRecord(int $userId, array $mutation, int $revision, bool $exists): void
    {
        $fields = [
            $mutation['operation'], $mutation['envelope_json'], $mutation['checksum'], $mutation['envelope_bytes'],
            $mutation['updated_at_ms'], $mutation['device_id'], $revision,
        ];
        if ($exists) {
            $statement = $this->pdo->prepare(
                'UPDATE sync_records SET operation = ?, envelope_json = ?, checksum = ?, byte_size = ?, updated_at_ms = ?, device_id = ?, revision = ? '
                . 'WHERE user_id = ? AND entity_type = ? AND entity_id = ?'
            );
            $statement->execute([...$fields, $userId, $mutation['entity_type'], $mutation['entity_id']]);
            return;
        }
        $statement = $this->pdo->prepare(
            'INSERT INTO sync_records (operation, envelope_json, checksum, byte_size, updated_at_ms, device_id, revision, user_id, entity_type, entity_id) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([...$fields, $userId, $mutation['entity_type'], $mutation['entity_id']]);
    }

    private function appendSyncChange(int $userId, array $mutation, int $revision): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO sync_changes (user_id, revision, entity_type, entity_id, operation, envelope_json, checksum, byte_size, updated_at_ms, device_id) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([
            $userId, $revision, $mutation['entity_type'], $mutation['entity_id'], $mutation['operation'],
            $mutation['envelope_json'], $mutation['checksum'], $mutation['envelope_bytes'],
            $mutation['updated_at_ms'], $mutation['device_id'],
        ]);
    }

    private function syncRecordView(array $record): array
    {
        if (!hash_equals($record['checksum'], hash('sha256', $record['envelope_json']))) {
            throw new CloudSyncHttpException(500, 'sync_record_corrupt', 'Stored encrypted sync record failed checksum validation');
        }
        return [
            'entity_type' => $record['entity_type'],
            'entity_id' => $record['entity_id'],
            'operation' => $record['operation'],
            'updated_at_ms' => (int) $record['updated_at_ms'],
            'device_id' => $record['device_id'],
            'revision' => (int) $record['revision'],
            'envelope' => json_decode($record['envelope_json'], true, 32, JSON_THROW_ON_ERROR),
        ];
    }

    private function credentials(array $body): array
    {
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) throw new InvalidArgumentException('email is invalid');
        if (strlen($password) < 12 || strlen($password) > 1024) throw new InvalidArgumentException('password must contain 12 to 1024 characters');
        return [$email, $password];
    }

    private function username(mixed $value, string $fallbackEmail = ''): string
    {
        $username = preg_replace('/\s+/u', ' ', trim((string) ($value ?? '')));
        if ($username === '' && $fallbackEmail !== '') {
            $localPart = strstr($fallbackEmail, '@', true) ?: 'user';
            $username = substr($localPart, 0, 32);
        }
        if (
            $username === '' ||
            strlen($username) > 128 ||
            preg_match('/\p{C}/u', $username) ||
            !preg_match('/^.{1,32}$/u', $username)
        ) {
            throw new InvalidArgumentException('username must contain 1 to 32 visible characters');
        }
        return $username;
    }

    private function userView(int $id, string $email, string $username): array
    {
        return ['id' => $id, 'email' => $email, 'username' => $username];
    }

    private function bearerToken(array $headers): string
    {
        $normalized = array_change_key_case($headers, CASE_LOWER);
        return preg_match('/^Bearer\s+(.+)$/i', trim((string) ($normalized['authorization'] ?? '')), $matches) ? trim($matches[1]) : '';
    }

    private function fetchOne(string $sql, array $parameters): array|false
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);
        return $statement->fetch();
    }

    private function backupView(string $deviceId, int $version, int $bytes, int $createdAt, int $updatedAt): array
    {
        return ['device_id' => $deviceId, 'version' => $version, 'byte_size' => $bytes, 'created_at' => $createdAt, 'updated_at' => $updatedAt];
    }

    private function unauthorized(): array { return [401, ['error' => ['code' => 'unauthorized', 'message' => 'Authentication required']]]; }
    private function missingBackup(): array { return [404, ['error' => ['code' => 'backup_not_found', 'message' => 'Backup not found']]]; }
    private function now(): int { return (int) ($this->clock)(); }
    private function tokenHash(string $token): string { return hash('sha256', $token); }
    private function randomToken(): string { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }
}
