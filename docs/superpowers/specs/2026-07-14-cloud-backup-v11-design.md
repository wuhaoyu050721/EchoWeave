# Cloud Backup V1.1 Design

## Scope

V1.1 adds account registration, login, refresh-token rotation, logout, one encrypted backup per user, backup metadata, restore, and backup deletion. It does not add entity-level merge, revision conflict handling, background WorkManager jobs, or multi-device bidirectional synchronization.

## Architecture

The Android app remains local-first. A `CloudApiClient` talks to a PHP 8 JSON API. Access and refresh tokens are opaque random values; only SHA-256 hashes are stored in MySQL. Refresh rotates both tokens and revokes the previous refresh token.

Before upload, the client serializes the existing versioned backup and encrypts it with AES-256-GCM. The encryption key is derived from the user-provided sync password with PBKDF2-HMAC-SHA256, a random 16-byte salt, and 210,000 iterations. MySQL stores only the envelope, checksum, size, device identifier, and timestamps.

## API

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `PUT /api/v1/backup`
- `GET /api/v1/backup/meta`
- `GET /api/v1/backup`
- `DELETE /api/v1/backup`

Access tokens expire after 15 minutes. Refresh tokens expire after 30 days. Passwords use `password_hash()` and `password_verify()`. Email addresses are normalized to lowercase and unique.

## Backup Rules

The server treats the encrypted envelope as opaque JSON and never receives the sync password. Upload replaces the user's previous V1.1 snapshot atomically. Restore validates the envelope version and checksum before returning it. A wrong sync password fails locally before any repository write.

## Error Handling

All responses use JSON. Authentication failures return `401`, validation failures return `422`, duplicate accounts return `409`, missing backups return `404`, and oversized payloads return `413`. Server errors do not include stack traces.

## Testing

PHP integration tests run against in-memory SQLite through PDO and cover account isolation, token rotation, logout, backup replacement, restore, and deletion. Node tests cover PBKDF2/AES-GCM round trips, wrong-password rejection, API request construction, and token refresh retry.
