import { normalizeProviderAvatar } from './core/provider-avatar.js'
import { extractAssistantStatus } from './core/assistant-status.js'
import {
  defaultProviderBaseUrl,
  normalizeProviderProtocol,
  switchProviderProtocol
} from './core/provider-protocol.js'

const tabScreens = {
  conversations: 'conversations',
  contacts: 'contacts',
  providers: 'providers',
  settings: 'settings'
}

export const navigationItems = [
  { id: 'conversations', label: '会话', icon: 'MessageCircle' },
  { id: 'contacts', label: '联系人', icon: 'Contact' },
  { id: 'providers', label: '接口', icon: 'Server' },
  { id: 'settings', label: '设置', icon: 'Settings' }
]

export const attachmentActions = [
  { id: 'image', label: '图片', icon: 'Image', inputRef: 'imageAttachmentInput' },
  { id: 'camera', label: '拍照', icon: 'Camera', inputRef: 'cameraAttachmentInput' },
  { id: 'file', label: '文件', icon: 'FileText', inputRef: 'fileAttachmentInput' }
]

export const conversations = [
  {
    id: 'product-review',
    title: '产品需求评审助手',
    preview: '好的，以下是针对您需求的评审要点和建议...',
    time: '09:28',
    icon: 'FileText'
  },
  {
    id: 'travel-japan',
    title: '旅行计划 - 日本关西',
    preview: '为你规划 5 天 4 夜的关西旅行程，包括大阪...',
    time: '昨天',
    icon: 'Plane'
  },
  {
    id: 'code-review',
    title: '代码优化建议',
    preview: '这段代码可以从以下几个方面优化：...',
    time: '昨天',
    icon: 'Code2'
  },
  {
    id: 'market-report',
    title: '市场调研分析',
    preview: '根据最新的数据，2024 年 Q1 市场趋势表现...',
    time: '05/18',
    icon: 'ChartNoAxesColumnIncreasing'
  },
  {
    id: 'reading-notes',
    title: '读书笔记：人类简史',
    preview: '《人类简史》主要讲述了人类从认知革命...',
    time: '05/17',
    icon: 'BookOpen'
  },
  {
    id: 'fitness-plan',
    title: '健身计划制定',
    preview: '根据你的目标和时间安排，建议如下训练计划...',
    time: '05/16',
    icon: 'Dumbbell'
  },
  {
    id: 'startup-ideas',
    title: '创业项目头脑风暴',
    preview: '以下是一些可行的方向和创新点：...',
    time: '05/15',
    icon: 'Lightbulb'
  }
]

export const providers = [
  {
    id: 'openai',
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    model: 'GPT-4o',
    logo: '/static/providers/openai.png'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'Claude 3.5 Sonnet',
    logo: '/static/providers/anthropic.png'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    logo: '/static/providers/deepseek.png'
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3:8b',
    logo: '/static/providers/ollama.png'
  }
]

export function createInitialUiState() {
  return {
    activeTab: 'conversations',
    screen: 'conversations',
    settingsView: 'overview',
    activeConversationId: null,
    groupEditorConversationId: null,
    activeCharacterId: null,
    activeProviderId: 'openai',
    appLockEnabled: false,
    generationMode: 'chat',
    generating: false
  }
}

export function setGenerationMode(state, mode) {
  state.generationMode = mode === 'image' ? 'image' : 'chat'
  return state.generationMode
}

export function openConversation(state, conversationId) {
  state.activeTab = 'conversations'
  state.screen = 'chat'
  state.activeConversationId = conversationId
  state.groupEditorConversationId = null
  state.activeCharacterId = null
}

export function openGroupEditor(state, conversationId = null) {
  state.activeTab = 'conversations'
  state.screen = 'group-editor'
  state.groupEditorConversationId = conversationId || null
  state.activeCharacterId = null
}

export function closeGroupEditor(state) {
  state.activeTab = 'conversations'
  state.screen = 'conversations'
  state.groupEditorConversationId = null
}

export function openCharacterDetails(state, characterId) {
  state.activeTab = 'contacts'
  state.screen = 'character-detail'
  state.activeCharacterId = characterId
}

export function closeCharacterDetails(state) {
  state.activeTab = 'contacts'
  state.screen = 'contacts'
  state.activeCharacterId = null
}

export function selectTab(state, tab) {
  if (!tabScreens[tab]) {
    return
  }

  state.activeTab = tab
  state.screen = tabScreens[tab]
  state.groupEditorConversationId = null
  state.activeCharacterId = null
  if (tab === 'settings') state.settingsView = 'overview'
}

export function openSettingsDetails(state) {
  state.activeTab = 'settings'
  state.screen = 'settings'
  state.settingsView = 'details'
}

export function openConversationSettings(state) {
  state.activeTab = 'settings'
  state.screen = 'settings'
  state.settingsView = 'conversation'
}

export function openNsfwSettings(state) {
  state.activeTab = 'settings'
  state.screen = 'settings'
  state.settingsView = 'nsfw'
}

export function closeSettingsDetails(state) {
  state.settingsView = 'overview'
}

export function resolveAppBackAction(state) {
  if (state?.screen === 'settings' && state?.settingsView !== 'overview') {
    return 'settings-overview'
  }

  if (state?.screen === 'character-detail') {
    return 'contacts'
  }

  if (state?.screen === 'group-editor') {
    return 'conversations'
  }

  if (state?.screen && state.screen !== 'conversations') {
    return 'conversations'
  }

  return 'system'
}

export function toggleAppLock(state) {
  state.appLockEnabled = !state.appLockEnabled
}

export function setGenerating(state, generating) {
  state.generating = Boolean(generating)
}

export function canSendMessage(state, draft, hasProvider, attachmentCount = 0, attachmentProcessing = false) {
  return !state.generating && !attachmentProcessing && Boolean(hasProvider) && (
    Boolean(String(draft ?? '').trim()) || Number(attachmentCount) > 0
  )
}

export function createProviderForm(provider = {}) {
  const protocolType = normalizeProviderProtocol(provider.protocolType)
  return {
    id: provider.id ?? null,
    name: provider.name ?? '',
    protocolType,
    baseUrl: provider.baseUrl ?? defaultProviderBaseUrl(protocolType),
    apiKey: '',
    defaultModel: provider.defaultModel ?? provider.model ?? '',
    modelsCache: Array.isArray(provider.modelsCache) ? [...provider.modelsCache] : [],
    hasApiKey: Boolean(provider.hasApiKey),
    avatar: normalizeProviderAvatar(provider.avatar)
  }
}

export function applyProviderProtocolSelection(form, protocolType) {
  return switchProviderProtocol(form, protocolType)
}

export function applyFetchedModels(form, models) {
  const nextModels = Array.isArray(models) ? [...models] : []
  form.modelsCache = nextModels
  if (!String(form.defaultModel ?? '').trim() && nextModels.length) {
    form.defaultModel = nextModels[0]
  }
  return form
}

export function applyProviderModelSelection(form, models, selectedIndex) {
  const index = Number(selectedIndex)
  const model = Array.isArray(models) && Number.isInteger(index) ? String(models[index] ?? '').trim() : ''
  if (model) form.defaultModel = model
  return form
}

export function isUserMessageRead(message) {
  return message?.role === 'user' && message?.status === 'completed'
}

function formatConversationTime(value, now) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

export function summarizeConversation(conversation, latestMessage, now = new Date()) {
  const timestamp = latestMessage?.updatedAt || conversation.lastMessageAt || conversation.updatedAt
  const rawContent = String(latestMessage?.content ?? '')
  const presentation = latestMessage?.role === 'assistant'
    ? extractAssistantStatus(rawContent)
    : { content: rawContent, status: null }
  return {
    ...conversation,
    preview: presentation.content.trim() || (
      presentation.status
        ? '[角色状态已更新]'
        : (latestMessage?.attachmentIds?.length ? '[附件]' : '开始一段新的 AI 对话')
    ),
    time: formatConversationTime(timestamp, now),
    icon: 'MessageCircle'
  }
}
