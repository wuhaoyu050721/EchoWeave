function invalidUrl() {
  throw new Error('基础地址不是有效 URL')
}

function validatePort(value) {
  if (!/^\d+$/.test(value)) invalidUrl()
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalidUrl()
}

function validateAuthority(authority) {
  if (!authority || /[\s\\/?#]/.test(authority)) invalidUrl()
  if (authority.includes('@')) throw new Error('基础地址不能包含用户凭据')

  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']')
    if (closingBracket <= 1) invalidUrl()
    const address = authority.slice(1, closingBracket)
    if (!/^[0-9a-z:.%-]+$/i.test(address)) invalidUrl()
    const remainder = authority.slice(closingBracket + 1)
    if (remainder) {
      if (!remainder.startsWith(':')) invalidUrl()
      validatePort(remainder.slice(1))
    }
    return authority
  }

  if (authority.includes('[') || authority.includes(']')) invalidUrl()
  const firstColon = authority.indexOf(':')
  const lastColon = authority.lastIndexOf(':')
  if (firstColon !== lastColon) invalidUrl()

  const hostname = lastColon >= 0 ? authority.slice(0, lastColon) : authority
  if (!hostname) invalidUrl()
  if (lastColon >= 0) validatePort(authority.slice(lastColon + 1))
  return authority
}

function parseBaseUrl(input) {
  const value = String(input ?? '').trim()
  if (!value) throw new Error('基础地址不能为空')

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)
  if (!schemeMatch) invalidUrl()
  const scheme = schemeMatch[1].toLowerCase()
  if (!['http', 'https'].includes(scheme)) {
    throw new Error('基础地址只支持 HTTP 或 HTTPS')
  }
  if (value.includes('?') || value.includes('#')) {
    throw new Error('基础地址不能包含查询参数或片段')
  }

  const remainder = value.slice(schemeMatch[0].length)
  const pathStart = remainder.indexOf('/')
  const authority = validateAuthority(pathStart >= 0 ? remainder.slice(0, pathStart) : remainder)
  const pathname = pathStart >= 0 ? remainder.slice(pathStart) : '/'
  if (/\s|\\/.test(pathname)) invalidUrl()

  const normalizedPath = pathname.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(normalizedPath)) {
    throw new Error('请填写服务基础地址，不要填写完整聊天地址')
  }

  return {
    origin: `${scheme}://${authority}`,
    pathname: normalizedPath || '/'
  }
}

export function normalizeOpenAIBaseUrl(input) {
  const url = parseBaseUrl(input)
  const pathname = url.pathname.replace(/\/+$/, '')
  const normalizedPath = /\/v1$/i.test(pathname) ? pathname : `${pathname || ''}/v1`
  return `${url.origin}${normalizedPath}`
}

export function buildOpenAIEndpoint(baseUrl, path) {
  const normalized = normalizeOpenAIBaseUrl(baseUrl)
  const suffix = String(path ?? '').replace(/^\/+/, '')
  return suffix ? `${normalized}/${suffix}` : normalized
}

export function normalizeGeminiBaseUrl(input) {
  const url = parseBaseUrl(input)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (/\/models(?:\/|$)/i.test(pathname) || /:(?:streamGenerateContent|generateContent)$/i.test(pathname)) {
    throw new Error('请填写 Gemini 服务基础地址，不要填写完整模型请求地址')
  }
  const normalizedPath = /\/v1(?:beta)?$/i.test(pathname) ? pathname : `${pathname || ''}/v1beta`
  return `${url.origin}${normalizedPath}`
}

export function buildGeminiEndpoint(baseUrl, path) {
  const normalized = normalizeGeminiBaseUrl(baseUrl)
  const suffix = String(path ?? '').replace(/^\/+/, '')
  return suffix ? `${normalized}/${suffix}` : normalized
}

export function buildGeminiModelEndpoint(baseUrl, model, action = 'streamGenerateContent', query = '') {
  const modelId = String(model ?? '').trim().replace(/^models\//i, '')
  if (!modelId) throw new Error('模型不能为空')
  if (!/^[a-z][a-zA-Z]+$/.test(String(action))) throw new Error('Gemini 请求动作无效')
  const endpoint = buildGeminiEndpoint(baseUrl, `models/${encodeURIComponent(modelId)}:${action}`)
  const normalizedQuery = String(query ?? '').replace(/^\?+/, '')
  return normalizedQuery ? `${endpoint}?${normalizedQuery}` : endpoint
}
