import {
  LOCAL_WORKSPACE_ID,
  androidDatabaseForWorkspace,
  assertWorkspaceId
} from '../../workspace/workspace-id.js'

const MIGRATIONS = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        last_message_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        payload TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence ON messages (conversation_id, sequence)',
      'CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (status)',
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL
      )`
    ]
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at TEXT,
        payload TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id)',
      'CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON attachments (conversation_id)'
    ]
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY NOT NULL,
        source_hash TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        payload TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_characters_source_hash ON characters (source_hash)',
      `CREATE TABLE IF NOT EXISTS world_books (
        id TEXT PRIMARY KEY NOT NULL,
        character_id TEXT,
        scope TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        payload TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_world_books_character ON world_books (character_id)',
      'CREATE INDEX IF NOT EXISTS idx_world_books_scope ON world_books (scope)',
      `CREATE TABLE IF NOT EXISTS character_assets (
        id TEXT PRIMARY KEY NOT NULL,
        character_id TEXT NOT NULL,
        created_at TEXT,
        payload TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_character_assets_character ON character_assets (character_id)'
    ]
  }
]

function toError(value, fallback) {
  if (value instanceof Error) return value
  return new Error(value?.message || value?.errMsg || fallback)
}

function sqlText(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function encodePayload(value) {
  return encodeURIComponent(JSON.stringify(value))
}

function decodePayload(value) {
  return JSON.parse(decodeURIComponent(String(value)))
}

function providerSql(provider) {
  return `INSERT OR REPLACE INTO providers (id, payload, updated_at, deleted_at) VALUES (${sqlText(provider.id)}, ${sqlText(encodePayload(provider))}, ${sqlText(provider.updatedAt)}, ${sqlText(provider.deletedAt)})`
}

function conversationSql(conversation) {
  return `INSERT OR REPLACE INTO conversations (id, payload, last_message_at, updated_at, deleted_at) VALUES (${sqlText(conversation.id)}, ${sqlText(encodePayload(conversation))}, ${sqlText(conversation.lastMessageAt)}, ${sqlText(conversation.updatedAt)}, ${sqlText(conversation.deletedAt)})`
}

function messageSql(message) {
  return `INSERT OR REPLACE INTO messages (id, conversation_id, sequence, status, created_at, updated_at, deleted_at, payload) VALUES (${sqlText(message.id)}, ${sqlText(message.conversationId)}, ${Number(message.sequence) || 0}, ${sqlText(message.status)}, ${sqlText(message.createdAt)}, ${sqlText(message.updatedAt)}, ${sqlText(message.deletedAt)}, ${sqlText(encodePayload(message))})`
}

function attachmentSql(attachment) {
  return `INSERT OR REPLACE INTO attachments (id, conversation_id, message_id, created_at, payload) VALUES (${sqlText(attachment.id)}, ${sqlText(attachment.conversationId)}, ${sqlText(attachment.messageId)}, ${sqlText(attachment.createdAt)}, ${sqlText(encodePayload(attachment))})`
}

function characterSql(character) {
  return `INSERT OR REPLACE INTO characters (id, source_hash, updated_at, deleted_at, payload) VALUES (${sqlText(character.id)}, ${sqlText(character.sourceHash)}, ${sqlText(character.updatedAt)}, ${sqlText(character.deletedAt)}, ${sqlText(encodePayload(character))})`
}

function worldBookSql(worldBook) {
  return `INSERT OR REPLACE INTO world_books (id, character_id, scope, updated_at, deleted_at, payload) VALUES (${sqlText(worldBook.id)}, ${sqlText(worldBook.characterId)}, ${sqlText(worldBook.scope)}, ${sqlText(worldBook.updatedAt)}, ${sqlText(worldBook.deletedAt)}, ${sqlText(encodePayload(worldBook))})`
}

function characterAssetSql(asset) {
  return `INSERT OR REPLACE INTO character_assets (id, character_id, created_at, payload) VALUES (${sqlText(asset.id)}, ${sqlText(asset.characterId)}, ${sqlText(asset.createdAt)}, ${sqlText(encodePayload(asset))})`
}

function keyValueSql(table, key, value) {
  return `INSERT OR REPLACE INTO ${table} (key, payload) VALUES (${sqlText(key)}, ${sqlText(encodePayload(value))})`
}

const SYNC_TABLE_BY_ENTITY = Object.freeze({
  providers: ['providers', 'id'],
  conversations: ['conversations', 'id'],
  messages: ['messages', 'id'],
  attachments: ['attachments', 'id'],
  characters: ['characters', 'id'],
  worldBooks: ['world_books', 'id'],
  characterAssets: ['character_assets', 'id'],
  settings: ['settings', 'key']
})

function importStatements({
  providers = [], conversations = [], messages = [], attachments = [],
  characters = [], worldBooks = [], characterAssets = [], settings = {}
}) {
  return [
    ...providers.map(providerSql),
    ...conversations.map(conversationSql),
    ...messages.map(messageSql),
    ...attachments.map(attachmentSql),
    ...characters.map(characterSql),
    ...worldBooks.map(worldBookSql),
    ...characterAssets.map(characterAssetSql),
    ...Object.entries(settings).map(([key, value]) => keyValueSql('settings', key, value))
  ]
}

function matchesSyncSnapshot(row, expectedSnapshot) {
  const exists = Boolean(row)
  const value = exists ? decodePayload(row.payload) : null
  return exists === Boolean(expectedSnapshot?.exists) &&
    JSON.stringify(value) === JSON.stringify(expectedSnapshot?.value ?? null)
}

export class PlusSqliteRepository {
  constructor({
    sqlite,
    databaseName,
    databasePath,
    workspaceId = LOCAL_WORKSPACE_ID,
    now = () => new Date().toISOString()
  } = {}) {
    if (!sqlite?.openDatabase || !sqlite?.executeSql || !sqlite?.selectSql) {
      throw new Error('PlusSqliteRepository 需要 plus.sqlite')
    }
    const workspaceDatabase = androidDatabaseForWorkspace(workspaceId)
    this.sqlite = sqlite
    this.workspaceId = assertWorkspaceId(workspaceId)
    this.databaseName = databaseName ?? workspaceDatabase.name
    this.databasePath = databasePath ?? workspaceDatabase.path
    this.now = now
    this.initialized = false
    this.opened = false
    this.initializing = null
    this.closing = null
    this.writeQueue = Promise.resolve()
  }

  async init() {
    if (this.closing) await this.closing
    if (this.initialized) return this
    if (this.initializing) return this.initializing
    this.initializing = (async () => {
      if (!this.sqlite.isOpenDatabase?.({ name: this.databaseName, path: this.databasePath })) {
        await new Promise((resolve, reject) => {
          this.sqlite.openDatabase({
            name: this.databaseName,
            path: this.databasePath,
            success: resolve,
            fail: (error) => reject(toError(error, '无法打开 SQLite 数据库'))
          })
        })
      }
      this.opened = true
      await this.#execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      )`)
      const applied = new Set(await this.getAppliedMigrations())
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue
        await this.#transactional([
          ...migration.statements,
          `INSERT INTO schema_migrations (version, applied_at) VALUES (${migration.version}, ${sqlText(this.now())})`
        ])
      }
      this.initialized = true
      return this
    })()
    try {
      return await this.initializing
    } finally {
      this.initializing = null
    }
  }

  async close() {
    if (this.closing) return this.closing
    this.closing = (async () => {
      if (this.initializing) {
        try { await this.initializing } catch {}
      }
      try { await this.writeQueue } catch {}
      const isOpen = typeof this.sqlite.isOpenDatabase === 'function'
        ? this.sqlite.isOpenDatabase({ name: this.databaseName, path: this.databasePath })
        : this.opened
      if (!isOpen) {
        this.initialized = false
        this.opened = false
        return
      }
      if (typeof this.sqlite.closeDatabase !== 'function') {
        throw new Error('plus.sqlite.closeDatabase 不可用')
      }
      await new Promise((resolve, reject) => {
        this.sqlite.closeDatabase({
          name: this.databaseName,
          success: resolve,
          fail: (error) => reject(toError(error, '无法关闭 SQLite 数据库'))
        })
      })
      this.initialized = false
      this.opened = false
    })()
    try {
      return await this.closing
    } finally {
      this.closing = null
    }
  }

  #execute(sql) {
    if (!this.opened) return Promise.reject(new Error('SQLite 仓储尚未初始化'))
    return new Promise((resolve, reject) => {
      this.sqlite.executeSql({
        name: this.databaseName,
        sql,
        success: resolve,
        fail: (error) => reject(toError(error, 'SQLite 写入失败'))
      })
    })
  }

  #select(sql) {
    if (!this.opened) return Promise.reject(new Error('SQLite 仓储尚未初始化'))
    return new Promise((resolve, reject) => {
      this.sqlite.selectSql({
        name: this.databaseName,
        sql,
        success: (rows) => resolve(Array.isArray(rows) ? rows : []),
        fail: (error) => reject(toError(error, 'SQLite 查询失败'))
      })
    })
  }

  #transaction(operation) {
    if (!this.opened) return Promise.reject(new Error('SQLite 仓储尚未初始化'))
    return new Promise((resolve, reject) => {
      this.sqlite.transaction({
        name: this.databaseName,
        operation,
        success: resolve,
        fail: (error) => reject(toError(error, `SQLite ${operation} 失败`))
      })
    })
  }

  async #transactional(statements) {
    await this.#transaction('begin')
    try {
      if (statements.length) await this.#execute(statements)
      await this.#transaction('commit')
    } catch (error) {
      try { await this.#transaction('rollback') } catch {}
      throw error
    }
  }

  #enqueueWrite(operation) {
    if (this.closing) return Promise.reject(new Error('SQLite repository is closing'))
    const result = this.writeQueue.then(operation, operation)
    this.writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async #get(table, keyColumn, key) {
    const rows = await this.#select(`SELECT payload FROM ${table} WHERE ${keyColumn} = ${sqlText(key)} LIMIT 1`)
    return rows[0] ? decodePayload(rows[0].payload) : undefined
  }

  async getAppliedMigrations() {
    const rows = await this.#select('SELECT version FROM schema_migrations ORDER BY version ASC')
    return rows.map((row) => Number(row.version))
  }

  async listProviders() {
    const rows = await this.#select("SELECT payload FROM providers WHERE deleted_at IS NULL ORDER BY COALESCE(updated_at, '') DESC")
    return rows.map((row) => decodePayload(row.payload))
  }

  getProvider(id) { return this.#get('providers', 'id', id) }
  async saveProvider(provider) { await this.#enqueueWrite(() => this.#execute(providerSql(provider))); return provider }
  deleteProvider(id) { return this.#enqueueWrite(() => this.#execute(`DELETE FROM providers WHERE id = ${sqlText(id)}`)) }

  async listConversations() {
    const rows = await this.#select("SELECT payload FROM conversations WHERE deleted_at IS NULL ORDER BY COALESCE(last_message_at, '') DESC")
    return rows.map((row) => decodePayload(row.payload))
  }

  getConversation(id) { return this.#get('conversations', 'id', id) }
  async saveConversation(conversation) { await this.#enqueueWrite(() => this.#execute(conversationSql(conversation))); return conversation }

  async createConversationWithInitialMessage(conversation, message = null) {
    await this.#enqueueWrite(() => this.#transactional([conversationSql(conversation), ...(message ? [messageSql(message)] : [])]))
    return conversation
  }

  async deleteConversation(id) {
    await this.#enqueueWrite(() => this.#transactional([
      `DELETE FROM attachments WHERE conversation_id = ${sqlText(id)}`,
      `DELETE FROM messages WHERE conversation_id = ${sqlText(id)}`,
      `DELETE FROM conversations WHERE id = ${sqlText(id)}`
    ]))
  }

  async listMessages(conversationId) {
    const rows = await this.#select(`SELECT payload FROM messages WHERE conversation_id = ${sqlText(conversationId)} AND deleted_at IS NULL ORDER BY sequence ASC`)
    return rows.map((row) => decodePayload(row.payload))
  }

  async listAllMessages() {
    const rows = await this.#select("SELECT payload FROM messages WHERE deleted_at IS NULL ORDER BY COALESCE(created_at, '') ASC, sequence ASC")
    return rows.map((row) => decodePayload(row.payload))
  }

  getMessage(id) { return this.#get('messages', 'id', id) }
  async saveMessage(message) { await this.#enqueueWrite(() => this.#execute(messageSql(message))); return message }
  async saveMessages(messages) { await this.#enqueueWrite(() => this.#transactional(messages.map(messageSql))); return messages }

  async createMessagePair(userMessage, assistantMessage, attachments = []) {
    await this.#enqueueWrite(() => this.#transactional([messageSql(userMessage), messageSql(assistantMessage), ...attachments.map(attachmentSql)]))
    return [userMessage, assistantMessage]
  }

  async saveAttachments(attachments) { await this.#enqueueWrite(() => this.#transactional(attachments.map(attachmentSql))); return attachments }

  async listAllAttachments() {
    const rows = await this.#select("SELECT payload FROM attachments ORDER BY COALESCE(created_at, '') ASC")
    return rows.map(row => decodePayload(row.payload)).filter(attachment => !attachment.deletedAt)
  }

  getAttachment(id) { return this.#get('attachments', 'id', id) }

  async listMessageAttachments(messageId) {
    const rows = await this.#select(`SELECT payload FROM attachments WHERE message_id = ${sqlText(messageId)} ORDER BY COALESCE(created_at, '') ASC`)
    return rows.map(row => decodePayload(row.payload)).filter(attachment => !attachment.deletedAt)
  }

  async listConversationAttachments(conversationId) {
    const rows = await this.#select(`SELECT payload FROM attachments WHERE conversation_id = ${sqlText(conversationId)} ORDER BY COALESCE(created_at, '') ASC`)
    return rows.map(row => decodePayload(row.payload)).filter(attachment => !attachment.deletedAt)
  }

  deleteAttachmentsByMessage(messageId) {
    return this.#enqueueWrite(() => this.#execute(`DELETE FROM attachments WHERE message_id = ${sqlText(messageId)}`))
  }

  async recoverGeneratingMessages(updatedAt = new Date().toISOString()) {
    return this.#enqueueWrite(async () => {
      const rows = await this.#select("SELECT payload FROM messages WHERE status = 'generating'")
      if (!rows.length) return 0
      const messages = rows.map((row) => ({ ...decodePayload(row.payload), status: 'interrupted', updatedAt }))
      await this.#transactional(messages.map(messageSql))
      return messages.length
    })
  }

  async setSetting(key, value) { await this.#enqueueWrite(() => this.#execute(keyValueSql('settings', key, value))); return value }
  async getSetting(key, fallback = null) { return (await this.#get('settings', 'key', key)) ?? fallback }

  async listSettings() {
    const rows = await this.#select('SELECT key, payload FROM settings ORDER BY key ASC')
    return Object.fromEntries(rows.map((row) => [row.key, decodePayload(row.payload)]))
  }

  async setSecret(key, value) { await this.#enqueueWrite(() => this.#execute(keyValueSql('secrets', key, value))); return value }
  async getSecret(key) { return (await this.#get('secrets', 'key', key)) ?? null }

  async listCharacters() {
    const rows = await this.#select("SELECT payload FROM characters WHERE deleted_at IS NULL ORDER BY payload ASC")
    return rows.map(row => decodePayload(row.payload)).sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? '')))
  }

  getCharacter(id) { return this.#get('characters', 'id', id) }
  async saveCharacter(character) { await this.#enqueueWrite(() => this.#execute(characterSql(character))); return character }

  async findCharactersBySourceHash(sourceHash) {
    const rows = await this.#select(`SELECT payload FROM characters WHERE source_hash = ${sqlText(sourceHash)} AND deleted_at IS NULL`)
    return rows.map(row => decodePayload(row.payload))
  }

  async listWorldBooks({ characterId = null, includeGlobal = false } = {}) {
    if (!characterId && !includeGlobal) return []
    const rows = await this.#select('SELECT payload FROM world_books WHERE deleted_at IS NULL ORDER BY payload ASC')
    return rows
      .map(row => decodePayload(row.payload))
      .filter(book => {
        const characterIds = Array.isArray(book.characterIds) ? book.characterIds.map(String) : []
        const explicitlyBound = Boolean(characterId) && (book.characterId === characterId || characterIds.includes(String(characterId)))
        const appliesGlobally = includeGlobal && book.scope === 'global' && !book.characterId && characterIds.length === 0
        return explicitlyBound || appliesGlobally
      })
      .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? '')))
  }

  getWorldBook(id) { return this.#get('world_books', 'id', id) }
  async saveWorldBook(worldBook) { await this.#enqueueWrite(() => this.#execute(worldBookSql(worldBook))); return worldBook }

  async listAllWorldBooks() {
    const rows = await this.#select("SELECT payload FROM world_books WHERE deleted_at IS NULL ORDER BY payload ASC")
    return rows.map(row => decodePayload(row.payload))
  }

  getCharacterAsset(id) { return this.#get('character_assets', 'id', id) }

  async listCharacterAssets(characterId) {
    const rows = await this.#select(`SELECT payload FROM character_assets WHERE character_id = ${sqlText(characterId)} ORDER BY COALESCE(created_at, '') ASC`)
    return rows.map(row => decodePayload(row.payload)).filter(asset => !asset.deletedAt)
  }

  async listAllCharacterAssets() {
    const rows = await this.#select("SELECT payload FROM character_assets ORDER BY COALESCE(created_at, '') ASC")
    return rows.map(row => decodePayload(row.payload)).filter(asset => !asset.deletedAt)
  }

  async importCharacterBundle({ character, worldBooks = [], characterAssets = [], conversations = [] }) {
    await this.#enqueueWrite(() => this.#transactional([
      characterSql(character),
      ...worldBooks.map(worldBookSql),
      ...characterAssets.map(characterAssetSql),
      ...conversations.map(conversationSql)
    ]))
    return character
  }

  async saveWorldBookBundle({ worldBook, characters = [] }) {
    await this.#enqueueWrite(() => this.#transactional([
      worldBookSql(worldBook),
      ...characters.map(characterSql)
    ]))
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
    await this.#enqueueWrite(() => this.#transactional(importStatements({
      providers, conversations, messages, attachments,
      characters, worldBooks, characterAssets, settings
    })))
  }

  async importRecordsIfUnchanged({ entityType, entityId, expectedSnapshot, records }) {
    const target = SYNC_TABLE_BY_ENTITY[entityType]
    if (!target) throw new Error('Unsupported sync entity type')
    const [table, keyColumn] = target
    return this.#enqueueWrite(async () => {
      await this.#transaction('begin')
      try {
        const rows = await this.#select(
          `SELECT payload FROM ${table} WHERE ${keyColumn} = ${sqlText(entityId)} LIMIT 1`
        )
        if (!matchesSyncSnapshot(rows[0], expectedSnapshot)) {
          await this.#transaction('commit')
          return false
        }
        const statements = importStatements(records)
        if (statements.length) await this.#execute(statements)
        await this.#transaction('commit')
        return true
      } catch (error) {
        try { await this.#transaction('rollback') } catch {}
        throw error
      }
    })
  }
}
