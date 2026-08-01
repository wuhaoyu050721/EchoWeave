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

test('story mode reads like a book in page and scroll layouts', async ({ page }) => {
  const runtimeErrors = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })

  await page.goto('/preview/')
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview?.initializing
  ))).toBe(true)
  await page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    if (!preview) throw new Error('Preview test instance is unavailable')
    const conversationId = 'story-reader-e2e'
    const characterId = 'story-character-e2e'
    preview.characterItems.push({
      id: characterId,
      name: '诸葛墨一',
      storyScope: 'story',
      avatarDataUrl: '/static/zhiyu-logo.png'
    })
    preview.conversationItems.push({
      id: conversationId,
      title: '诸葛墨一',
      preview: '墨一现身，行动组抵达现场。',
      time: '刚刚',
      conversationKind: 'story',
      characterId,
      characterNameSnapshot: '诸葛墨一',
      characterAvatarDataUrl: '/static/zhiyu-logo.png',
      providerProfileId: preview.providerItems[0]?.id,
      providerNameSnapshot: preview.providerItems[0]?.name || 'OpenAI 官方',
      modelName: preview.providerItems[0]?.defaultModel || 'gpt-4o-mini'
    })
    const story = [
      '坠落的广告牌在距离她们不足半米的位置骤然停滞，像是被一只无形的手稳稳托住。',
      '四周像是短暂安静了一瞬。墨一跪在地上，银白的长发从肩头滑落。她抬起手，看着指尖微弱的光一点点熄灭。',
      '灰黑雾气已经在街道另一端聚成扭曲的人形，轮廓在半空中不断蠕动、膨胀。没有任何标识的黑色车辆急停在封锁线外，行动队员迅速散开。',
      '走在最前方的女人身形高挑，神情冷峻。她扫过灾害中心，目光准确落在墨一胸前发亮的白玉佩上。',
      '特勤七队接管现场。未登记能力者，带着孩子退到我身后。她顿了顿，侧目看向正在成形的黑影。',
      '如果你还站得起来，就告诉我这里发生了什么。'
    ].join('\n\n').repeat(5)
		preview.ui.activeTab = 'conversations'
		preview.ui.screen = 'conversations'
		preview.ui.activeConversationId = null
    preview.ui.generationMode = 'chat'
    preview.messageHistoryHasMore = false
    preview.messageHistoryTrimmed = false
    preview.messageHistoryLoading = false
    preview.messageItems = [
      preview.decorateChatMessage({
        id: 'story-event-e2e', conversationId, sequence: 1, role: 'user', status: 'completed',
        content: '墨一现身，行动组抵达现场。', attachments: [], attachmentIds: [],
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
      }),
      preview.decorateChatMessage({
        id: 'story-answer-e2e', conversationId, sequence: 2, role: 'assistant', status: 'completed',
        content: story, attachments: [], attachmentIds: [], generationMode: 'chat',
        createdAt: '2026-08-01T00:00:01.000Z', updatedAt: '2026-08-01T00:00:01.000Z'
      })
    ]
		await preview.services.repository.saveMessages(JSON.parse(JSON.stringify(preview.messageItems)))
    await preview.$nextTick()
  })

	await expect(page.locator('[data-conversation-id="story-reader-e2e"]')).toHaveCount(0)
	await expect(page.locator('[data-story-conversation-id="story-reader-e2e"]')).toHaveCount(1)
	await page.locator('[data-tab="stories"]').click()
	await expect(page.locator('[data-story-conversation-id="story-reader-e2e"]')).toBeVisible()
	await expect(page.getByText('继续阅读', { exact: true })).toBeVisible()
	await page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		preview.ui.screen = 'chat'
		preview.ui.activeConversationId = 'story-reader-e2e'
		await preview.$nextTick()
	})

  const reader = page.getByTestId('story-reader')
  const counter = page.getByTestId('story-page-counter')
  await expect(reader).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveClass(/story-reader-active/)
  await expect(page.locator('.app-shell')).not.toHaveClass(/chat-active/)
  await expect(page.locator('.message-bubble')).toHaveCount(0)
	await expect(reader).toHaveAttribute('data-chrome-visible', 'false')
	await expect(page.getByTestId('story-reader-top-chrome')).toHaveAttribute('aria-hidden', 'true')
	await expect(page.getByTestId('story-reader-composer')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByTestId('story-page-mode')).toHaveAttribute('aria-selected', 'true')
	await expect(page.getByTestId('story-scroll-bottom')).toHaveCount(0)

	await expect.poll(async () => {
		const parts = String(await counter.textContent()).trim().split('/').map(value => Number(value.trim()))
		return parts[1] > 1 && parts[0] === parts[1]
	}).toBe(true)
	const initialCounter = String(await counter.textContent()).trim()
	const paginationLayout = await page.evaluate(async () => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		const component = shell?.__vueParentComponent?.proxy
		const layouts = []
		for (let pageIndex = 0; pageIndex < component.pageCount; pageIndex += 1) {
			component.currentPageIndex = pageIndex
			await component.$nextTick()
			const pageNode = document.querySelector('.story-page')
			const blocks = [...pageNode.querySelectorAll('.story-reader-block')]
			const pageRect = pageNode.getBoundingClientRect()
			const lastBlockRect = blocks.at(-1)?.getBoundingClientRect()
			layouts.push({
				gap: lastBlockRect
					? pageRect.bottom - Number.parseFloat(getComputedStyle(pageNode).paddingBottom) - lastBlockRect.bottom
					: 0,
				overflow: Math.max(0, pageNode.scrollHeight - pageNode.clientHeight)
			})
		}
		component.currentPageIndex = component.pageCount - 1
		await component.$nextTick()
		return layouts
	})
	const maximumNonFinalGap = Math.max(...paginationLayout.slice(0, -1).map(layout => layout.gap))
	const maximumOverflow = Math.max(...paginationLayout.map(layout => layout.overflow))
	expect(maximumNonFinalGap, JSON.stringify(paginationLayout)).toBeLessThanOrEqual(80)
	expect(maximumOverflow, JSON.stringify(paginationLayout)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: '上一页' }).click()
	await expect(page.getByTestId('story-page-content')).toHaveClass(/turn-backward/)
  await expect(counter).not.toHaveText(initialCounter)
	await page.waitForTimeout(300)

  const beforeSwipe = String(await counter.textContent()).trim()
  await page.locator('.story-page').evaluate(element => {
    const dispatchTouch = (type, x, y) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
      element.dispatchEvent(event)
    }
    dispatchTouch('touchstart', 310, 320)
    dispatchTouch('touchend', 80, 326)
  })
	await expect(page.getByTestId('story-page-content')).toHaveClass(/turn-forward/)
  await expect(counter).not.toHaveText(beforeSwipe)
	await page.waitForTimeout(300)

	await page.locator('.story-page').click({ position: { x: 195, y: 320 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'true')
	await expect(page.getByTestId('story-reader-top-chrome')).toHaveAttribute('aria-hidden', 'false')
	await expect(page.getByTestId('story-reader-composer')).toHaveAttribute('aria-hidden', 'false')
	const bookmarkedPageCounter = String(await counter.textContent()).trim()
	await page.getByTestId('story-bookmark-menu').click()
	const bookmarkPanel = page.getByTestId('story-bookmark-panel')
	await expect(bookmarkPanel).toBeVisible()
	await page.getByTestId('story-bookmark-toggle').click()
	await expect(page.getByTestId('story-bookmark-toggle')).toContainText('移除当前位置书签')
	await expect.poll(() => page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		const bookmarks = await preview.services.repository.getSetting('storyReaderBookmarks:story-reader-e2e', [])
		return bookmarks.length
	})).toBe(1)
	const savedBookmark = await page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		return (await preview.services.repository.getSetting('storyReaderBookmarks:story-reader-e2e', []))[0]
	})
	expect(savedBookmark).toMatchObject({ conversationId: 'story-reader-e2e' })
	expect(savedBookmark.blockId).toBeTruthy()
	expect(savedBookmark.excerpt).toBeTruthy()
	await bookmarkPanel.getByRole('button', { name: '关闭书签' }).click()
	await page.getByRole('button', { name: '上一页' }).click()
	await expect(counter).not.toHaveText(bookmarkedPageCounter)
	await page.waitForTimeout(300)
	await page.getByTestId('story-bookmark-menu').click()
	await bookmarkPanel.getByRole('button', { name: /^跳转书签 第/ }).click()
	await expect(counter).toHaveText(bookmarkedPageCounter)
	await page.locator('.story-page').click({ position: { x: 195, y: 320 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'false')
	await page.evaluate(() => {
		const preview = globalThis.__echoWeavePreview
		globalThis.__storyContinueCalls = 0
		globalThis.__storyContinueOriginal = preview.services.chatService.continueResponse
		preview.services.chatService.continueResponse = async () => {
			globalThis.__storyContinueCalls += 1
			return new Promise(resolve => { globalThis.__storyContinueResolve = resolve })
		}
	})
	await page.getByTestId('story-continue-writing').click()
	await expect.poll(() => page.evaluate(() => globalThis.__storyContinueCalls)).toBe(1)
	await expect(reader).toHaveAttribute('data-chrome-visible', 'false')
	await page.evaluate(() => {
		const preview = globalThis.__echoWeavePreview
		preview.services.chatService.continueResponse = globalThis.__storyContinueOriginal
		delete globalThis.__storyContinueOriginal
		delete globalThis.__storyContinueCalls
		delete globalThis.__storyContinueResolve
	})

	const heldPageCounter = String(await counter.textContent()).trim()
	const heldPageParts = heldPageCounter.split('/').map(value => Number(value.trim()))
	await page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		const message = preview.messageItems.find(item => item.id === 'story-answer-e2e')
		globalThis.__storyOriginalMessage = { ...message }
		preview.ui.generating = true
		preview.commitMessageUpdate({
			...message,
			status: 'generating',
			content: `${message.content}\n\n${'新生成的故事段落逐步抵达，但阅读位置保持不变。'.repeat(180)}`
		})
		await preview.$nextTick()
	})
	await expect.poll(async () => {
		const parts = String(await counter.textContent()).trim().split('/').map(value => Number(value.trim()))
		return parts[1]
	}).toBeGreaterThan(heldPageParts[1])
	const growingPageParts = String(await counter.textContent()).trim().split('/').map(value => Number(value.trim()))
	expect(growingPageParts[0]).toBe(heldPageParts[0])
	await page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		preview.commitMessageUpdate(globalThis.__storyOriginalMessage)
		preview.ui.generating = false
		delete globalThis.__storyOriginalMessage
		await preview.$nextTick()
	})
	await page.locator('.story-page').click({ position: { x: 195, y: 320 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'true')

  await page.getByTestId('story-scroll-mode').click()
  await expect(page.getByTestId('story-scroll-mode')).toHaveAttribute('aria-selected', 'true')
	await expect(page.getByTestId('story-scroll-bottom')).toBeVisible()
  await expect(page.locator('.story-reader-scroll')).toBeVisible()
  await expect(page.getByText('事件走向', { exact: true })).toBeVisible()
  await expect(reader.getByText('墨一现身，行动组抵达现场。', { exact: true })).toBeVisible()
  await expect(page.locator('textarea[placeholder="输入事件走向，留空续写"]')).toBeVisible()
	await page.locator('.story-reader-scroll').click({ position: { x: 195, y: 360 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'false')
	await expect(page.getByTestId('story-reader-composer')).toHaveAttribute('aria-hidden', 'true')

  await expect.poll(() => page.evaluate(async () => {
    const preview = globalThis.__echoWeavePreview
    return preview.services.repository.getSetting('storyReaderMode', '')
  })).toBe('scroll')

	const persistedScrollTop = await page.evaluate(async () => {
		const scroll = document.querySelector('.story-reader-scroll')
		const nextScrollTop = Math.min(
			Math.max(0, scroll.scrollHeight - scroll.clientHeight),
			Math.floor(scroll.scrollHeight * 0.42)
		)
		scroll.scrollTop = nextScrollTop
		scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
		await new Promise(resolve => setTimeout(resolve, 520))
		return scroll.scrollTop
	})
	await page.locator('.story-reader-scroll').click({ position: { x: 195, y: 360 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'true')
	await page.getByTestId('story-page-mode').click()
	await expect(page.getByTestId('story-page-mode')).toHaveAttribute('aria-selected', 'true')
	await page.waitForTimeout(280)
	const persistedReadingState = await page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		const parentPosition = preview.storyReaderPosition
		const pendingPosition = preview.pendingStoryReaderPositionSave?.position || null
		await preview.flushStoryReaderPositionSave()
		const savedPosition = await preview.services.repository.getSetting('storyReaderPosition:story-reader-e2e', null)
		return { parentPosition, pendingPosition, savedPosition }
	})
	expect(persistedScrollTop).toBeGreaterThan(0)
	expect(persistedReadingState).toMatchObject({
		parentPosition: { conversationId: 'story-reader-e2e' }
	})
	expect(persistedReadingState.parentPosition?.blockId).toBeTruthy()
	expect(persistedReadingState.savedPosition).toEqual(persistedReadingState.parentPosition)

	const savedPageCounter = String(await counter.textContent()).trim()
	await page.getByTestId('back-to-conversations').click()
	await expect(page.locator('[data-story-conversation-id="story-reader-e2e"]')).toBeVisible()
	await page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		preview.storyReaderBookmarks = []
		await preview.openChat('story-reader-e2e')
		await preview.$nextTick()
	})
	await expect(reader).toBeVisible()
	await expect(counter).toHaveText(savedPageCounter)
	const restoredPosition = await page.evaluate(() => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		return shell?.__vueParentComponent?.proxy?.readingPosition || null
	})
	expect(restoredPosition).toEqual(persistedReadingState.savedPosition)
	await page.locator('.story-page').click({ position: { x: 195, y: 320 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'true')
	await page.getByTestId('story-bookmark-menu').click()
	await expect(bookmarkPanel).toBeVisible()
	await expect(bookmarkPanel.getByRole('button', { name: /^跳转书签 第/ })).toHaveCount(1)
	await bookmarkPanel.getByRole('button', { name: '关闭书签' }).click()
	await page.locator('.story-page').click({ position: { x: 195, y: 320 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'false')

	await page.locator('.story-page').click({ position: { x: 195, y: 320 } })
	await expect(reader).toHaveAttribute('data-chrome-visible', 'true')
	await page.evaluate(() => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		const component = shell?.__vueParentComponent?.proxy
		if (!component) throw new Error('Story reader component is unavailable')
		component.__storyScrollTargetOriginal = component.storyScrollTarget
		component.__storyScrollTargetAttemptCount = 0
		component.storyScrollTarget = function delayedStoryScrollTarget() {
			this.__storyScrollTargetAttemptCount += 1
			if (this.__storyScrollTargetAttemptCount <= 2) return null
			return this.__storyScrollTargetOriginal()
		}
	})
	await page.getByTestId('story-scroll-mode').click()
	await expect(page.getByTestId('story-scroll-mode')).toHaveAttribute('aria-selected', 'true')
	await expect.poll(() => page.evaluate(() => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		return shell?.__vueParentComponent?.proxy?.__storyScrollTargetAttemptCount || 0
	})).toBeGreaterThan(2)
	const scrollRestoreAttempts = await page.evaluate(() => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		const component = shell?.__vueParentComponent?.proxy
		const attempts = component?.__storyScrollTargetAttemptCount || 0
		if (component?.__storyScrollTargetOriginal) component.storyScrollTarget = component.__storyScrollTargetOriginal
		delete component?.__storyScrollTargetOriginal
		delete component?.__storyScrollTargetAttemptCount
		return attempts
	})
	expect(scrollRestoreAttempts).toBeGreaterThan(2)
	await expect.poll(async () => page.evaluate(() => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		const component = shell?.__vueParentComponent?.proxy
		const position = component?.readingPosition
		const target = component?.storyScrollTarget?.()
		const node = position ? component?.findStoryScrollNode?.(position.blockId) : null
		const block = position
			? component?.storyBlocks?.find(item => item.sourceId === position.blockId || item.id === position.blockId)
			: null
		if (!position || !target || !node || !block) return Number.POSITIVE_INFINITY
		const relativeOffset = Math.max(0, position.characterOffset - Number(block.sourceOffset || 0))
		const anchorRect = component.storyTextRectAtOffset(node, relativeOffset)
		const viewportRect = target.getBoundingClientRect()
		if (!anchorRect || !viewportRect) return Number.POSITIVE_INFINITY
		const readingLine = viewportRect.top + component.storyReadingLineInset(viewportRect)
		return Math.abs(anchorRect.top - readingLine)
	})).toBeLessThan(3)
	await page.getByTestId('story-scroll-bottom').click()
	await expect.poll(() => page.evaluate(() => {
		const scroll = document.querySelector('.story-reader-scroll')
		return scroll ? Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop) : Number.POSITIVE_INFINITY
	})).toBeLessThan(2)
	const bottomReadingPosition = await page.evaluate(() => {
		const shell = document.querySelector('[data-testid="story-reader"]')
		const component = shell?.__vueParentComponent?.proxy
		const finalBlock = component?.storyBlocks?.[component.storyBlocks.length - 1]
		return {
			position: component?.readingPosition || null,
			blockId: finalBlock?.sourceId || finalBlock?.id || '',
			characterOffset: Number(finalBlock?.sourceOffset || 0) + Array.from(String(finalBlock?.text || '')).length
		}
	})
	expect(bottomReadingPosition.position).toMatchObject({
		blockId: bottomReadingPosition.blockId,
		characterOffset: bottomReadingPosition.characterOffset
	})
	await page.getByTestId('story-bookmark-menu').click()
	await expect(bookmarkPanel).toBeVisible()
	await bookmarkPanel.getByRole('button', { name: /^删除书签 第/ }).click()
	await expect(bookmarkPanel.getByText('还没有书签', { exact: true })).toBeVisible()
	await expect.poll(() => page.evaluate(async () => {
		const preview = globalThis.__echoWeavePreview
		const bookmarks = await preview.services.repository.getSetting('storyReaderBookmarks:story-reader-e2e', [])
		return bookmarks.length
	})).toBe(0)
  expect(runtimeErrors).toEqual([])
})
