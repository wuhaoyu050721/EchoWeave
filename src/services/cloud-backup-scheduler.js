export class CloudBackupScheduler {
  constructor({
    cloudBackupService,
    credentialStore,
    getDeviceId,
    intervalMs = 180000,
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    onStatus = () => {}
  } = {}) {
    if (!cloudBackupService?.upload || !credentialStore?.load || !getDeviceId) {
      throw new Error('CloudBackupScheduler 依赖不完整')
    }
    this.cloudBackupService = cloudBackupService
    this.credentialStore = credentialStore
    this.getDeviceId = getDeviceId
    this.intervalMs = intervalMs
    this.setIntervalFn = setIntervalFn
    this.clearIntervalFn = clearIntervalFn
    this.onStatus = onStatus
    this.interval = null
    this.active = null
    this.blocked = false
  }

  start() {
    this.blocked = false
    if (this.interval == null && this.setIntervalFn) {
      this.interval = this.setIntervalFn(() => this.trigger('interval'), this.intervalMs)
      this.interval?.unref?.()
    }
    return this.trigger('start')
  }

  stop() {
    if (this.interval != null) this.clearIntervalFn?.(this.interval)
    this.interval = null
  }

  async stopAndWait() {
    this.blocked = true
    this.stop()
    const active = this.active
    if (!active) return false
    try {
      await active
    } catch {}
    return true
  }

  trigger(reason = 'manual') {
    if (this.blocked) return Promise.resolve({ skipped: 'stopped' })
    if (this.active) return this.active
    this.active = (async () => {
      const syncPassword = await this.credentialStore.load()
      if (!syncPassword) return { skipped: 'missing_sync_password' }
      this.onStatus({ state: 'uploading', reason })
      try {
        const result = await this.cloudBackupService.upload({
          deviceId: await this.getDeviceId(),
          syncPassword
        })
        this.onStatus({ state: 'completed', reason, result, completedAt: new Date().toISOString() })
        return result
      } catch (error) {
        this.onStatus({ state: 'failed', reason, error })
        throw error
      } finally {
        this.active = null
      }
    })()
    return this.active
  }
}
