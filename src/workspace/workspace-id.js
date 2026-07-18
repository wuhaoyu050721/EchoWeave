import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const LOCAL_WORKSPACE_ID = 'local'
export const DEFAULT_ACCOUNT_NAMESPACE = 'primary-cloud'

export const LEGACY_BROWSER_DATABASE_NAME = 'ai-chat-custom'
export const LEGACY_ANDROID_DATABASE = Object.freeze({
  name: 'ai-chat-custom',
  path: '_doc/ai-chat-custom.db'
})
export const LEGACY_ANDROID_DATABASE_ALIASES = Object.freeze([
  LEGACY_ANDROID_DATABASE,
  Object.freeze({ name: 'ai_chat_local', path: '_doc/ai_chat_local.db' })
])

export const BROWSER_DEVICE_DATABASE_NAME = 'ai-chat-custom-device'
export const ANDROID_DEVICE_DATABASE = Object.freeze({
  name: 'ai_chat_device',
  path: '_doc/ai_chat_device.db'
})

const ACCOUNT_WORKSPACE_PATTERN = /^account-[a-f0-9]{64}$/

function normalizedBoundedString(value, label, maximumLength) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  if (normalized.length > maximumLength) throw new Error(`${label}过长`)
  return normalized
}

export function normalizeAccountNamespace(value = DEFAULT_ACCOUNT_NAMESPACE) {
  const normalized = normalizedBoundedString(value, '云账号服务域', 2048)
  if (!/^https?:\/\//i.test(normalized)) return normalized
  try {
    const url = new URL(normalized)
    if (url.username || url.password) throw new Error('云账号服务域不能包含凭据')
    url.hash = ''
    url.search = ''
    const pathname = url.pathname.replace(/\/+$/, '')
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`
  } catch (error) {
    if (/凭据/.test(error?.message || '')) throw error
    throw new Error('云账号服务域无效')
  }
}

function normalizeServerUserId(user) {
  if (!user || typeof user !== 'object' || !Object.prototype.hasOwnProperty.call(user, 'id')) {
    throw new Error('云账号缺少不可变的 user.id')
  }
  const value = user.id
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('云账号 user.id 必须是安全整数或字符串')
  } else if (typeof value !== 'string' && typeof value !== 'bigint') {
    throw new Error('云账号 user.id 类型无效')
  }
  return normalizedBoundedString(value, '云账号 user.id', 1024)
}

export function deriveAccountWorkspaceId(user, {
  accountNamespace = DEFAULT_ACCOUNT_NAMESPACE
} = {}) {
  const namespace = normalizeAccountNamespace(accountNamespace)
  const userId = normalizeServerUserId(user)
  // This domain string is persisted indirectly in every account database name.
  const source = [
    'ai-chat-workspace:v1',
    `namespace:${namespace.length}:${namespace}`,
    `user-id:${userId.length}:${userId}`
  ].join('\n')
  return `account-${bytesToHex(sha256(utf8ToBytes(source)))}`
}

export function workspaceIdFromSession(session, options) {
  if (!session?.user) throw new Error('云会话缺少 user.id，无法选择账号工作区')
  return deriveAccountWorkspaceId(session.user, options)
}

export function assertWorkspaceId(workspaceId) {
  const value = String(workspaceId ?? '')
  if (value === LOCAL_WORKSPACE_ID || ACCOUNT_WORKSPACE_PATTERN.test(value)) return value
  throw new Error('workspaceId 无效')
}

export function isAccountWorkspaceId(workspaceId) {
  return ACCOUNT_WORKSPACE_PATTERN.test(String(workspaceId ?? ''))
}

export function browserDatabaseNameForWorkspace(workspaceId = LOCAL_WORKSPACE_ID) {
  const value = assertWorkspaceId(workspaceId)
  if (value === LOCAL_WORKSPACE_ID) return LEGACY_BROWSER_DATABASE_NAME
  return `ai-chat-custom-${value}`
}

export function androidDatabaseForWorkspace(workspaceId = LOCAL_WORKSPACE_ID) {
  const value = assertWorkspaceId(workspaceId)
  if (value === LOCAL_WORKSPACE_ID) return { ...LEGACY_ANDROID_DATABASE }
  const digest = value.slice('account-'.length)
  const name = `ai_chat_account_${digest}`
  return { name, path: `_doc/${name}.db` }
}

export function describeWorkspace(workspaceId = LOCAL_WORKSPACE_ID) {
  const id = assertWorkspaceId(workspaceId)
  return Object.freeze({
    id,
    kind: id === LOCAL_WORKSPACE_ID ? 'local' : 'account',
    isLocal: id === LOCAL_WORKSPACE_ID
  })
}
