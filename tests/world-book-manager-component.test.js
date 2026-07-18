import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

test('world-book manager SFC compiles and exposes its integration contract', async () => {
  const source = await readFile(new URL('../src/components/world-book-manager.vue', import.meta.url), 'utf8')
  const parsed = parse(source, { filename: 'world-book-manager.vue' })
  assert.deepEqual(parsed.errors, [])
  const descriptor = parsed.descriptor
  assert.ok(descriptor.template)
  assert.ok(descriptor.script)
  assert.ok(descriptor.styles.some(style => style.scoped))

  assert.doesNotThrow(() => compileScript(descriptor, { id: 'world-book-manager' }))
  const template = compileTemplate({
    source: descriptor.template.content,
    filename: 'world-book-manager.vue',
    id: 'world-book-manager',
    compilerOptions: {
      isCustomElement: tag => ['view', 'text', 'scroll-view', 'picker'].includes(tag)
    }
  })
  assert.deepEqual(template.errors, [])

  const script = descriptor.script.content
  for (const prop of ['open', 'repository', 'worldBooks', 'characters', 'busy']) {
    assert.match(script, new RegExp(`\\b${prop}: \\{ type:`), `missing prop ${prop}`)
  }
  assert.match(script, /emits: \['changed', 'close', 'error', 'import', 'update:open', 'update:worldBooks'\]/)
  assert.match(script, /createWorldBookManagementService\(\{ repository: this\.repository \}\)/)
  assert.match(script, /service\.update\(this\.editingId, input\)/)
  assert.match(script, /service\.create\(input\)/)
  assert.match(script, /managementService\(\)\.remove\(this\.editingId\)/)
})

test('world-book manager template includes the complete editable field and interaction contract', async () => {
  const source = await readFile(new URL('../src/components/world-book-manager.vue', import.meta.url), 'utf8')

  for (const label of ['名称', '描述', '扫描深度', 'Token 预算', '规则名称', '关键词', '内容', '启用', '常驻', '顺序', '位置']) {
    assert.match(source, new RegExp(label), `missing field label ${label}`)
  }
  assert.match(source, /draft\.bindingMode === 'global'/)
  assert.match(source, /draft\.bindingMode === 'characters'/)
  assert.match(source, /v-model="rule\.comment"/)
  assert.match(source, /toggleCharacter\(character\.id\)/)
  assert.match(source, /role="switch"/)
  assert.match(source, /<picker[^>]+:range="positionOptions"/)
  assert.match(source, /deleteWorldBook/)
  assert.match(source, /<Trash2/)
  assert.match(source, /<ProviderLogo/)
  assert.match(source, /env\(safe-area-inset-bottom\)/)
  assert.match(source, /max-width: 560px/)
  assert.match(source, /@media \(max-width: 380px\)/)
})
