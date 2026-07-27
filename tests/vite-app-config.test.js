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

test('browser preview keeps its dedicated entry point, proxy, and static assets', async () => {
  const { default: config } = await import(`../vite.browser.config.js?browser=${Date.now()}`)

  assert.equal(config.build.rollupOptions.input, 'preview/index.html')
  assert.equal(config.plugins.some((plugin) => plugin?.name === 'browser-entry-redirect'), true)
  assert.equal(config.plugins.some((plugin) => plugin?.name === 'local-ai-proxy'), true)
  assert.equal(config.plugins.some((plugin) => plugin?.name === 'copy-static-assets'), true)
})

test('browser preview redirects root requests without intercepting preview assets', async () => {
  const { default: config } = await import(`../vite.browser.config.js?redirect=${Date.now()}`)
  const plugin = config.plugins.find((candidate) => candidate?.name === 'browser-entry-redirect')
  const middlewares = []
  plugin.configureServer({
    middlewares: {
      use(middleware) {
        middlewares.push(middleware)
      }
    }
  })

  let location = ''
  let ended = false
  middlewares[0](
    { url: '/?mode=compact' },
    {
      statusCode: 200,
      setHeader(name, value) {
        if (name === 'Location') location = value
      },
      end() {
        ended = true
      }
    },
    () => assert.fail('root request should redirect')
  )

  assert.equal(location, '/preview/?mode=compact')
  assert.equal(ended, true)

  let continued = false
  middlewares[0](
    { url: '/preview/main.js' },
    {},
    () => {
      continued = true
    }
  )
  assert.equal(continued, true)
})
