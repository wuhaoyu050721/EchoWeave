import { expect, test } from 'playwright/test'

const observations = new WeakMap()

test.beforeEach(async ({ page, baseURL }) => {
  const observation = { errors: [], upstreamRequests: [], popups: [] }
  observations.set(page, observation)
  page.on('pageerror', error => observation.errors.push(error.message))
  page.on('popup', popup => observation.popups.push(popup))
  const origin = new URL(baseURL).origin
  // Every test gets Playwright's isolated browser context. Network guards make
  // these settings checks incapable of reaching model or account services.
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname !== '/__ai_proxy') return route.continue()
    observation.upstreamRequests.push(url.origin + url.pathname)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' })
  })
})

test.afterEach(async ({ page }) => {
  const observation = observations.get(page)
  expect(observation.errors).toEqual([])
  expect(observation.upstreamRequests).toEqual([])
  expect(observation.popups).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

async function waitForApp(page) {
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview?.initializing
  ))).toBe(true)
}

async function openSettings(page, width = 320) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/preview/')
  await waitForApp(page)
  await page.locator('[data-tab="settings"]').click()
  await expect(page.locator('.settings-overview .settings-row')).toHaveCount(13)
}

async function openOverviewEntry(page, title) {
  await expect(page.locator('.settings-overview')).toBeVisible()
  await page.locator('.settings-overview .settings-row').filter({
    has: page.getByText(title, { exact: true })
  }).click()
}

async function expectOverview(page) {
  await expect(page.locator('.settings-overview')).toBeVisible()
  await expect(page.locator('[data-tab="settings"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.settings-overview .settings-row')).toHaveCount(13)
}

async function expectNoHorizontalOverflow(page, root) {
  const pageOverflow = await root.evaluate(element => element.scrollWidth - element.clientWidth)
  const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(pageOverflow).toBeLessThanOrEqual(1)
  expect(documentOverflow).toBeLessThanOrEqual(1)
}

async function seedStorageRecords(page) {
  return page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    const repository = app.services.repository
    for (const [index, kind] of ['chat', 'chat', 'story'].entries()) {
      const conversation = await app.services.chatService.createConversation({ providerProfileId: app.providerItems[0].id })
      await repository.saveConversation({ ...conversation, title: `设置存储回归 ${index}`, conversationKind: kind })
    }
    for (const [index, storyScope] of ['chat', 'story'].entries()) {
      const name = `设置回归角色 ${index}`
      await repository.saveCharacter({
        id: `settings-character-${index}`, name, storyScope, worldBookIds: [],
        card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: '仅用于隔离浏览器回归测试。' } },
        createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', deletedAt: null
      })
    }
    await repository.saveWorldBook({
      id: 'settings-world-book', name: '设置回归世界书', scope: 'global',
      characterId: null, characterIds: [], data: { entries: [] }, deletedAt: null
    })
    await Promise.all([app.loadConversations(), app.loadCharacters(), app.loadWorldBooks()])
    const [conversations, characters, worldBooks, providers] = await Promise.all([
      repository.listConversations(), repository.listCharacters(), repository.listAllWorldBooks(), repository.listProviders()
    ])
    return {
      会话: conversations.filter(item => item.conversationKind !== 'story').length,
      角色: characters.length,
      故事: conversations.filter(item => item.conversationKind === 'story').length,
      接口: providers.length,
      世界书: worldBooks.length
    }
  })
}

test('storage shows real isolated workspace counts and its backup entry remains usable', async ({ page }, testInfo) => {
  await openSettings(page)
  const expected = await seedStorageRecords(page)
  await openOverviewEntry(page, '数据与存储')
  const storage = page.getByTestId('settings-information-storage')
  await expect(storage).toBeVisible()
  await expect(storage.locator('.storage-count-card')).toHaveCount(5)
  for (const [label, count] of Object.entries(expected)) {
    const card = storage.locator('.storage-count-card').filter({ has: page.getByText(label, { exact: true }) })
    await expect(card.locator('.storage-count-value')).toHaveText(count.toLocaleString('zh-CN'))
  }
  await expect(storage).toContainText('不代表占用空间')
  await expectNoHorizontalOverflow(page, storage)
  await page.screenshot({ path: testInfo.outputPath('storage-320.png'), animations: 'disabled', scale: 'css' })
  await storage.getByRole('button', { name: /^导入与导出/ }).click()
  const backup = page.getByRole('dialog', { name: '导入与导出 JSON' })
  await expect(backup).toBeVisible()
  await backup.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(storage).toBeVisible()
  await storage.getByRole('button', { name: '返回设置', exact: true }).click()
  await expectOverview(page)
})

test('about shows the installed version in an internal page and returns to settings', async ({ page }, testInfo) => {
  await openSettings(page)
  const version = await page.evaluate(() => globalThis.__echoWeavePreview.appVersion)
  await openOverviewEntry(page, '关于应用')
  const about = page.getByTestId('settings-information-about')
  await expect(about).toBeVisible()
  await expect(about.locator('.information-facts')).toContainText(version)
  await expect(about.getByText('EchoWeave', { exact: true })).toBeVisible()
  await expect(about.getByRole('button', { name: /^版本发布/ })).toBeVisible()
  await expectNoHorizontalOverflow(page, about)
  await page.screenshot({ path: testInfo.outputPath('about-320.png'), animations: 'disabled', scale: 'css' })
  await about.getByRole('button', { name: '返回设置', exact: true }).click()
  await expectOverview(page)
})

test('updates opens internally and clearly states that it has not checked the network', async ({ page }, testInfo) => {
  await openSettings(page)
  const version = await page.evaluate(() => globalThis.__echoWeavePreview.appVersion)
  await openOverviewEntry(page, '检查更新')
  const updates = page.getByTestId('settings-information-updates')
  await expect(updates).toBeVisible()
  await expect(updates.locator('.updates-version')).toHaveText(version)
  await expect(updates).toContainText('本页未联网检查版本，当前显示的是已安装版本。')
  await expect(updates.getByRole('button', { name: '前往发布页查看更新', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page, updates)
  await page.screenshot({ path: testInfo.outputPath('updates-320.png'), animations: 'disabled', scale: 'css' })
  await updates.getByRole('button', { name: '返回设置', exact: true }).click()
  await expectOverview(page)
})

test('help opens internally, changes the expanded FAQ, and preserves a clear return path', async ({ page }, testInfo) => {
  await openSettings(page)
  await openOverviewEntry(page, '帮助与反馈')
  const help = page.getByTestId('settings-information-help')
  await expect(help).toBeVisible()
  const emptyReply = help.getByRole('button', { name: '只有头像，没有回复正文怎么办？', exact: true })
  const continuation = help.getByRole('button', { name: '续写和重试有什么区别？', exact: true })
  await expect(emptyReply).toHaveAttribute('aria-expanded', 'true')
  await expect(help.locator('#settings-help-empty-reply')).toContainText('响应详情')
  await continuation.click()
  await expect(continuation).toHaveAttribute('aria-expanded', 'true')
  await expect(emptyReply).toHaveAttribute('aria-expanded', 'false')
  await expect(help.locator('#settings-help-empty-reply')).toHaveCount(0)
  await expect(help.locator('#settings-help-continue')).toContainText('重试会重新发起该轮回复')
  await continuation.click()
  await expect(continuation).toHaveAttribute('aria-expanded', 'false')
  await expect(help.locator('.help-faq-answer')).toHaveCount(0)
  await expectNoHorizontalOverflow(page, help)
  await page.screenshot({ path: testInfo.outputPath('help-320.png'), animations: 'disabled', scale: 'css' })
  await help.getByRole('button', { name: '返回设置', exact: true }).click()
  await expectOverview(page)
})

test('privacy keeps masked PIN fields, busy guards, and Android-only notification controls', async ({ page }, testInfo) => {
  await openSettings(page)
  await openOverviewEntry(page, '隐私与安全')
  await page.getByTestId('app-lock-entry').click()
  const lock = page.getByTestId('app-lock-settings-page')
  const inputs = lock.locator('input')
  await expect(lock).toBeVisible()
  await expect(inputs).toHaveCount(2)
  for (const input of await inputs.all()) {
    await expect(input).toHaveAttribute('type', 'password')
    await expect(input).toHaveAttribute('inputmode', 'numeric')
    await expect(input).toHaveAttribute('maxlength', '8')
    await expect(input).toHaveValue('')
  }
  const toggle = page.getByTestId('app-lock-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  // Exercise the existing busy state without hashing a PIN or enabling a lock.
  await page.evaluate(() => { globalThis.__echoWeavePreview.appLockBusy = true })
  await expect(toggle).toBeDisabled()
  for (const input of await inputs.all()) await expect(input).toBeDisabled()
  await page.evaluate(() => { globalThis.__echoWeavePreview.appLockBusy = false })
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expectNoHorizontalOverflow(page, lock)
  await page.screenshot({ path: testInfo.outputPath('app-lock-320.png'), animations: 'disabled', scale: 'css' })
  await lock.getByRole('button', { name: '返回设置概览', exact: true }).click()
  await openOverviewEntry(page, '隐私与安全')
  await page.getByTestId('reply-notifications-entry').click()
  const notifications = page.getByTestId('reply-notifications-settings-page')
  await expect(notifications).toBeVisible()
  await expect(page.getByTestId('reply-notifications-toggle')).toBeDisabled()
  await expect(notifications).toContainText('仅 Android App 安装包可用')
  await expect(notifications.getByRole('button', { name: '打开系统通知设置', exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(page, notifications)
  await notifications.getByRole('button', { name: '返回设置概览', exact: true }).click()
  await expectOverview(page)
})

test('diagnostics stays unavailable in the browser and its back button restores settings', async ({ page }, testInfo) => {
  await openSettings(page)
  await openOverviewEntry(page, '设备与诊断')
  await expect(page).toHaveURL(/\?page=pages\/android-diagnostics\/index$/)
  const diagnostics = page.locator('.diagnostic-shell')
  await expect(diagnostics).toBeVisible()
  await expect(diagnostics.getByRole('button', { name: '开始诊断', exact: true })).toBeDisabled()
  await expect(diagnostics).toContainText('仅 Android App 支持流式诊断')
  await diagnostics.getByRole('button', { name: '诊断页菜单', exact: true }).click()
  await expect(diagnostics.locator('#diagnostic-header-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(diagnostics.locator('#diagnostic-header-menu')).toHaveCount(0)
  await expectNoHorizontalOverflow(page, diagnostics)
  await page.screenshot({ path: testInfo.outputPath('diagnostics-320.png'), animations: 'disabled', scale: 'css' })
  await diagnostics.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\?tab=settings$/)
  await waitForApp(page)
  await expectOverview(page)
  await expect(page.locator('[data-tab="conversations"]')).not.toHaveAttribute('aria-current', 'page')
})

test('system prompt changes save as ciphertext and survive refresh with their enabled state', async ({ page }) => {
  await openSettings(page)
  await openOverviewEntry(page, '对话设置')
  const input = page.getByTestId('system-prompt-input')
  const toggle = page.getByTestId('system-prompt-toggle')
  const save = page.getByTestId('system-prompt-save')
  const prompt = '设置回归专用内容：请用清晰的短句回答。\n此文本只保存在隔离的测试工作区。'
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await input.fill(prompt)
  await save.click()
  await expect(page.getByText('系统提示词已保存', { exact: true })).toBeVisible()
  const stored = await page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('systemPrompt'))
  expect(Object.keys(stored).sort()).toEqual(['enabled', 'encryptedValue'])
  expect(stored.enabled).toBe(true)
  expect(stored.encryptedValue.algorithm).toBe('AES-GCM')
  expect(stored.encryptedValue.iv).toBeTruthy()
  expect(stored.encryptedValue.ciphertext).toBeTruthy()
  expect(JSON.stringify(stored)).not.toContain(prompt)
  expect(JSON.stringify(stored)).not.toContain('设置回归专用内容')

  await page.reload()
  await waitForApp(page)
  await page.locator('[data-tab="settings"]').click()
  await openOverviewEntry(page, '对话设置')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(input).toHaveValue(prompt)
  await toggle.click()
  await save.click()
  await expect.poll(() => page.evaluate(async () => (
    await globalThis.__echoWeavePreview.services.repository.getSetting('systemPrompt')
  ).enabled)).toBe(false)
  await page.reload()
  await waitForApp(page)
  await page.locator('[data-tab="settings"]').click()
  await openOverviewEntry(page, '对话设置')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(input).toHaveValue(prompt)
})

test('streaming, character status and private-status switches persist immediately through refresh', async ({ page }) => {
  await openSettings(page)
  await openOverviewEntry(page, '流式传输')
  const streaming = page.getByTestId('streaming-toggle')
  const segmented = page.getByTestId('streaming-segmented-toggle')
  await expect(streaming).toHaveAttribute('aria-checked', 'true')
  await expect(segmented).toHaveAttribute('aria-checked', 'false')
  await segmented.click()
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('streamingSegmentedDisplay'))).toBe(true)
  await streaming.click()
  await expect(segmented).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('streamingEnabled'))).toBe(false)

  await page.reload()
  await waitForApp(page)
  await page.locator('[data-tab="settings"]').click()
  await openOverviewEntry(page, '流式传输')
  await expect(streaming).toHaveAttribute('aria-checked', 'false')
  await expect(segmented).toHaveCount(0)
  await streaming.click()
  await expect(segmented).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('streamingEnabled'))).toBe(true)
  await page.getByTestId('streaming-settings-page').getByRole('button', { name: '返回设置概览', exact: true }).click()

  await openOverviewEntry(page, '角色状态栏')
  const characterStatus = page.getByTestId('character-status-toggle')
  await expect(characterStatus).toHaveAttribute('aria-checked', 'true')
  await characterStatus.click()
  await expect(characterStatus).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('characterStatusEnabled'))).toBe(false)
  await page.getByTestId('character-status-settings-page').getByRole('button', { name: '返回设置概览', exact: true }).click()
  await openOverviewEntry(page, 'NSFW 设置')
  const privateStatus = page.getByTestId('nsfw-status-toggle')
  await expect(privateStatus).toHaveAttribute('aria-checked', 'false')
  await privateStatus.click()
  await expect(privateStatus).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('nsfwEnabled'))).toBe(true)

  await page.reload()
  await waitForApp(page)
  await page.locator('[data-tab="settings"]').click()
  await openOverviewEntry(page, '角色状态栏')
  await expect(characterStatus).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('character-status-settings-page').getByRole('button', { name: '返回设置概览', exact: true }).click()
  await openOverviewEntry(page, 'NSFW 设置')
  await expect(privateStatus).toHaveAttribute('aria-checked', 'true')
})
