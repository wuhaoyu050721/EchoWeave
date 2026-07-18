import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const detail = await readFile(new URL('../src/components/character-detail.vue', import.meta.url), 'utf8')

test('character edit mode exposes explicit gallery and file avatar request contracts', () => {
  assert.match(detail, /requestAvatarChange\('gallery'\)/)
  assert.match(detail, /requestAvatarChange\('file'\)/)
	assert.match(detail, /\$emit\(CHARACTER_MANAGEMENT_EVENTS\.requestAvatarChange, \{ characterId: this\.character\.id, source \}\)/)
  assert.match(detail, /'request-avatar-change': payload => \['gallery', 'file'\]\.includes\(payload\?\.source\)/)
  assert.match(detail, />相册</)
  assert.match(detail, />文件</)
})

test('character details expose JSON, PNG, and confirmed delete management events', () => {
  assert.match(detail, /emitCharacterAction\('export-json'\)/)
  assert.match(detail, /emitCharacterAction\('export-png'\)/)
	assert.match(detail, /\$emit\(CHARACTER_MANAGEMENT_EVENTS\.deleteCharacter, \{ characterId: this\.character\.id \}\)/)
  assert.match(detail, /role="dialog"/)
  assert.match(detail, /aria-label="确认删除角色"/)
  assert.match(detail, /已有会话会保留并解除角色绑定/)
  assert.match(detail, />确认删除</)
})
