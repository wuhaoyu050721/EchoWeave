import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'

import { createChatInstructionResolver } from '../src/app/create-character-instructions.js'
import { createBackup, prepareImport } from '../src/core/backup-format.js'
import { DEFAULT_CHARACTER_AVATAR_DATA_URL, exportCharacterCardPng } from '../src/features/character-management.js'
import { commitCharacterImport, commitCharacterUpdate, inspectCharacterCard } from '../src/features/character-import/importCharacterCard.js'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

const CREATED_AT = '2026-10-01T00:00:00.000Z'
const UPDATED_AT = '2026-10-07T00:00:00.000Z'

function ids(prefix) {
  let next = 0
  return () => `${prefix}-${++next}`
}

function bookData(content) {
  return {
    name: content,
    extensions: {},
    entries: [{ keys: [], content, extensions: {}, enabled: true, insertion_order: 1, constant: true, position: 'before_char' }]
  }
}

async function previewFor({ name = '更新后的角色', description = 'NEW_CHARACTER_INSTRUCTIONS', lore = 'NEW_EMBEDDED_LORE', sensitive = false, bytes = 'Ag==' } = {}) {
  const card = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name, description, personality: 'New personality', scenario: 'New scenario', first_mes: '新的开场白不会插入旧聊天',
      mes_example: '', creator_notes: '', system_prompt: 'Follow the updated role.', post_history_instructions: '',
      alternate_greetings: ['另一个新开场白'], group_only_greetings: [], tags: ['updated'], creator: '卡片作者', character_version: '2',
      extensions: sensitive ? { regex_scripts: [{ scriptName: 'disabled-test' }] } : {},
      assets: [{ type: 'emotion', name: 'smile', uri: '__asset:smile.png', ext: 'png' }],
      ...(lore === null ? {} : { character_book: bookData(lore) })
    }
  }
  const exported = await exportCharacterCardPng({
    id: 'file-only-character', name, card, avatarDataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL,
    assetIds: ['file-only-emotion'], worldBookIds: []
  }, {
    characterAssets: [{
      id: 'file-only-emotion', characterId: 'file-only-character', type: 'emotion', name: 'smile', ext: 'png',
      uri: '__asset:smile.png', chunkKey: 'smile.png', source: 'embedded', dataUrl: `data:image/png;base64,${bytes}`
    }]
  })
  return inspectCharacterCard({ name: exported.fileName, arrayBuffer: async () => exported.bytes })
}

async function openRepository(kind, context) {
  const databaseName = `character-update-${crypto.randomUUID()}`
  const sqlite = kind === 'SQLite' ? createNodePlusSqlite({ persistOnClose: true }) : null
  const repository = sqlite
    ? new PlusSqliteRepository({ sqlite, databaseName, databasePath: '_doc/character-update-tests.db' })
    : new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName })
  await repository.init()
  context.after(async () => {
    await repository.close()
    sqlite?.closeAll()
  })
  return { repository, sqlite }
}

async function seed(repository) {
  const imported = await commitCharacterImport(await previewFor({
    name: '原角色', description: 'OLD_CHARACTER_INSTRUCTIONS', lore: 'OLD_EMBEDDED_LORE', bytes: 'AQ=='
  }), { repository, idFactory: ids('original'), now: () => CREATED_AT })
  const original = imported.character
  const patches = [{ id: 'memory-patch', field: 'relationship_memory', content: 'STORY_MEMORY_TO_KEEP', sourceMessageId: 'story-assistant', createdAt: CREATED_AT }]
  const preservedBooks = [
    { id: 'manual-book', source: 'manual', scope: 'global', characterId: null, characterIds: [original.id], data: bookData('MANUAL_LORE_TO_KEEP') },
    { id: 'shared-card-book', source: 'character-card', scope: 'global', characterId: null, characterIds: [original.id, 'other-character'], data: bookData('SHARED_LORE_TO_KEEP') },
    { id: 'story-memory-book', source: 'story-auto', scope: 'story', conversationId: 'story', characterId: null, characterIds: [original.id], data: bookData('STORY_LORE_TO_KEEP') },
    { id: 'global-card-book', source: 'character-card', scope: 'global', characterId: null, characterIds: [], data: bookData('GLOBAL_LORE_TO_KEEP') }
  ].map(book => ({ ...book, name: book.id, createdAt: CREATED_AT, updatedAt: CREATED_AT, deletedAt: null }))
  const character = {
    ...original,
    cloudBackupAllowed: false, storyScope: 'story', storyImportedAt: CREATED_AT, storyMemoryPatches: patches,
    localPreference: { favorite: true },
    worldBookIds: [...original.worldBookIds, ...preservedBooks.map(book => book.id)],
    card: { ...original.card, data: { ...original.card.data, extensions: { ...original.card.data.extensions, echoWeaveStoryPatches: patches } } }
  }
  const baseConversation = { characterId: character.id, characterNameSnapshot: character.name, characterAvatarAssetId: character.avatarAssetId, createdAt: CREATED_AT, updatedAt: CREATED_AT, lastMessageAt: CREATED_AT, deletedAt: null }
  const conversations = [
    { ...baseConversation, id: 'ordinary', title: '用户自定义的聊天标题', conversationKind: 'chat', providerProfileId: 'provider', modelName: 'fixture-model' },
    { ...baseConversation, id: 'group', title: '原来的群聊', conversationKind: 'group', characterId: null, participants: [
      { memberKind: 'character', characterId: character.id, nameSnapshot: character.name, avatarAssetId: character.avatarAssetId, enabled: false },
      { memberKind: 'character', characterId: 'other-character', nameSnapshot: '另一个成员', enabled: true }
    ], replyPolicy: { autoHandoff: false } },
    { ...baseConversation, id: 'story', title: '已经进行很久的故事', conversationKind: 'story', storyConfig: {
      characterIds: [character.id], worldBookIds: ['story-memory-book'], memoryWorldBookId: 'story-memory-book', readingPosition: { messageId: 'story-assistant', offset: 57 }
    } }
  ]
  const messages = conversations.flatMap(conversation => ['user', 'assistant'].map((role, index) => ({
    id: `${conversation.id}-${role}`, conversationId: conversation.id, role, sequence: index + 1,
    content: `${conversation.id} ${role} 原文保留，不得重新生成`, status: 'completed', createdAt: CREATED_AT, updatedAt: CREATED_AT, deletedAt: null,
    speakerCharacterId: role === 'assistant' ? character.id : null,
    speakerNameSnapshot: role === 'assistant' ? character.name : null,
    speakerAvatarAssetId: role === 'assistant' ? character.avatarAssetId : null,
    attachmentIds: conversation.id === 'ordinary' && role === 'user' ? ['attachment'] : []
  })))
  await repository.importRecords({
    characters: [character, { id: 'other-character', name: '另一个成员', worldBookIds: ['shared-card-book'], createdAt: CREATED_AT, updatedAt: CREATED_AT, deletedAt: null }],
    worldBooks: preservedBooks, conversations, messages,
    attachments: [{ id: 'attachment', kind: 'image', conversationId: 'ordinary', messageId: 'ordinary-user', createdAt: CREATED_AT, dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL }]
  })
  return { character, embeddedBookId: original.worldBookIds[0], preservedBooks }
}

function update(preview, repository, character, options = {}) {
  return commitCharacterUpdate(preview, {
    repository, characterId: character.id, idFactory: ids('updated'), now: () => UPDATED_AT, ...options
  })
}

for (const kind of ['IndexedDB', 'SQLite']) {
  test(`${kind}: updating a card preserves every conversation, message, attachment and story memory across reopen`, async context => {
    const { repository } = await openRepository(kind, context)
    const { character, preservedBooks, embeddedBookId } = await seed(repository)
    const before = await repository.readBackupData()
    const preview = await previewFor()
    const result = await update(preview, repository, character, { expectedCharacter: character })
    assert.equal(result.character.id, character.id)
    await repository.close()
    await repository.init()
    const after = await repository.readBackupData()
    assert.equal(after.characters.length, before.characters.length)
    for (const key of ['conversations', 'messages', 'attachments']) assert.deepEqual(after[key], before[key], key)
    const stored = await repository.getCharacter(character.id)
    assert.equal(stored.name, preview.character.name)
    assert.equal(stored.description, 'NEW_CHARACTER_INSTRUCTIONS')
    assert.equal(stored.sourceHash, preview.source.hash)
    for (const key of ['id', 'createdAt', 'importedAt', 'storyScope', 'storyImportedAt', 'cloudBackupAllowed', 'storyMemoryPatches', 'localPreference']) {
      assert.deepEqual(stored[key], character[key], key)
    }
    assert.deepEqual(stored.card.data.extensions.echoWeaveStoryPatches, character.storyMemoryPatches)
    assert.equal(stored.updatedAt, UPDATED_AT)
    assert.equal(stored.card.data.first_mes, preview.cardV3.data.first_mes)
    assert.notEqual(stored.avatarAssetId, character.avatarAssetId)
    assert.ok(stored.assetIds.every(id => !character.assetIds.includes(id)))
    for (const asset of before.characterAssets) assert.deepEqual(await repository.getCharacterAsset(asset.id), asset)
    for (const book of preservedBooks) assert.deepEqual(await repository.getWorldBook(book.id), book)
    const ownedBook = await repository.getWorldBook(embeddedBookId)
    assert.equal(ownedBook.id, embeddedBookId)
    assert.equal(ownedBook.data.entries[0].content, 'NEW_EMBEDDED_LORE')
    assert.equal(ownedBook.createdAt, CREATED_AT)
    assert.deepEqual(await repository.getCharacter('other-character'), before.characters.find(item => item.id === 'other-character'))
  })

  test(`${kind}: the next ordinary, group and story prompts use updated settings without old embedded lore`, async context => {
    const { repository } = await openRepository(kind, context)
    const { character } = await seed(repository)
    const resolve = createChatInstructionResolver({ repository, vault: { decryptString: async value => value }, getUserName: async () => '测试用户' })
    const ordinary = await repository.getConversation('ordinary')
    assert.match(JSON.stringify(await resolve(ordinary)), /OLD_CHARACTER_INSTRUCTIONS/)
    await update(await previewFor(), repository, character)
    for (const conversationId of ['ordinary', 'group', 'story']) {
      const prompt = JSON.stringify(await resolve(await repository.getConversation(conversationId), { speakerCharacterId: character.id }))
      assert.match(prompt, /NEW_CHARACTER_INSTRUCTIONS/, conversationId)
      assert.match(prompt, /NEW_EMBEDDED_LORE/, conversationId)
      assert.doesNotMatch(prompt, /OLD_CHARACTER_INSTRUCTIONS|OLD_EMBEDDED_LORE/, conversationId)
      assert.match(prompt, /MANUAL_LORE_TO_KEEP|SHARED_LORE_TO_KEEP/, conversationId)
      if (conversationId === 'story') assert.match(prompt, /STORY_MEMORY_TO_KEEP|STORY_LORE_TO_KEEP/)
    }
  })

  test(`${kind}: updating preserves private-book settings and removing card lore only retires its private book`, async context => {
    const { repository } = await openRepository(kind, context)
    const { character, preservedBooks, embeddedBookId } = await seed(repository)
    const oldBook = await repository.getWorldBook(embeddedBookId)
    await repository.saveWorldBook({ ...oldBook, enabled: false, scope: 'story', conversationId: null, localNote: '保留本地开关' })
    await update(await previewFor(), repository, character)
    const replaced = await repository.getWorldBook(embeddedBookId)
    assert.equal(replaced.enabled, false)
    assert.equal(replaced.scope, 'story')
    assert.equal(replaced.localNote, '保留本地开关')
    const story = await repository.getConversation('story')
    const explicitlyLinkedStory = { ...story, storyConfig: { ...story.storyConfig, worldBookIds: [...story.storyConfig.worldBookIds, embeddedBookId] } }
    await repository.saveConversation(explicitlyLinkedStory)
    const latest = await repository.getCharacter(character.id)
    await update(await previewFor({ lore: null }), repository, latest, { idFactory: ids('without-book') })
    const stored = await repository.getCharacter(character.id)
    assert.ok(!stored.worldBookIds.includes(embeddedBookId))
    const retired = await repository.getWorldBook(embeddedBookId)
    assert.equal(retired.deletedAt, null)
    assert.equal(retired.characterId, null)
    assert.deepEqual(retired.characterIds, [])
    assert.equal(retired.scope, 'story')
    assert.equal(retired.conversationId, null)
    assert.deepEqual(retired.data, replaced.data)
    assert.ok(!(await repository.listWorldBooks({ characterId: character.id, includeGlobal: true })).some(book => book.id === embeddedBookId))
    assert.deepEqual(await repository.getConversation('story'), explicitlyLinkedStory)
    for (const book of preservedBooks) {
      assert.deepEqual(await repository.getWorldBook(book.id), book)
      assert.ok(stored.worldBookIds.includes(book.id))
    }
    const prepared = prepareImport(createBackup(await repository.readBackupData(), new Date(UPDATED_AT)), ids('restored'))
    const restoredStory = prepared.conversations.find(conversation => conversation.conversationKind === 'story')
    const restoredBook = prepared.worldBooks.find(book => book.source === 'character-card' && book.scope === 'story' && !book.characterId)
    assert.ok(restoredBook, 'Retired book must be included in a restorable backup')
    assert.ok(restoredStory.storyConfig.worldBookIds.includes(restoredBook.id))
    assert.equal(restoredBook.data.entries[0].content, 'NEW_EMBEDDED_LORE')
    const resolve = createChatInstructionResolver({ repository, vault: { decryptString: async value => value }, getUserName: async () => '测试用户' })
    assert.doesNotMatch(JSON.stringify(await resolve(await repository.getConversation('ordinary'))), /NEW_EMBEDDED_LORE|OLD_EMBEDDED_LORE/)
  })

  test(`${kind}: exporting the updated PNG uses the new bytes when historical assets have the same resource name`, async context => {
    const { repository } = await openRepository(kind, context)
    const { character } = await seed(repository)
    await update(await previewFor(), repository, character)
    const stored = await repository.getCharacter(character.id)
    const exported = await exportCharacterCardPng(stored, { repository })
    const inspected = await inspectCharacterCard({ name: exported.fileName, arrayBuffer: async () => exported.bytes })
    const emotion = inspected.commitData.assets.find(asset => asset.name === 'smile')
    assert.equal(emotion.dataUrl, 'data:image/png;base64,Ag==')
    assert.equal(inspected.character.name, '更新后的角色')
    assert.match(JSON.stringify(inspected.cardV3.data.character_book), /NEW_EMBEDDED_LORE/)
    assert.doesNotMatch(JSON.stringify(inspected.cardV3.data.character_book), /OLD_EMBEDDED_LORE/)
    const oldAsset = (await repository.listCharacterAssets(character.id)).find(asset => character.assetIds.includes(asset.id) && asset.name === 'smile')
    assert.equal(oldAsset.dataUrl, 'data:image/png;base64,AQ==')
  })

  test(`${kind}: sensitive extension confirmation, missing and deleted targets never alter stored records`, async context => {
    const { repository } = await openRepository(kind, context)
    const { character } = await seed(repository)
    const sensitive = await previewFor({ sensitive: true })
    assert.equal(sensitive.requiresSensitiveExtensionConfirmation, true)
    const before = await repository.readBackupData()
    await assert.rejects(update(sensitive, repository, character), error => error.code === 'sensitive_extension_confirmation_required')
    await assert.rejects(update(await previewFor(), repository, { id: 'missing-character' }), error => error.code === 'character_not_found')
    assert.deepEqual(await repository.readBackupData(), before)
    await repository.saveCharacter({ ...character, deletedAt: UPDATED_AT })
    const afterDelete = await repository.readBackupData()
    await assert.rejects(update(await previewFor(), repository, character), error => error.code === 'character_not_found')
    assert.deepEqual(await repository.readBackupData(), afterDelete)
    assert.equal((await repository.getCharacter(character.id)).deletedAt, UPDATED_AT)
    await repository.saveCharacter(character)
    await update(sensitive, repository, character, { allowSensitiveExtensions: true })
    assert.equal((await repository.getCharacter(character.id)).name, sensitive.character.name)
  })

  test(`${kind}: stale previews and a concurrent story-memory write are rejected without clobbering the newer state`, async context => {
    const { repository } = await openRepository(kind, context)
    const { character } = await seed(repository)
    const preview = await previewFor()
    const edited = { ...character, description: '最新的本地修改', updatedAt: '2026-10-06T00:00:00.000Z' }
    await repository.saveCharacter(edited)
    const beforeStale = await repository.readBackupData()
    await assert.rejects(update(preview, repository, character, { expectedCharacter: character }), error => error.code === 'character_update_conflict')
    assert.deepEqual(await repository.readBackupData(), beforeStale)
    const originalCommit = repository.importRecordsIfUnchanged.bind(repository)
    const newest = { ...edited, storyMemoryPatches: [...edited.storyMemoryPatches, { id: 'concurrent-memory', content: '生成刚刚完成的记忆' }] }
    let beforeConcurrentCommit
    repository.importRecordsIfUnchanged = async options => {
      await repository.saveCharacter(newest)
      beforeConcurrentCommit = await repository.readBackupData()
      return originalCommit(options)
    }
    await assert.rejects(update(preview, repository, edited), error => error.code === 'character_update_conflict')
    assert.ok(beforeConcurrentCommit, 'The update must use the repository transaction that checks the current snapshot')
    assert.deepEqual(await repository.readBackupData(), beforeConcurrentCommit)
    assert.deepEqual(await repository.getCharacter(character.id), newest)
  })

  for (const [change, mutate] of [
    ['content', book => ({ ...book, data: bookData('同时编辑的世界书正文') })],
    ['enabled setting', book => ({ ...book, enabled: false })],
    ['shared binding', book => ({ ...book, scope: 'global', characterId: null, characterIds: ['other-character'] })],
    ['deletion', book => ({ ...book, deletedAt: UPDATED_AT })]
  ]) {
    test(`${kind}: a concurrent worldbook ${change} change rejects the complete character update`, async context => {
      const { repository } = await openRepository(kind, context)
      const { character, embeddedBookId } = await seed(repository)
      const originalCommit = repository.importRecordsIfUnchanged.bind(repository)
      const newerBook = { ...mutate(await repository.getWorldBook(embeddedBookId)), updatedAt: UPDATED_AT }
      let beforeCommit
      repository.importRecordsIfUnchanged = async options => {
        await repository.saveWorldBook(newerBook)
        beforeCommit = await repository.readBackupData()
        return originalCommit(options)
      }
      await assert.rejects(update(await previewFor(), repository, character), error => error.code === 'character_update_conflict')
      assert.ok(beforeCommit, 'The competing edit must occur after preparation and before the storage transaction')
      assert.deepEqual(await repository.readBackupData(), beforeCommit)
      assert.deepEqual(await repository.getWorldBook(embeddedBookId), newerBook)
      assert.deepEqual(await repository.getCharacter(character.id), character)
    })
  }

  test(`${kind}: a late storage failure rolls back the updated character, worldbook and new assets together`, async context => {
    const { repository, sqlite } = await openRepository(kind, context)
    const { character } = await seed(repository)
    const before = await repository.readBackupData()
    let injected = false
    if (sqlite) {
      const executeSql = sqlite.executeSql.bind(sqlite)
      sqlite.executeSql = options => {
        const statements = Array.isArray(options.sql) ? options.sql : [options.sql]
        if (!injected && statements.some(statement => statement.includes('INSERT OR REPLACE INTO character_assets'))) {
          injected = true
          return executeSql({ ...options, sql: [...statements, 'INSERT INTO missing_update_failure_table (id) VALUES (1)'] })
        }
        return executeSql(options)
      }
    } else {
      const commit = repository.importRecordsIfUnchanged.bind(repository)
      repository.importRecordsIfUnchanged = options => {
        injected = true
        return commit({ ...options, records: {
          ...options.records,
          characterAssets: [...options.records.characterAssets, { characterId: character.id, name: 'invalid asset without an id' }]
        } })
      }
    }
    await assert.rejects(update(await previewFor(), repository, character), error => error.code === 'character_update_commit_failed')
    assert.ok(injected, 'Storage failure must be injected inside the real write transaction')
    assert.deepEqual(await repository.readBackupData(), before)
  })
}
