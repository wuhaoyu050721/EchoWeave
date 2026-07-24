import {
  CLOUD_SYNC_ENTITY_TYPES,
  extractTombstoneRefs,
  syncRecordKey,
  timestampFromRecord
} from '../core/cloud-sync-protocol.js'
import { hashSyncValue } from '../core/cloud-sync-crypto.js'

export const DEFAULT_LOCAL_ONLY_SYNC_SETTINGS = Object.freeze([
  'cloudDeviceId',
  'cloudAutoBackup',
  'cloudConfig'
])

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function without(object, ...keys) {
  return Object.fromEntries(Object.entries(object ?? {}).filter(([key]) => !keys.includes(key)))
}

function emptyImport() {
  return {
    providers: [],
    conversations: [],
    messages: [],
    attachments: [],
    characters: [],
    worldBooks: [],
    characterAssets: [],
    settings: {}
  }
}

function tombstoneValue(entityType, entityId, tombstone, updatedAt) {
  const deletedAt = String(tombstone?.deletedAt ?? new Date(updatedAt).toISOString())
  const refs = tombstone?.refs && typeof tombstone.refs === 'object' ? tombstone.refs : {}
  const record = {
    id: entityId,
    ...cloneJson(refs),
    updatedAt: new Date(updatedAt).toISOString(),
    deletedAt
  }
  if (entityType === 'messages' && !record.conversationId) record.conversationId = '__sync_deleted__'
  if (entityType === 'attachments') {
    if (!record.conversationId) record.conversationId = '__sync_deleted__'
    if (!record.messageId) record.messageId = '__sync_deleted__'
  }
  if (entityType === 'characterAssets' && !record.characterId) record.characterId = '__sync_deleted__'
  return record
}

export class CloudSyncRepositoryAdapter {
  constructor({
    repository,
    vault,
    localOnlySettingKeys = DEFAULT_LOCAL_ONLY_SYNC_SETTINGS
  } = {}) {
    if (!repository?.readBackupData || !repository?.importRecords || !vault?.encryptString || !vault?.decryptString) {
      throw new Error('CloudSyncRepositoryAdapter requires repository and vault')
    }
    this.repository = repository
    this.vault = vault
    this.localOnlySettingKeys = new Set(localOnlySettingKeys)
  }

  isLocalOnlySetting(key) {
    return this.localOnlySettingKeys.has(String(key))
  }

  async readRecords({ manifest = {} } = {}) {
    const supportsAssetMetadata = typeof this.repository.listCharacterAssetSyncMetadata === 'function'
    const data = await this.repository.readBackupData(
      supportsAssetMetadata ? { includeCharacterAssets: false } : undefined
    )
    const records = []
    for (const entityType of CLOUD_SYNC_ENTITY_TYPES) {
      if (entityType === 'characterAssets' && supportsAssetMetadata) continue
      if (entityType === 'settings') {
        for (const [entityId, value] of Object.entries(data.settings ?? {})) {
          if (this.isLocalOnlySetting(entityId)) continue
          records.push(await this.#descriptor(entityType, entityId, value))
        }
        continue
      }
      for (const value of data[entityType] ?? []) {
        if (!value?.id) continue
        records.push(await this.#descriptor(entityType, value.id, value))
      }
    }
    if (supportsAssetMetadata) {
      records.push(...await this.#characterAssetDescriptors({
        manifest,
        characters: data.characters ?? []
      }))
    }
    return records
  }

  async materializeRecord(descriptor) {
    const entityType = String(descriptor?.entityType ?? '')
    const entityId = String(descriptor?.entityId ?? '')
    if (!entityType || !entityId) return null
    const snapshot = await this.#readStorageRecord(entityType, entityId)
    if (!snapshot.exists || snapshot.value?.deletedAt) return null
    const materialized = await this.#descriptor(entityType, entityId, snapshot.value)
    materialized.hash = hashSyncValue(materialized.value)
    if (entityType === 'characterAssets') {
      const metadata = await this.repository.getCharacterAssetSyncMetadata?.(entityId)
      materialized.localRevision = metadata?.localRevision ?? descriptor?.localRevision ?? 0
      await this.repository.cacheCharacterAssetSyncHash?.(entityId, {
        expectedRevision: materialized.localRevision,
        hash: materialized.hash,
        sourceUpdatedAt: snapshot.value.updatedAt ?? snapshot.value.createdAt ?? null
      })
    }
    return materialized
  }

  async readRecord(entityType, entityId) {
    return (await this.readRecordState(entityType, entityId)).record
  }

  async readRecordState(entityType, entityId) {
    if (entityType === 'settings' && this.isLocalOnlySetting(entityId)) {
      return { record: null, snapshot: { exists: false, value: null } }
    }
    const snapshot = await this.#readStorageRecord(entityType, entityId)
    const visible = snapshot.exists && (entityType === 'settings' || (snapshot.value !== null && !snapshot.value?.deletedAt))
    return {
      record: visible ? await this.#descriptor(entityType, entityId, snapshot.value) : null,
      snapshot
    }
  }

  async applyRecord(change, { expectedSnapshot } = {}) {
    const { entityType, entityId, operation, value, tombstone, updatedAt } = change
    if (entityType === 'settings' && this.isLocalOnlySetting(entityId)) return { skipped: 'local_only_setting' }
    const records = emptyImport()
    if (entityType === 'settings') {
      records.settings[entityId] = operation === 'delete'
        ? null
        : await this.#fromPortable(entityType, value, entityId)
    } else {
      const record = operation === 'delete'
        ? tombstoneValue(entityType, entityId, tombstone, updatedAt)
        : await this.#fromPortable(entityType, value, entityId)
      if (operation === 'upsert' && String(record?.id ?? '') !== String(entityId)) {
        throw new Error('Decrypted sync record id does not match its metadata')
      }
      records[entityType].push(record)
    }
    let result = { applied: true }
    if (expectedSnapshot && typeof this.repository.importRecordsIfUnchanged === 'function') {
      const applied = await this.repository.importRecordsIfUnchanged({
        entityType,
        entityId,
        expectedSnapshot,
        records
      })
      if (!applied) return { applied: false, reason: 'local_changed' }
    } else {
      await this.repository.importRecords(records)
    }
    if (entityType === 'characterAssets' && operation === 'upsert') {
      const metadata = await this.repository.getCharacterAssetSyncMetadata?.(entityId)
      const hash = typeof change.hash === 'string' && change.hash
        ? change.hash
        : hashSyncValue(value)
      await this.repository.cacheCharacterAssetSyncHash?.(entityId, {
        expectedRevision: metadata?.localRevision ?? 0,
        hash,
        sourceUpdatedAt: value?.updatedAt ?? value?.createdAt ?? null
      })
    }
    return result
  }

  async #readStorageRecord(entityType, entityId) {
    let value
    let exists = false
    if (entityType === 'providers') value = await this.repository.getProvider?.(entityId)
    else if (entityType === 'conversations') value = await this.repository.getConversation?.(entityId)
    else if (entityType === 'messages') value = await this.repository.getMessage?.(entityId)
    else if (entityType === 'attachments') {
      value = typeof this.repository.getAttachment === 'function'
        ? await this.repository.getAttachment(entityId)
        : (await this.repository.listAllAttachments()).find(record => record.id === entityId)
    } else if (entityType === 'characters') value = await this.repository.getCharacter?.(entityId)
    else if (entityType === 'worldBooks') value = await this.repository.getWorldBook?.(entityId)
    else if (entityType === 'characterAssets') value = await this.repository.getCharacterAsset?.(entityId)
    else if (entityType === 'settings') {
      const missing = {}
      value = await this.repository.getSetting(entityId, missing)
      exists = value !== missing
      if (!exists) value = null
      return { exists, value: cloneJson(value) }
    }
    exists = value !== undefined && value !== null
    return { exists, value: cloneJson(value ?? null) }
  }

  async #descriptor(entityType, entityId, localValue) {
    const value = await this.#toPortable(entityType, localValue, entityId)
    return {
      entityType,
      entityId: String(entityId),
      value,
      sourceUpdatedAt: timestampFromRecord(value),
      refs: extractTombstoneRefs(entityType, value)
    }
  }

  async #characterAssetDescriptors({ manifest, characters }) {
    const deletedAssetIds = new Set(
      characters.flatMap(character => Array.isArray(character?.deletedAssetIds) ? character.deletedAssetIds : [])
        .map(String)
    )
    const records = []
    for (const metadata of await this.repository.listCharacterAssetSyncMetadata()) {
      const entityId = String(metadata.id)
      const key = syncRecordKey('characterAssets', entityId)
      const baseline = manifest?.[key]
      const legacyDeleted = metadata.metadataKnown === false && (
        baseline?.deleted === true || deletedAssetIds.has(entityId)
      )
      if (metadata.deleted === true || legacyDeleted) continue

      let hash = metadata.syncHash
      if (
        !hash &&
        metadata.metadataKnown === false &&
        baseline &&
        baseline.deleted !== true &&
        typeof baseline.hash === 'string' &&
        baseline.hash
      ) {
        hash = baseline.hash
        await this.repository.cacheCharacterAssetSyncHash?.(entityId, {
          expectedRevision: 0,
          hash,
          sourceUpdatedAt: metadata.sourceUpdatedAt ?? metadata.createdAt ?? null
        })
      }

      if (hash) {
        records.push({
          entityType: 'characterAssets',
          entityId,
          value: undefined,
          hash,
          localRevision: metadata.localRevision ?? 0,
          sourceUpdatedAt: timestampFromRecord({
            updatedAt: metadata.sourceUpdatedAt,
            createdAt: metadata.createdAt
          }),
          refs: {
            characterId: String(metadata.characterId ?? ''),
            createdAt: metadata.createdAt ?? null
          }
        })
        continue
      }

      const value = await this.repository.getCharacterAsset(entityId)
      if (!value || value.deletedAt) continue
      const descriptor = await this.#descriptor('characterAssets', entityId, value)
      descriptor.hash = hashSyncValue(descriptor.value)
      descriptor.localRevision = metadata.localRevision ?? 0
      await this.repository.cacheCharacterAssetSyncHash?.(entityId, {
        expectedRevision: descriptor.localRevision,
        hash: descriptor.hash,
        sourceUpdatedAt: value.updatedAt ?? value.createdAt ?? null
      })
      records.push(descriptor)
    }
    return records
  }

  async #toPortable(entityType, localValue, entityId) {
    if (entityType === 'providers') {
      return {
        ...without(localValue, 'encryptedApiKey'),
        apiKey: localValue.encryptedApiKey ? await this.vault.decryptString(localValue.encryptedApiKey) : ''
      }
    }
    if (entityType === 'conversations') {
      return {
        ...without(localValue, 'encryptedSystemPrompt'),
        systemPrompt: localValue.encryptedSystemPrompt
          ? await this.vault.decryptString(localValue.encryptedSystemPrompt)
          : ''
      }
    }
    if (entityType === 'settings' && entityId === 'systemPrompt') {
      return {
        ...without(localValue, 'encryptedValue'),
        value: localValue.encryptedValue ? await this.vault.decryptString(localValue.encryptedValue) : ''
      }
    }
    return cloneJson(localValue)
  }

  async #fromPortable(entityType, portableValue, entityId) {
    if (entityType === 'providers') {
      return {
        ...without(portableValue, 'apiKey'),
        encryptedApiKey: portableValue?.apiKey ? await this.vault.encryptString(portableValue.apiKey) : null
      }
    }
    if (entityType === 'conversations') {
      return {
        ...without(portableValue, 'systemPrompt'),
        encryptedSystemPrompt: portableValue?.systemPrompt
          ? await this.vault.encryptString(portableValue.systemPrompt)
          : null
      }
    }
    if (entityType === 'settings' && entityId === 'systemPrompt') {
      return {
        ...without(portableValue, 'value'),
        encryptedValue: portableValue.value ? await this.vault.encryptString(portableValue.value) : null
      }
    }
    return cloneJson(portableValue)
  }
}
