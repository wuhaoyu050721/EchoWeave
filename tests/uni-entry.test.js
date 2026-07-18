import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('uni-app entry imports the Vue application with an explicit extension', async () => {
  const source = await readFile(new URL('../main.js', import.meta.url), 'utf8')

  assert.match(source, /import App from ['"]\.\/App\.vue['"]/)
})
