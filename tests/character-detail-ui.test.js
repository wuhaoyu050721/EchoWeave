import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [page, detail] = await Promise.all([
  readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/character-detail.vue', import.meta.url), 'utf8')
])

test('character detail has view, edit, save and new-chat states', () => {
  assert.match(page, /ui\.screen === 'character-detail'/)
  assert.match(page, /:character="selectedCharacter"/)
  assert.match(page, /@save="saveCharacterDetails"/)
  assert.match(page, /@new-chat="startCharacterChatFromDetails"/)
  assert.match(page, /repository\.saveCharacter\(updated\)/)
  assert.match(detail, /data-testid="character-detail"/)
	assert.match(detail, /'角色卡详情'/)
  assert.match(detail, />新建聊天</)
	assert.match(detail, /保存角色卡/)
	assert.match(detail, /creating \? '新建角色' : '角色卡详情'/)
	assert.match(detail, /creating \? '创建角色' : '保存角色卡'/)
})

test('custom-character avatar selection is staged and persisted with creation', () => {
  assert.match(page, /customCharacterAvatar:\s*null/)
  assert.match(page, /nativeAttachmentPicker\.pick\(source === 'gallery' \? 'image' : 'image-file'/)
  assert.match(page, /this\.customCharacterDraft = \{ \.\.\.this\.customCharacterDraft, avatarDataUrl: avatar\.dataUrl \}/)
  assert.match(page, /createCharacter\(updated, \{ avatar: this\.customCharacterAvatar \}\)/)
})

test('Android character-card PNG export writes original bytes to Downloads', () => {
  assert.match(page, /exportBytesToDownloads\(\{ plusApi, fileName: exported\.fileName, bytes: exported\.bytes, mimeType: exported\.mimeType \}\)/)
  const exportBlock = page.slice(page.indexOf('async exportCharacterPng'), page.indexOf('async deleteCharacterFromDetails'))
  assert.doesNotMatch(exportBlock, /saveImageToPhotoAlbum/)
})

test('character editor exposes the main V3 character fields', () => {
  for (const field of [
    'editForm.name',
    'editForm.nickname',
    'editForm.creator',
    'editForm.tagsText',
    'editForm.description',
    'editForm.personality',
    'editForm.scenario',
    'editForm.firstMessage',
    'editForm.alternateGreetings',
    'editForm.messageExample',
    'editForm.systemPrompt',
    'editForm.postHistoryInstructions',
    'editForm.creatorNotes'
  ]) {
    assert.match(detail, new RegExp(field.replace('.', '\\.')))
  }
})

test('character detail hides the bottom navigation while open', () => {
  assert.match(page, /ui\.screen !== 'chat' && ui\.screen !== 'character-detail'/)
})
