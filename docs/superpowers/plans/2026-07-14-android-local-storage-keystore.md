# Android Local Storage and Keystore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main uni-app use a native Android transport, `plus.sqlite` persistence, and Android Keystore encryption while preserving the current browser implementation.

**Architecture:** Add Android adapters behind the same repository, vault, and transport contracts already consumed by `ProviderService`, `ChatService`, and `BackupService`. A runtime platform factory selects browser adapters on H5 and dynamically loads Android adapters when `plus.sqlite` and `uni.request` are available. The Keystore implementation is a local UTS extension exposed as custom `uni.aiChatKeystore*` APIs.

**Tech Stack:** uni-app Vue 3, HTML5+ `plus.sqlite`, `uni.request`, Android Keystore through UTS, Node 24 `node:sqlite` for repository tests.

## Global Constraints

- Browser IndexedDB and Web Crypto behavior must remain unchanged.
- Android records must be stored in `_doc/ai-chat-custom.db` with ordered schema migrations.
- API keys and system prompts must only be stored as Android Keystore AES-GCM ciphertext.
- No hard-coded encryption keys may exist in JavaScript, UTS, configuration, or SQLite.
- The App transport must support normal JSON requests, streaming byte chunks, and abort.
- Repository writes involving multiple records must use SQLite transactions.
- Android runtime behavior remains unverified until run on a compatible device.
- This workspace is not a Git repository, so commit steps cannot be executed.

---

### Task 1: `plus.sqlite` Repository and Migrations

**Files:**
- Create: `src/platform/app/plus-sqlite-repository.js`
- Create: `tests/helpers/node-plus-sqlite.js`
- Create: `tests/plus-sqlite-repository.test.js`

**Interfaces:**
- Constructor: `new PlusSqliteRepository({ sqlite, databaseName, databasePath, now })`
- Implements every public method currently exposed by `IndexedDbRepository`.
- Adds `close()` for releasing the native database.

- [ ] Write failing parity tests using `node:sqlite` behind a callback-compatible fake `plus.sqlite` API.
- [ ] Verify RED with `node --test tests/plus-sqlite-repository.test.js`.
- [ ] Implement migration version 1 with `schema_migrations`, `providers`, `conversations`, `messages`, `settings`, and `secrets` tables plus message indexes.
- [ ] Store complete entities as encoded JSON payloads and maintain indexed columns for sorting, filtering, recovery, and relationship deletion.
- [ ] Wrap message pairs, bulk message writes, conversation deletion, recovery, and imports in explicit `begin` / `commit` / `rollback` operations.
- [ ] Verify repository parity tests pass.

### Task 2: Production App Request Transport

**Files:**
- Create: `src/platform/app/uni-request-transport.js`
- Create: `tests/uni-request-transport.test.js`

**Interfaces:**
- Constructor: `new UniRequestTransport({ uniApi })`
- Method: `request({ url, method, headers, body, signal, onChunk, timeout })`
- Returns: `{ status, headers, text }` matching `BrowserFetchTransport`.

- [ ] Write failing tests for normal text responses, byte streaming, HTTP errors, network failures, and immediate abort.
- [ ] Verify RED.
- [ ] Implement `dataType: 'text'` for normal requests and `enableChunked: true` plus `responseType: 'arraybuffer'` for streaming requests.
- [ ] Reject missing `RequestTask.onChunkReceived` with `chunk_callback_unsupported` only when streaming was requested.
- [ ] Verify transport tests pass.

### Task 3: Android Keystore Vault and UTS Bridge

**Files:**
- Create: `src/platform/app/android-keystore-vault.js`
- Create: `tests/android-keystore-vault.test.js`
- Create: `uni_modules/ai-chat-keystore/package.json`
- Create: `uni_modules/ai-chat-keystore/utssdk/app-android/index.uts`

**Interfaces:**
- JavaScript vault methods: `init()`, `encryptString(value)`, `decryptString(record)`.
- Native custom APIs: `uni.aiChatKeystoreReady()`, `uni.aiChatKeystoreEncrypt(value)`, and `uni.aiChatKeystoreDecrypt(recordJson)`.
- Cipher record: `{ version: 1, algorithm: 'AES-GCM', iv, ciphertext }`.

- [ ] Write failing JavaScript adapter tests with a fake native API.
- [ ] Verify RED.
- [ ] Implement adapter validation so malformed native results never enter the repository.
- [ ] Implement a non-exportable AES-256 key in Android KeyStore under alias `ai-chat-custom-device-key-v1`.
- [ ] Use a unique 12-byte GCM IV for every encryption and Base64 `NO_WRAP` encoding.
- [ ] Map the UTS exports to the custom `uni.aiChatKeystore*` API names in `package.json`.
- [ ] Add source-level tests that reject hard-coded key material and require AndroidKeyStore/AES-GCM primitives.

### Task 4: Platform Service Factory and Main App Integration

**Files:**
- Create: `src/app/create-app-services.js`
- Create: `src/app/create-platform-services.js`
- Modify: `pages/index/index.vue`
- Modify: `tests/vue-service-container.test.js`
- Create: `tests/platform-services.test.js`

**Interfaces:**
- `createPlatformServices({ runtime, createBrowser, loadApp })` selects App only when both `runtime.plus.sqlite` and `runtime.uni.request` exist.
- `createAppServices({ plusApi, uniApi })` returns the same service object shape as `createBrowserServices()`.

- [ ] Write failing platform-selection tests.
- [ ] Verify RED.
- [ ] Build App services with `PlusSqliteRepository`, `AndroidKeystoreVault`, `UniRequestTransport`, `OpenAIProvider`, `ProviderService`, `ChatService`, and `BackupService`.
- [ ] Replace the main page's direct browser factory import with `createPlatformServices`.
- [ ] Update the local-data and about text to report SQLite/IndexedDB according to the active repository platform.
- [ ] Verify browser tests still use the browser factory and App selection tests use injected fakes.

### Task 5: Full Verification

- [ ] Run `npm test` and require zero failures, cancellations, or skips.
- [ ] Run `npm run build` and require the browser preview build to complete.
- [ ] Run the HBuilderX 5.15 App compiler and require `DONE Build complete.`.
- [ ] Inspect generated App output for the Android page and `uni_modules/ai-chat-keystore` references.
- [ ] Report Android SQLite, Keystore, and streaming as code-complete but runtime-unverified until a compatible device is available.
