import {
  LOCAL_WORKSPACE_ID,
  assertWorkspaceId,
  browserDatabaseNameForWorkspace
} from '../../workspace/workspace-id.js'

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB 事务已中止')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error), { once: true })
  })
}

function cloneForStorage(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value)
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function putAll(store, records) {
  for (const record of records) {
    store.put(cloneForStorage(record))
  }
}

function normalizeMessagePageLimit(value, fallback = 60) {
  const numeric = Math.floor(Number(value))
  return Number.isFinite(numeric) ? Math.max(1, Math.min(200, numeric)) : fallback
}

const IMPORT_STORE_NAMES = [
  'providers', 'conversations', 'messages', 'attachments',
  'characters', 'worldBooks', 'characterAssets', 'settings'
]

const SYNC_STORE_BY_ENTITY = Object.freeze({
  providers: 'providers',
  conversations: 'conversations',
  messages: 'messages',
  attachments: 'attachments',
  characters: 'characters',
  worldBooks: 'worldBooks',
  characterAssets: 'characterAssets',
  settings: 'settings'
})

function writeImportRecords(transaction, {
  providers = [], conversations = [], messages = [], attachments = [],
  characters = [], worldBooks = [], characterAssets = [], settings = {}
}) {
  putAll(transaction.objectStore('providers'), providers)
  putAll(transaction.objectStore('conversations'), conversations)
  putAll(transaction.objectStore('messages'), messages)
  putAll(transaction.objectStore('attachments'), attachments)
  putAll(transaction.objectStore('characters'), characters)
  putAll(transaction.objectStore('worldBooks'), worldBooks)
  putAll(transaction.objectStore('characterAssets'), characterAssets)
  const settingsStore = transaction.objectStore('settings')
  for (const [key, value] of Object.entries(settings)) {
    settingsStore.put({ key, value: cloneForStorage(value) })
  }
}

function matchesSyncSnapshot(stored, expectedSnapshot, isSetting) {
  const exists = stored !== undefined
  const value = isSetting ? (exists ? stored.value : null) : (exists ? stored : null)
  return exists === Boolean(expectedSnapshot?.exists) &&
    JSON.stringify(value) === JSON.stringify(expectedSnapshot?.value ?? null)
}

async function runWriteTransaction(transaction, write) {
  const completion = transactionToPromise(transaction)
  try {
    write()
  } catch (error) {
    try { transaction.abort() } catch {}
    try { await completion } catch {}
    throw error
  }
  await completion
}

export class IndexedDbRepository {
  constructor({
    indexedDB = globalThis.indexedDB,
    keyRange = globalThis.IDBKeyRange,
    databaseName,
    workspaceId = LOCAL_WORKSPACE_ID,
    databaseVersion = 3
  } = {}) {
    if (!indexedDB) {
      throw new Error('当前环境不支持 IndexedDB')
    }
    this.indexedDB = indexedDB
    this.keyRange = keyRange || null
    this.workspaceId = assertWorkspaceId(workspaceId)
    this.databaseName = databaseName ?? browserDatabaseNameForWorkspace(this.workspaceId)
    this.databaseVersion = databaseVersion
    this.database = null
    this.initializing = null
  }

  async init() {
    if (this.database) return this
    if (this.initializing) return this.initializing
    this.initializing = (async () => {
      const request = this.indexedDB.open(this.databaseName, this.databaseVersion)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        if (!database.objectStoreNames.contains('meta')) {
          database.createObjectStore('meta', { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains('providers')) {
          database.createObjectStore('providers', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('conversations')) {
          database.createObjectStore('conversations', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('messages')) {
          const messages = database.createObjectStore('messages', { keyPath: 'id' })
          messages.createIndex('conversationId', 'conversationId', { unique: false })
          messages.createIndex('conversationSequence', ['conversationId', 'sequence'], { unique: false })
        }
        if (!database.objectStoreNames.contains('attachments')) {
          const attachments = database.createObjectStore('attachments', { keyPath: 'id' })
          attachments.createIndex('messageId', 'messageId', { unique: false })
          attachments.createIndex('conversationId', 'conversationId', { unique: false })
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains('secrets')) {
          database.createObjectStore('secrets', { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains('characters')) {
          const characters = database.createObjectStore('characters', { keyPath: 'id' })
          characters.createIndex('sourceHash', 'sourceHash', { unique: false })
        }
        if (!database.objectStoreNames.contains('worldBooks')) {
          const worldBooks = database.createObjectStore('worldBooks', { keyPath: 'id' })
          worldBooks.createIndex('characterId', 'characterId', { unique: false })
          worldBooks.createIndex('scope', 'scope', { unique: false })
        }
        if (!database.objectStoreNames.contains('characterAssets')) {
          const characterAssets = database.createObjectStore('characterAssets', { keyPath: 'id' })
          characterAssets.createIndex('characterId', 'characterId', { unique: false })
        }
      })
      const database = await requestToPromise(request)
      this.database = database
      database.addEventListener('versionchange', () => {
        database.close()
        if (this.database === database) this.database = null
      })
      return this
    })()
    try {
      return await this.initializing
    } finally {
      this.initializing = null
    }
  }

  async close() {
    if (this.initializing) await this.initializing
    const database = this.database
    this.database = null
    database?.close()
  }

  #transaction(storeNames, mode = 'readonly') {
    if (!this.database) {
      throw new Error('IndexedDB 仓储尚未初始化')
    }
    return this.database.transaction(storeNames, mode)
  }

  async #get(storeName, key) {
    const transaction = this.#transaction(storeName)
    return requestToPromise(transaction.objectStore(storeName).get(key))
  }

  async #getAll(storeName) {
    const transaction = this.#transaction(storeName)
    return requestToPromise(transaction.objectStore(storeName).getAll())
  }

  async #put(storeName, value) {
    const transaction = this.#transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(cloneForStorage(value))
    await transactionToPromise(transaction)
    return value
  }

  async listProviders() {
    return (await this.#getAll('providers'))
      .filter((provider) => !provider.deletedAt)
      .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
  }

  getProvider(id) {
    return this.#get('providers', id)
  }

  saveProvider(provider) {
    return this.#put('providers', provider)
  }

  async deleteProvider(id) {
    const transaction = this.#transaction('providers', 'readwrite')
    transaction.objectStore('providers').delete(id)
    await transactionToPromise(transaction)
  }

  async listConversations() {
    return (await this.#getAll('conversations'))
      .filter((conversation) => !conversation.deletedAt)
      .sort((left, right) => String(right.lastMessageAt ?? '').localeCompare(String(left.lastMessageAt ?? '')))
  }

  getConversation(id) {
    return this.#get('conversations', id)
  }

  saveConversation(conversation) {
    return this.#put('conversations', conversation)
  }

  async createConversationWithInitialMessage(conversation, message = null) {
    const transaction = this.#transaction(['conversations', 'messages'], 'readwrite')
    transaction.objectStore('conversations').put(cloneForStorage(conversation))
    if (message) transaction.objectStore('messages').put(cloneForStorage(message))
    await transactionToPromise(transaction)
    return conversation
  }

  async deleteConversation(id) {
    const transaction = this.#transaction(['conversations', 'messages', 'attachments'], 'readwrite')
    transaction.objectStore('conversations').delete(id)
    const messages = transaction.objectStore('messages')
    const cursorRequest = messages.openCursor()
    cursorRequest.addEventListener('success', () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        return
      }
      if (cursor.value.conversationId === id) {
        cursor.delete()
      }
      cursor.continue()
    })
    const attachments = transaction.objectStore('attachments')
    const attachmentCursorRequest = attachments.openCursor()
    attachmentCursorRequest.addEventListener('success', () => {
      const cursor = attachmentCursorRequest.result
      if (!cursor) return
      if (cursor.value.conversationId === id) cursor.delete()
      cursor.continue()
    })
    await transactionToPromise(transaction)
  }

  async listMessages(conversationId) {
    return (await this.#getAll('messages'))
      .filter((message) => message.conversationId === conversationId && !message.deletedAt)
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
  }

  async listMessagePage(conversationId, { beforeSequence = null, limit = 60 } = {}) {
    const pageLimit = normalizeMessagePageLimit(limit)
    const before = Number(beforeSequence)
    const hasBefore = beforeSequence !== null && beforeSequence !== undefined && Number.isFinite(before)
    if (!this.keyRange) {
      const messages = (await this.listMessages(conversationId))
        .filter(message => !hasBefore || (Number(message.sequence) || 0) < before)
      return {
        messages: messages.slice(-pageLimit),
        hasMore: messages.length > pageLimit
      }
    }

    const transaction = this.#transaction('messages')
    const index = transaction.objectStore('messages').index('conversationSequence')
    const range = this.keyRange.bound(
      [conversationId, Number.MIN_SAFE_INTEGER],
      [conversationId, hasBefore ? before : Number.MAX_SAFE_INTEGER],
      false,
      hasBefore
    )
    const request = index.openCursor(range, 'prev')
    const descending = await new Promise((resolve, reject) => {
      const values = []
      request.addEventListener('success', () => {
        const cursor = request.result
        if (!cursor || values.length > pageLimit) {
          resolve(values)
          return
        }
        if (!cursor.value.deletedAt) values.push(cursor.value)
        cursor.continue()
      })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    return {
      messages: descending.slice(0, pageLimit).reverse(),
      hasMore: descending.length > pageLimit
    }
  }

  async listLatestMessages(conversationIds = []) {
    const ids = [...new Set(
      (Array.isArray(conversationIds) ? conversationIds : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )]
    const messages = []
    for (let offset = 0; offset < ids.length; offset += 16) {
      const batch = await Promise.all(
        ids.slice(offset, offset + 16).map(async conversationId => (
          (await this.listMessagePage(conversationId, { limit: 1 })).messages[0] || null
        ))
      )
      messages.push(...batch.filter(Boolean))
    }
    return messages
  }

  async listAllMessages() {
    return (await this.#getAll('messages'))
      .filter((message) => !message.deletedAt)
      .sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')))
  }

  getMessage(id) {
    return this.#get('messages', id)
  }

  saveMessage(message) {
    return this.#put('messages', message)
  }

  async saveMessages(messages) {
    const transaction = this.#transaction('messages', 'readwrite')
    putAll(transaction.objectStore('messages'), messages)
    await transactionToPromise(transaction)
    return messages
  }

  async createMessagePair(userMessage, assistantMessage, attachments = []) {
    const transaction = this.#transaction(['messages', 'attachments'], 'readwrite')
    const store = transaction.objectStore('messages')
    store.put(cloneForStorage(userMessage))
    store.put(cloneForStorage(assistantMessage))
    putAll(transaction.objectStore('attachments'), attachments)
    await transactionToPromise(transaction)
    return [userMessage, assistantMessage]
  }

  async saveAttachments(attachments) {
    const transaction = this.#transaction('attachments', 'readwrite')
    putAll(transaction.objectStore('attachments'), attachments)
    await transactionToPromise(transaction)
    return attachments
  }

  async listAllAttachments() {
    return (await this.#getAll('attachments'))
      .filter(attachment => !attachment.deletedAt)
      .sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')))
  }

  getAttachment(id) {
    return this.#get('attachments', id)
  }

  async listMessageAttachments(messageId) {
    return (await this.listAllAttachments()).filter(attachment => attachment.messageId === messageId)
  }

  async listConversationAttachments(conversationId) {
    return (await this.listAllAttachments()).filter(attachment => attachment.conversationId === conversationId)
  }

  async deleteAttachmentsByMessage(messageId) {
    const transaction = this.#transaction('attachments', 'readwrite')
    const request = transaction.objectStore('attachments').openCursor()
    request.addEventListener('success', () => {
      const cursor = request.result
      if (!cursor) return
      if (cursor.value.messageId === messageId) cursor.delete()
      cursor.continue()
    })
    await transactionToPromise(transaction)
  }

  async recoverGeneratingMessages(updatedAt = new Date().toISOString()) {
    const messages = await this.#getAll('messages')
    const generating = messages.filter((message) => message.status === 'generating')
    if (!generating.length) {
      return 0
    }
    const transaction = this.#transaction('messages', 'readwrite')
    const store = transaction.objectStore('messages')
    for (const message of generating) {
      store.put({ ...message, status: 'interrupted', updatedAt })
    }
    await transactionToPromise(transaction)
    return generating.length
  }

  async setSetting(key, value) {
    await this.#put('settings', { key, value: cloneForStorage(value) })
    return value
  }

  async getSetting(key, fallback = null) {
    const record = await this.#get('settings', key)
    return record ? record.value : fallback
  }

  async listSettings() {
    return Object.fromEntries((await this.#getAll('settings')).map(({ key, value }) => [key, value]))
  }

  async setSecret(key, value) {
    const transaction = this.#transaction('secrets', 'readwrite')
    transaction.objectStore('secrets').put({ key, value })
    await transactionToPromise(transaction)
    return value
  }

  async getSecret(key) {
    const record = await this.#get('secrets', key)
    return record ? record.value : null
  }

  async listCharacters() {
    return (await this.#getAll('characters'))
      .filter(character => !character.deletedAt)
      .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-CN'))
  }

  getCharacter(id) {
    return this.#get('characters', id)
  }

  saveCharacter(character) {
    return this.#put('characters', character)
  }

  async findCharactersBySourceHash(sourceHash) {
    return (await this.listCharacters()).filter(character => character.sourceHash === sourceHash)
  }

  async listWorldBooks({ characterId = null, includeGlobal = false } = {}) {
    return (await this.#getAll('worldBooks'))
      .filter(book => !book.deletedAt)
      .filter(book => {
        const characterIds = Array.isArray(book.characterIds) ? book.characterIds.map(String) : []
        const explicitlyBound = Boolean(characterId) && (book.characterId === characterId || characterIds.includes(String(characterId)))
        const appliesGlobally = includeGlobal && book.scope === 'global' && !book.characterId && characterIds.length === 0
        return explicitlyBound || appliesGlobally
      })
      .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-CN'))
  }

  getWorldBook(id) {
    return this.#get('worldBooks', id)
  }

  saveWorldBook(worldBook) {
    return this.#put('worldBooks', worldBook)
  }

  async listAllWorldBooks() {
    return (await this.#getAll('worldBooks')).filter(book => !book.deletedAt)
  }

  getCharacterAsset(id) {
    return this.#get('characterAssets', id)
  }

  async listCharacterAssets(characterId) {
    return (await this.#getAll('characterAssets'))
      .filter(asset => asset.characterId === characterId && !asset.deletedAt)
  }

  async listAllCharacterAssets() {
    return (await this.#getAll('characterAssets')).filter(asset => !asset.deletedAt)
  }

  async importCharacterBundle({ character, worldBooks = [], characterAssets = [], conversations = [] }) {
    const transaction = this.#transaction(['characters', 'worldBooks', 'characterAssets', 'conversations'], 'readwrite')
    await runWriteTransaction(transaction, () => {
      transaction.objectStore('characters').put(cloneForStorage(character))
      putAll(transaction.objectStore('worldBooks'), worldBooks)
      putAll(transaction.objectStore('characterAssets'), characterAssets)
      putAll(transaction.objectStore('conversations'), conversations)
    })
    return character
  }

  async saveWorldBookBundle({ worldBook, characters = [] }) {
    const transaction = this.#transaction(['worldBooks', 'characters'], 'readwrite')
    await runWriteTransaction(transaction, () => {
      transaction.objectStore('worldBooks').put(cloneForStorage(worldBook))
      putAll(transaction.objectStore('characters'), characters)
    })
    return worldBook
  }

  async readBackupData() {
    return {
      providers: await this.listProviders(),
      conversations: await this.listConversations(),
      messages: await this.listAllMessages(),
      attachments: await this.listAllAttachments(),
      characters: await this.listCharacters(),
      worldBooks: await this.listAllWorldBooks(),
      characterAssets: await this.listAllCharacterAssets(),
      settings: await this.listSettings()
    }
  }

  async importRecords({
    providers = [], conversations = [], messages = [], attachments = [],
    characters = [], worldBooks = [], characterAssets = [], settings = {}
  }) {
    const transaction = this.#transaction(IMPORT_STORE_NAMES, 'readwrite')
    writeImportRecords(transaction, {
      providers, conversations, messages, attachments,
      characters, worldBooks, characterAssets, settings
    })
    await transactionToPromise(transaction)
  }

  async importRecordsIfUnchanged({ entityType, entityId, expectedSnapshot, records }) {
    const storeName = SYNC_STORE_BY_ENTITY[entityType]
    if (!storeName) throw new Error('Unsupported sync entity type')
    const transaction = this.#transaction(IMPORT_STORE_NAMES, 'readwrite')
    const completion = transactionToPromise(transaction)
    try {
      const stored = await requestToPromise(transaction.objectStore(storeName).get(entityId))
      if (!matchesSyncSnapshot(stored, expectedSnapshot, entityType === 'settings')) {
        await completion
        return false
      }
      writeImportRecords(transaction, records)
      await completion
      return true
    } catch (error) {
      try { transaction.abort() } catch {}
      try { await completion } catch {}
      throw error
    }
  }
}
