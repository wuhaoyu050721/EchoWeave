import { expect, test } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function setupChat(page) {
  await page.goto('/preview/')
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__echoWeavePreview?.ready))).toBe(true)
  return page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    const provider = await app.services.providerService.saveProvider({ name: '空响应回归', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-secret', defaultModel: 'fixture-model' })
    await app.loadProviders()
    const conversation = await app.services.chatService.createConversation({ providerProfileId: provider.id })
    const timestamp = new Date().toISOString()
    await app.services.repository.saveMessages([
      { id: 'previous-user', conversationId: conversation.id, sequence: 1, role: 'user', content: '开始', status: 'completed', attachmentIds: [], createdAt: timestamp, updatedAt: timestamp },
      { id: 'previous-reply', conversationId: conversation.id, sequence: 2, role: 'assistant', content: '已有的上一段正文。', status: 'completed', generationMode: 'chat', attachmentIds: [], createdAt: timestamp, updatedAt: timestamp }
    ])
    await app.loadConversations()
    await app.openChat(conversation.id)
    return conversation.id
  })
}

for (const hiddenOnly of [false, true]) {
  test(`continuation with ${hiddenOnly ? 'hidden status only' : 'no text'} has a visible failure and response evidence`, async ({ page }, testInfo) => {
    let requestCount = 0
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/__ai_proxy', async route => {
      requestCount += 1
      const content = hiddenOnly ? '<sumo_monitor><status>[位置|房间]</status></sumo_monitor>' : ''
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
        `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n` + 'data: [DONE]\n\n'
      })
    })
    const conversationId = await setupChat(page)
    await page.getByTestId('continue-writing').click()
    const failed = page.locator('.message-assistant').last()
    await expect(failed.locator('.message-status-copy')).toContainText('回答失败')
    await expect(failed.getByRole('button', { name: '响应详情' })).toBeVisible()
    const saved = await page.evaluate(async () => {
      const app = globalThis.__echoWeavePreview
      return app.services.repository.getMessage(app.messageItems.at(-1).id)
    })
    expect(saved.status).toBe('failed')
    expect(saved.responseDiagnostics.requestKind).toBe('continue')
    expect(saved.responseDiagnostics.receivedBytes).toBeGreaterThan(0)
    expect(saved.responseDiagnostics.visibleCharacters).toBe(0)
    expect(requestCount).toBe(1)
    await failed.getByRole('button', { name: '响应详情' }).click()
    const details = page.getByRole('alertdialog', { name: '本次响应详情' })
    await expect(details).toContainText('HTTP 200')
    await expect(details).toContainText('可显示：0 字符')
    await expect(details).not.toContainText('fixture-secret')
    await expect(details).not.toContainText('sumo_monitor')
    await expect(details.getByRole('button', { name: '复制详情' })).toBeVisible()
    if (!hiddenOnly) {
      const directory = join(tmpdir(), 'echoweave-reliability-20261003')
      await mkdir(directory, { recursive: true })
      await page.screenshot({ path: join(directory, `${testInfo.project.name}-empty-continuation-details.png`), scale: 'css', animations: 'disabled' })
    }
    await details.getByRole('button', { name: '关闭', exact: true }).click()
    await page.evaluate(id => globalThis.__echoWeavePreview.openChat(id), conversationId)
    await expect(page.locator('.message-assistant').last().getByRole('button', { name: '响应详情' })).toBeVisible()
    expect(requestCount).toBe(1)
    expect(errors).toEqual([])
  })
}

test('old completed empty replies show a fallback and do not invent upstream evidence', async ({ page }) => {
  await setupChat(page)
  await page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    const previous = await app.services.repository.getMessage('previous-reply')
    await app.services.repository.saveMessage({ ...previous, content: '' })
    await app.openChat(previous.conversationId)
  })
  const last = page.locator('.message-assistant').last()
  await expect(last.locator('.assistant-body')).toBeVisible()
  await expect(last).toContainText('未收到可显示正文')
  await last.getByRole('button', { name: '响应详情' }).click()
  await expect(page.getByRole('alertdialog', { name: '本次响应详情' })).toContainText('无法确认当时上游是否返回')
})

test('empty story history also provides a visible response-details entry', async ({ page }) => {
  const conversationId = await setupChat(page)
  await page.evaluate(async id => {
    const app = globalThis.__echoWeavePreview
    const conversation = await app.services.repository.getConversation(id)
    const reply = await app.services.repository.getMessage('previous-reply')
    await app.services.repository.saveConversation({ ...conversation, conversationKind: 'story' })
    await app.services.repository.saveMessage({ ...reply, content: '' })
    await app.loadConversations()
    await app.openChat(id)
  }, conversationId)
  const reader = page.getByTestId('story-reader')
  await expect(reader.getByText('这条历史回复没有可显示的正文，可查看响应详情或手动重试。')).toBeVisible()
  await reader.getByRole('button', { name: '响应详情' }).click()
  await expect(page.getByRole('alertdialog', { name: '本次响应详情' })).toContainText('无法确认当时上游是否返回')
})
