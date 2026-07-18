import { normalizeProfileAvatar } from './profile-avatar.js'

export const PROVIDER_AVATAR_VERSION = 1

export const PROVIDER_AVATAR_PRESETS = Object.freeze([
  { id: 'openai', label: 'GPT', source: '/static/providers/openai.png' },
  { id: 'grok', label: 'Grok', source: '/static/providers/grok.png' },
  { id: 'claude', label: 'Claude', source: '/static/providers/anthropic.png' },
  { id: 'kimi', label: 'Kimi', source: '/static/providers/kimi.png' },
  { id: 'deepseek', label: 'DeepSeek', source: '/static/providers/deepseek.png' },
  { id: 'gemini', label: 'Gemini', source: '/static/providers/gemini.png' },
  { id: 'qwen', label: 'Qwen', source: '/static/providers/qwen.png' },
  { id: 'doubao', label: '豆包', source: '/static/providers/doubao.png' },
  { id: 'ollama', label: 'Ollama', source: '/static/providers/ollama.png' }
].map(preset => Object.freeze(preset)))

const PRESET_BY_ID = new Map(PROVIDER_AVATAR_PRESETS.map(preset => [preset.id, preset]))
const LEGACY_PRESET_IDS = Object.freeze({ anthropic: 'claude', gpt: 'openai', chatgpt: 'openai' })
const AUTO_MATCHERS = Object.freeze([
  ['deepseek', ['deepseek']],
  ['grok', ['grok', 'api.x.ai', 'x.ai', 'xai']],
  ['claude', ['claude', 'anthropic']],
  ['kimi', ['kimi', 'moonshot']],
  ['gemini', ['gemini', 'generativelanguage', 'google ai studio']],
  ['qwen', ['qwen', 'dashscope', 'aliyuncs', 'bailian', 'tongyi', '通义', '百炼']],
  ['doubao', ['doubao', 'volcengine', 'ark.cn-', '豆包', '火山方舟']],
  ['ollama', ['ollama']],
  ['openai', ['openai', 'chatgpt', 'gpt-']]
])

function blankAvatar(mode = 'auto', presetId = '') {
  return {
    version: PROVIDER_AVATAR_VERSION,
    mode,
    presetId,
    dataUrl: '',
    mimeType: '',
    byteSize: 0
  }
}

function normalizedPresetId(value) {
  const candidate = String(value ?? '').trim().toLowerCase()
  return LEGACY_PRESET_IDS[candidate] || candidate
}

function providerSignature(provider = {}) {
  const cachedModels = Array.isArray(provider.modelsCache) ? provider.modelsCache.slice(0, 50) : []
  return [
    provider.name,
    provider.baseUrl,
    provider.defaultModel,
    provider.model,
    ...cachedModels
  ].map(value => String(value ?? '').trim()).filter(Boolean).join(' ').toLowerCase()
}

export function getProviderAvatarPreset(id) {
  return PRESET_BY_ID.get(normalizedPresetId(id)) || null
}

export function detectProviderAvatarPreset(provider = {}) {
  const signature = providerSignature(provider)
  for (const [presetId, keywords] of AUTO_MATCHERS) {
    if (keywords.some(keyword => signature.includes(keyword))) return PRESET_BY_ID.get(presetId)
  }
  return PRESET_BY_ID.get('openai')
}

export function normalizeProviderAvatar(value, { strict = false } = {}) {
  if (!value || typeof value !== 'object') return blankAvatar()
  const inferredMode = value.mode || (value.dataUrl ? 'custom' : value.presetId ? 'preset' : 'auto')
  const mode = String(inferredMode).trim().toLowerCase()

  if (mode === 'auto') return blankAvatar()

  if (mode === 'preset') {
    const preset = getProviderAvatarPreset(value.presetId)
    if (preset) return blankAvatar('preset', preset.id)
    if (strict) throw new Error('所选接口头像不存在')
    return blankAvatar()
  }

  if (mode === 'custom') {
    const image = normalizeProfileAvatar(value)
    if (!image) {
      if (strict) throw new Error('接口头像图片无效或超过 2 MB')
      return blankAvatar()
    }
    return {
      version: PROVIDER_AVATAR_VERSION,
      mode: 'custom',
      presetId: '',
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null
    }
  }

  if (strict) throw new Error('接口头像模式无效')
  return blankAvatar()
}

export function createProviderCustomAvatar(attachment, now = () => new Date().toISOString()) {
  const avatar = normalizeProviderAvatar({ ...attachment, mode: 'custom' }, { strict: true })
  return { ...avatar, updatedAt: now() }
}

export function createProviderPresetAvatar(presetId) {
  return normalizeProviderAvatar({ mode: 'preset', presetId }, { strict: true })
}

export function createAutomaticProviderAvatar() {
  return blankAvatar()
}

export function resolveProviderAvatarSource(provider = {}) {
  const avatar = normalizeProviderAvatar(provider.avatar)
  if (avatar.mode === 'custom') return avatar.dataUrl
  if (avatar.mode === 'preset') return getProviderAvatarPreset(avatar.presetId)?.source || PRESET_BY_ID.get('openai').source
  return detectProviderAvatarPreset(provider).source
}

export function describeProviderAvatar(provider = {}) {
  const avatar = normalizeProviderAvatar(provider.avatar)
  if (avatar.mode === 'custom') return '自定义头像'
  if (avatar.mode === 'preset') return `${getProviderAvatarPreset(avatar.presetId)?.label || '默认'}头像`
  return `自动识别为 ${detectProviderAvatarPreset(provider).label}`
}
