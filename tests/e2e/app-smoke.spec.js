import { expect, test } from 'playwright/test'

test('core local workflow remains usable', async ({ page }) => {
  const runtimeErrors = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  await page.route('**/__ai_proxy', async route => {
    const target = route.request().headers()['x-ai-target-url'] || ''
    if (target.endsWith('/chat/completions')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body:
          'data: {"choices":[{"delta":{"content":"E2E 流式回答"},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n'
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'mock-model' }] })
    })
  })

  await page.goto('/preview/')
  await expect(page).toHaveTitle('织语')
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect(page.getByText('初始化失败')).toHaveCount(0)

  for (const [tab, heading] of [
    ['contacts', '联系人'],
    ['providers', '接口'],
    ['settings', '本地模式']
  ]) {
    await page.locator(`[data-tab="${tab}"]`).click()
    await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText(heading, { exact: false }).first()).toBeVisible()
  }

  await page.locator('[data-tab="providers"]').click()
  await page.getByRole('button', { name: '添加接口' }).click()
  await page.locator('.provider-form label.form-row').filter({ hasText: '名称' }).locator('input').fill('E2E Mock')
  await page.locator('.provider-form label.form-row').filter({ hasText: '基础地址' }).locator('input').fill('https://mock.example/v1')
  await page.locator('.provider-form .password-field input').fill('test-key')
  await page.locator('.provider-form label.form-row').filter({ hasText: '手动模型' }).locator('input').fill('mock-model')
  await page.locator('.provider-save-button').click()
  await expect(page.getByText('接口已保存', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择接口 E2E Mock' })).toBeVisible()

  await page.locator('[data-tab="settings"]').click()
  await page.getByTestId('streaming-settings-entry').click()
  await expect(page.getByTestId('streaming-settings-page')).toBeVisible()
  const streamingToggle = page.getByTestId('streaming-toggle')
  await expect(streamingToggle).toHaveAttribute('aria-checked', 'true')
  await streamingToggle.click()
  await expect(streamingToggle).toHaveAttribute('aria-checked', 'false')
  await streamingToggle.click()
  await expect(streamingToggle).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '返回设置概览' }).click()

  await page.getByText('导入与导出', { exact: true }).click()
  const backupDialog = page.getByRole('dialog', { name: '导入与导出 JSON' })
  await expect(backupDialog).toBeVisible()
  await expect(backupDialog.getByText('保存到本地', { exact: true })).toBeVisible()
  await backupDialog.getByRole('button', { name: '关闭' }).click()

  await page.getByText('隐私与安全', { exact: true }).click()
  await page.getByTestId('app-lock-entry').click()
  await expect(page.getByTestId('app-lock-settings-page')).toBeVisible()
  const pinInputs = page.getByTestId('app-lock-settings-page').locator('input[type="password"]')
  await pinInputs.nth(0).fill('1234')
  await pinInputs.nth(1).fill('1234')
  const appLockToggle = page.getByTestId('app-lock-toggle')
  await appLockToggle.click()
  await expect(appLockToggle).toHaveAttribute('aria-checked', 'true')
  await pinInputs.nth(0).fill('1234')
  await appLockToggle.click()
  await expect(appLockToggle).toHaveAttribute('aria-checked', 'false')

  await page.locator('[data-tab="conversations"]').click()
  await page.getByRole('button', { name: '更多会话操作' }).click()
  await page.getByText('新建会话', { exact: true }).click()
  const composer = page.locator('textarea[placeholder="输入消息"]')
  await expect(composer).toBeVisible()
  await composer.fill('请进行流式测试')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.message-content').filter({ hasText: 'E2E 流式回答' })).toBeVisible()
  await expect(page.locator('.generation-status')).toHaveCount(0)

  await page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    if (!preview) throw new Error('Preview test instance is unavailable')
    preview.resetChatVirtualWindow()
    preview.messageItems = Array.from({ length: 240 }, (_, index) => {
      const role = index % 2 === 0 ? 'user' : 'assistant'
      const content = `虚拟滚动消息 ${index + 1}\n${'不同长度的正文内容。'.repeat((index % 18) + 1)}`
      return preview.decorateChatMessage({
        id: `virtual-message-${index + 1}`,
        conversationId: preview.ui.activeConversationId,
        sequence: index + 1,
        role,
        content,
        status: 'completed',
        generationMode: 'chat',
        attachments: [],
        attachmentIds: [],
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z'
      })
    })
    preview.chatVirtualPinnedToBottom = true
    await preview.$nextTick()
    preview.scrollChatToBottom(true)
  })
  await expect(page.locator('[data-chat-message-id="virtual-message-240"]')).toBeVisible()
  const tailVirtualRows = page.locator('.chat-virtual-row')
  const tailVirtualRowCount = await tailVirtualRows.count()
  expect(tailVirtualRowCount).toBeGreaterThan(0)
  expect(tailVirtualRowCount).toBeLessThanOrEqual(48)
  await page.waitForTimeout(140)

  const middleWindow = await page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    const scroll = document.querySelector('.chat-scroll')
    const scrollTop = Math.max(0, scroll.scrollHeight / 2)
    scroll.scrollTop = scrollTop
    preview.onChatScroll({
      detail: {
        scrollTop,
        scrollHeight: scroll.scrollHeight
      }
    })
    await new Promise(resolve => setTimeout(resolve, 180))
    const rows = [...document.querySelectorAll('.chat-virtual-row')]
    return {
      count: rows.length,
      firstId: rows[0]?.getAttribute('data-chat-message-id') || '',
      lastId: rows.at(-1)?.getAttribute('data-chat-message-id') || '',
      spacerCount: document.querySelectorAll('.chat-virtual-spacer').length
    }
  })
  expect(middleWindow.count).toBeGreaterThan(0)
  expect(middleWindow.count).toBeLessThanOrEqual(48)
  expect(middleWindow.firstId).not.toBe('virtual-message-1')
  expect(middleWindow.lastId).not.toBe('virtual-message-240')
  expect(middleWindow.spacerCount).toBe(2)

  const pausedSegmentedFollow = await page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    const scroll = document.querySelector('.chat-scroll')
    const messageIndex = preview.messageItems.length - 1
    const message = preview.messageItems[messageIndex]
    const before = scroll.scrollTop
    preview.messageItems.splice(messageIndex, 1, {
      ...message,
      responseDisplayMode: 'segmented',
      displayContent: '第一段\n\n第二段\n\n第三段',
      displaySegments: ['第一段', '第二段', '第三段'],
      visibleSegmentCount: 0
    })
    preview.chatVirtualPinnedToBottom = true
    preview.scheduleSegmentedReplyReveal(message.id)
    await new Promise(resolve => setTimeout(resolve, 420))
    const result = {
      before,
      after: scroll.scrollTop,
      pinnedToBottom: preview.chatVirtualPinnedToBottom,
      visibleSegmentCount: preview.messageItems[messageIndex].visibleSegmentCount
    }
    preview.clearSegmentedReplyTimers()
    return result
  })
  expect(pausedSegmentedFollow.pinnedToBottom).toBe(true)
  expect(pausedSegmentedFollow.visibleSegmentCount).toBe(1)
  expect(Math.abs(pausedSegmentedFollow.after - pausedSegmentedFollow.before)).toBeLessThan(3)

  const pausedNonStreamingFollow = await page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    const scroll = document.querySelector('.chat-scroll')
    const messageIndex = preview.messageItems.length - 1
    const message = preview.messageItems[messageIndex]
    const before = scroll.scrollTop
    const previousStreamingEnabled = preview.streamingEnabled
    preview.streamingEnabled = false
    preview.chatVirtualPinnedToBottom = true
    preview.commitMessageUpdate({
      ...message,
      role: 'assistant',
      responseDisplayMode: 'continuous',
      status: 'completed',
      content: `${message.content || ''}\n\nNon-streaming completed reply.`,
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
    await new Promise(resolve => setTimeout(resolve, 180))
    const result = {
      before,
      after: scroll.scrollTop,
      pinnedToBottom: preview.chatVirtualPinnedToBottom
    }
    preview.streamingEnabled = previousStreamingEnabled
    return result
  })
  expect(pausedNonStreamingFollow.pinnedToBottom).toBe(true)
  expect(Math.abs(pausedNonStreamingFollow.after - pausedNonStreamingFollow.before)).toBeLessThan(3)

  const automaticHistoryLoads = await page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    const scroll = document.querySelector('.chat-scroll')
    const originalLoadEarlierMessages = preview.loadEarlierMessages
    let calls = 0
    preview.loadEarlierMessages = () => { calls += 1 }
    preview.messageHistoryHasMore = true
    preview.chatHistoryAutoLoadArmed = true
    preview.onChatScroll({
      detail: {
        scrollTop: 32,
        scrollHeight: scroll.scrollHeight
      }
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    preview.loadEarlierMessages = originalLoadEarlierMessages
    return calls
  })
  expect(automaticHistoryLoads).toBe(1)

  expect(runtimeErrors).toEqual([])
})
