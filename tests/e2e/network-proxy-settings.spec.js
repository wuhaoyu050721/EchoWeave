import { expect, test } from 'playwright/test'

const observations = new WeakMap()
const manualProxyUrl = 'http://127.0.0.1:7890'

test.beforeEach(async ({ page, baseURL }) => {
  const observation = { errors: [], upstreamRequests: [] }
  observations.set(page, observation)
  page.on('pageerror', error => observation.errors.push(error.message))
  const origin = new URL(baseURL).origin
  // Each test uses an isolated workspace. Even an accidental model request must
  // stop at the browser guard rather than reaching the proxy or an upstream API.
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
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

async function installPendingAndroidDetector(page) {
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.__echoWeavePreview?.ready && !globalThis.__echoWeavePreview?.initializing
  ))).toBe(true)
  await page.evaluate(async () => {
    const [{ createAndroidNetworkProxy }, { preserveServiceIdentity }] = await Promise.all([
      import('/src/platform/app/android-network-proxy.js'),
      import('/src/app/vue-service-container.js')
    ])
    const app = globalThis.__echoWeavePreview
    // Only the native bridge is simulated. The actual detector, timeout,
    // Vue handlers and repository remain responsible for all state transitions.
    globalThis.__proxyNativeCalls = []
    const networkProxy = createAndroidNetworkProxy({
      nativeApi: {
        aiChatDetectHttpProxy: () => new Promise(resolve => {
          globalThis.__proxyNativeCalls.push({ resolve })
        })
      }
    })
    app.services = preserveServiceIdentity({
      ...app.services,
      platform: { ...app.services.platform, runtime: 'app-android' },
      networkProxy
    })
    await app.loadWorkspaceSettings()
  })
}

async function openAndroidProxySettings(page) {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/preview/')
  await installPendingAndroidDetector(page)
  await page.locator('[data-tab="settings"]').click()
  await page.getByTestId('network-proxy-settings-entry').click()
  await expect(page.getByTestId('network-proxy-settings-page')).toBeVisible()
}

async function storedProxySetting(page) {
  return page.evaluate(() => globalThis.__echoWeavePreview.services.repository.getSetting('networkProxy', null))
}

async function nativeCallCount(page) {
  return page.evaluate(() => globalThis.__proxyNativeCalls.length)
}

test('smart enable persists without waiting for native detection and a lost callback times out with usable controls', async ({ page }, testInfo) => {
  await openAndroidProxySettings(page)
  const toggle = page.getByTestId('network-proxy-toggle')
  const detect = page.getByTestId('network-proxy-detect')
  const status = page.getByTestId('network-proxy-status')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()

  // These assertions finish before the real 2.5-second detector deadline. A
  // handler that awaits the native callback before saving fails this contract.
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 1000 })
  await expect.poll(() => storedProxySetting(page), { timeout: 1000 }).toEqual({ enabled: true, mode: 'smart', url: '' })
  await expect.poll(() => nativeCallCount(page), { timeout: 1000 }).toBe(1)
  await expect(toggle).toBeEnabled()
  await expect(page.getByPlaceholder(manualProxyUrl)).toBeEnabled()
  await expect(page.getByTestId('network-proxy-save')).toBeEnabled()
  await expect(detect).toBeDisabled()
  await expect(status).toContainText('正在检测')

  await expect(status).toContainText('超时', { timeout: 5000 })
  await expect(detect).toBeEnabled()
  await expect(toggle).toBeEnabled()
  expect(await page.evaluate(() => globalThis.__echoWeavePreview.services.networkProxy.getDetectionState())).toMatchObject({
    pending: false, completed: true, failed: true, timedOut: true
  })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('proxy-timeout-320.png'), animations: 'disabled', scale: 'css' })

  await detect.click()
  await expect.poll(() => nativeCallCount(page)).toBe(2)
  await expect(status).toContainText('正在检测')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 1000 })
  await expect.poll(() => storedProxySetting(page)).toEqual({ enabled: false, mode: 'smart', url: '' })
  await expect.poll(() => page.evaluate(() => globalThis.__echoWeavePreview.networkProxyDetecting)).toBe(false)
  await expect(detect).toHaveCount(0)
})

test('manual phone proxy saves immediately, keeps its mode when toggled, and survives reloading', async ({ page }, testInfo) => {
  await openAndroidProxySettings(page)
  const toggle = page.getByTestId('network-proxy-toggle')
  await page.getByPlaceholder(manualProxyUrl).fill(manualProxyUrl)
  await page.getByTestId('network-proxy-save').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 1000 })
  await expect.poll(() => storedProxySetting(page)).toEqual({ enabled: true, mode: 'manual', url: manualProxyUrl })
  await expect(page.getByTestId('network-proxy-smart-button')).toBeVisible()
  await expect(page.getByTestId('network-proxy-status')).toContainText(manualProxyUrl)
  expect(await nativeCallCount(page)).toBe(0)

  await toggle.click()
  await expect.poll(() => storedProxySetting(page)).toEqual({ enabled: false, mode: 'manual', url: manualProxyUrl })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect.poll(() => storedProxySetting(page)).toEqual({ enabled: true, mode: 'manual', url: manualProxyUrl })
  expect(await nativeCallCount(page)).toBe(0)

  await page.reload()
  await installPendingAndroidDetector(page)
  await page.locator('[data-tab="settings"]').click()
  await page.getByTestId('network-proxy-settings-entry').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByPlaceholder(manualProxyUrl)).toHaveValue(manualProxyUrl)
  await expect(page.getByTestId('network-proxy-smart-button')).toBeVisible()
  await expect(page.getByTestId('network-proxy-detect')).toHaveCount(0)
  expect(await nativeCallCount(page)).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('proxy-manual-320.png'), animations: 'disabled', scale: 'css' })
})

test('saving a manual proxy during detection cancels the wait and ignores a late native result', async ({ page }) => {
  await openAndroidProxySettings(page)
  await page.getByTestId('network-proxy-toggle').click()
  await expect.poll(() => nativeCallCount(page)).toBe(1)
  await expect(page.getByTestId('network-proxy-status')).toContainText('正在检测')

  await page.getByPlaceholder(manualProxyUrl).fill(manualProxyUrl)
  await page.getByTestId('network-proxy-save').click()
  await expect.poll(() => storedProxySetting(page), { timeout: 1000 }).toEqual({ enabled: true, mode: 'manual', url: manualProxyUrl })
  await expect(page.getByTestId('network-proxy-smart-button')).toBeVisible()
  await expect(page.getByTestId('network-proxy-status')).toContainText(manualProxyUrl)

  const state = await page.evaluate(async () => {
    globalThis.__proxyNativeCalls[0].resolve('http://127.0.0.1:7897')
    // Drain both the bridge and detector promise continuations before inspecting
    // the saved route. No timing sleeps or model traffic are needed.
    await new Promise(resolve => setTimeout(resolve, 0))
    const app = globalThis.__echoWeavePreview
    const setting = await app.services.repository.getSetting('networkProxy', null)
    return {
      mode: app.networkProxyMode,
      detectedUrl: app.networkProxyDetectedUrl,
      detecting: app.networkProxyDetecting,
      pending: app.services.networkProxy.getDetectionState().pending,
      route: await app.services.networkProxy.getProxyRoute(setting),
      calls: globalThis.__proxyNativeCalls.length
    }
  })
  expect(state).toEqual({
    mode: 'manual', detectedUrl: '', detecting: false, pending: false,
    route: { proxyUrl: manualProxyUrl, allowDirectFallback: false }, calls: 1
  })
  await expect(page.getByTestId('network-proxy-status')).toContainText(manualProxyUrl)
  await expect(page.getByTestId('network-proxy-status')).not.toContainText('7897')
  await expect(page.getByTestId('network-proxy-toggle')).toBeEnabled()
})
