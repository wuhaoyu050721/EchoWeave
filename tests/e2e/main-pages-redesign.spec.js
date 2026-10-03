import { expect, test } from 'playwright/test'

const runtimeErrors = new WeakMap()
const mainTabs = [
  ['conversations', '会话'], ['contacts', '联系人'], ['stories', '故事'],
  ['providers', '接口'], ['settings', '设置']
]

test.beforeEach(async ({ page, baseURL }) => {
  const errors = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  // Fixtures are local only; even an accidental model/cloud request cannot reach an upstream.
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

async function openApp(page, width = 390) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/preview/')
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview?.initializing
  ))).toBe(true)
  await expect(page.locator('.bottom-nav')).toBeVisible()
}

async function openTab(page, tab) {
  const button = page.locator(`[data-tab="${tab}"]`)
  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'page')
}

async function seedContacts(page) {
  await page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    for (const [index, name] of ['阿澄', '白羽', '橙子'].entries()) {
      await app.services.repository.saveCharacter({
        id: `redesign-character-${index}`, name, storyScope: 'chat',
        creator: '本地回归测试', tags: index === 1 ? ['旅人'] : ['日常'],
        card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: '仅用于隔离浏览器测试。' } },
        importedAt: `2026-10-0${index + 1}T00:00:00.000Z`,
        createdAt: `2026-10-0${index + 1}T00:00:00.000Z`, updatedAt: `2026-10-0${index + 1}T00:00:00.000Z`
      })
    }
    await app.loadCharacters()
  })
}

for (const width of [390, 320]) {
  test(`all five main pages remain reachable without horizontal overflow at ${width}px`, async ({ page }, testInfo) => {
    await openApp(page, width)
    await seedContacts(page)
    for (const [tab, title] of mainTabs) {
      await openTab(page, tab)
      const activePage = page.locator('.paper-main-page:visible')
      await expect(activePage).toHaveCount(1)
      await expect(activePage.locator('.paper-heading-title')).toHaveText(title)
      const layout = await page.evaluate(() => {
        const root = document.querySelector('.app-shell')
        const rootRect = root.getBoundingClientRect()
        const active = [...document.querySelectorAll('.paper-main-page')].find(element => element.getBoundingClientRect().height > 0)
        return {
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          pageOverflow: active.scrollWidth - active.clientWidth,
          navWithinScreen: [...document.querySelectorAll('.bottom-nav [data-tab]')].every(element => {
            const rect = element.getBoundingClientRect()
            return rect.left >= rootRect.left - 1 && rect.right <= rootRect.right + 1 && rect.bottom <= window.innerHeight + 1
          })
        }
      })
      expect(layout.documentOverflow).toBeLessThanOrEqual(1)
      expect(layout.pageOverflow).toBeLessThanOrEqual(1)
      expect(layout.navWithinScreen).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${width}-${tab}.png`), animations: 'disabled', scale: 'css' })
    }
  })
}

test('contacts retain the two-column library, search, sorting and usable add menu', async ({ page }) => {
  await openApp(page, 320)
  await seedContacts(page)
  await openTab(page, 'contacts')
  const cards = page.locator('.contact-row')
  await expect(cards).toHaveCount(3)
  const [first, second, third] = await Promise.all([0, 1, 2].map(index => cards.nth(index).boundingBox()))
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1)
  expect(second.x).toBeGreaterThanOrEqual(first.x + first.width)
  expect(third.y).toBeGreaterThan(first.y + first.height)
  await expect(cards.first()).toHaveAccessibleName('查看角色卡 阿澄')
  await page.getByRole('button', { name: '按导入时间排序', exact: true }).click()
  await expect(cards.first()).toHaveAccessibleName('查看角色卡 橙子')
  await page.getByRole('button', { name: '按名称排序', exact: true }).click()
  await expect(cards.first()).toHaveAccessibleName('查看角色卡 阿澄')

  await page.getByRole('textbox', { name: '搜索联系人' }).fill('旅人')
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAccessibleName('查看角色卡 白羽')
  await page.getByRole('button', { name: '清空联系人搜索' }).click()
  await expect(cards).toHaveCount(3)

  await page.getByRole('button', { name: '添加角色', exact: true }).click()
  const menu = page.locator('#contacts-add-menu')
  await expect(menu.getByRole('button')).toHaveCount(4)
  for (const name of ['新建自定义角色', '从相册导入角色卡', '从文件管理器导入角色卡', '点击前往制作角色卡']) {
    await menu.getByRole('button', { name, exact: true }).click({ trial: true })
  }
  await page.locator('.contacts-add-scrim').click({ position: { x: 8, y: 330 } })
  await expect(menu).toHaveCount(0)
  await page.getByRole('button', { name: '添加角色', exact: true }).click()
  await page.getByRole('button', { name: '新建自定义角色', exact: true }).click()
  await expect(page.getByRole('button', { name: '创建角色', exact: true })).toBeVisible()
})

test('story management is separate from continuing and both import choices open their picker', async ({ page }) => {
  await openApp(page, 320)
  const id = await page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    const conversation = await app.services.chatService.createConversation({ providerProfileId: app.providerItems[0].id })
    await app.services.repository.saveConversation({ ...conversation, title: '林间的来信', conversationKind: 'story' })
    await app.services.repository.saveMessages([{
      id: 'redesign-story-message', conversationId: conversation.id, sequence: 1,
      role: 'assistant', content: '天色渐晚，小屋里亮起一盏灯。她打开信封，读到了昨日未完的故事。',
      status: 'completed', generationMode: 'chat', attachmentIds: [],
      createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z'
    }])
    await app.loadConversations()
    return conversation.id
  })
  await openTab(page, 'stories')
  await page.getByRole('button', { name: '管理故事 林间的来信', exact: true }).click()
  await expect(page.getByTestId('conversation-action-sheet')).toBeVisible()
  await expect(page.getByTestId('story-reader')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭会话操作' }).click()

  // Browser preview uses a PNG file input for both entries; Android owns its native picker choice.
  for (const name of ['相册导入', '文件导入']) {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.locator('.stories-import-grid').getByRole('button', { name, exact: true }).click()
    const chooser = await chooserPromise
    expect(await chooser.element().getAttribute('accept')).toContain('image/png')
    await chooser.setFiles([])
  }
  await page.getByRole('button', { name: '继续故事 林间的来信', exact: true }).click()
  await expect(page.getByTestId('story-reader')).toBeVisible()
  await expect(page.getByTestId('story-reader')).toContainText('天色渐晚，小屋里亮起一盏灯。')
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.ui.activeConversationId)).toBe(id)
})

test('provider save remains fully reachable above navigation on a narrow screen', async ({ page }) => {
  await openApp(page, 320)
  await openTab(page, 'providers')
  await page.getByRole('button', { name: '添加接口', exact: true }).click()
  await page.locator('.provider-form label.form-row').filter({ hasText: '名称' }).locator('input').fill('窄屏本地测试')
  await page.locator('.provider-form label.form-row').filter({ hasText: '基础地址' }).locator('input').fill('https://fixture.example/v1')
  await page.locator('.provider-form .password-field input').fill('fixture-key')
  await page.locator('.provider-form label.form-row').filter({ hasText: '手动模型' }).locator('input').fill('fixture-model')
  await page.locator('.provider-screen').evaluate(element => { element.scrollTop = element.scrollHeight })
  const save = page.locator('.provider-save-button')
  await save.click({ trial: true })
  const saveBounds = await save.boundingBox()
  const navigationBounds = await page.locator('.bottom-nav').boundingBox()
  expect(saveBounds.y).toBeGreaterThanOrEqual(0)
  expect(saveBounds.y + saveBounds.height).toBeLessThanOrEqual(navigationBounds.y)
  await save.click()
  await expect(page.getByText('接口已保存', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const app = globalThis.__echoWeavePreview
    return (await app.services.repository.listProviders()).some(item => item.name === '窄屏本地测试')
  })).toBe(true)
})

test('all thirteen settings entries remain discoverable and reachable through search', async ({ page }) => {
  await openApp(page, 320)
  await openTab(page, 'settings')
  const rows = page.locator('.settings-overview .settings-row')
  await expect(rows).toHaveCount(13)
  await page.getByRole('button', { name: '搜索设置', exact: true }).click()
  const search = page.getByPlaceholder('搜索设置', { exact: true })
  for (const title of [
    '对话设置', '流式传输', '角色状态栏', '网络代理', '账号与云端', '数据与存储', '导入与导出',
    '隐私与安全', 'NSFW 设置', '设备与诊断', '关于应用', '检查更新', '帮助与反馈'
  ]) {
    await search.fill(title)
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText(title)
    await rows.click({ trial: true })
  }
  await search.fill('不存在的功能名称')
  await expect(page.getByText('未找到相关设置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清空设置搜索' }).click()
  await expect(rows).toHaveCount(13)
})
