export const NETWORK_PROXY_SETTING_KEY = 'networkProxy'
export const NETWORK_PROXY_MODE_MANUAL = 'manual'
export const NETWORK_PROXY_MODE_SMART = 'smart'

function invalidProxyUrl() {
  throw new Error('代理地址无效')
}

function validateProxyPort(value) {
  if (!/^\d+$/.test(value)) invalidProxyUrl()
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalidProxyUrl()
}

function validateProxyAuthority(authority) {
  if (!authority || /[\s\\/?#]/.test(authority)) invalidProxyUrl()
  if (authority.includes('@')) throw new Error('代理地址不能包含用户凭据')

  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']')
    if (closingBracket <= 1) invalidProxyUrl()
    const address = authority.slice(1, closingBracket)
    if (!/^[0-9a-z:.%-]+$/i.test(address)) invalidProxyUrl()
    const remainder = authority.slice(closingBracket + 1)
    if (remainder) {
      if (!remainder.startsWith(':')) invalidProxyUrl()
      validateProxyPort(remainder.slice(1))
    }
    return authority
  }

  if (authority.includes('[') || authority.includes(']')) invalidProxyUrl()
  const firstColon = authority.indexOf(':')
  const lastColon = authority.lastIndexOf(':')
  if (firstColon !== lastColon) invalidProxyUrl()
  const hostname = lastColon >= 0 ? authority.slice(0, lastColon) : authority
  if (!hostname) invalidProxyUrl()
  if (lastColon >= 0) validateProxyPort(authority.slice(lastColon + 1))
  return authority
}

function normalizeProxyUrlWithoutUrlConstructor(candidate) {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(candidate)
  if (!schemeMatch) invalidProxyUrl()
  const scheme = schemeMatch[1].toLowerCase()
  if (!['http', 'https'].includes(scheme)) {
    throw new Error('代理仅支持 HTTP 或 HTTPS 地址')
  }
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(candidate)
  if (!match) invalidProxyUrl()
  if (match[4] || match[5]) throw new Error('代理地址不能包含路径、查询参数或片段')
  if (match[3] && match[3] !== '/') throw new Error('代理地址不能包含路径、查询参数或片段')
  const authority = validateProxyAuthority(match[2])
  return `${scheme}://${authority}`
}

export function normalizeNetworkProxyUrl(input) {
  const value = String(input ?? '').trim()
  if (!value) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`

  if (typeof globalThis.URL !== 'function') return normalizeProxyUrlWithoutUrlConstructor(candidate)

  let url
  try {
    url = new globalThis.URL(candidate)
  } catch {
    invalidProxyUrl()
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('代理仅支持 HTTP 或 HTTPS 地址')
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error('代理地址不能包含用户凭据')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('代理地址不能包含路径、查询参数或片段')
  }
  return `${url.protocol}//${url.host}`
}

export function normalizeNetworkProxySetting(value) {
  const source = typeof value === 'string'
    ? { enabled: Boolean(value), url: value, mode: NETWORK_PROXY_MODE_MANUAL }
    : (value || {})
  const url = normalizeNetworkProxyUrl(source.url)
  const mode = source.mode === NETWORK_PROXY_MODE_SMART
    ? NETWORK_PROXY_MODE_SMART
    : NETWORK_PROXY_MODE_MANUAL
  return {
    enabled: Boolean(source.enabled) && (mode === NETWORK_PROXY_MODE_SMART || Boolean(url)),
    mode,
    url
  }
}

export async function readNetworkProxySetting(repository) {
  const stored = await repository?.getSetting?.(NETWORK_PROXY_SETTING_KEY, null)
  return normalizeNetworkProxySetting(stored)
}
