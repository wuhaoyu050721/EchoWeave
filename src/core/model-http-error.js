export class ModelHttpError extends Error {
  constructor(message, { status = 0, body = '', code = 'http_error' } = {}) {
    super(message)
    this.name = 'ModelHttpError'
    this.status = status
    this.body = body
    this.code = code
  }
}

function localizeModelError(message, status) {
  const text = String(message ?? '').trim()
  const normalized = text.toLowerCase()
  const explicitlyMentionsApiKey = /api[ -]?key.+required|authorization header|x-api-key|x-goog-api-key|invalid api[ -]?key|incorrect api[ -]?key/.test(normalized)
  if (
    Number(status) === 401 ||
    explicitlyMentionsApiKey
  ) {
    const guidance = 'API 密钥缺失或无效，请在接口页面填写并保存后重试'
    return text && !explicitlyMentionsApiKey ? `${guidance}（${text}）` : guidance
  }
  return text || `模型服务返回 HTTP ${status}`
}

export function extractModelErrorMessage(text, status) {
  try {
    const payload = JSON.parse(text)
    return localizeModelError(payload?.error?.message || payload?.message, status)
  } catch {
    return localizeModelError(text, status)
  }
}
