import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('Android hardware back is wired to layered in-app navigation', () => {
  assert.match(source, /onBackPress\(\)\s*\{\s*return this\.handleAppBack\(\)\s*\}/)

  const start = source.indexOf('\n\t\t\thandleAppBack() {')
  const end = source.indexOf('\n\t\t\ttoggleConversationSearch() {', start)
  const handler = source.slice(start, end)

  for (const transientState of [
    'attachmentPreview',
		'assistantStatusOpen',
    'profileAvatarMenuOpen',
    'cloudOpen',
    'backupMenuOpen',
    'worldBookImportPreview',
    'worldBookManagerOpen',
    'characterImportPreview',
    'modelMenuOpen',
    'attachmentMenuOpen',
    'emojiMenuOpen',
    'homeMenuOpen',
    'searchOpen',
    'settingsSearchOpen'
  ]) {
    assert.match(handler, new RegExp(`this\\.${transientState}`))
  }

  assert.match(handler, /resolveAppBackAction\(this\.ui\)/)
	assert.match(handler, /this\.characterDetailEditing = false/)
	assert.match(handler, /action === 'contacts'/)
	assert.match(handler, /this\.closeCharacterDetailsView\(\)/)
  assert.match(handler, /this\.backToConversations\(\)/)
  assert.match(handler, /this\.goToTab\('conversations'\)/)
  assert.match(handler, /return false/)
})
