import { createBrowserServices, createBrowserWorkspaceManager } from './create-browser-services.js'
import { createAppServices, createAppWorkspaceManager } from './create-app-services.js'

function currentRuntime() {
  return {
    plus: typeof plus === 'undefined' ? globalThis.plus : plus,
    uni: typeof uni === 'undefined' ? globalThis.uni : uni
  }
}

function hasAppRuntime(runtime) {
  return Boolean(runtime?.plus?.sqlite && typeof runtime?.uni?.request === 'function')
}

export async function waitForAppRuntime({
  readRuntime = currentRuntime,
  timeoutMs = 5000,
  intervalMs = 50,
  delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs))
  let runtime = readRuntime()
  for (let attempt = 0; attempt < attempts && !hasAppRuntime(runtime); attempt += 1) {
    await delay(intervalMs)
    runtime = readRuntime()
  }
  return runtime
}

function assertAppRuntime(runtime) {
  if (!runtime?.plus?.sqlite) {
    throw new Error('当前安装包未包含 SQLite 模块，请在 manifest.json 中启用 SQLite 后重新打包安装')
  }
  if (typeof runtime?.uni?.request !== 'function') {
    throw new Error('当前安装包缺少 uni.request 网络能力，请重新打包安装')
  }
}

export async function createPlatformServices({
  runtime = currentRuntime(),
  isPackagedApp = Boolean(globalThis.__aiChatPackagedApp || globalThis.__aiChatNativeApis),
  createBrowser = createBrowserServices,
  loadApp = async () => ({ createAppServices }),
  waitForRuntime = waitForAppRuntime
} = {}) {
  const appRuntimeExpected = isPackagedApp || Boolean(runtime?.plus)
  if (!appRuntimeExpected) return createBrowser()

  if (!runtime?.plus) runtime = await waitForRuntime()
  assertAppRuntime(runtime)

  const { createAppServices } = await loadApp()
  return createAppServices({ plusApi: runtime.plus, uniApi: runtime.uni })
}

export async function createPlatformWorkspaceManager({
  runtime = currentRuntime(),
  isPackagedApp = Boolean(globalThis.__aiChatPackagedApp || globalThis.__aiChatNativeApis),
  createBrowserManager = createBrowserWorkspaceManager,
  createAppManager = createAppWorkspaceManager,
  waitForRuntime = waitForAppRuntime,
  ...managerOptions
} = {}) {
  const appRuntimeExpected = isPackagedApp || Boolean(runtime?.plus)
  if (!appRuntimeExpected) return createBrowserManager(managerOptions)

  if (!runtime?.plus) runtime = await waitForRuntime()
  assertAppRuntime(runtime)
  return createAppManager({
    ...managerOptions,
    plusApi: runtime.plus,
    uniApi: runtime.uni
  })
}
