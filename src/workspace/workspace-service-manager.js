import {
  DEFAULT_ACCOUNT_NAMESPACE,
  LOCAL_WORKSPACE_ID,
  assertWorkspaceId,
  deriveAccountWorkspaceId,
  normalizeAccountNamespace,
  workspaceIdFromSession
} from './workspace-id.js'

function isScopedSession(session) {
  if (!String(session?.user?.id ?? '').trim() || !session?.cloud_base_url) return false
  try {
    normalizeAccountNamespace(session.cloud_base_url)
    return true
  } catch {
    return false
  }
}

async function defaultDisposeServices(services) {
  if (!services) return
  services.cloudServices?.scheduler?.stop?.()
  services.scheduler?.stop?.()
  if (typeof services.dispose === 'function') {
    await services.dispose()
    return
  }
  if (typeof services.chatService?.stopAndWait === 'function') {
    await services.chatService.stopAndWait()
  } else {
    services.chatService?.stop?.()
  }
  services.replyNotificationService?.dispose?.()
  await services.repository?.close?.()
}

export class WorkspaceServiceManager {
  constructor({
    createServices,
    disposeServices = defaultDisposeServices,
    deviceServices = null,
    accountNamespace = DEFAULT_ACCOUNT_NAMESPACE
  } = {}) {
    if (typeof createServices !== 'function') throw new Error('WorkspaceServiceManager 需要 createServices')
    this.createServices = createServices
    this.disposeServices = disposeServices
    this.deviceServices = deviceServices
    this.accountNamespace = accountNamespace
    this.current = null
    this.pending = Promise.resolve()
    this.closed = false
  }

  get workspaceId() {
    return this.current?.workspaceId ?? null
  }

  get services() {
    return this.current?.services ?? null
  }

  get tokenStore() {
    return this.deviceServices?.tokenStore ?? null
  }

  switchToLocal(options = {}) {
    return this.switchToWorkspace(LOCAL_WORKSPACE_ID, options)
  }

  switchToAccount(user, options = {}) {
    const { accountNamespace = this.accountNamespace, ...switchOptions } = options
    const workspaceId = deriveAccountWorkspaceId(user, { accountNamespace })
    return this.switchToWorkspace(workspaceId, {
      ...switchOptions,
      validateTarget: () => this.#assertStoredAccount(workspaceId)
    })
  }

  switchToSession(session, options = {}) {
    if (!session) return this.switchToLocal(options)
    const {
      accountNamespace = session.cloud_base_url || this.accountNamespace,
      ...switchOptions
    } = options
    const workspaceId = workspaceIdFromSession(session, { accountNamespace })
    return this.switchToWorkspace(workspaceId, {
      ...switchOptions,
      validateTarget: () => this.#assertStoredAccount(workspaceId)
    })
  }

  async openFromStoredSession(options = {}) {
    if (!this.tokenStore) throw new Error('工作区管理器没有设备级 token store')
    let session = await this.tokenStore.load()
    if (!isScopedSession(session)) {
      await this.switchToLocal(options)
      session = await this.tokenStore.load()
    }
    if (session && !isScopedSession(session)) {
      await this.tokenStore.clear()
      session = null
    }
    const services = await this.switchToSession(session, options)
    return { session, workspaceId: this.workspaceId, services }
  }

  switchToWorkspace(workspaceId, { beforeClose, force = false, validateTarget } = {}) {
    const targetWorkspaceId = assertWorkspaceId(workspaceId)
    return this.#enqueue(async () => {
      this.#assertOpen()
      await validateTarget?.()
      if (!force && this.current?.workspaceId === targetWorkspaceId) return this.current.services

      const previous = this.current
      const services = await this.createServices({
        workspaceId: targetWorkspaceId,
        deviceServices: this.deviceServices
      })
      if (services?.workspaceId && services.workspaceId !== targetWorkspaceId) {
        await this.disposeServices(services)
        throw new Error('服务工厂返回了错误的工作区')
      }

      if (previous) {
        try {
          await beforeClose?.({
            fromWorkspaceId: previous.workspaceId,
            toWorkspaceId: targetWorkspaceId,
            services: previous.services
          })
        } catch (error) {
          await this.disposeServices(services)
          throw error
        }
        await this.disposeServices(previous.services, {
          fromWorkspaceId: previous.workspaceId,
          toWorkspaceId: targetWorkspaceId
        })
      }
      this.current = { workspaceId: targetWorkspaceId, services }
      return services
    })
  }

  close() {
    return this.#enqueue(async () => {
      if (this.closed) return
      this.closed = true
      const previous = this.current
      this.current = null
      let failure = null
      try {
        await this.disposeServices(previous?.services)
      } catch (error) {
        failure = error
      }
      try {
        await this.deviceServices?.close?.()
      } catch (error) {
        failure ||= error
      }
      if (failure) throw failure
    })
  }

  #assertOpen() {
    if (this.closed) throw new Error('工作区管理器已关闭')
  }

  async #assertStoredAccount(targetWorkspaceId) {
    if (!this.tokenStore) return
    const storedSession = await this.tokenStore.load()
    if (!storedSession?.user) throw new Error('设备级登录会话不存在，不能打开账号工作区')
    const storedWorkspaceId = workspaceIdFromSession(storedSession, {
      accountNamespace: storedSession.cloud_base_url
    })
    if (storedWorkspaceId !== targetWorkspaceId) {
      throw new Error('设备级登录会话与目标账号工作区不一致')
    }
  }

  #enqueue(operation) {
    const result = this.pending.then(operation, operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
}
