function retryable(error) {
  return error?.code === 'network_error' ||
    error?.code === 'request_timeout' ||
    error?.status === 408 ||
    error?.status === 429 ||
    Number(error?.status) >= 500
}

export class AndroidWorkManagerSyncAdapter {
  constructor({ coordinator } = {}) {
    if (!coordinator?.syncNow) throw new Error('AndroidWorkManagerSyncAdapter requires a coordinator')
    this.coordinator = coordinator
  }

  get capabilities() {
    return {
      schedulesNativeWork: false,
      survivesProcessTerminationWithoutNativeBridge: false,
      headlessEntryPoint: 'run'
    }
  }

  async run() {
    try {
      const result = await this.coordinator.syncNow('android-work-manager')
      if (result?.skipped === 'offline') return { outcome: 'retry', result }
      return { outcome: 'success', result }
    } catch (error) {
      if (retryable(error)) return { outcome: 'retry', error }
      return { outcome: 'failure', error }
    }
  }
}
