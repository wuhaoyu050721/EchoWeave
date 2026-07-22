import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFetchedModels,
  applyProviderModelSelection,
  applyProviderProtocolSelection,
  attachmentActions,
  canSendMessage,
  createProviderForm,
  createInitialUiState,
  navigationItems,
  closeSettingsDetails,
  closeCharacterDetails,
  openCharacterDetails,
  openConversationSettings,
  openNsfwSettings,
  openSettingsDetails,
  openConversation,
  resolveAppBackAction,
  selectTab,
  setGenerationMode,
  setGenerating,
  summarizeConversation,
  isUserMessageRead,
  toggleAppLock
} from '../src/ui-state.js'

test('opens chat from a conversation without changing the selected bottom tab', () => {
  const state = createInitialUiState()

  openConversation(state, 'product-review')

  assert.equal(state.screen, 'chat')
  assert.equal(state.activeTab, 'conversations')
  assert.equal(state.activeConversationId, 'product-review')
})

test('selecting provider screen leaves chat and activates provider tab', () => {
  const state = createInitialUiState()
  openConversation(state, 'product-review')

  selectTab(state, 'providers')

  assert.equal(state.screen, 'providers')
  assert.equal(state.activeTab, 'providers')
})

test('app lock toggle changes the visible setting state', () => {
  const state = createInitialUiState()

  toggleAppLock(state)

  assert.equal(state.appLockEnabled, true)
})

test('navigation exposes conversations contacts providers and settings', () => {
  assert.deepEqual(
    navigationItems.map((item) => item.id),
    ['conversations', 'contacts', 'providers', 'settings']
  )
})

test('selecting contacts opens the character contact screen', () => {
  const state = createInitialUiState()
  selectTab(state, 'contacts')
  assert.equal(state.screen, 'contacts')
  assert.equal(state.activeTab, 'contacts')
})

test('character details keep the contacts tab active and return to contacts', () => {
  const state = createInitialUiState()

  openCharacterDetails(state, 'character-1')
  assert.equal(state.screen, 'character-detail')
  assert.equal(state.activeTab, 'contacts')
  assert.equal(state.activeCharacterId, 'character-1')
  assert.equal(resolveAppBackAction(state), 'contacts')

  closeCharacterDetails(state)
  assert.equal(state.screen, 'contacts')
  assert.equal(state.activeTab, 'contacts')
  assert.equal(state.activeCharacterId, null)
})

test('settings opens details and returns to overview', () => {
  const state = createInitialUiState()

  selectTab(state, 'settings')
  assert.equal(state.settingsView, 'overview')

  openSettingsDetails(state)
  assert.equal(state.screen, 'settings')
  assert.equal(state.activeTab, 'settings')
  assert.equal(state.settingsView, 'details')

  closeSettingsDetails(state)
  assert.equal(state.settingsView, 'overview')
})

test('conversation settings opens as a second-level settings view', () => {
  const state = createInitialUiState()

  openConversationSettings(state)

  assert.equal(state.screen, 'settings')
  assert.equal(state.activeTab, 'settings')
  assert.equal(state.settingsView, 'conversation')
  assert.equal(resolveAppBackAction(state), 'settings-overview')

  closeSettingsDetails(state)
  assert.equal(state.settingsView, 'overview')
})

test('NSFW settings opens as a second-level settings view', () => {
  const state = createInitialUiState()

  openNsfwSettings(state)

  assert.equal(state.screen, 'settings')
  assert.equal(state.activeTab, 'settings')
  assert.equal(state.settingsView, 'nsfw')
  assert.equal(resolveAppBackAction(state), 'settings-overview')

  closeSettingsDetails(state)
  assert.equal(state.settingsView, 'overview')
})

test('re-entering settings always starts at overview', () => {
  const state = createInitialUiState()
  openSettingsDetails(state)

  selectTab(state, 'providers')
  selectTab(state, 'settings')

  assert.equal(state.settingsView, 'overview')
})

test('app back navigation closes settings details before leaving settings', () => {
  const state = createInitialUiState()
  openSettingsDetails(state)

  assert.equal(resolveAppBackAction(state), 'settings-overview')
})

test('app back navigation returns internal screens to conversations', () => {
  const state = createInitialUiState()

  openConversation(state, 'product-review')
  assert.equal(resolveAppBackAction(state), 'conversations')

  for (const tab of ['contacts', 'providers', 'settings']) {
    selectTab(state, tab)
    assert.equal(resolveAppBackAction(state), 'conversations')
  }
})

test('app back navigation delegates to Android on the conversation root', () => {
  const state = createInitialUiState()

  assert.equal(resolveAppBackAction(state), 'system')
})

test('provider forms never expose an encrypted key as editable text', () => {
  assert.deepEqual(createProviderForm({
    id: 'p1',
    name: 'OpenAI',
    protocolType: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-test',
    hasApiKey: true,
    encryptedApiKey: { ciphertext: 'hidden' }
  }), {
    id: 'p1',
    name: 'OpenAI',
    protocolType: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModel: 'gpt-test',
    modelsCache: [],
    hasApiKey: true,
    avatar: {
      version: 1,
      mode: 'auto',
      presetId: '',
      dataUrl: '',
      mimeType: '',
      byteSize: 0
    }
  })
})

test('creates Gemini forms and switches only default provider addresses', () => {
  const gemini = createProviderForm({ protocolType: 'gemini' })
  assert.equal(gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')

  const defaultForm = createProviderForm({ defaultModel: 'gpt-old', modelsCache: ['stale-model'] })
  applyProviderProtocolSelection(defaultForm, 'gemini')
  assert.equal(defaultForm.protocolType, 'gemini')
  assert.equal(defaultForm.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')
  assert.equal(defaultForm.defaultModel, '')
  assert.deepEqual(defaultForm.modelsCache, [])

  const customForm = createProviderForm({ baseUrl: 'https://proxy.example.com/google/v1beta' })
  applyProviderProtocolSelection(customForm, 'gemini')
  assert.equal(customForm.baseUrl, 'https://proxy.example.com/google/v1beta')
})

test('applies fetched models without replacing a non-empty default', () => {
  const form = createProviderForm({ defaultModel: 'manual-model' })
  applyFetchedModels(form, ['model-a', 'model-b'])
  assert.equal(form.defaultModel, 'manual-model')
  assert.deepEqual(form.modelsCache, ['model-a', 'model-b'])
})

test('selects the first fetched model when the default is empty', () => {
  const form = createProviderForm({ defaultModel: '' })
  applyFetchedModels(form, ['model-a', 'model-b'])
  assert.equal(form.defaultModel, 'model-a')
})

test('applies a model selected by a uni-app picker index', () => {
  const form = createProviderForm({ defaultModel: 'manual-model' })

  applyProviderModelSelection(form, ['manual-model', 'model-a', 'model-b'], '1')
  assert.equal(form.defaultModel, 'model-a')

  applyProviderModelSelection(form, ['model-a'], '9')
  assert.equal(form.defaultModel, 'model-a')
})

test('attachment actions expose image camera and file entry points', () => {
  assert.deepEqual(attachmentActions.map((item) => item.id), ['image', 'camera', 'file'])
  assert.deepEqual(attachmentActions.map((item) => item.label), ['图片', '拍照', '文件'])
  assert.deepEqual(attachmentActions.map((item) => item.inputRef), [
    'imageAttachmentInput', 'cameraAttachmentInput', 'fileAttachmentInput'
  ])
})

test('shows read receipt only for completed user messages', () => {
  assert.equal(isUserMessageRead({ role: 'user', status: 'completed' }), true)
  assert.equal(isUserMessageRead({ role: 'user', status: 'failed' }), false)
  assert.equal(isUserMessageRead({ role: 'assistant', status: 'completed' }), false)
})

test('switches between chat and image generation modes', () => {
  const state = createInitialUiState()
  assert.equal(state.generationMode, 'chat')
  assert.equal(setGenerationMode(state, 'image'), 'image')
  assert.equal(setGenerationMode(state, 'unsupported'), 'chat')
})

test('send guard requires a provider, content, and no active generation', () => {
  const state = createInitialUiState()
  assert.equal(canSendMessage(state, 'hello', true), true)
  setGenerating(state, true)
  assert.equal(canSendMessage(state, 'hello', true), false)
  setGenerating(state, false)
  assert.equal(canSendMessage(state, '  ', true), false)
  assert.equal(canSendMessage(state, '  ', true, 1, false), true)
  assert.equal(canSendMessage(state, 'hello', true, 1, true), false)
  assert.equal(canSendMessage(state, 'hello', false), false)
})

test('conversation summary labels attachment-only messages', () => {
  const summary = summarizeConversation(
    { id: 'c1', title: 'Title' },
    { content: '', attachmentIds: ['a1'], updatedAt: '2026-07-13T09:29:00.000+08:00' },
    new Date('2026-07-13T10:00:00.000+08:00')
  )
  assert.equal(summary.preview, '[附件]')
})

test('conversation summary uses the latest message and stable fallback values', () => {
  const summary = summarizeConversation(
    { id: 'c1', title: 'Title', updatedAt: '2026-07-13T09:28:00.000+08:00' },
    { content: 'Latest reply', updatedAt: '2026-07-13T09:29:00.000+08:00' },
    new Date('2026-07-13T10:00:00.000+08:00')
  )
  assert.equal(summary.preview, 'Latest reply')
  assert.equal(summary.time, '09:29')
  assert.equal(summary.icon, 'MessageCircle')
})

test('conversation summary hides a trailing assistant status block', () => {
  const summary = summarizeConversation(
    { id: 'c1', title: '角色会话' },
    {
      role: 'assistant',
      content: '她向你挥了挥手。\n<character_status>[心情|开心]</character_status>',
      updatedAt: '2026-07-13T09:29:00.000+08:00'
    },
    new Date('2026-07-13T10:00:00.000+08:00')
  )

  assert.equal(summary.preview, '她向你挥了挥手。')
  assert.doesNotMatch(summary.preview, /character_status/)
})
