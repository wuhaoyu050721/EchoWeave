export class CloudSyncCoordinator {
  constructor({
    syncEngine,
    credentialStore,
    getDeviceId,
    getAccountId,
    isOnline = () => true,
    intervalMs = 180000,
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    onStatus = () => {}
  } = {}) {
    if (!syncEngine?.sync || !credentialStore?.load || !getDeviceId || !getAccountId) {
      throw new Error('CloudSyncCoordinator dependencies are incomplete')
    }
    this.syncEngine = syncEngine
    this.credentialStore = credentialStore
    this.getDeviceId = getDeviceId
    this.getAccountId = getAccountId
    this.isOnline = isOnline
    this.intervalMs = Math.max(60000, Number(intervalMs) || 180000)
    this.setIntervalFn = setIntervalFn
    this.clearIntervalFn = clearIntervalFn
    this.onStatus = onStatus
    this.interval = null
    this.active = null
    this.blocked = false
  }

  startForeground() {
    this.blocked = false
    if (this.interval == null && this.setIntervalFn) {
      this.interval = this.setIntervalFn(() => this.syncNow('interval'), this.intervalMs)
      this.interval?.unref?.()
    }
    return this.syncNow('foreground-start')
  }

  stopForeground() {
    if (this.interval != null) this.clearIntervalFn?.(this.interval)
    this.interval = null
  }

  async stopAndWait() {
    this.blocked = true
    this.stopForeground()
    const active = this.active
    if (!active) return false
    try {
      await active
    } catch {}
    return true
  }

  onAppShow() {
    return this.syncNow('app-show')
  }

  onNetworkRestored() {
    return this.syncNow('network-restored')
  }

  manualSync() {
    this.blocked = false
    return this.syncNow('manual')
  }

  syncNow(reason = 'manual') {
    if (this.blocked) return Promise.resolve({ skipped: 'stopped' })
    if (this.active) return this.active
    this.active = (async () => {
      if (!await this.isOnline()) return { skipped: 'offline' }
      const syncPassword = await this.credentialStore.load()
      if (!syncPassword) return { skipped: 'missing_sync_password' }
      const accountId = await this.getAccountId()
      if (accountId === null || accountId === undefined || String(accountId).trim() === '') {
        return { skipped: 'missing_account' }
      }
      const deviceId = await this.getDeviceId()
      if (!String(deviceId ?? '').trim()) return { skipped: 'missing_device_id' }

      this.onStatus({ state: 'syncing', reason })
      try {
        const result = await this.syncEngine.sync({ accountId, deviceId, syncPassword })
        this.onStatus({ state: 'completed', reason, result, completedAt: new Date().toISOString() })
        return result
      } catch (error) {
        this.onStatus({ state: 'failed', reason, error })
        throw error
      }
    })().finally(() => {
      this.active = null
    })
    return this.active
  }
}
