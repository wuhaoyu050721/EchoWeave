import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
const editor = await readFile(new URL('../src/components/group-chat-editor.vue', import.meta.url), 'utf8')
const avatar = await readFile(new URL('../src/components/group-avatar.vue', import.meta.url), 'utf8')
const dialog = await readFile(new URL('../src/components/app-dialog-layer.vue', import.meta.url), 'utf8')

test('conversation UI exposes group creation, editing, avatars, mentions, and speaker identity', () => {
  assert.match(page, /createGroupConversationFromMenu/)
  assert.match(page, /ui\.screen === 'group-editor'/)
  assert.match(page, /<GroupChatEditor/)
  assert.match(page, /<GroupAvatar v-if="isGroupChat\(conversation\)"/)
  assert.match(page, /messageAssistantAvatar\(message\)/)
  assert.match(page, /messageAssistantName\(message\)/)
  assert.match(page, /groupMentionSuggestions/)
  assert.match(page, /selectGroupMention\(participant\)/)
  assert.match(page, /groupStatusParticipants/)
  assert.match(page, /autoHandoffLimitReached/)
  assert.match(dialog, /conversation-group-settings-action/)
})

test('group editor enforces the member bound and exposes reply policies plus automatic handoff', () => {
  assert.match(editor, /selectedKeys\.length >= 2/)
  assert.match(editor, /selectedKeys\.length <= 8/)
  assert.match(editor, /memberTab === 'characters'/)
  assert.match(editor, /memberTab === 'providers'/)
  assert.match(editor, /providerProfileId/)
  assert.match(editor, /providerSubtitle/)
  assert.match(editor, /id: 'round-robin'/)
  assert.match(editor, /id: 'all'/)
  assert.match(editor, /id: 'mention'/)
  assert.match(editor, /respondersPerTurn/)
  assert.match(editor, /class="group-auto-handoff"/)
  assert.match(editor, /role="switch"/)
  assert.match(editor, /autoHandoff: true/)
  assert.match(editor, /autoHandoff: this\.autoHandoff/)
  assert.match(avatar, /slice\(0, 4\)/)
  assert.match(avatar, /groupParticipantKey/)
  assert.match(page, /group-status-participant-avatar/)
})
