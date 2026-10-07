import { expect, test } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyCharacterEdits, createCharacterEditForm, createCustomCharacter } from '../../src/features/character-editor.js'
import { exportCharacterCardPng } from '../../src/features/character-management/exportCharacterCard.js'

const originalName = '旧版角色小澄'
const updatedName = '新版角色小澄'
const updatedDescription = '更新后的角色设定：小澄现在是一位研究星图的航海员。'
const originalGreeting = '这是我们第一次见面的原始问候。'
const updatedGreeting = '这是新版开场白，已有对话中不应再次插入。'
const historyText = '我们之前约好一起去看灯塔，请保留这段共同经历。'
const fixtureTimestamp = '2026-10-01T08:00:00.000Z'
const runtimeErrors = new WeakMap()

function characterFixture() {
  const character = createCustomCharacter({ idFactory: () => 'card-update-character', now: () => fixtureTimestamp })
  return applyCharacterEdits(character, {
    ...createCharacterEditForm(character), name: originalName,
    description: '旧版设定：小澄是一位图书管理员。', firstMessage: originalGreeting
  }, () => fixtureTimestamp)
}

async function updatedPng() {
  const original = characterFixture()
  const updated = applyCharacterEdits(original, {
    ...createCharacterEditForm(original), name: updatedName, description: updatedDescription,
    personality: '耐心、好奇，喜欢把航海日志分享给老朋友。', firstMessage: updatedGreeting
  })
  const exported = await exportCharacterCardPng(updated)
  return { name: 'updated-character.png', mimeType: 'image/png', buffer: Buffer.from(exported.bytes) }
}

test.beforeEach(async ({ page, baseURL }) => {
  const errors = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  // These fixtures never contact a model, cloud account, or other remote service.
  const origin = new URL(baseURL).origin
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname !== '/__ai_proxy') return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' })
  })
})

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

async function ready(page) {
  await expect(page).toHaveTitle('织语')
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview.initializing
  ))).toBe(true)
}

async function setupCharacterHistory(page) {
  await page.goto('/preview/')
  await ready(page)
  return page.evaluate(async ({ character, timestamp, historyText }) => {
    const app = globalThis.__echoWeavePreview
    const repository = app.services.repository
    await repository.saveCharacter(character)
    await repository.saveCharacter({ ...character, id: 'card-update-companion', name: '群聊中的另一位角色' })
    const provider = await app.services.providerService.saveProvider({
      name: '角色卡更新回归接口', baseUrl: 'https://fixture.example/v1',
      apiKey: 'fixture-secret', defaultModel: 'fixture-model'
    })
    await app.loadProviders()
    const options = { characterId: character.id, providerProfileId: provider.id, modelName: 'fixture-model' }
    const ordinary = await app.services.chatService.createCharacterConversation(options)
    await repository.saveConversation({ ...ordinary, title: '与小澄长期保留的对话' })
    const group = await app.services.chatService.createGroupConversation({
      ...options, participantCharacterIds: [character.id, 'card-update-companion'], title: '原本的朋友群'
    })
    const story = await app.services.chatService.createStoryConversation({ ...options, title: '未完的灯塔故事' })
    const memory = {
      id: 'card-update-story-memory', characterId: character.id, name: '灯塔故事记忆',
      scope: 'story', enabled: true,
      data: { entries: [{ id: 'memory-entry', keys: ['灯塔'], content: '小澄已经找到了旧灯塔的钥匙。', enabled: true }] },
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null
    }
    await repository.saveWorldBook(memory)
    await repository.saveConversation({
      ...story, storyConfig: { ...story.storyConfig, memoryWorldBookId: memory.id, worldBookIds: [memory.id] }
    })
    for (const [index, conversation] of [ordinary, group, story].entries()) {
      const existing = await repository.listMessages(conversation.id)
      await repository.saveMessages([
        {
          id: `card-update-history-user-${index}`, conversationId: conversation.id, sequence: existing.length + 1,
          role: 'user', content: historyText, attachmentIds: [], generationMode: 'chat', status: 'completed',
          createdAt: timestamp, updatedAt: timestamp, deletedAt: null
        },
        {
          id: `card-update-history-assistant-${index}`, conversationId: conversation.id, sequence: existing.length + 2,
          role: 'assistant', content: '我记得我们的约定，灯塔还在等我们。', speakerCharacterId: character.id,
          speakerNameSnapshot: character.name, attachmentIds: [], generationMode: 'chat', status: 'completed',
          createdAt: timestamp, updatedAt: timestamp, deletedAt: null
        }
      ])
    }
    await app.loadCharacters()
    await app.loadConversations()
    return { characterId: character.id, conversationIds: [ordinary.id, group.id, story.id], memoryId: memory.id }
  }, { character: characterFixture(), timestamp: fixtureTimestamp, historyText })
}

async function snapshot(page, ids) {
  return page.evaluate(async ({ characterId, conversationIds, memoryId }) => {
    const repository = globalThis.__echoWeavePreview.services.repository
    return {
      character: await repository.getCharacter(characterId),
      characters: (await repository.listCharacters()).map(character => character.id).sort(),
      conversations: await Promise.all(conversationIds.map(id => repository.getConversation(id))),
      allConversationIds: (await repository.listConversations()).map(conversation => conversation.id).sort(),
      messages: await Promise.all(conversationIds.map(id => repository.listMessages(id))),
      memory: await repository.getWorldBook(memoryId)
    }
  }, ids)
}

function conversationIdentity(conversation) {
  const { characterNameSnapshot, characterAvatarAssetId, updatedAt, ...identity } = conversation
  if (identity.participants) {
    identity.participants = identity.participants.map(({ nameSnapshot, avatarAssetId, ...participant }) => participant)
  }
  return JSON.parse(JSON.stringify(identity))
}

async function openUpdatePreview(page) {
  await page.locator('[data-tab="contacts"]').click()
  await page.getByRole('button', { name: `查看角色卡 ${originalName}`, exact: true }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /更新角色卡/ }).click()
  const chooser = await chooserPromise
  expect(await chooser.element().getAttribute('accept')).toContain('image/png')
  await chooser.setFiles(await updatedPng())
  const preview = page.locator('.character-import-modal')
  await expect(preview).toBeVisible()
  await expect(preview).toBeInViewport({ ratio: 1 })
  await expect(preview).toContainText(updatedName)
  await expect(preview).toContainText(originalName)
  await expect(preview.getByRole('button', { name: '确认更新', exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: '确认更新', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(preview.getByRole('button', { name: '取消', exact: true })).toBeVisible()
  return preview
}

async function evidence(page, testInfo, name) {
  const directory = join(tmpdir(), 'echoweave-character-update-20261007')
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: join(directory, `${testInfo.project.name}-${name}.png`), animations: 'disabled', scale: 'css' })
}

test('updating a PNG character preserves all conversations and uses new settings in the existing chat', async ({ page }, testInfo) => {
  const ids = await setupCharacterHistory(page)
  const before = await snapshot(page, ids)
  const preview = await openUpdatePreview(page)
  await evidence(page, testInfo, 'update-preview')
  await preview.getByRole('button', { name: '确认更新', exact: true }).click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('character-detail')).toContainText(updatedName)
  await expect(page.getByTestId('character-detail')).toContainText(updatedDescription)

  const updated = await snapshot(page, ids)
  expect(updated.character.id).toBe(before.character.id)
  expect(updated.character.createdAt).toBe(before.character.createdAt)
  expect(updated.character.name).toBe(updatedName)
  expect(updated.character.description).toBe(updatedDescription)
  expect(updated.character.card.data.first_mes).toBe(updatedGreeting)
  expect(updated.characters).toEqual(before.characters)
  expect(updated.allConversationIds).toEqual(before.allConversationIds)
  expect(updated.conversations.map(conversationIdentity)).toEqual(before.conversations.map(conversationIdentity))
  expect(updated.messages).toEqual(before.messages)
  expect(updated.memory).toEqual(before.memory)
  await page.locator('.character-profile-name').scrollIntoViewIfNeeded()
  await evidence(page, testInfo, 'updated-character')

  await page.reload()
  await ready(page)
  const persisted = await snapshot(page, ids)
  // Startup refreshes display-name/avatar snapshots; the identity, settings and history stay intact.
  expect({ ...persisted, conversations: persisted.conversations.map(conversationIdentity) })
    .toEqual({ ...updated, conversations: updated.conversations.map(conversationIdentity) })
  expect(persisted.conversations[0].characterNameSnapshot).toBe(updatedName)
  expect(persisted.conversations[1].participants[0].nameSnapshot).toBe(updatedName)
  expect(persisted.conversations[2].characterNameSnapshot).toBe(updatedName)
  await page.locator('[data-tab="conversations"]').click()
  await page.getByRole('button', { name: '打开会话 与小澄长期保留的对话', exact: true }).click()
  await expect(page.locator('.chat-scroll')).toContainText(originalGreeting)
  await expect(page.locator('.chat-scroll')).toContainText(historyText)
  await expect(page.locator('.chat-scroll')).not.toContainText(updatedGreeting)
  const requests = []
  await page.route('**/__ai_proxy', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200, contentType: 'text/event-stream; charset=utf-8',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: '我仍记得灯塔的约定，新的航程从这里开始。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
    })
  })
  await page.locator('.composer-input').fill('继续我们在灯塔的约定。')
  await page.locator('.composer-input').press('Control+Enter')
  await expect.poll(() => requests.length).toBe(1)
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.messageItems.at(-1)?.status)).toBe('completed')
  const sent = requests[0].messages
  expect(sent.some(message => message.role === 'system' && message.content.includes(updatedDescription))).toBe(true)
  expect(sent.some(message => message.role === 'user' && message.content === historyText)).toBe(true)
  expect(sent.some(message => message.role === 'assistant' && message.content === originalGreeting)).toBe(true)
  expect(sent.some(message => message.content === updatedGreeting)).toBe(false)
  await expect(page.locator('.chat-scroll')).toContainText('新的航程从这里开始。')
  const continued = await snapshot(page, ids)
  expect(continued.allConversationIds).toEqual(before.allConversationIds)
  expect(continued.messages[0].slice(0, before.messages[0].length)).toEqual(before.messages[0])
  expect(continued.messages[0]).toHaveLength(before.messages[0].length + 2)
  await evidence(page, testInfo, 'existing-chat-continued')
})

test('cancelling an update on a short screen keeps the card and histories unchanged', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 480 })
  const ids = await setupCharacterHistory(page)
  const before = await snapshot(page, ids)
  const preview = await openUpdatePreview(page)
  await evidence(page, testInfo, 'short-screen-preview')
  await preview.getByRole('button', { name: '取消', exact: true }).click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('character-detail')).toContainText(originalName)
  expect(await snapshot(page, ids)).toEqual(before)
  await page.reload()
  await ready(page)
  expect(await snapshot(page, ids)).toEqual(before)
})
