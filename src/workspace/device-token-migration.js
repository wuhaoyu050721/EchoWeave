import { CloudTokenStore } from '../services/cloud-token-store.js'
import { LOCAL_WORKSPACE_ID, normalizeAccountNamespace } from './workspace-id.js'

function normalizeCloudBaseUrl(value) {
  const baseUrl = String(value ?? '').trim()
  if (!/^https?:\/\//i.test(baseUrl)) return ''
  try {
    return normalizeAccountNamespace(baseUrl)
  } catch {
    return ''
  }
}

async function legacyWorkspaceBaseUrl(repository) {
  if (typeof repository?.getSetting !== 'function') return ''
  try {
    const cloudConfig = await repository.getSetting('cloudConfig', null)
    return normalizeCloudBaseUrl(cloudConfig?.baseUrl)
  } catch {
    return ''
  }
}

function scopeSession(session, fallbackBaseUrl) {
  const baseUrl = normalizeCloudBaseUrl(session?.cloud_base_url) || fallbackBaseUrl
  return baseUrl ? { ...session, cloud_base_url: baseUrl } : null
}

export async function migrateLegacyCloudToken({
  workspaceId,
  repository,
  vault,
  deviceTokenStore
} = {}) {
  if (workspaceId !== LOCAL_WORKSPACE_ID) return { status: 'not-local' }
  if (!deviceTokenStore?.load || !deviceTokenStore?.save || !deviceTokenStore?.clear) {
    throw new Error('设备级 token store 不完整')
  }

  const legacyTokenStore = new CloudTokenStore({ repository, vault })
  if (deviceTokenStore.repository === repository) return { status: 'shared-store' }
  try {
    const deviceSession = await deviceTokenStore.load()
    const legacySession = await legacyTokenStore.load()
    const fallbackBaseUrl = await legacyWorkspaceBaseUrl(repository)

    if (deviceSession) {
      if (legacySession) await legacyTokenStore.clear()
      const scopedDeviceSession = scopeSession(deviceSession, fallbackBaseUrl)
      if (!scopedDeviceSession) {
        await deviceTokenStore.clear()
        return { status: 'reauth-required', reason: 'missing-cloud-base-url' }
      }
      if (scopedDeviceSession.cloud_base_url !== deviceSession.cloud_base_url) {
        await deviceTokenStore.save(scopedDeviceSession)
        return { status: 'scoped-device-session', session: scopedDeviceSession }
      }
      return { status: legacySession ? 'removed-legacy-copy' : 'already-device-level' }
    }
    if (!legacySession) return { status: 'empty' }

    const scopedLegacySession = scopeSession(legacySession, fallbackBaseUrl)
    if (!scopedLegacySession) {
      await legacyTokenStore.clear()
      return { status: 'reauth-required', reason: 'missing-cloud-base-url' }
    }
    await deviceTokenStore.save(scopedLegacySession)
    await legacyTokenStore.clear()
    return { status: 'migrated', session: scopedLegacySession }
  } catch (error) {
    let cleanupFailed = false
    try { await deviceTokenStore.clear() } catch { cleanupFailed = true }
    try { await legacyTokenStore.clear() } catch { cleanupFailed = true }
    return {
      status: 'reauth-required',
      reason: 'migration-failed',
      error,
      cleanupFailed
    }
  }
}
