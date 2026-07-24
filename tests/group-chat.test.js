import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GROUP_MEMBER_LIMIT,
  createGroupParticipant,
  createGroupProviderParticipant,
  groupParticipantKey,
  groupMentionQuery,
  groupStatusMessages,
  groupVisibleMessages,
  insertGroupMention,
  mentionedGroupParticipantIds,
  normalizeGroupParticipants,
  normalizeGroupReplyPolicy,
  selectGroupResponders
} from '../src/core/group-chat.js'

function participants() {
  return [
    { characterId: 'a', nameSnapshot: '苏墨', avatarAssetId: 'avatar-a', enabled: true },
    { characterId: 'b', nameSnapshot: '林夏', avatarAssetId: 'avatar-b', enabled: true },
    { characterId: 'c', nameSnapshot: '小障', avatarAssetId: 'avatar-c', enabled: true }
  ]
}

test('normalizes bounded group participants and creates stable character snapshots', () => {
  const created = createGroupParticipant({
    id: 'character-1',
    name: '苏墨',
    avatarAssetId: 'avatar-1'
  }, { joinedAt: '2026-07-23T00:00:00.000Z' })
  assert.deepEqual(created, {
    memberKind: 'character',
    characterId: 'character-1',
    nameSnapshot: '苏墨',
    avatarAssetId: 'avatar-1',
    enabled: true,
    joinedAt: '2026-07-23T00:00:00.000Z'
  })

  const source = Array.from({ length: GROUP_MEMBER_LIMIT + 3 }, (_, index) => ({
    characterId: `character-${index}`,
    nameSnapshot: `角色 ${index}`
  }))
  source.splice(2, 0, { characterId: 'character-1', nameSnapshot: '重复角色' })
  const normalized = normalizeGroupParticipants(source)
  assert.equal(normalized.length, GROUP_MEMBER_LIMIT)
  assert.equal(new Set(normalized.map(item => item.characterId)).size, GROUP_MEMBER_LIMIT)
})

test('mentions override reply policy and support full-width at signs', () => {
  const members = participants()
  assert.deepEqual(
    mentionedGroupParticipantIds('请 @林夏 和＠小障回答', members),
    ['character:b', 'character:c']
  )
  assert.deepEqual(mentionedGroupParticipantIds('请 @林 回答', [
    { characterId: 'short', nameSnapshot: '林' },
    { characterId: 'long', nameSnapshot: '林夏' }
  ]), ['character:short'])
  assert.deepEqual(mentionedGroupParticipantIds('请 @林夏回答', [
    { characterId: 'short', nameSnapshot: '林' },
    { characterId: 'long', nameSnapshot: '林夏' }
  ]), ['character:long'])
  assert.deepEqual(
    selectGroupResponders({
      conversation: { participants: members, replyPolicy: { mode: 'round-robin', respondersPerTurn: 2 } },
      content: '@小障 你怎么看'
    }).map(item => item.characterId),
    ['c']
  )
})

test('keeps character and provider members distinct and rotates across both kinds', () => {
  const provider = createGroupProviderParticipant({
    id: 'shared-id',
    name: 'DeepSeek 接口',
    defaultModel: 'deepseek-chat',
    logo: '/static/providers/deepseek.png'
  })
  const members = normalizeGroupParticipants([
    { characterId: 'shared-id', nameSnapshot: '同名角色' },
    provider
  ])

  assert.deepEqual(members.map(groupParticipantKey), ['character:shared-id', 'provider:shared-id'])
  assert.equal(provider.memberKind, 'provider')
  assert.equal(provider.modelName, 'deepseek-chat')
  assert.deepEqual(
    selectGroupResponders({
      conversation: {
        participants: members,
        replyPolicy: { mode: 'round-robin', respondersPerTurn: 1 }
      },
      messages: [{ role: 'assistant', speakerCharacterId: 'shared-id' }]
    }).map(groupParticipantKey),
    ['provider:shared-id']
  )
})

test('round robin continues after the latest speaker while all and mention-only remain deterministic', () => {
  const members = participants()
  const messages = [
    { role: 'assistant', speakerCharacterId: 'a', sequence: 1 },
    { role: 'assistant', speakerCharacterId: 'b', sequence: 2 }
  ]
  assert.deepEqual(
    selectGroupResponders({
      conversation: { participants: members, replyPolicy: { mode: 'round-robin', respondersPerTurn: 2 } },
      messages
    }).map(item => item.characterId),
    ['c', 'a']
  )
  assert.deepEqual(
    selectGroupResponders({
      conversation: { participants: members, replyPolicy: { mode: 'all' } },
      messages
    }).map(item => item.characterId),
    ['a', 'b', 'c']
  )
  assert.deepEqual(
    selectGroupResponders({
      conversation: { participants: members, replyPolicy: { mode: 'mention' } },
      messages
    }),
    []
  )
  assert.deepEqual(normalizeGroupReplyPolicy({ respondersPerTurn: 99 }, 3), {
    mode: 'round-robin',
    respondersPerTurn: 3,
    autoHandoff: true
  })
  assert.deepEqual(normalizeGroupReplyPolicy({ mode: 'mention', autoHandoff: false }, 3), {
    mode: 'mention',
    respondersPerTurn: 2,
    autoHandoff: false
  })
})

test('group history labels speakers while removing their private status blocks', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '大家好' },
    {
      id: 'a1',
      role: 'assistant',
      speakerCharacterId: 'a',
      speakerNameSnapshot: '苏墨',
      content: '你好。\n<sumo_monitor><status>[当前状态|平静]</status></sumo_monitor>'
    },
    {
      id: 'a2',
      role: 'assistant',
      speakerCharacterId: 'b',
      speakerNameSnapshot: '林夏',
      content: '晚上好。'
    }
  ]
  const visible = groupVisibleMessages(messages, { userName: '小明' })

  assert.equal(visible[0].content, '小明：大家好')
  assert.equal(visible[1].content, '苏墨：你好。')
  assert.equal(visible[2].content, '林夏：晚上好。')
  assert.doesNotMatch(visible[1].content, /sumo_monitor/)
  assert.deepEqual(groupStatusMessages(messages, 'a').map(message => message.id), ['a1'])
  assert.deepEqual(groupStatusMessages(messages, 'b').map(message => message.id), ['a2'])
})

test('mention query and insertion replace only the active composer token', () => {
  assert.equal(groupMentionQuery('你好 @苏'), '苏')
  assert.equal(groupMentionQuery('你好'), null)
  assert.equal(insertGroupMention('你好 @苏', '苏墨'), '你好 @苏墨 ')
  assert.equal(insertGroupMention('你好', '林夏'), '你好 @林夏 ')
})
