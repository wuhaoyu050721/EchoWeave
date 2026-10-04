import { expect, test } from 'playwright/test'

const browserErrors = new WeakMap()

test.beforeEach(async ({ page }) => {
  const errors = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

async function setupChat(page, { story = false, messageCount = 2, shortMessages = false } = {}) {
  await page.goto('/preview/')
  await expect(page).toHaveTitle('织语')
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview.initializing))).toBe(true)
  await page.evaluate(({ story, messageCount, shortMessages }) => {
    // Chromium can collect an async evaluation's Promise during a large IndexedDB write.
    // Keep the fixture alive in the page and poll plain state instead of awaiting it over CDP.
    const fixture = { done: false, id: null, error: null, promise: null }
    globalThis.__interactionFixture = fixture
    fixture.promise = (async () => {
      const app = globalThis.__echoWeavePreview
      const provider = await app.services.providerService.saveProvider({
        name: '交互回归接口', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-secret', defaultModel: 'fixture-model'
      })
      await app.loadProviders()
      const conversation = await app.services.chatService.createConversation({ providerProfileId: provider.id })
      if (story) await app.services.repository.saveConversation({ ...conversation, conversationKind: 'story' })
      const timestamp = new Date().toISOString()
      await app.services.repository.saveMessages(Array.from({ length: messageCount }, (_, index) => ({
        id: `interaction-message-${index + 1}`, conversationId: conversation.id, sequence: index + 1,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${index + 1} 条交互检查消息。${'这是可阅读的历史正文，用于检验滚动位置保持。'.repeat(messageCount > 2 && !shortMessages ? 7 : 1)}`,
        status: 'completed', generationMode: 'chat', attachmentIds: [], createdAt: timestamp, updatedAt: timestamp
      })))
      await app.loadConversations()
      await app.openChat(conversation.id)
      return conversation.id
    })().then(id => { fixture.id = id; fixture.done = true }, error => {
      fixture.error = error?.stack || String(error)
      fixture.done = true
    })
  }, { story, messageCount, shortMessages })
  await expect.poll(() => page.evaluate(() => globalThis.__interactionFixture?.done)).toBe(true)
  const result = await page.evaluate(() => {
    const { id, error } = globalThis.__interactionFixture
    delete globalThis.__interactionFixture
    return { id, error }
  })
  if (result.error) throw new Error(`Chat fixture failed: ${result.error}`)
  const id = result.id
  if (story) {
    const paper = page.locator('.story-page')
    const bounds = await paper.boundingBox()
    await paper.click({ position: { x: bounds.width / 2, y: bounds.height * 0.6 } })
  }
  await expect(page.locator(story ? '.story-direction-input' : '.composer-input')).toBeVisible()
  return id
}

async function interceptReplies(page) {
  const requests = []
  await page.route('**/__ai_proxy', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body:
      `data: ${JSON.stringify({ choices: [{ delta: { content: '快捷键发送已成功，正文正常显示。' }, finish_reason: 'stop' }] })}\n\n` + 'data: [DONE]\n\n'
    })
  })
  return requests
}

async function scrollIntoHistory(page) {
  // Wait for initial delayed anchor scrolling and measurement to settle first.
  await page.waitForTimeout(450)
  await page.locator('.chat-scroll').evaluate(element => {
    element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.45)
  })
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.chatVirtualPinnedToBottom)).toBe(false)
  await page.waitForTimeout(150)
}

test('model menu dismisses on background click and composer focus', async ({ page }) => {
  await setupChat(page)
  const selector = page.getByRole('button', { name: '选择接口与模型', exact: true })
  await selector.click()
  await expect(selector).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.model-popover')).toBeVisible()
  await page.locator('.model-menu-backdrop').click({ position: { x: 12, y: 300 } })
  await expect(page.locator('.model-popover')).toHaveCount(0)
  await expect(selector).toHaveAttribute('aria-expanded', 'false')
  await selector.click()
  await page.locator('.composer-input').click()
  await expect(page.locator('.model-popover')).toHaveCount(0)
  await expect(page.locator('.composer-input')).toBeFocused()
})

test('rename dialog saves typed input and cancelling deletion keeps the conversation', async ({ page }) => {
  const id = await setupChat(page)
  await page.getByRole('button', { name: '管理会话', exact: true }).click()
  await page.getByTestId('conversation-rename-action').click()
  const input = page.getByTestId('app-dialog-input')
  const save = page.getByTestId('app-dialog-confirm')
  await input.fill('')
  await expect(save).toBeDisabled()
  await input.fill('重命名后保留的会话')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByTestId('app-dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(async id =>
    (await globalThis.__echoWeavePreview.services.repository.getConversation(id))?.title, id
  )).toBe('重命名后保留的会话')

  await page.getByRole('button', { name: '管理会话', exact: true }).click()
  await page.getByTestId('conversation-delete-action').click()
  const dialog = page.getByTestId('app-dialog')
  await expect(dialog).toHaveAccessibleName('删除会话')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(async id =>
    (await globalThis.__echoWeavePreview.services.repository.getConversation(id))?.title, id
  )).toBe('重命名后保留的会话')
})

for (const story of [false, true]) {
  test(`${story ? 'story' : 'ordinary chat'} keyboard keeps Enter as newline and sends once with ${story ? 'Meta' : 'Control'}+Enter`, async ({ page }) => {
    const requests = await interceptReplies(page)
    await setupChat(page, { story })
    const input = page.locator(story ? '.story-direction-input' : '.composer-input')
    await input.fill('第一行')
    await input.press('Enter')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('第一行\n\n')
    expect(requests).toHaveLength(0)
    await input.fill('第一行\n第二行操作意图')
    await input.press(story ? 'Meta+Enter' : 'Control+Enter')
    await expect.poll(() => requests.length).toBe(1)
    await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.messageItems.at(-1)?.status)).toBe('completed')
    await expect(page.locator(story ? '[data-testid="story-reader"]' : '.chat-scroll')).toContainText('快捷键发送已成功，正文正常显示。')
    await expect(input).toHaveValue('')
    expect(requests[0].messages.some(message => message.role === 'user' && message.content === '第一行\n第二行操作意图')).toBe(true)
    if (story) {
      // Empty story input has a continue action on its button, but a keyboard shortcut must not issue it.
      await input.press('Control+Enter')
      await input.press('Meta+Enter')
      await page.waitForTimeout(250)
      expect(requests).toHaveLength(1)
      await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.ui.generating)).toBe(false)
    }
  })
}

test('history stays in place during a reply update and returns to the latest on demand', async ({ page }) => {
  await setupChat(page, { messageCount: 48 })
  await scrollIntoHistory(page)
  const position = await page.locator('.chat-scroll').evaluate(element => element.scrollTop)
  await page.evaluate(() => {
    const app = globalThis.__echoWeavePreview
    const message = app.messageItems.at(-1)
    app.commitMessageUpdate({ ...message, content: `${message.content}\n新的流式正文`, status: 'generating' })
  })
  await page.waitForTimeout(300)
  expect(Math.abs(await page.locator('.chat-scroll').evaluate(element => element.scrollTop) - position)).toBeLessThan(3)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  await page.getByTestId('chat-jump-latest').click()
  await expect(page.getByTestId('chat-jump-latest')).toHaveCount(0)
  await expect(page.locator('[data-chat-message-id="interaction-message-48"]')).toBeVisible()
  await expect.poll(() => page.locator('.chat-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
})

test('reduced motion disables menu and action-icon animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setupChat(page)
  await page.getByRole('button', { name: '选择接口与模型', exact: true }).click()
  for (const selector of ['.model-popover', '.composer-action-icon']) {
    expect(await page.locator(selector).evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  }
  await page.locator('.composer-input').click()
  await page.getByRole('button', { name: '选择表情', exact: true }).click()
  expect(await page.locator('.emoji-popover').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  expect(await page.locator('.composer-stop').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
  await page.getByRole('button', { name: '选择表情', exact: true }).click()
  await page.getByRole('button', { name: '添加附件', exact: true }).click()
  expect(await page.locator('.attachment-popover').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
})

test('return-to-latest reloads the persisted tail after the bounded history window trims it', async ({ page }) => {
  await setupChat(page, { messageCount: 300, shortMessages: true })
  await page.locator('.composer-input').fill('历史阅读期间保留的未发送草稿')
  await page.waitForTimeout(450)
  const history = await page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    for (let index = 0; index < 6 && !app.messageHistoryTrimmed && app.messageHistoryHasMore; index += 1) {
      await app.loadEarlierMessages()
      await app.$nextTick()
    }
    return { trimmed: app.messageHistoryTrimmed, tail: app.messageItems.at(-1)?.id, count: app.messageItems.length }
  })
  expect(history.trimmed).toBe(true)
  expect(history.tail).not.toBe('interaction-message-300')
  expect(history.count).toBeLessThanOrEqual(240)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  await page.getByTestId('chat-jump-latest').click()
  await expect(page.getByTestId('chat-jump-latest')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => ({
    trimmed: globalThis.__echoWeavePreview.messageHistoryTrimmed,
    tail: globalThis.__echoWeavePreview.messageItems.at(-1)?.id
  }))).toEqual({ trimmed: false, tail: 'interaction-message-300' })
  const persisted = await page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getMessage('interaction-message-300'))
  expect(persisted.sequence).toBe(300)
  await expect(page.locator('[data-chat-message-id="interaction-message-300"]')).toBeVisible()
  await expect(page.locator('.composer-input')).toHaveValue('历史阅读期间保留的未发送草稿')
  await expect.poll(() => page.locator('.chat-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
})

test('a stale return-to-latest load does not scroll a reopened conversation away from history', async ({ page }) => {
  const conversationId = await setupChat(page, { messageCount: 300, shortMessages: true })
  await page.waitForTimeout(450)
  await page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    for (let index = 0; index < 6 && !app.messageHistoryTrimmed && app.messageHistoryHasMore; index += 1) {
      await app.loadEarlierMessages()
      await app.$nextTick()
    }
  })
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.messageHistoryTrimmed)).toBe(true)
  await page.evaluate(() => {
    const app = globalThis.__echoWeavePreview
    const originalRead = app.readChatMessagePage.bind(app)
    let firstRead = true
    app.readChatMessagePage = async (...args) => {
      const pauseThisRead = firstRead
      firstRead = false
      const result = await originalRead(...args)
      if (pauseThisRead) await new Promise(resolve => { globalThis.__interactionReleaseOldLoad = resolve })
      return result
    }
    globalThis.__interactionRestorePageRead = () => { app.readChatMessagePage = originalRead }
    // Retain the actual action's promise so assertions run after all of the stale action finishes.
    globalThis.__interactionOldJump = app.jumpToLatestChat()
  })
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__interactionReleaseOldLoad))).toBe(true)
  await page.getByTestId('back-to-conversations').click()
  await page.locator(`[data-conversation-id="${conversationId}"] .conversation-open`).click()
  await expect(page.locator('.composer-input')).toBeVisible()
  await scrollIntoHistory(page)
  const before = await page.locator('.chat-scroll').evaluate(element => element.scrollTop)
  await page.evaluate(async () => {
    globalThis.__interactionReleaseOldLoad()
    await globalThis.__interactionOldJump
    globalThis.__interactionRestorePageRead()
  })
  await page.waitForTimeout(300)
  const after = await page.locator('.chat-scroll').evaluate(element => element.scrollTop)
  expect(Math.abs(after - before)).toBeLessThan(3)
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.chatVirtualPinnedToBottom)).toBe(false)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
})

test('return-to-latest stays above a multiline composer and attachment preview', async ({ page }) => {
  await setupChat(page, { messageCount: 48 })
  await page.locator('.composer-input').fill('第一行\n第二行\n第三行\n第四行')
  await page.locator('.composer input[type="file"]').last().setInputFiles({ name: '交互检查.txt', mimeType: 'text/plain', buffer: Buffer.from('这是本地测试附件。') })
  await expect(page.locator('.pending-attachment')).toHaveCount(1)
  await scrollIntoHistory(page)
  const bounds = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height }
    }
    return { composer: box('.composer'), jump: box('.chat-jump-latest'), input: box('.composer-input'), send: box('.composer-stop'), attachment: box('.composer-attachment'), width: innerWidth }
  })
  expect(bounds.input.height).toBeGreaterThan(44)
  expect(bounds.jump.bottom).toBeLessThanOrEqual(bounds.composer.top - 8)
  expect(bounds.jump.left).toBeGreaterThanOrEqual(0)
  expect(bounds.jump.right).toBeLessThanOrEqual(bounds.width)
  expect(bounds.input.right).toBeLessThanOrEqual(bounds.attachment.left + 1)
  expect(bounds.input.right).toBeLessThanOrEqual(bounds.send.left)
  await page.getByTestId('chat-jump-latest').click()
  await expect(page.getByTestId('chat-jump-latest')).toHaveCount(0)
  await expect(page.locator('.composer-input')).toHaveValue('第一行\n第二行\n第三行\n第四行')
  await expect(page.locator('.pending-attachment')).toHaveCount(1)
})
