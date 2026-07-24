import {
  LOCAL_WORKSPACE_ID,
  androidDatabaseForWorkspace,
  assertWorkspaceId
} from '../../workspace/workspace-id.js'

const PAYLOAD_CHUNK_CHARACTERS = 256 * 1024
const PAYLOAD_CHUNK_MARKER = '__echo_weave_chunked_payload_v1__'
const LATEST_MESSAGE_CURSOR_BATCH_SIZE = 4
const PAYLOAD_TABLES = Object.freeze([
  { table: 'providers', keyColumn: 'id' },
  { table: 'conversations', keyColumn: 'id' },
  { table: 'messages', keyColumn: 'id' },
  { table: 'settings', keyColumn: 'key' },
  { table: 'secrets', keyColumn: 'key' },
  { table: 'attachments', keyColumn: 'id' },
  { table: 'characters', keyColumn: 'id' },
  { table: 'world_books', keyColumn: 'id' },
  { table: 'character_assets', keyColumn: 'id' }
])

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
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS payload_chunks (
        entity_table TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        payload_chunk TEXT NOT NULL,
        PRIMARY KEY (entity_table, entity_id, chunk_index)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_payload_chunks_entity ON payload_chunks (entity_table, entity_id, chunk_index)'
    ]
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS sync_local_metadata (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_revision INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        source_updated_at TEXT,
        sync_hash TEXT,
        PRIMARY KEY (entity_type, entity_id)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_sync_local_metadata_revision ON sync_local_metadata (entity_type, local_revision)'
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

function normalizeMessagePageLimit(value, fallback = 60) {
  const numeric = Math.floor(Number(value))
  return Number.isFinite(numeric) ? Math.max(1, Math.min(200, numeric)) : fallback
}

function encodePayload(value) {
  return encodeURIComponent(JSON.stringify(value))
}

function decodePayload(value) {
  return JSON.parse(decodeURIComponent(String(value)))
}

function providerSql(provider, payload = encodePayload(provider)) {
  return `INSERT OR REPLACE INTO providers (id, payload, updated_at, deleted_at) VALUES (${sqlText(provider.id)}, ${sqlText(payload)}, ${sqlText(provider.updatedAt)}, ${sqlText(provider.deletedAt)})`
}

function conversationSql(conversation, payload = encodePayload(conversation)) {
  return `INSERT OR REPLACE INTO conversations (id, payload, last_message_at, updated_at, deleted_at) VALUES (${sqlText(conversation.id)}, ${sqlText(payload)}, ${sqlText(conversation.lastMessageAt)}, ${sqlText(conversation.updatedAt)}, ${sqlText(conversation.deletedAt)})`
}

function messageSql(message, payload = encodePayload(message)) {
  return `INSERT OR REPLACE INTO messages (id, conversation_id, sequence, status, created_at, updated_at, deleted_at, payload) VALUES (${sqlText(message.id)}, ${sqlText(message.conversationId)}, ${Number(message.sequence) || 0}, ${sqlText(message.status)}, ${sqlText(message.createdAt)}, ${sqlText(message.updatedAt)}, ${sqlText(message.deletedAt)}, ${sqlText(payload)})`
}

function attachmentSql(attachment, payload = encodePayload(attachment)) {
  return `INSERT OR REPLACE INTO attachments (id, conversation_id, message_id, created_at, payload) VALUES (${sqlText(attachment.id)}, ${sqlText(attachment.conversationId)}, ${sqlText(attachment.messageId)}, ${sqlText(attachment.createdAt)}, ${sqlText(payload)})`
}

function characterSql(character, payload = encodePayload(character)) {
  return `INSERT OR REPLACE INTO characters (id, source_hash, updated_at, deleted_at, payload) VALUES (${sqlText(character.id)}, ${sqlText(character.sourceHash)}, ${sqlText(character.updatedAt)}, ${sqlText(character.deletedAt)}, ${sqlText(payload)})`
}

function worldBookSql(worldBook, payload = encodePayload(worldBook)) {
  return `INSERT OR REPLACE INTO world_books (id, character_id, scope, updated_at, deleted_at, payload) VALUES (${sqlText(worldBook.id)}, ${sqlText(worldBook.characterId)}, ${sqlText(worldBook.scope)}, ${sqlText(worldBook.updatedAt)}, ${sqlText(worldBook.deletedAt)}, ${sqlText(payload)})`
}

function characterAssetSql(asset, payload = encodePayload(asset)) {
  return `INSERT OR REPLACE INTO character_assets (id, character_id, created_at, payload) VALUES (${sqlText(asset.id)}, ${sqlText(asset.characterId)}, ${sqlText(asset.createdAt)}, ${sqlText(payload)})`
}

function syncLocalMetadataSql(entityType, entityId, { deleted = false, sourceUpdatedAt = null } = {}) {
  return `INSERT OR REPLACE INTO sync_local_metadata ` +
    `(entity_type, entity_id, local_revision, deleted, source_updated_at, sync_hash) VALUES (` +
    `${sqlText(entityType)}, ${sqlText(entityId)}, ` +
    `COALESCE((SELECT local_revision + 1 FROM sync_local_metadata ` +
    `WHERE entity_type = ${sqlText(entityType)} AND entity_id = ${sqlText(entityId)}), 1), ` +
    `${deleted ? 1 : 0}, ${sqlText(sourceUpdatedAt)}, NULL)`
}

function deletePayloadChunksSql(entityTable, entityId) {
  return `DELETE FROM payload_chunks WHERE entity_table = ${sqlText(entityTable)} AND entity_id = ${sqlText(entityId)}`
}

function insertPayloadChunkSql(entityTable, entityId, chunkIndex, payloadChunk) {
  return `INSERT INTO payload_chunks (entity_table, entity_id, chunk_index, payload_chunk) VALUES (${sqlText(entityTable)}, ${sqlText(entityId)}, ${chunkIndex}, ${sqlText(payloadChunk)})`
}

function chunkedPayloadStatements(entityTable, entityId, value, recordSql) {
  const payload = encodePayload(value)
  const statements = [deletePayloadChunksSql(entityTable, entityId)]
  if (payload.length <= PAYLOAD_CHUNK_CHARACTERS) {
    statements.push(recordSql(payload))
    return statements
  }
  statements.push(recordSql(PAYLOAD_CHUNK_MARKER))
  for (let offset = 0, chunkIndex = 0; offset < payload.length; offset += PAYLOAD_CHUNK_CHARACTERS, chunkIndex += 1) {
    statements.push(insertPayloadChunkSql(
      entityTable,
      entityId,
      chunkIndex,
      payload.slice(offset, offset + PAYLOAD_CHUNK_CHARACTERS)
    ))
  }
  return statements
}

function providerStatements(provider) {
  return chunkedPayloadStatements('providers', provider.id, provider, payload => providerSql(provider, payload))
}

function conversationStatements(conversation) {
  return chunkedPayloadStatements('conversations', conversation.id, conversation, payload => conversationSql(conversation, payload))
}

function messageStatements(message) {
  return chunkedPayloadStatements('messages', message.id, message, payload => messageSql(message, payload))
}

function attachmentStatements(attachment) {
  return chunkedPayloadStatements('attachments', attachment.id, attachment, payload => attachmentSql(attachment, payload))
}

function characterStatements(character) {
  return chunkedPayloadStatements('characters', character.id, character, payload => characterSql(character, payload))
}

function worldBookStatements(worldBook) {
  return chunkedPayloadStatements('world_books', worldBook.id, worldBook, payload => worldBookSql(worldBook, payload))
}

function characterAssetStatements(asset) {
  return [
    ...chunkedPayloadStatements('character_assets', asset.id, asset, payload => characterAssetSql(asset, payload)),
    syncLocalMetadataSql('characterAssets', asset.id, {
      deleted: Boolean(asset.deletedAt),
      sourceUpdatedAt: asset.updatedAt ?? asset.createdAt ?? null
    })
  ]
}

function keyValueSql(table, key, value, payload = encodePayload(value)) {
  return `INSERT OR REPLACE INTO ${table} (key, payload) VALUES (${sqlText(key)}, ${sqlText(payload)})`
}

function keyValueStatements(table, key, value) {
  return chunkedPayloadStatements(table, key, value, payload => keyValueSql(table, key, value, payload))
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
    ...providers.flatMap(providerStatements),
    ...conversations.flatMap(conversationStatements),
    ...messages.flatMap(messageStatements),
    ...attachments.flatMap(attachmentStatements),
    ...characters.flatMap(characterStatements),
    ...worldBooks.flatMap(worldBookStatements),
    ...characterAssets.flatMap(characterAssetStatements),
    ...Object.entries(settings).flatMap(([key, value]) => keyValueStatements('settings', key, value))
  ]
}

function matchesSyncSnapshot(exists, value, expectedSnapshot) {
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
      await this.#migrateLegacyLargePayloads()
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

  async #migrateLegacyLargePayloads() {
    for (const { table, keyColumn } of PAYLOAD_TABLES) {
      const rows = await this.#select(
        `SELECT ${keyColumn} AS entity_id, length(payload) AS payload_length FROM ${table} ` +
        `WHERE payload <> ${sqlText(PAYLOAD_CHUNK_MARKER)} AND length(payload) > ${PAYLOAD_CHUNK_CHARACTERS}`
      )
      for (const row of rows) {
        await this.#migrateLegacyLargePayload({
          table,
          keyColumn,
          entityId: String(row.entity_id),
          payloadLength: Number(row.payload_length)
        })
      }
    }
  }

  async #migrateLegacyLargePayload({ table, keyColumn, entityId, payloadLength }) {
    if (!Number.isSafeInteger(payloadLength) || payloadLength <= PAYLOAD_CHUNK_CHARACTERS) return
    await this.#transaction('begin')
    try {
      await this.#execute(deletePayloadChunksSql(table, entityId))
      for (let offset = 0, chunkIndex = 0; offset < payloadLength; offset += PAYLOAD_CHUNK_CHARACTERS, chunkIndex += 1) {
        const rows = await this.#select(
          `SELECT substr(payload, ${offset + 1}, ${PAYLOAD_CHUNK_CHARACTERS}) AS payload_chunk ` +
          `FROM ${table} WHERE ${keyColumn} = ${sqlText(entityId)} LIMIT 1`
        )
        const payloadChunk = rows[0]?.payload_chunk
        if (typeof payloadChunk !== 'string' || !payloadChunk.length) {
          throw new Error(`SQLite 大字段迁移失败: ${table}/${entityId} 分块缺失`)
        }
        await this.#execute(insertPayloadChunkSql(table, entityId, chunkIndex, payloadChunk))
      }
      await this.#execute(
        `UPDATE ${table} SET payload = ${sqlText(PAYLOAD_CHUNK_MARKER)} WHERE ${keyColumn} = ${sqlText(entityId)}`
      )
      await this.#transaction('commit')
    } catch (error) {
      try { await this.#transaction('rollback') } catch {}
      throw error
    }
  }

  async #decodeStoredPayload(table, entityId, payload) {
    if (payload !== PAYLOAD_CHUNK_MARKER) return decodePayload(payload)
    const countRows = await this.#select(
      `SELECT COUNT(*) AS chunk_count FROM payload_chunks WHERE entity_table = ${sqlText(table)} ` +
      `AND entity_id = ${sqlText(entityId)}`
    )
    const chunkCount = Number(countRows[0]?.chunk_count)
    if (!Number.isSafeInteger(chunkCount) || chunkCount <= 0) {
      throw new Error(`SQLite 大字段分块缺失: ${table}/${entityId}`)
    }
    const chunks = []
    for (let index = 0; index < chunkCount; index += 1) {
      const rows = await this.#select(
        `SELECT payload_chunk FROM payload_chunks WHERE entity_table = ${sqlText(table)} ` +
        `AND entity_id = ${sqlText(entityId)} AND chunk_index = ${index} LIMIT 1`
      )
      if (typeof rows[0]?.payload_chunk !== 'string') {
        throw new Error(`SQLite 大字段分块损坏: ${table}/${entityId}`)
      }
      chunks.push(rows[0].payload_chunk)
    }
    return decodePayload(chunks.join(''))
  }

  async #decodePayloadRows(table, rows, keyColumn = 'id') {
    const values = []
    for (const row of rows) {
      values.push(await this.#decodeStoredPayload(table, row[keyColumn], row.payload))
    }
    return values
  }

  async #get(table, keyColumn, key) {
    const rows = await this.#select(`SELECT payload FROM ${table} WHERE ${keyColumn} = ${sqlText(key)} LIMIT 1`)
    return rows[0] ? this.#decodeStoredPayload(table, key, rows[0].payload) : undefined
  }

  async getAppliedMigrations() {
    const rows = await this.#select('SELECT version FROM schema_migrations ORDER BY version ASC')
    return rows.map((row) => Number(row.version))
  }

  async listProviders() {
    const rows = await this.#select("SELECT id, payload FROM providers WHERE deleted_at IS NULL ORDER BY COALESCE(updated_at, '') DESC")
    return this.#decodePayloadRows('providers', rows)
  }

  getProvider(id) { return this.#get('providers', 'id', id) }
  async saveProvider(provider) { await this.#enqueueWrite(() => this.#transactional(providerStatements(provider))); return provider }
  deleteProvider(id) {
    return this.#enqueueWrite(() => this.#transactional([
      deletePayloadChunksSql('providers', id),
      `DELETE FROM providers WHERE id = ${sqlText(id)}`
    ]))
  }

  async listConversations() {
    const rows = await this.#select("SELECT id, payload FROM conversations WHERE deleted_at IS NULL ORDER BY COALESCE(last_message_at, '') DESC")
    return this.#decodePayloadRows('conversations', rows)
  }

  getConversation(id) { return this.#get('conversations', 'id', id) }
  async saveConversation(conversation) { await this.#enqueueWrite(() => this.#transactional(conversationStatements(conversation))); return conversation }

  async createConversationWithInitialMessage(conversation, message = null) {
    await this.#enqueueWrite(() => this.#transactional([
      ...conversationStatements(conversation),
      ...(message ? messageStatements(message) : [])
    ]))
    return conversation
  }

  async deleteConversation(id) {
    await this.#enqueueWrite(() => this.#transactional([
      `DELETE FROM payload_chunks WHERE entity_table = 'attachments' AND entity_id IN (SELECT id FROM attachments WHERE conversation_id = ${sqlText(id)})`,
      `DELETE FROM payload_chunks WHERE entity_table = 'messages' AND entity_id IN (SELECT id FROM messages WHERE conversation_id = ${sqlText(id)})`,
      deletePayloadChunksSql('conversations', id),
      `DELETE FROM attachments WHERE conversation_id = ${sqlText(id)}`,
      `DELETE FROM messages WHERE conversation_id = ${sqlText(id)}`,
      `DELETE FROM conversations WHERE id = ${sqlText(id)}`
    ]))
  }

  async listMessages(conversationId) {
    const rows = await this.#select(`SELECT id, payload FROM messages WHERE conversation_id = ${sqlText(conversationId)} AND deleted_at IS NULL ORDER BY sequence ASC`)
    return this.#decodePayloadRows('messages', rows)
  }

  async listMessagePage(conversationId, { beforeSequence = null, limit = 60 } = {}) {
    const pageLimit = normalizeMessagePageLimit(limit)
    const before = Number(beforeSequence)
    const hasBefore = beforeSequence !== null && beforeSequence !== undefined && Number.isFinite(before)
    const beforeClause = hasBefore ? ` AND sequence < ${before}` : ''
    const rows = await this.#select(
      `SELECT id, payload FROM messages WHERE conversation_id = ${sqlText(conversationId)} ` +
      `AND deleted_at IS NULL${beforeClause} ORDER BY sequence DESC LIMIT ${pageLimit + 1}`
    )
    const pageRows = rows.slice(0, pageLimit)
    return {
      messages: (await this.#decodePayloadRows('messages', pageRows)).reverse(),
      hasMore: rows.length > pageLimit
    }
  }

  async listLatestMessages(conversationIds = []) {
    const ids = [...new Set(
      (Array.isArray(conversationIds) ? conversationIds : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )]
    const messages = []
    const seenConversations = new Set()
    for (let offset = 0; offset < ids.length; offset += LATEST_MESSAGE_CURSOR_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + LATEST_MESSAGE_CURSOR_BATCH_SIZE)
      const idList = batchIds.map(sqlText).join(', ')
      const rows = await this.#select(
        'SELECT messages.id, messages.payload FROM messages ' +
        'INNER JOIN (' +
          'SELECT conversation_id, MAX(sequence) AS max_sequence FROM messages ' +
          `WHERE deleted_at IS NULL AND conversation_id IN (${idList}) GROUP BY conversation_id` +
        ') AS latest ON latest.conversation_id = messages.conversation_id ' +
          'AND latest.max_sequence = messages.sequence ' +
        'WHERE messages.deleted_at IS NULL ORDER BY messages.conversation_id ASC'
      )
      const decoded = await this.#decodePayloadRows('messages', rows)
      for (const message of decoded) {
        if (!message?.conversationId || seenConversations.has(message.conversationId)) continue
        seenConversations.add(message.conversationId)
        messages.push(message)
      }
    }
    return messages
  }

  async listAllMessages() {
    const rows = await this.#select("SELECT id, payload FROM messages WHERE deleted_at IS NULL ORDER BY COALESCE(created_at, '') ASC, sequence ASC")
    return this.#decodePayloadRows('messages', rows)
  }

  getMessage(id) { return this.#get('messages', 'id', id) }
  async saveMessage(message) { await this.#enqueueWrite(() => this.#transactional(messageStatements(message))); return message }
  async saveMessages(messages) { await this.#enqueueWrite(() => this.#transactional(messages.flatMap(messageStatements))); return messages }

  async createMessagePair(userMessage, assistantMessage, attachments = []) {
    await this.#enqueueWrite(() => this.#transactional([
      ...messageStatements(userMessage),
      ...messageStatements(assistantMessage),
      ...attachments.flatMap(attachmentStatements)
    ]))
    return [userMessage, assistantMessage]
  }

  async saveAttachments(attachments) { await this.#enqueueWrite(() => this.#transactional(attachments.flatMap(attachmentStatements))); return attachments }

  async listAllAttachments() {
    const rows = await this.#select("SELECT id, payload FROM attachments ORDER BY COALESCE(created_at, '') ASC")
    return (await this.#decodePayloadRows('attachments', rows)).filter(attachment => !attachment.deletedAt)
  }

  getAttachment(id) { return this.#get('attachments', 'id', id) }

  async listMessageAttachments(messageId) {
    const rows = await this.#select(`SELECT id, payload FROM attachments WHERE message_id = ${sqlText(messageId)} ORDER BY COALESCE(created_at, '') ASC`)
    return (await this.#decodePayloadRows('attachments', rows)).filter(attachment => !attachment.deletedAt)
  }

  async listConversationAttachments(conversationId) {
    const rows = await this.#select(`SELECT id, payload FROM attachments WHERE conversation_id = ${sqlText(conversationId)} ORDER BY COALESCE(created_at, '') ASC`)
    return (await this.#decodePayloadRows('attachments', rows)).filter(attachment => !attachment.deletedAt)
  }

  deleteAttachmentsByMessage(messageId) {
    return this.#enqueueWrite(() => this.#transactional([
      `DELETE FROM payload_chunks WHERE entity_table = 'attachments' AND entity_id IN (SELECT id FROM attachments WHERE message_id = ${sqlText(messageId)})`,
      `DELETE FROM attachments WHERE message_id = ${sqlText(messageId)}`
    ]))
  }

  async recoverGeneratingMessages(updatedAt = new Date().toISOString()) {
    return this.#enqueueWrite(async () => {
      const rows = await this.#select("SELECT id, payload FROM messages WHERE status = 'generating'")
      if (!rows.length) return 0
      const messages = (await this.#decodePayloadRows('messages', rows))
        .map(message => ({ ...message, status: 'interrupted', updatedAt }))
      await this.#transactional(messages.flatMap(messageStatements))
      return messages.length
    })
  }

  async setSetting(key, value) { await this.#enqueueWrite(() => this.#transactional(keyValueStatements('settings', key, value))); return value }
  async getSetting(key, fallback = null) { return (await this.#get('settings', 'key', key)) ?? fallback }

  async listSettings() {
    const rows = await this.#select('SELECT key, payload FROM settings ORDER BY key ASC')
    const values = await this.#decodePayloadRows('settings', rows, 'key')
    return Object.fromEntries(rows.map((row, index) => [row.key, values[index]]))
  }

  async setSecret(key, value) { await this.#enqueueWrite(() => this.#transactional(keyValueStatements('secrets', key, value))); return value }
  async getSecret(key) { return (await this.#get('secrets', 'key', key)) ?? null }

  async listCharacters() {
    const rows = await this.#select("SELECT id, payload FROM characters WHERE deleted_at IS NULL ORDER BY id ASC")
    return (await this.#decodePayloadRows('characters', rows))
      .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? '')))
  }

  getCharacter(id) { return this.#get('characters', 'id', id) }
  async saveCharacter(character) { await this.#enqueueWrite(() => this.#transactional(characterStatements(character))); return character }

  async findCharactersBySourceHash(sourceHash) {
    const rows = await this.#select(`SELECT id, payload FROM characters WHERE source_hash = ${sqlText(sourceHash)} AND deleted_at IS NULL`)
    return this.#decodePayloadRows('characters', rows)
  }

  async listWorldBooks({ characterId = null, includeGlobal = false } = {}) {
    if (!characterId && !includeGlobal) return []
    const rows = await this.#select('SELECT id, payload FROM world_books WHERE deleted_at IS NULL ORDER BY id ASC')
    return (await this.#decodePayloadRows('world_books', rows))
      .filter(book => {
        const characterIds = Array.isArray(book.characterIds) ? book.characterIds.map(String) : []
        const explicitlyBound = Boolean(characterId) && (book.characterId === characterId || characterIds.includes(String(characterId)))
        const appliesGlobally = includeGlobal && book.scope === 'global' && !book.characterId && characterIds.length === 0
        return explicitlyBound || appliesGlobally
      })
      .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? '')))
  }

  getWorldBook(id) { return this.#get('world_books', 'id', id) }
  async saveWorldBook(worldBook) { await this.#enqueueWrite(() => this.#transactional(worldBookStatements(worldBook))); return worldBook }

  async listAllWorldBooks() {
    const rows = await this.#select("SELECT id, payload FROM world_books WHERE deleted_at IS NULL ORDER BY id ASC")
    return this.#decodePayloadRows('world_books', rows)
  }

  getCharacterAsset(id) { return this.#get('character_assets', 'id', id) }

  async listCharacterAssets(characterId) {
    const rows = await this.#select(`SELECT id, payload FROM character_assets WHERE character_id = ${sqlText(characterId)} ORDER BY COALESCE(created_at, '') ASC`)
    return (await this.#decodePayloadRows('character_assets', rows)).filter(asset => !asset.deletedAt)
  }

  async listAllCharacterAssets() {
    const rows = await this.#select("SELECT id, payload FROM character_assets ORDER BY COALESCE(created_at, '') ASC")
    return (await this.#decodePayloadRows('character_assets', rows)).filter(asset => !asset.deletedAt)
  }

  async listCharacterAssetSyncMetadata() {
    const rows = await this.#select(
      `SELECT assets.id, assets.character_id, assets.created_at, metadata.local_revision, ` +
      `metadata.deleted, metadata.source_updated_at, metadata.sync_hash ` +
      `FROM character_assets AS assets LEFT JOIN sync_local_metadata AS metadata ` +
      `ON metadata.entity_type = 'characterAssets' AND metadata.entity_id = assets.id ` +
      `ORDER BY assets.id ASC`
    )
    return rows.map(row => ({
      id: String(row.id),
      characterId: String(row.character_id ?? ''),
      createdAt: row.created_at ?? null,
      localRevision: row.local_revision === null || row.local_revision === undefined
        ? 0
        : Math.max(0, Math.trunc(Number(row.local_revision) || 0)),
      metadataKnown: row.local_revision !== null && row.local_revision !== undefined,
      deleted: row.deleted === null || row.deleted === undefined ? null : Number(row.deleted) === 1,
      sourceUpdatedAt: row.source_updated_at ?? row.created_at ?? null,
      syncHash: typeof row.sync_hash === 'string' && row.sync_hash ? row.sync_hash : null
    }))
  }

  async getCharacterAssetSyncMetadata(id) {
    const rows = await this.#select(
      `SELECT assets.id, assets.character_id, assets.created_at, metadata.local_revision, ` +
      `metadata.deleted, metadata.source_updated_at, metadata.sync_hash ` +
      `FROM character_assets AS assets LEFT JOIN sync_local_metadata AS metadata ` +
      `ON metadata.entity_type = 'characterAssets' AND metadata.entity_id = assets.id ` +
      `WHERE assets.id = ${sqlText(id)} LIMIT 1`
    )
    if (!rows[0]) return null
    const row = rows[0]
    return {
      id: String(row.id),
      characterId: String(row.character_id ?? ''),
      createdAt: row.created_at ?? null,
      localRevision: row.local_revision === null || row.local_revision === undefined
        ? 0
        : Math.max(0, Math.trunc(Number(row.local_revision) || 0)),
      metadataKnown: row.local_revision !== null && row.local_revision !== undefined,
      deleted: row.deleted === null || row.deleted === undefined ? null : Number(row.deleted) === 1,
      sourceUpdatedAt: row.source_updated_at ?? row.created_at ?? null,
      syncHash: typeof row.sync_hash === 'string' && row.sync_hash ? row.sync_hash : null
    }
  }

  async cacheCharacterAssetSyncHash(id, { expectedRevision = 0, hash, sourceUpdatedAt = null } = {}) {
    const revision = Math.max(0, Math.trunc(Number(expectedRevision) || 0))
    const normalizedHash = String(hash ?? '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new Error('Character asset sync hash is invalid')
    await this.#enqueueWrite(() => this.#transactional([
      `INSERT OR IGNORE INTO sync_local_metadata ` +
        `(entity_type, entity_id, local_revision, deleted, source_updated_at, sync_hash) ` +
        `VALUES ('characterAssets', ${sqlText(id)}, ${revision}, 0, ${sqlText(sourceUpdatedAt)}, ${sqlText(normalizedHash)})`,
      `UPDATE sync_local_metadata SET sync_hash = ${sqlText(normalizedHash)} ` +
        `WHERE entity_type = 'characterAssets' AND entity_id = ${sqlText(id)} ` +
        `AND local_revision = ${revision} AND deleted = 0`
    ]))
    const metadata = await this.getCharacterAssetSyncMetadata(id)
    return metadata?.localRevision === revision && metadata.deleted === false && metadata.syncHash === normalizedHash
  }

  async importCharacterBundle({ character, worldBooks = [], characterAssets = [], conversations = [] }) {
    await this.#enqueueWrite(() => this.#transactional([
      ...characterStatements(character),
      ...worldBooks.flatMap(worldBookStatements),
      ...characterAssets.flatMap(characterAssetStatements),
      ...conversations.flatMap(conversationStatements)
    ]))
    return character
  }

  async saveWorldBookBundle({ worldBook, characters = [] }) {
    await this.#enqueueWrite(() => this.#transactional([
      ...worldBookStatements(worldBook),
      ...characters.flatMap(characterStatements)
    ]))
    return worldBook
  }

  async readBackupData({ includeCharacterAssets = true } = {}) {
    return {
      providers: await this.listProviders(),
      conversations: await this.listConversations(),
      messages: await this.listAllMessages(),
      attachments: await this.listAllAttachments(),
      characters: await this.listCharacters(),
      worldBooks: await this.listAllWorldBooks(),
      characterAssets: includeCharacterAssets ? await this.listAllCharacterAssets() : [],
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
        const exists = Boolean(rows[0])
        const value = exists
          ? await this.#decodeStoredPayload(table, entityId, rows[0].payload)
          : null
        if (!matchesSyncSnapshot(exists, value, expectedSnapshot)) {
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
