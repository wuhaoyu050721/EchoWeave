import { CloudApiClient } from '../services/cloud-api-client.js'
import { CloudBackupScheduler } from '../services/cloud-backup-scheduler.js'
import { CloudBackupService } from '../services/cloud-backup-service.js'
import { AndroidWorkManagerSyncAdapter } from '../services/android-workmanager-sync-adapter.js'
import { CloudSyncCredentialStore } from '../services/cloud-sync-credential-store.js'
import { CloudSyncCoordinator } from '../services/cloud-sync-coordinator.js'
import { CloudSyncEngine } from '../services/cloud-sync-engine.js'
import { CloudSyncRepositoryAdapter } from '../services/cloud-sync-repository-adapter.js'
import { CloudSyncStateStore } from '../services/cloud-sync-state-store.js'
import { CloudTokenStore } from '../services/cloud-token-store.js'

export function createCloudServices({
  baseUrl,
  repository,
  vault,
  transport,
  backupService,
  tokenStore,
  deviceTokenStore,
  getDeviceId,
  getAccountId,
  isOnline,
  onStatus,
  onSyncStatus
}) {
  const resolvedTokenStore = tokenStore || deviceTokenStore || new CloudTokenStore({ repository, vault })
  const credentialStore = new CloudSyncCredentialStore({ repository, vault })
  const apiClient = new CloudApiClient({ baseUrl, transport, tokenStore: resolvedTokenStore })
  const cloudBackupService = new CloudBackupService({ backupService, repository, vault, apiClient })
  const scheduler = getDeviceId
    ? new CloudBackupScheduler({ cloudBackupService, credentialStore, getDeviceId, onStatus })
    : null
  const syncAdapter = getAccountId
    ? new CloudSyncRepositoryAdapter({ repository, vault })
    : null
  const syncStateStore = syncAdapter ? new CloudSyncStateStore({ repository }) : null
  const syncEngine = syncAdapter
    ? new CloudSyncEngine({ adapter: syncAdapter, apiClient, stateStore: syncStateStore })
    : null
  const syncCoordinator = syncEngine && getDeviceId
    ? new CloudSyncCoordinator({
        syncEngine,
        credentialStore,
        getDeviceId,
        getAccountId,
        isOnline,
        onStatus: onSyncStatus || onStatus
      })
    : null
  const androidWorkManagerSyncAdapter = syncCoordinator
    ? new AndroidWorkManagerSyncAdapter({ coordinator: syncCoordinator })
    : null
  return {
    tokenStore: resolvedTokenStore,
    credentialStore,
    apiClient,
    cloudBackupService,
    scheduler,
    syncAdapter,
    syncStateStore,
    syncEngine,
    syncCoordinator,
    androidWorkManagerSyncAdapter
  }
}
