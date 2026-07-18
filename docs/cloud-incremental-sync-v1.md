# Cloud Incremental Sync v1

## Scope

The v1 sync protocol coexists with the existing opaque full-backup API. These routes are unchanged:

- `PUT /api/v1/backup`
- `GET /api/v1/backup`
- `GET /api/v1/backup/meta`
- `DELETE /api/v1/backup`

Incremental sync covers `providers`, `conversations`, `messages`, `attachments`, `characters`, `worldBooks`, `characterAssets`, and business `settings`. The device-local transport settings `cloudDeviceId`, `cloudAutoBackup`, and `cloudConfig` are excluded so one device cannot overwrite another device's identity or scheduling configuration.

## Wire Protocol

Both sync routes use the existing bearer access token and automatic refresh-token flow.

### Push

`POST /api/v1/sync/push`

```json
{
  "protocol_version": 1,
  "device_id": "device-a",
  "mutations": [
    {
      "mutation_id": "b82c1f2e-2c9f-49de-812c-12a2e07458c4",
      "entity_type": "messages",
      "entity_id": "message-1",
      "operation": "upsert",
      "updated_at_ms": 1800000000000,
      "envelope": {}
    }
  ]
}
```

Every first-seen mutation gets a user-scoped monotonic revision, including a mutation that loses conflict resolution. A repeated `mutation_id` with the identical request returns its original result and allocates no revision. Reusing it for different content returns `409 mutation_id_reused`.

The response includes one result per mutation. `record` is the current canonical encrypted record, including when the submitted mutation loses. This lets a client converge even when its pull cursor has already passed that record's revision.

### Pull

`POST /api/v1/sync/pull`

```json
{
  "protocol_version": 1,
  "cursor": 0,
  "limit": 100
}
```

The response contains `changes`, `next_cursor`, `has_more`, and `server_cursor`. Pull captures a transactional server watermark before querying changes. When the last page crosses revisions used by rejected mutations, `next_cursor` advances to that watermark without inventing change rows. A cursor ahead of the user's watermark returns `409 sync_cursor_ahead`.

## Encryption

Each upsert and tombstone has its own AES-GCM envelope and random 96-bit IV. PBKDF2-SHA-256 uses 210,000 iterations and a 128-bit salt. A device reuses its KDF salt across records so one sync run can cache the derived key, but each record is independently authenticated and decryptable.

AES-GCM additional authenticated data binds protocol version, entity type, entity ID, operation, and `updated_at_ms`. An envelope cannot be moved to another record or changed from an upsert to a delete without authentication failure.

The server sees account ID, entity type, opaque entity ID, operation, client timestamp, device ID, sizes, revisions, and ciphertext. It never receives record plaintext, API keys, prompts, attachment bodies, character data, world-book data, or local plaintext hashes.

Provider API keys and encrypted prompts are decrypted from the source device vault only in memory, encrypted inside the sync envelope, then re-encrypted with the destination device vault before repository import.

## Manifests And Deletes

The account-scoped local state contains:

- Last pull cursor.
- Per-record plaintext hash, canonical revision, timestamp, tombstone state, and minimal relationship references.
- Pending mutation IDs and already encrypted envelopes.
- The device's sync KDF salt.

The state contains no sync password or business plaintext. A scan compares canonical local hashes with the manifest. A formerly known record that is physically absent creates an encrypted tombstone. Minimal relationship references are kept so SQLite can store filtered tombstone rows for entities whose local schema has non-null parent columns.

Settings have no repository delete method. A received setting tombstone is stored as `null`; when its manifest entry is deleted, the adapter treats that `null` as absent and does not create a new upsert.

## Conflict Order

The server compares this tuple, highest value wins:

1. `updated_at_ms`
2. Tombstone rank (`delete` wins an exact timestamp tie)
3. Server-assigned revision
4. Lexicographic device ID

An older upsert cannot revive a tombstone. An equal-timestamp upsert also cannot revive it. A strictly newer upsert is treated as an intentional later edit and may recreate the record.

## Limits

Defaults are configurable in `server/config.php`:

- Push request: 48 MiB
- One encrypted record: 40 MiB
- Pull response budget: 48 MiB; an individually larger record is returned alone
- Mutations per push: 100
- Maximum pull page: 500 records
- Existing full backup: 100 MiB

The client automatically halves a rejected multi-record push batch and retries without replacing mutation IDs. A rejected single-record batch is reported as `sync_record_too_large`. The front controller caps bytes read from `php://input`; `CloudBackupApp` repeats endpoint-specific validation after JSON decoding and caps pull pages by both count and encrypted byte size.

## Client Wiring

The platform workspace manager and main page compose these services after cloud login:

```js
import { CloudSyncRepositoryAdapter } from './src/services/cloud-sync-repository-adapter.js'
import { CloudSyncStateStore } from './src/services/cloud-sync-state-store.js'
import { CloudSyncEngine } from './src/services/cloud-sync-engine.js'
import { CloudSyncCoordinator } from './src/services/cloud-sync-coordinator.js'
import { AndroidWorkManagerSyncAdapter } from './src/services/android-workmanager-sync-adapter.js'

const syncAdapter = new CloudSyncRepositoryAdapter({ repository, vault })
const syncStateStore = new CloudSyncStateStore({ repository })
const syncEngine = new CloudSyncEngine({
  adapter: syncAdapter,
  apiClient,
  stateStore: syncStateStore
})
const syncCoordinator = new CloudSyncCoordinator({
  syncEngine,
  credentialStore,
  getDeviceId,
  getAccountId: async () => (await tokenStore.load())?.user?.id ?? null,
  isOnline
})
const androidWorker = new AndroidWorkManagerSyncAdapter({ coordinator: syncCoordinator })
```

Public trigger API:

- `syncCoordinator.startForeground()` starts a foreground interval and syncs immediately.
- `syncCoordinator.stopForeground()` stops that JS interval.
- `syncCoordinator.onAppShow()` is the app lifecycle trigger.
- `syncCoordinator.onNetworkRestored()` is the connectivity-restored trigger.
- `syncCoordinator.manualSync()` is the explicit manual API.
- `androidWorker.run()` is the no-UI entry point for a native worker bridge.

`AndroidWorkManagerSyncAdapter` does not schedule WorkManager and does not claim that JavaScript survives process termination. A native Android module must schedule work, initialize a supported headless JS runtime, and invoke `run()`; otherwise only foreground JS triggers are reliable.

## Deployment

1. Back up the MySQL database.
2. Apply `server/migrations/004_incremental_sync.sql` after migrations 001-003.
3. Apply `server/migrations/005_expand_sync_envelopes.sql` so imported character assets up to the existing 20 MiB local limit fit after Data URL and encryption encoding.
4. Deploy the updated `CloudBackupApp.php`, front controller, and config limits.
5. Ensure the reverse proxy and PHP request limits accept at least 48 MiB sync pushes.
6. Smoke-test register/login and the existing `/api/v1/backup` upload/download routes.
7. Smoke-test empty sync pull, one encrypted push, idempotent replay, byte-bounded paginated pull, and a large character asset.
8. Release the client code.

Server rollback can restore the previous PHP files without dropping the new tables. Old clients remain on `/api/v1/backup` throughout deployment.
