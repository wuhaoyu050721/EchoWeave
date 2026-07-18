export const CLOUD_SYNC_PROTOCOL_VERSION = 1

export const CLOUD_SYNC_ENTITY_TYPES = Object.freeze([
  'providers',
  'conversations',
  'messages',
  'attachments',
  'characters',
  'worldBooks',
  'characterAssets',
  'settings'
])

export const CLOUD_SYNC_OPERATIONS = Object.freeze(['upsert', 'delete'])

const ENTITY_TYPE_SET = new Set(CLOUD_SYNC_ENTITY_TYPES)
const OPERATION_SET = new Set(CLOUD_SYNC_OPERATIONS)

function canonicalValue(value, inArray = false) {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    return value.map(item => canonicalValue(item, true) ?? null)
  }
  if (value && typeof value.toJSON === 'function') {
    return canonicalValue(value.toJSON(), inArray)
  }
  if (value && typeof value === 'object') {
    const normalized = {}
    for (const key of Object.keys(value).sort()) {
      const item = canonicalValue(value[key], false)
      if (item !== undefined) normalized[key] = item
    }
    return normalized
  }
  return inArray ? null : undefined
}

export function canonicalSyncJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export function assertSyncEntityType(entityType) {
  if (!ENTITY_TYPE_SET.has(entityType)) throw new Error(`Unsupported sync entity type: ${entityType}`)
  return entityType
}

export function assertSyncOperation(operation) {
  if (!OPERATION_SET.has(operation)) throw new Error(`Unsupported sync operation: ${operation}`)
  return operation
}

export function syncRecordKey(entityType, entityId) {
  assertSyncEntityType(entityType)
  const id = String(entityId ?? '')
  if (!id) throw new Error('Sync entity id is required')
  return JSON.stringify([entityType, id])
}

export function timestampFromRecord(record) {
  for (const candidate of [record?.updatedAt, record?.createdAt, record?.lastMessageAt]) {
    const parsed = parseTimestamp(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

export function nextMutationTimestamp({ record, previousUpdatedAt = -1, now = Date.now(), changed = false } = {}) {
  const recordTimestamp = timestampFromRecord(record)
  const explicitUpdatedAt = parseTimestamp(record?.updatedAt)
  const previousFloor = Math.trunc(Number(previousUpdatedAt) || 0) + 1
  if (explicitUpdatedAt !== null) {
    return changed ? Math.max(explicitUpdatedAt, previousFloor) : explicitUpdatedAt
  }
  const wallClock = Math.max(0, Math.trunc(Number(now) || 0))
  if (!changed && recordTimestamp !== null) return recordTimestamp
  return Math.max(recordTimestamp ?? 0, wallClock, previousFloor)
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function extractTombstoneRefs(entityType, value = {}) {
  assertSyncEntityType(entityType)
  if (entityType === 'messages') {
    return { conversationId: String(value.conversationId ?? ''), sequence: Number(value.sequence) || 0 }
  }
  if (entityType === 'attachments') {
    return {
      conversationId: String(value.conversationId ?? ''),
      messageId: String(value.messageId ?? ''),
      createdAt: value.createdAt ?? null
    }
  }
  if (entityType === 'worldBooks') {
    return { characterId: value.characterId ?? null, scope: value.scope ?? null }
  }
  if (entityType === 'characterAssets') {
    return { characterId: String(value.characterId ?? ''), createdAt: value.createdAt ?? null }
  }
  return {}
}

export function createSyncPlaintext({ entityType, entityId, operation, value, deletedAt, refs = {} }) {
  assertSyncEntityType(entityType)
  assertSyncOperation(operation)
  const plaintext = {
    protocolVersion: CLOUD_SYNC_PROTOCOL_VERSION,
    entityType,
    entityId: String(entityId)
  }
  if (operation === 'upsert') plaintext.value = value
  else plaintext.tombstone = { deletedAt, refs }
  return plaintext
}

export function parseSyncPlaintext(plaintext, { entityType, entityId, operation }) {
  const valid = plaintext?.protocolVersion === CLOUD_SYNC_PROTOCOL_VERSION &&
    plaintext?.entityType === entityType &&
    plaintext?.entityId === String(entityId)
  if (!valid) throw new Error('Encrypted sync record identity does not match its metadata')
  if (operation === 'upsert' && !Object.prototype.hasOwnProperty.call(plaintext, 'value')) {
    throw new Error('Encrypted sync upsert has no value')
  }
  if (operation === 'delete' && !plaintext.tombstone) {
    throw new Error('Encrypted sync tombstone is missing')
  }
  return plaintext
}

export function compareSyncVersion(left, right) {
  for (const key of ['updatedAt', 'deleteRank', 'revision']) {
    const difference = Number(left?.[key] ?? 0) - Number(right?.[key] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return String(left?.deviceId ?? '').localeCompare(String(right?.deviceId ?? ''))
}
