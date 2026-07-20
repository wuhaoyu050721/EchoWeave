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

function invalidAccountNamespace() {
  throw new Error('云账号服务域无效')
}

function normalizeFallbackAuthority(value, protocol) {
  if (!value || /[\s\\/?#]/.test(value)) invalidAccountNamespace()
  if (value.includes('@')) throw new Error('云账号服务域不能包含凭据')

  let hostname = ''
  let port = ''
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')
    if (closingBracket <= 1) invalidAccountNamespace()
    const address = value.slice(1, closingBracket)
    if (!/^[0-9a-z:.%-]+$/i.test(address)) invalidAccountNamespace()
    hostname = `[${address.toLowerCase()}]`
    const remainder = value.slice(closingBracket + 1)
    if (remainder) {
      if (!remainder.startsWith(':')) invalidAccountNamespace()
      port = remainder.slice(1)
    }
  } else {
    if (value.includes('[') || value.includes(']')) invalidAccountNamespace()
    const firstColon = value.indexOf(':')
    const lastColon = value.lastIndexOf(':')
    if (firstColon !== lastColon) invalidAccountNamespace()
    hostname = lastColon >= 0 ? value.slice(0, lastColon) : value
    port = lastColon >= 0 ? value.slice(lastColon + 1) : ''
    if (!hostname || !/^[a-z0-9._-]+$/i.test(hostname)) invalidAccountNamespace()
    hostname = hostname.toLowerCase()
  }

  if (port) {
    if (!/^\d+$/.test(port)) invalidAccountNamespace()
    const number = Number(port)
    if (!Number.isSafeInteger(number) || number < 0 || number > 65535) invalidAccountNamespace()
    if ((protocol === 'http:' && number === 80) || (protocol === 'https:' && number === 443)) port = ''
    else port = String(number)
  }

  return `${hostname}${port ? `:${port}` : ''}`
}

function normalizeAccountHttpNamespaceWithoutUrl(value) {
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(?:#.*)?$/i.exec(value)
  if (!match || /[\s\\]/.test(match[3])) invalidAccountNamespace()
  const protocol = `${match[1].toLowerCase()}:`
  const host = normalizeFallbackAuthority(match[2], protocol)
  const pathname = match[3].replace(/\/+$/, '')
  return `${protocol}//${host}${pathname}`
}

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
    if (typeof globalThis.URL === 'function') {
      const url = new globalThis.URL(normalized)
      if (url.username || url.password) throw new Error('云账号服务域不能包含凭据')
      url.hash = ''
      url.search = ''
      const pathname = url.pathname.replace(/\/+$/, '')
      return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`
    }
    return normalizeAccountHttpNamespaceWithoutUrl(normalized)
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
