import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('chat renders the latest completed assistant state as a clickable status bar', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /v-if="latestAssistantStatus && assistantStatusOverview" class="character-status-bar"/)
  assert.match(source, /latestAssistantStatus\.summary/)
  assert.match(source, /assistantStatusOpen = true/)
  assert.match(source, /class="assistant-status-modal"[^>]*aria-label="角色状态详情"/)
	assert.match(source, /assistantStatusOverview\.primary/)
	assert.match(source, /assistantStatusOverview\.location/)
	assert.match(source, /assistantStatusOverview\.scoreValue/)
	assert.match(source, /class="assistant-status-progress"/)
	assert.match(source, /:active-color="assistantStatusProgressColor"/)
	assert.match(source, /--assistant-status-progress-color/)
	assert.match(source, /var\(--assistant-status-progress-color, #2fa49f\)/)
	assert.match(source, /assistantStatusUpdateLabel/)
	assert.match(source, /assistantStatusIssue/)
	assert.match(source, /本轮未返回状态/)
	assert.match(source, /状态格式未识别/)
  assert.match(source, /v-for="section in assistantStatusSections"/)
  assert.match(source, /v-for="\(item, itemIndex\) in section\.items"/)
  assert.match(source, /message\.status === 'completed' && message\.assistantStatus/)
  assert.match(source, /\.chat-scroll\.has-character-status\s*\{[^}]*padding-top:\s*122px/s)
	assert.match(source, /\.character-status-bar\s*\{[^}]*height:\s*48px/s)
	assert.match(source, /\.assistant-status-modal\s*\{[^}]*border-radius:\s*8px 8px 0 0/s)
	assert.match(source, /\.assistant-status-hero-item\s*\{[^}]*overflow:\s*hidden/s)
	assert.match(source, /\.assistant-status-hero-item text\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*text-overflow:\s*ellipsis/s)
})

test('chat derives display content without changing the stored assistant response', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const decorator = source.slice(source.indexOf('decorateChatMessage(message)'), source.indexOf('async openChat(conversationId)'))

  assert.match(decorator, /extractAssistantStatus\(rawContent, \{ hideIncomplete: message\.status === 'generating' \}\)/)
  assert.match(decorator, /displayContent: extracted\.content/)
  assert.match(decorator, /assistantStatus: extracted\.status/)
  assert.match(source, /\{\{ message\.displayContent \}\}/)
  assert.doesNotMatch(decorator, /message\.content\s*=/)
})
