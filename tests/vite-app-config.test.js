import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('browser-only Vite config does not override the HBuilderX app compiler', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

  assert.equal(existsSync(new URL('../vite.config.js', import.meta.url)), false)
  assert.equal(packageJson.scripts.dev, 'vite --config vite.browser.config.js')
  assert.equal(packageJson.scripts.build, 'vite build --config vite.browser.config.js')
})

test('browser preview keeps its dedicated entry point and proxy', async () => {
  const { default: config } = await import(`../vite.browser.config.js?browser=${Date.now()}`)

  assert.equal(config.build.rollupOptions.input, 'preview/index.html')
  assert.equal(config.plugins.some((plugin) => plugin?.name === 'local-ai-proxy'), true)
})
