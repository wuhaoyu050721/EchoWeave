import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('contacts wires the standalone world-book manager and import preview', async () => {
  const [page, contacts, manager, appServices] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/world-book-manager.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/create-app-services.js', import.meta.url), 'utf8')
  ])

  assert.match(contacts, /@click="\$emit\('manage-world-books'\)"/)
  assert.match(page, /@manage-world-books="openWorldBookManager"/)
  assert.match(page, /<WorldBookManager/)
  assert.match(page, /:repository="services\?\.repository"/)
  assert.match(page, /:world-books="worldBookItems"/)
  assert.match(page, /:characters="characterItems"/)
  assert.match(page, /@changed="handleWorldBookChanged"/)
  assert.match(page, /@import="openWorldBookPicker"/)

  assert.match(manager, /<text>导入<\/text>/)
  assert.match(manager, /<text>新建世界书<\/text>/)
  assert.match(manager, /beginCreate/)
  assert.match(manager, /saveWorldBook/)
  assert.match(manager, /deleteWorldBook/)
  assert.match(manager, /draft\.characterIds\.includes\(String\(characterId\)\)/)
  assert.match(manager, />指定角色<\/button>/)
  assert.match(manager, /createWorldBookManagementService/)

  assert.match(page, /accept="application\/json,\.json" @change="handleWorldBookSelection"/)
  assert.match(page, />导入世界书<\/text>/)
  assert.match(page, />所有角色<\/text>/)
  assert.match(page, />指定角色<\/text>/)
  assert.match(page, /worldBookSelectedCharacterIds\.includes\(character\.id\)/)
  assert.match(page, /commitWorldBookImport\(this\.worldBookImportPreview/)
  assert.match(page, /characterIds: this\.worldBookApplyToAll \? \[\] : this\.worldBookSelectedCharacterIds/)
  assert.match(page, /await syncProfileNameFromCloudSession\(this\.services\?\.repository, this\.cloudSession\)/)
  assert.match(page, /v-if="!message\.isGreeting" class="retry-action"/)
  assert.match(appServices, /nativeWorldBookPicker/)
})
