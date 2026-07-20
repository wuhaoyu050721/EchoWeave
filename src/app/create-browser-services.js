import { BrowserFetchTransport } from '../platform/browser/browser-fetch-transport.js'
import { IndexedDbRepository } from '../platform/browser/indexeddb-repository.js'
import { WebCryptoVault } from '../platform/browser/web-crypto-vault.js'
import { WebAttachmentAdapter } from '../platform/browser/web-attachment-adapter.js'
import { GeminiProvider } from '../providers/gemini-provider.js'
import { OpenAIProvider } from '../providers/openai-provider.js'
import { ProviderRouter } from '../providers/provider-router.js'
import { BackupService } from '../services/backup-service.js'
import { AttachmentService } from '../services/attachment-service.js'
import { ChatService } from '../services/chat-service.js'
import { CloudTokenStore } from '../services/cloud-token-store.js'
import { ProviderService } from '../services/provider-service.js'
import { ReplyNotificationService } from '../services/reply-notification-service.js'
import { createWorkspaceDisposer } from '../workspace/create-workspace-disposer.js'
import { migrateLegacyCloudToken } from '../workspace/device-token-migration.js'
import {
  BROWSER_DEVICE_DATABASE_NAME,
  LOCAL_WORKSPACE_ID,
  assertWorkspaceId,
  describeWorkspace
} from '../workspace/workspace-id.js'
import { WorkspaceServiceManager } from '../workspace/workspace-service-manager.js'
import { createChatInstructionResolver, createUserNameResolver } from './create-character-instructions.js'
import { getRuntimeDiagnosticLogStore } from '../core/runtime-diagnostic-log.js'

export function browserProxyPath(pathname = globalThis.location?.pathname) {
  return String(pathname ?? '').startsWith('/preview/') ? '/__ai_proxy' : null
}

export async function createBrowserDeviceServices({
  indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto,
  deviceDatabaseName = BROWSER_DEVICE_DATABASE_NAME
} = {}) {
  const repository = new IndexedDbRepository({ indexedDB, databaseName: deviceDatabaseName })
  await repository.init()
  const vault = new WebCryptoVault({ repository, crypto })
  try {
    await vault.init()
  } catch (error) {
    await repository.close().catch(() => {})
    throw error
  }
  const tokenStore = new CloudTokenStore({ repository, vault })
  let closing = null
  return {
    repository,
    vault,
    tokenStore,
    close() {
      closing ||= repository.close()
      return closing
    }
  }
}

export async function createBrowserServices({
  workspaceId = LOCAL_WORKSPACE_ID,
  indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto,
  databaseName,
  deviceServices = null,
  deviceDatabaseName
} = {}) {
  const resolvedWorkspaceId = assertWorkspaceId(workspaceId)
  const repository = new IndexedDbRepository({ indexedDB, databaseName, workspaceId: resolvedWorkspaceId })
  let resolvedDeviceServices = deviceServices
  const ownsDeviceServices = !resolvedDeviceServices
  try {
    await repository.init()
    await repository.recoverGeneratingMessages()
    if (!resolvedDeviceServices) {
      resolvedDeviceServices = await createBrowserDeviceServices({ indexedDB, crypto, deviceDatabaseName })
    }
  } catch (error) {
    await repository.close().catch(() => {})
    if (ownsDeviceServices) await resolvedDeviceServices?.close?.().catch(() => {})
    throw error
  }

  const vault = new WebCryptoVault({ repository, crypto })
  try {
    await vault.init()
  } catch (error) {
    await repository.close().catch(() => {})
    if (ownsDeviceServices) await resolvedDeviceServices?.close?.().catch(() => {})
    throw error
  }
  const deviceTokenMigration = await migrateLegacyCloudToken({
    workspaceId: resolvedWorkspaceId,
    repository,
    vault,
    deviceTokenStore: resolvedDeviceServices.tokenStore
  })
  const transport = new BrowserFetchTransport({ proxyPath: browserProxyPath() })
  const openAIProvider = new OpenAIProvider({ transport })
  const geminiProvider = new GeminiProvider({ transport })
  const providerRouter = new ProviderRouter({ providers: [openAIProvider, geminiProvider] })
  const providerService = new ProviderService({ repository, vault, provider: providerRouter })
  const attachmentService = new AttachmentService({ adapter: new WebAttachmentAdapter() })

  const getUserName = createUserNameResolver(repository)
  const getSystemPrompt = createChatInstructionResolver({ repository, vault, getUserName })
  const replyNotificationService = new ReplyNotificationService()
  const diagnosticLogStore = getRuntimeDiagnosticLogStore()

  const chatService = new ChatService({
    repository,
    providerService,
    provider: providerRouter,
    getSystemPrompt,
    getUserName,
    replyNotificationService,
    diagnosticLogStore
  })
  const backupService = new BackupService({ repository })
  const dispose = createWorkspaceDisposer({
    chatService,
    replyNotificationService,
    repository,
    closeDeviceServices: ownsDeviceServices ? () => resolvedDeviceServices.close() : null
  })

  return {
    workspaceId: resolvedWorkspaceId,
    workspace: describeWorkspace(resolvedWorkspaceId),
    repository,
    vault,
    tokenStore: resolvedDeviceServices.tokenStore,
    deviceTokenStore: resolvedDeviceServices.tokenStore,
    deviceServices: resolvedDeviceServices,
    deviceTokenMigration,
    transport,
    openAIProvider,
    geminiProvider,
    providerRouter,
    providerService,
    chatService,
    backupService,
    attachmentService,
    replyNotificationService,
    diagnosticLogStore,
    dispose,
    close: dispose,
    platform: {
      runtime: 'browser',
      storage: 'IndexedDB',
      encryption: 'Web Crypto',
      about: '浏览器本地版'
    }
  }
}

export async function createBrowserWorkspaceManager(options = {}) {
  const deviceServices = options.deviceServices ?? await createBrowserDeviceServices(options)
  return new WorkspaceServiceManager({
    accountNamespace: options.accountNamespace,
    deviceServices,
    createServices: ({ workspaceId }) => createBrowserServices({
      indexedDB: options.indexedDB,
      crypto: options.crypto,
      workspaceId,
      deviceServices
    })
  })
}
