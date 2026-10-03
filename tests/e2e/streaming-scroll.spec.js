import { expect, test } from 'playwright/test'

const observations = new WeakMap()

test.beforeEach(async ({ page, baseURL }) => {
  const observation = { errors: [], upstreamRequests: [] }
  observations.set(page, observation)
  page.on('pageerror', error => observation.errors.push(error.message))
  const origin = new URL(baseURL).origin
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname !== '/__ai_proxy') return route.continue()
    observation.upstreamRequests.push(url.origin + url.pathname)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' })
  })
})

test.afterEach(async ({ page }) => {
  expect(observations.get(page).errors).toEqual([])
  expect(observations.get(page).upstreamRequests).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

async function setupStreamingChat(page, { segmented = false } = {}) {
  await page.goto('/preview/')
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview.initializing
  ))).toBe(true)
  await page.evaluate(({ segmented }) => {
    const fixture = { done: false, error: null, promise: null }
    globalThis.__streamingScrollFixture = fixture
    fixture.promise = (async () => {
      const app = globalThis.__echoWeavePreview
      const provider = await app.services.providerService.saveProvider({
        name: '滚动回归接口', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-secret', defaultModel: 'fixture-model'
      })
      await app.loadProviders()
      const conversation = await app.services.chatService.createConversation({ providerProfileId: provider.id })
      const timestamp = new Date().toISOString()
      await app.services.repository.saveMessages(Array.from({ length: 64 }, (_, index) => ({
        id: `streaming-scroll-message-${index + 1}`, conversationId: conversation.id, sequence: index + 1,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${index + 1} 条历史消息。${'流式生成期间可以停留在原处阅读。'.repeat(6)}`,
        responseDisplayMode: segmented && index === 63 ? 'segmented' : 'streaming',
        status: 'completed', generationMode: 'chat', attachmentIds: [], createdAt: timestamp, updatedAt: timestamp
      })))
      await app.loadConversations()
      await app.openChat(conversation.id)
      app.streamingEnabled = true
      if (segmented) {
        const message = app.messageItems.at(-1)
        message.visibleSegmentCount = message.displaySegments.length
      }
    })().then(() => { fixture.done = true }, error => {
      fixture.error = error?.stack || String(error)
      fixture.done = true
    })
  }, { segmented })
  await expect.poll(() => page.evaluate(() => globalThis.__streamingScrollFixture?.done)).toBe(true)
  expect(await page.evaluate(() => globalThis.__streamingScrollFixture.error)).toBeNull()
  await expect(page.locator('.composer-input')).toBeVisible()
  await page.waitForTimeout(450)
  await expect.poll(() => bottomDistance(page)).toBeLessThan(3)
  // The fixture must exercise the bounded virtual list, rather than a tiny chat.
  expect(await page.evaluate(() => globalThis.__echoWeavePreview.messageItems.length)).toBeGreaterThanOrEqual(60)
  expect(await page.locator('.chat-virtual-row').count()).toBeLessThan(48)
}

async function bottomDistance(page) {
  return page.locator('.chat-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)
}

async function position(page) {
  return page.locator('.chat-scroll').evaluate(element => element.scrollTop)
}

async function appendReply(page, content, { segmented = false, completed = false } = {}) {
  await page.evaluate(({ content, segmented, completed }) => {
    const app = globalThis.__echoWeavePreview
    const message = app.messageItems.at(-1)
    app.commitMessageUpdate({
      ...message,
      content: `${message.content}\n\n${content}`,
      responseDisplayMode: segmented ? 'segmented' : 'streaming',
      status: completed ? 'completed' : 'generating'
    })
  }, { content, segmented, completed })
}

test('a 24px upward wheel movement keeps streaming history in place', async ({ page }) => {
  await setupStreamingChat(page)
  await page.locator('.chat-scroll').hover()
  await page.mouse.wheel(0, -24)
  await expect.poll(() => bottomDistance(page)).toBeGreaterThan(12)
  const before = await position(page)
  for (let index = 0; index < 3; index += 1) {
    await appendReply(page, `第 ${index + 1} 次流式追加。`)
    await page.waitForTimeout(140)
  }
  await appendReply(page, '本次回答生成结束。', { completed: true })
  await page.waitForTimeout(150)
  expect(Math.abs(await position(page) - before)).toBeLessThan(3)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.chatVirtualPinnedToBottom)).toBe(false)
})

test('a 16px upward move also holds position during segmented reveal and completion', async ({ page }) => {
  await setupStreamingChat(page, { segmented: true })
  await page.locator('.chat-scroll').hover()
  await page.mouse.wheel(0, -16)
  await expect.poll(() => bottomDistance(page)).toBeGreaterThan(8)
  const before = await position(page)
  await appendReply(page, '第一段新增的流式回答。\n\n第二段新增的流式回答。\n\n', { segmented: true })
  await appendReply(page, '最后一段已经完成。', { segmented: true, completed: true })
  await expect.poll(() => page.evaluate(() => {
    const app = globalThis.__echoWeavePreview
    return app.assistantHasPendingSegments(app.messageItems.at(-1))
  })).toBe(false)
  expect(Math.abs(await position(page) - before)).toBeLessThan(3)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.chatVirtualPinnedToBottom)).toBe(false)
})

test('a touch gesture cancels queued scrolling before the first scroll event arrives', async ({ page }) => {
  await setupStreamingChat(page)
  const paused = await page.evaluate(() => {
    const app = globalThis.__echoWeavePreview
    const target = document.querySelector('.chat-scroll')
    const originalScrollTo = target.scrollTo.bind(target)
    globalThis.__streamingScrollCalls = 0
    target.scrollTo = (...args) => { globalThis.__streamingScrollCalls += 1; originalScrollTo(...args) }
    // Put all three sources of old auto-follow work in flight: its timeout,
    // a throttled bottom-position event, and the next-tick DOM callback.
    app.scrollChatToBottom()
    app.onChatScroll({ detail: { scrollTop: target.scrollTop, scrollHeight: target.scrollHeight } })
    app.requestChatScrollToBottom()
    const sendTouch = (type, y) => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientY: y, pageY: y }] })
      Object.defineProperty(event, 'changedTouches', { value: [{ clientY: y, pageY: y }] })
      target.dispatchEvent(event)
    }
    sendTouch('touchstart', 200)
    const scrollCancelledOnTouch = app.chatScrollTimer === null && app.chatScrollIntoView === ''
    sendTouch('touchmove', 216)
    target.scrollTop -= 16
    sendTouch('touchend', 216)
    return { scrollCancelledOnTouch, pinned: app.chatVirtualPinnedToBottom, top: target.scrollTop }
  })
  expect(paused.scrollCancelledOnTouch).toBe(true)
  expect(paused.pinned).toBe(false)
  await page.waitForTimeout(180)
  expect(await page.evaluate(() => globalThis.__streamingScrollCalls)).toBe(0)
  expect(Math.abs(await position(page) - paused.top)).toBeLessThan(3)
  await appendReply(page, '触摸后的流式增量。')
  await page.waitForTimeout(150)
  expect(Math.abs(await position(page) - paused.top)).toBeLessThan(3)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
})

test('downward scrolling near the end stays paused until the actual bottom and then follows new text', async ({ page }) => {
  await setupStreamingChat(page)
  await page.locator('.chat-scroll').hover()
  await page.mouse.wheel(0, -24)
  await expect.poll(() => bottomDistance(page)).toBeGreaterThan(20)
  await page.mouse.wheel(0, 14)
  await expect.poll(() => bottomDistance(page)).toBeLessThan(12)
  expect(await bottomDistance(page)).toBeGreaterThan(6)
  const before = await position(page)
  await appendReply(page, '距离底部十像素时仍然保持阅读位置。')
  await page.waitForTimeout(160)
  expect(Math.abs(await position(page) - before)).toBeLessThan(3)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  // A genuine downward movement all the way to the end resumes following.
  await page.mouse.wheel(0, 1000)
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(2)
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.chatVirtualPinnedToBottom)).toBe(true)
  await appendReply(page, '到达底部以后，应继续跟随这段新的正文。')
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(2)
  await expect(page.getByTestId('chat-jump-latest')).toHaveCount(0)
})

test('return to latest resumes following after a shallow history gesture', async ({ page }, testInfo) => {
  await setupStreamingChat(page)
  await page.locator('.chat-scroll').hover()
  await page.mouse.wheel(0, -24)
  await expect(page.getByTestId('chat-jump-latest')).toBeVisible()
  await appendReply(page, '你可以停留阅读，也可以点击回到最新。')
  await page.waitForTimeout(160)
  await page.screenshot({ path: testInfo.outputPath('streaming-history-paused.png') })
  await page.getByTestId('chat-jump-latest').click()
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(2)
  await expect(page.getByTestId('chat-jump-latest')).toHaveCount(0)
  await appendReply(page, '点回到最新后恢复自动跟随。', { completed: true })
  await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(2)
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.chatVirtualPinnedToBottom)).toBe(true)
})
