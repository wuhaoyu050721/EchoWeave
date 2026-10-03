import { expect, test } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function openApp(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/preview/')
  await expect(page).toHaveTitle('织语')
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__echoWeavePreview?.ready))).toBe(true)
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  return errors
}

async function evidence(page, testInfo, name) {
  const directory = join(tmpdir(), 'echoweave-reliability-20261003')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${testInfo.project.name}-${name}.png`)
  await page.screenshot({ path, fullPage: false, scale: 'css', animations: 'disabled' })
}

test('drafts and attachments stay with their conversation and account space', async ({ page }, testInfo) => {
  const errors = await openApp(page)
  const ids = await page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    const provider = app.providerItems[0]
    const a = await app.services.chatService.createConversation({ providerProfileId: provider.id })
    const b = await app.services.chatService.createConversation({ providerProfileId: provider.id })
    await app.services.repository.saveConversation({ ...a, title: '草稿 A' })
    await app.services.repository.saveConversation({ ...b, title: '草稿 B' })
    await app.loadConversations()
    return { a: a.id, b: b.id }
  })
  await page.getByRole('button', { name: '打开会话 草稿 A' }).click()
  const input = page.locator('textarea[placeholder="输入消息"]')
  await input.fill('属于 A 的草稿')
  await page.locator('input[type="file"][accept*=".txt"]').setInputFiles({ name: 'a-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('A attachment') })
  await expect(page.getByRole('button', { name: '移除附件 a-draft.txt' })).toBeVisible()
  await page.getByTestId('back-to-conversations').click()
  await page.getByRole('button', { name: '打开会话 草稿 B' }).click()
  await expect(input).toHaveValue('')
  await expect(page.locator('.pending-attachment')).toHaveCount(0)
  await evidence(page, testInfo, 'draft-b-empty')
  await input.fill('属于 B 的草稿')
  await page.getByTestId('back-to-conversations').click()
  await page.getByRole('button', { name: '打开会话 草稿 A' }).click()
  await expect(input).toHaveValue('属于 A 的草稿')
  await expect(page.getByRole('button', { name: '移除附件 a-draft.txt' })).toBeVisible()
  await evidence(page, testInfo, 'draft-restored')
  await page.evaluate(async ({ a }) => {
    const app = globalThis.__echoWeavePreview
    const localConversation = await app.services.repository.getConversation(a)
    const session = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', cloud_base_url: 'https://fixture.example', user: { id: 'draft-account', email: 'draft@example.test', username: '测试账号' } }
    await app.workspaceManager.tokenStore.save(session)
    await app.activateWorkspaceForSession(session)
    // Deliberately reuse the conversation ID in a different account to test both keys.
    await app.services.repository.saveConversation(localConversation)
    await app.loadConversations()
    await app.openChat(a)
  }, ids)
  await expect(input).toHaveValue('')
  await expect(page.locator('.pending-attachment')).toHaveCount(0)
  await input.fill('账号空间的草稿')
  await page.evaluate(async ({ a }) => {
    const app = globalThis.__echoWeavePreview
    await app.workspaceManager.tokenStore.clear()
    await app.activateLocalWorkspace()
    await app.openChat(a)
  }, ids)
  await expect(input).toHaveValue('属于 A 的草稿')
  await expect(page.getByRole('button', { name: '移除附件 a-draft.txt' })).toBeVisible()
  expect(errors).toEqual([])
})

test('cloud JSON sharing explains plaintext, lists expiry and revokes a share', async ({ page }, testInfo) => {
  const errors = await openApp(page)
  await page.evaluate(() => {
    const app = globalThis.__echoWeavePreview
    app.cloudSession = { access_token: 'fixture-token', user: { id: 5 } }
    const createdAt = Math.floor(Date.now() / 1000)
    const items = [{ id: 11, created_at: createdAt, expires_at: createdAt + 604800, byte_size: 450, format_version: 1 }]
    globalThis.__shareCalls = []
    app.prepareCloudServices = async () => ({ apiClient: {
      listJsonExports: async () => [...items],
      uploadJsonExport: async () => {
        const item = { id: 12, created_at: createdAt, expires_at: createdAt + 604800, byte_size: 512, format_version: 1 }
        items.push(item)
        return { ...item, download_url: 'https://fixture.example/share/new-token' }
      },
      revokeJsonExport: async id => {
        globalThis.__shareCalls.push(id)
        const index = items.findIndex(item => item.id === id)
        if (index >= 0) items.splice(index, 1)
      }
    } })
    app.openBackupMenu()
  })
  const dialog = page.getByRole('dialog', { name: '导入与导出 JSON' })
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('json-share-notice')).toContainText('明文分享')
  await expect(page.getByTestId('json-share-notice')).toContainText('默认 7 天')
  await expect(dialog.locator('[data-share-id="11"]')).toContainText('失效')
  await dialog.getByRole('button', { name: '保存到云端' }).click()
  await expect(dialog.locator('.backup-link-field input')).toHaveValue('https://fixture.example/share/new-token')
  await expect(dialog.locator('[data-share-id="12"]')).toBeVisible()
  await evidence(page, testInfo, 'json-share-expiry')
  await dialog.getByRole('button', { name: '撤销分享 12' }).click()
  await expect(dialog.locator('[data-share-id="12"]')).toHaveCount(0)
  await expect(dialog.locator('.backup-link-field')).toHaveCount(0)
  expect(await page.evaluate(() => globalThis.__shareCalls)).toEqual([12])
  await page.evaluate(() => globalThis.__echoWeavePreview.resetWorkspaceViewState())
  expect(await page.evaluate(() => ({ shares: globalThis.__echoWeavePreview.jsonExports, url: globalThis.__echoWeavePreview.cloudExportUrl }))).toEqual({ shares: [], url: '' })
  expect(errors).toEqual([])
})

for (const mode of ['page', 'scroll']) {
  test(`old story positions and bookmarks load outside the newest 60 messages (${mode})`, async ({ page }, testInfo) => {
    const errors = await openApp(page)
    await page.evaluate(async mode => {
      const app = globalThis.__echoWeavePreview
      const existing = app.conversationItems[0]
      const conversation = { ...existing, id: 'long-story', title: '长篇阅读回归', conversationKind: 'story', characterId: null }
      await app.services.repository.saveConversation(conversation)
      const messages = Array.from({ length: 180 }, (_, index) => ({
        id: `long-${index + 1}`, conversationId: conversation.id, sequence: index + 1, role: 'assistant', status: 'completed', generationMode: 'chat',
        content: `章节 ${index + 1} 的正文。${'夜色里，旅人沿着古老的河岸向前，远处的灯火照亮下一段旅途。'.repeat(7)}`,
        attachments: [], attachmentIds: [], createdAt: new Date(1800000000000 + index * 1000).toISOString(), updatedAt: new Date(1800000000000 + index * 1000).toISOString()
      }))
      await app.services.repository.saveMessages(messages)
      await app.services.repository.setSetting('storyReaderMode', mode)
      app.storyReaderMode = mode
      await app.services.repository.setSetting('storyReaderPosition:long-story', { conversationId: 'long-story', blockId: 'long-10-paragraph-1', characterOffset: 0 })
      await app.services.repository.setSetting('storyReaderBookmarks:long-story', [{ id: 'old-bookmark', conversationId: 'long-story', blockId: 'long-20-paragraph-1', characterOffset: 0, excerpt: '早期书签', createdAt: new Date().toISOString() }])
      await app.loadConversations()
      await app.openChat('long-story')
    }, mode)
    const reader = page.getByTestId('story-reader')
    await expect(reader).toBeVisible()
    await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.messageItems.some(item => item.id === 'long-10'))).toBe(true)
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="story-reader"]')?.__vueParentComponent?.proxy?.readingPosition?.blockId)).toBe('long-10-paragraph-1')
    await page.evaluate(async () => {
      const app = globalThis.__echoWeavePreview
      await app.reloadLatestMessages()
      await app.$nextTick()
      const component = document.querySelector('[data-testid="story-reader"]')?.__vueParentComponent?.proxy
      component.readerChromeVisible = true
    })
    await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.messageItems[0]?.sequence)).toBe(121)
    await page.getByTestId('story-bookmark-menu').click()
    await page.getByTestId('story-bookmark-panel').getByRole('button', { name: /^跳转书签/ }).click()
    await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.messageItems.some(item => item.id === 'long-20'))).toBe(true)
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="story-reader"]')?.__vueParentComponent?.proxy?.readingPosition?.blockId)).toBe('long-20-paragraph-1')
    await evidence(page, testInfo, `story-old-bookmark-${mode}`)
    // Reach the end of the restored window, then load the next continuous section.
    const lastLoaded = await page.evaluate(async () => {
      const app = globalThis.__echoWeavePreview
      const component = document.querySelector('[data-testid="story-reader"]')?.__vueParentComponent?.proxy
      if (component.normalizedMode === 'scroll') component.scrollStoryToBottom()
      else component.currentPageIndex = component.pageCount - 1
      component.readerChromeVisible = true
      await component.$nextTick()
      return app.messageItems[app.messageItems.length - 1].sequence
    })
    if (mode === 'page') await page.getByRole('button', { name: '下一页', exact: true }).click()
    else await page.getByRole('button', { name: '加载后续内容', exact: true }).click()
    await expect.poll(() => page.evaluate(() => {
      const app = globalThis.__echoWeavePreview
      return app.messageItems[app.messageItems.length - 1].sequence
    })).toBeGreaterThan(lastLoaded)
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="story-reader"]')?.__vueParentComponent?.proxy?.readingPosition?.blockId)).toBe(`long-${lastLoaded + 1}-paragraph-1`)
    expect(errors).toEqual([])
  })
}
