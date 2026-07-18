import { normalizeGeminiBaseUrl, normalizeOpenAIBaseUrl } from './provider-url.js'

export const OPENAI_COMPATIBLE_PROTOCOL = 'openai-compatible'
export const GEMINI_PROTOCOL = 'gemini'

export const PROVIDER_PROTOCOLS = Object.freeze([
  Object.freeze({
    id: OPENAI_COMPATIBLE_PROTOCOL,
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: '例如 gpt-4o-mini'
  }),
  Object.freeze({
    id: GEMINI_PROTOCOL,
    label: 'Gemini 原生',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelPlaceholder: '例如 gemini-2.5-flash'
  })
])

const PROTOCOL_BY_ID = new Map(PROVIDER_PROTOCOLS.map(protocol => [protocol.id, protocol]))

export function normalizeProviderProtocol(value) {
  const protocolType = String(value ?? '').trim().toLowerCase()
  if (!protocolType) return OPENAI_COMPATIBLE_PROTOCOL
  if (!PROTOCOL_BY_ID.has(protocolType)) throw new Error(`不支持的接口格式：${protocolType}`)
  return protocolType
}

export function getProviderProtocol(value) {
  return PROTOCOL_BY_ID.get(normalizeProviderProtocol(value))
}

export function normalizeProviderBaseUrl(input, protocolType) {
  return normalizeProviderProtocol(protocolType) === GEMINI_PROTOCOL
    ? normalizeGeminiBaseUrl(input)
    : normalizeOpenAIBaseUrl(input)
}

export function defaultProviderBaseUrl(protocolType) {
  return getProviderProtocol(protocolType).defaultBaseUrl
}

export function switchProviderProtocol(form, protocolType) {
  if (!form) return null
  const previousProtocol = normalizeProviderProtocol(form?.protocolType)
  const nextProtocol = normalizeProviderProtocol(protocolType)
  const currentBaseUrl = String(form?.baseUrl ?? '').trim()
  if (previousProtocol === nextProtocol) return form

  form.protocolType = nextProtocol
  form.modelsCache = []
  form.defaultModel = ''
  if (
    !currentBaseUrl ||
    currentBaseUrl === defaultProviderBaseUrl(previousProtocol) ||
    currentBaseUrl === 'https://example.com/v1'
  ) {
    form.baseUrl = defaultProviderBaseUrl(nextProtocol)
  }
  return form
}
