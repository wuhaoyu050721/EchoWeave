import { PlusSqliteRepository } from '../platform/app/plus-sqlite-repository.js'
import { AndroidKeystoreVault } from '../platform/app/android-keystore-vault.js'
import { NativeAttachmentAdapter } from '../platform/app/native-attachment-adapter.js'
import { NativeAttachmentPicker } from '../platform/app/native-attachment-picker.js'
import { NativeBackupPicker } from '../platform/app/native-backup-picker.js'
import { NativeCharacterCardPicker } from '../platform/app/native-character-card-picker.js'
import { NativeWorldBookPicker } from '../platform/app/native-world-book-picker.js'
import { NativeStreamingTransport } from '../platform/app/native-streaming-transport.js'
import { UniPushNotificationAdapter } from '../platform/app/uni-push-notification-adapter.js'
import { UniRequestTransport } from '../platform/app/uni-request-transport.js'
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
  ANDROID_DEVICE_DATABASE,
  LEGACY_ANDROID_DATABASE,
  LEGACY_ANDROID_DATABASE_ALIASES,
  LOCAL_WORKSPACE_ID,
  assertWorkspaceId,
  describeWorkspace
} from '../workspace/workspace-id.js'
import { WorkspaceServiceManager } from '../workspace/workspace-service-manager.js'
import { createChatInstructionResolver, createUserNameResolver } from './create-character-instructions.js'
import { getRuntimeDiagnosticLogStore } from '../core/runtime-diagnostic-log.js'

function registeredNativeApis() {
  return globalThis.__aiChatNativeApis || null
}

function resolveNativeKeystoreApi(fallback) {
  const registered = registeredNativeApis()
  if (
    typeof registered?.aiChatKeystoreReady === 'function' &&
    typeof registered?.aiChatKeystoreEncrypt === 'function' &&
    typeof registered?.aiChatKeystoreDecrypt === 'function'
  ) {
    return registered
  }
  if (
    typeof uni !== 'undefined' &&
    typeof uni.aiChatKeystoreReady === 'function' &&
    typeof uni.aiChatKeystoreEncrypt === 'function' &&
    typeof uni.aiChatKeystoreDecrypt === 'function'
  ) {
    return {
      aiChatKeystoreReady: () => uni.aiChatKeystoreReady(),
      aiChatKeystoreEncrypt: value => uni.aiChatKeystoreEncrypt(value),
      aiChatKeystoreDecrypt: recordJson => uni.aiChatKeystoreDecrypt(recordJson)
    }
  }
  return fallback
}

function resolveNativeAttachmentApi(fallback) {
  const registered = registeredNativeApis()
  if (typeof registered?.aiChatPickAttachments === 'function') return registered
  if (typeof uni !== 'undefined' && typeof uni.aiChatPickAttachments === 'function') return uni
  return fallback
}

function resolveNativeStreamingApi(fallback) {
  const registered = registeredNativeApis()
  if (
    typeof registered?.onAiChatStreamEvent === 'function' &&
    typeof registered?.aiChatStreamRequest === 'function' &&
    typeof registered?.aiChatStreamCancel === 'function'
  ) return registered
  if (
    typeof uni !== 'undefined' &&
    typeof uni.onAiChatStreamEvent === 'function' &&
    typeof uni.aiChatStreamRequest === 'function' &&
    typeof uni.aiChatStreamCancel === 'function'
  ) return uni
  if (
    typeof fallback?.onAiChatStreamEvent === 'function' &&
    typeof fallback?.aiChatStreamRequest === 'function' &&
    typeof fallback?.aiChatStreamCancel === 'function'
  ) return fallback
  return null
}

function localFileExists(plusApi, path) {
  if (typeof plusApi?.io?.resolveLocalFileSystemURL !== 'function') return Promise.resolve(false)
  return new Promise(resolve => {
    try {
      plusApi.io.resolveLocalFileSystemURL(path, () => resolve(true), () => resolve(false))
    } catch (_) {
      resolve(false)
    }
  })
}

export async function resolveAndroidLocalDatabase(plusApi) {
  const existing = []
  for (const candidate of LEGACY_ANDROID_DATABASE_ALIASES) {
    if (await localFileExists(plusApi, candidate.path)) existing.push(candidate)
  }
  if (existing.length > 1) throw new Error('检测到多个历史本地数据库，拒绝自动选择以避免数据丢失')
  if (existing.length === 1) return { ...existing[0] }
  return { ...LEGACY_ANDROID_DATABASE }
}

export async function createAppDeviceServices({
  plusApi,
  uniApi,
  deviceDatabaseName = ANDROID_DEVICE_DATABASE.name,
  deviceDatabasePath = ANDROID_DEVICE_DATABASE.path
} = {}) {
  const repository = new PlusSqliteRepository({
    sqlite: plusApi?.sqlite,
    databaseName: deviceDatabaseName,
    databasePath: deviceDatabasePath
  })
  await repository.init()
  const vault = new AndroidKeystoreVault({ nativeApi: resolveNativeKeystoreApi(uniApi) })
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

export async function createAppServices({
  plusApi,
  uniApi,
  workspaceId = LOCAL_WORKSPACE_ID,
  databaseName,
  databasePath,
  deviceServices = null,
  deviceDatabaseName,
  deviceDatabasePath
} = {}) {
  const resolvedWorkspaceId = assertWorkspaceId(workspaceId)
  const localDatabase = resolvedWorkspaceId === LOCAL_WORKSPACE_ID && databaseName == null && databasePath == null
    ? await resolveAndroidLocalDatabase(plusApi)
    : null
  const repository = new PlusSqliteRepository({
    sqlite: plusApi?.sqlite,
    workspaceId: resolvedWorkspaceId,
    databaseName: databaseName ?? localDatabase?.name,
    databasePath: databasePath ?? localDatabase?.path
  })
  let resolvedDeviceServices = deviceServices
  const ownsDeviceServices = !resolvedDeviceServices
  try {
    await repository.init()
    await repository.recoverGeneratingMessages()
    if (!resolvedDeviceServices) {
      resolvedDeviceServices = await createAppDeviceServices({
        plusApi,
        uniApi,
        deviceDatabaseName,
        deviceDatabasePath
      })
    }
  } catch (error) {
    await repository.close().catch(() => {})
    if (ownsDeviceServices) await resolvedDeviceServices?.close?.().catch(() => {})
    throw error
  }

  const vault = new AndroidKeystoreVault({ nativeApi: resolveNativeKeystoreApi(uniApi) })
  try {
    await vault.init()
  } catch (error) {
    await repository.close().catch(() => {})
    if (ownsDeviceServices) await resolvedDeviceServices?.close?.().catch(() => {})
    throw error
  }
  const deviceTokenMigration = await migrateLegacyCloudToken({
    workspaceId: repository.workspaceId,
    repository,
    vault,
    deviceTokenStore: resolvedDeviceServices.tokenStore
  })
  const nativeStreamingApi = resolveNativeStreamingApi(uniApi)
  const streamingTransport = nativeStreamingApi
    ? new NativeStreamingTransport({ nativeApi: nativeStreamingApi })
    : null
  const transport = new UniRequestTransport({ uniApi, streamingTransport })
  const openAIProvider = new OpenAIProvider({ transport })
  const geminiProvider = new GeminiProvider({ transport })
  const providerRouter = new ProviderRouter({ providers: [openAIProvider, geminiProvider] })
  const providerService = new ProviderService({ repository, vault, provider: providerRouter })
  const attachmentService = new AttachmentService({ adapter: new NativeAttachmentAdapter() })
  const nativeAttachmentPicker = new NativeAttachmentPicker({
    uniApi: resolveNativeAttachmentApi(uniApi),
    attachmentService
  })
  const nativeBackupPicker = new NativeBackupPicker({ uniApi: resolveNativeAttachmentApi(uniApi) })
  const nativeCharacterCardPicker = new NativeCharacterCardPicker({ uniApi: resolveNativeAttachmentApi(uniApi) })
  const nativeWorldBookPicker = new NativeWorldBookPicker({ uniApi: resolveNativeAttachmentApi(uniApi) })
  const replyNotificationService = new ReplyNotificationService({
    adapter: new UniPushNotificationAdapter({ uniApi, plusApi }),
    isAppVisible: () => globalThis.__aiChatAppVisible !== false
  })

  const getUserName = createUserNameResolver(repository)
  const getSystemPrompt = createChatInstructionResolver({ repository, vault, getUserName })
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
    workspaceId: repository.workspaceId,
    workspace: describeWorkspace(repository.workspaceId),
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
    nativeAttachmentPicker,
    nativeBackupPicker,
    nativeCharacterCardPicker,
    nativeWorldBookPicker,
    replyNotificationService,
    diagnosticLogStore,
    dispose,
    close: dispose,
    platform: {
      runtime: 'app-android',
      storage: 'SQLite',
      encryption: 'Android Keystore',
      about: 'Android 本地版'
    }
  }
}

export async function createAppWorkspaceManager(options = {}) {
  const deviceServices = options.deviceServices ?? await createAppDeviceServices(options)
  return new WorkspaceServiceManager({
    accountNamespace: options.accountNamespace,
    deviceServices,
    createServices: ({ workspaceId }) => createAppServices({
      plusApi: options.plusApi,
      uniApi: options.uniApi,
      workspaceId,
      deviceServices
    })
  })
}
