const FORWARDED_HEADERS = new Set([
  'accept',
  'authorization',
  'content-type',
  'openai-organization',
  'openai-project',
  'user-agent',
  'x-api-key',
  'x-goog-api-key'
])

export function validateProxyTarget(value) {
  let target
  try {
    target = new URL(String(value ?? ''))
  } catch {
    throw new Error('模型目标地址无效')
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('模型目标只支持 HTTP 或 HTTPS')
  }
  if (target.username || target.password) {
    throw new Error('模型目标不能包含用户凭据')
  }
  if (target.pathname.startsWith('/__ai_proxy')) {
    throw new Error('模型目标不能递归指向本地代理')
  }
  return target
}

export function filterProxyRequestHeaders(headers = {}) {
  const result = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase()
    if (!FORWARDED_HEADERS.has(normalized) || value == null) {
      continue
    }
    result[normalized] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return result
}
