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

  expect(runtimeErrors).toEqual([])
})
