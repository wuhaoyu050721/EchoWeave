# Cloud Backup V1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deployable PHP/MySQL account and encrypted snapshot backup service plus reusable client-side cloud backup primitives.

**Architecture:** PHP exposes a small versioned REST API backed by PDO. The app encrypts backup JSON with a sync-password-derived AES-GCM key and sends an opaque envelope through an authenticated client that can rotate refresh tokens.

**Tech Stack:** PHP 8.2+, PDO MySQL, SQLite integration tests, JavaScript Web Crypto, Node test runner.

## Global Constraints

- Never store plaintext passwords or bearer tokens.
- Never send the sync password to the server.
- Keep browser and Android local chat behavior unchanged.
- V1.1 replaces a single snapshot and does not merge records.
- Repository writes during restore happen only after successful decryption and validation.

---

### Task 1: PHP API Core and Schema

**Files:**
- Create: `server/src/CloudBackupApp.php`
- Create: `server/public/index.php`
- Create: `server/migrations/001_initial.sql`
- Create: `server/config.example.php`
- Create: `server/tests/integration.php`

**Interfaces:**
- `CloudBackupApp::handle(string $method, string $path, array $headers, array $body): array`
- Returns `[statusCode, responseBody]`.

- [ ] Write integration tests for registration, login, refresh rotation, logout, user isolation, upload, metadata, restore, and deletion.
- [ ] Run `php server/tests/integration.php` and verify RED.
- [ ] Implement validation, token hashing, token expiry, authentication, and snapshot persistence.
- [ ] Run the PHP integration test and verify GREEN.

### Task 2: Client Backup Cryptography

**Files:**
- Create: `src/core/cloud-backup-crypto.js`
- Create: `tests/cloud-backup-crypto.test.js`

**Interfaces:**
- `encryptCloudBackup(payload, password, options)` returns a versioned envelope.
- `decryptCloudBackup(envelope, password, options)` returns the original payload.

- [ ] Write failing tests for round trip, random salt/IV, malformed envelope, and wrong password.
- [ ] Verify RED.
- [ ] Implement PBKDF2-HMAC-SHA256 with 210,000 iterations and AES-256-GCM.
- [ ] Verify GREEN.

### Task 3: Authenticated Cloud API Client

**Files:**
- Create: `src/services/cloud-api-client.js`
- Create: `tests/cloud-api-client.test.js`

**Interfaces:**
- `register`, `login`, `logout`, `getBackupMetadata`, `uploadBackup`, `downloadBackup`, `deleteBackup`.
- A `tokenStore` provides `load()`, `save(session)`, and `clear()`.

- [ ] Write failing tests for URLs, authorization, JSON parsing, and one refresh retry after `401`.
- [ ] Verify RED.
- [ ] Implement the client without coupling it to Vue.
- [ ] Verify GREEN.

### Task 4: Full Verification

- [ ] Run `php server/tests/integration.php`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run the HBuilderX App compiler.
