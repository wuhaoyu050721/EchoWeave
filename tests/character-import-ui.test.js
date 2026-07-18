import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('contacts groups character actions behind one animated add menu', async () => {
  const [page, contacts] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8')
  ])

  assert.match(contacts, /\$emit\('import-character-gallery'\)/)
  assert.match(contacts, /\$emit\('import-character-file'\)/)
  assert.match(contacts, /class="contacts-add-toggle"/)
  assert.match(contacts, />添加</)
  assert.match(contacts, /class="contacts-add-menu"/)
  assert.match(contacts, /addMenuOpen/)
  assert.match(contacts, />相册导入</)
  assert.match(contacts, />文件导入</)
  assert.match(contacts, /contacts-add-option:nth-child\(3\)/)
  assert.match(contacts, /prefers-reduced-motion: reduce/)
  assert.match(page, /@import-character-gallery="openCharacterCardPicker\('gallery'\)"/)
  assert.match(page, /@import-character-file="openCharacterCardPicker\('file'\)"/)
  assert.match(page, /nativeCharacterCardPicker\.pick\(source\)/)
})

test('contact rows open character details instead of immediately creating a chat', async () => {
  const [page, contacts] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8')
  ])

  assert.match(contacts, /\$emit\('open-character-details', character\)/)
  assert.match(contacts, /查看角色卡 \$\{character\.name\}/)
  assert.doesNotMatch(contacts, /\$emit\('open-character', character\)/)
  assert.match(page, /@open-character-details="openCharacterDetailsView"/)
  assert.doesNotMatch(page, /@open-character="startCharacterChat"/)
})

test('contacts can open a blank custom character editor without importing a file', async () => {
  const [page, contacts] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8')
  ])

  assert.match(contacts, /aria-label="新建自定义角色"/)
  assert.match(contacts, /\$emit\('create-character'\)/)
  assert.match(page, /@create-character="openCustomCharacterEditor"/)
  assert.match(page, /customCharacterDraft: null/)
  assert.match(page, /const draft = createCustomCharacter\(\)/)
  assert.match(page, /this\.customCharacterDraft = null/)
  assert.match(page, /creating \? '角色已创建' : '角色卡已保存'/)
})
