import { createCloudSyncCipherSession, hashSyncValue } from '../core/cloud-sync-crypto.js'
import {
  CLOUD_SYNC_PROTOCOL_VERSION,
  createSyncPlaintext,
  extractTombstoneRefs,
  nextMutationTimestamp,
  parseSyncPlaintext,
  syncRecordKey
} from '../core/cloud-sync-protocol.js'
import { createRuntimeId } from '../core/runtime-id.js'

function toWireMutation(mutation) {
  return {
    mutation_id: mutation.mutationId,
    entity_type: mutation.entityType,
    entity_id: mutation.entityId,
    operation: mutation.operation,
    updated_at_ms: mutation.updatedAt,
    envelope: mutation.envelope
  }
}

function descriptorHash(descriptor) {
  return descriptor ? hashSyncValue(descriptor.value) : null
}

function latestPendingByKey(pending) {
  const latest = new Map()
  for (const mutation of pending) latest.set(syncRecordKey(mutation.entityType, mutation.entityId), mutation)
  return latest
}

function hasPendingForKey(state, key, exceptMutationId = '') {
  return state.pending.some(mutation => (
    mutation.mutationId !== exceptMutationId &&
    syncRecordKey(mutation.entityType, mutation.entityId) === key
  ))
}

function mutationDeviceId(mutation, fallbackDeviceId) {
  return String(mutation?.deviceId ?? '').trim() || fallbackDeviceId
}

function takePendingBatch(pending, maximumSize, fallbackDeviceId) {
  const deviceId = mutationDeviceId(pending[0], fallbackDeviceId)
  const batch = []
  for (const mutation of pending) {
    if (batch.length >= maximumSize || mutationDeviceId(mutation, fallbackDeviceId) !== deviceId) break
    batch.push(mutation)
  }
  return { batch, deviceId }
}

function needsBootstrapPull(state) {
  return state.cursor === 0 && Object.keys(state.manifest).length === 0
}

function assertServerRecord(record) {
  const valid = record &&
    typeof record.entity_type === 'string' &&
    typeof record.entity_id === 'string' &&
    ['upsert', 'delete'].includes(record.operation) &&
    Number.isSafeInteger(record.updated_at_ms) && record.updated_at_ms >= 0 &&
    Number.isSafeInteger(record.revision) && record.revision > 0 &&
    typeof record.device_id === 'string' &&
    record.envelope && typeof record.envelope === 'object'
  if (!valid) throw new Error('Cloud sync server returned an invalid record')
  return record
}

export class CloudSyncEngine {
  constructor({
    adapter,
    apiClient,
    stateStore,
    idFactory = createRuntimeId,
    now = Date.now,
    cipherFactory = createCloudSyncCipherSession,
    pushBatchSize = 50,
    pullPageSize = 100,
    maxPendingMutations = 1000,
    maxPullPages = 1000,
    maxRounds = 3
  } = {}) {
    if (!adapter?.readRecords || !adapter?.readRecord || !adapter?.applyRecord) {
      throw new Error('CloudSyncEngine requires a repository adapter')
    }
    if (!apiClient?.pushSyncBatch || !apiClient?.pullSyncPage || !stateStore?.load || !stateStore?.save) {
      throw new Error('CloudSyncEngine requires API and state stores')
    }
    this.adapter = adapter
    this.apiClient = apiClient
    this.stateStore = stateStore
    this.idFactory = idFactory
    this.now = now
    this.cipherFactory = cipherFactory
    this.pushBatchSize = Math.max(1, Math.min(100, Number(pushBatchSize) || 50))
    this.pullPageSize = Math.max(1, Math.min(500, Number(pullPageSize) || 100))
    this.maxPendingMutations = Math.max(this.pushBatchSize, Number(maxPendingMutations) || 1000)
    this.maxPullPages = Math.max(1, Number(maxPullPages) || 1000)
    this.maxRounds = Math.max(1, Number(maxRounds) || 3)
  }

  async sync({ accountId, deviceId, syncPassword } = {}) {
    const normalizedDeviceId = String(deviceId ?? '').trim()
    if (!normalizedDeviceId) throw new Error('Cloud sync device id is required')
    const state = await this.stateStore.load(accountId)
    const cipher = await this.cipherFactory(syncPassword, { salt: state.encryptionSalt })
    const summary = {
      pushed: 0,
      pulled: 0,
      applied: 0,
      conflicts: 0,
      cursor: state.cursor,
      pending: state.pending.length
    }

    try {
      if (!state.encryptionSalt) {
        state.encryptionSalt = cipher.salt
        await this.stateStore.save(accountId, state)
      }

      if (needsBootstrapPull(state)) {
        await this.#pullChanges({ accountId, state, cipher, summary })
      }

      for (let round = 0; round < this.maxRounds; round += 1) {
        await this.#stageLocalMutations(state, cipher, normalizedDeviceId)
        await this.stateStore.save(accountId, state)
        await this.#pushPending({ accountId, deviceId: normalizedDeviceId, state, cipher, summary })
        await this.#pullChanges({ accountId, state, cipher, summary })
        await this.#stageLocalMutations(state, cipher, normalizedDeviceId)
        await this.stateStore.save(accountId, state)
        if (state.pending.length === 0) break
      }

      summary.cursor = state.cursor
      summary.pending = state.pending.length
      return summary
    } finally {
      cipher.close?.()
    }
  }

  async #stageLocalMutations(state, cipher, deviceId) {
    const records = await this.adapter.readRecords()
    const current = new Map()
    for (const descriptor of records) {
      const key = syncRecordKey(descriptor.entityType, descriptor.entityId)
      const manifest = state.manifest[key]
      if (descriptor.entityType === 'settings' && descriptor.value === null && manifest?.deleted) continue
      current.set(key, { ...descriptor, hash: descriptorHash(descriptor) })
    }

    const latestPending = latestPendingByKey(state.pending)
    for (const [key, descriptor] of current) {
      const pending = latestPending.get(key)
      const manifest = state.manifest[key]
      const baselineHash = pending?.operation === 'upsert'
        ? pending.localHash
        : (!pending && manifest && !manifest.deleted ? manifest.hash : null)
      if (baselineHash === descriptor.hash) continue

      const previousUpdatedAt = pending?.updatedAt ?? manifest?.updatedAt ?? -1
      const changed = Boolean(pending || manifest)
      const tombstoneBaseline = pending?.operation === 'delete'
        ? {
            updatedAt: pending.updatedAt,
            previousHash: manifest?.deleted ? manifest.previousHash : manifest?.hash
          }
        : (manifest?.deleted ? manifest : null)
      let updatedAt
      if (tombstoneBaseline && descriptor.sourceUpdatedAt !== null) {
        updatedAt = descriptor.sourceUpdatedAt
      } else if (tombstoneBaseline?.previousHash === descriptor.hash) {
        updatedAt = Math.max(0, Number(tombstoneBaseline.updatedAt) - 1)
      } else {
        updatedAt = nextMutationTimestamp({
          record: descriptor.value,
          previousUpdatedAt,
          now: this.now(),
          changed
        })
      }
      if (state.pending.length >= this.maxPendingMutations) return
      const plaintext = createSyncPlaintext({
        entityType: descriptor.entityType,
        entityId: descriptor.entityId,
        operation: 'upsert',
        value: descriptor.value
      })
      const mutation = {
        mutationId: this.idFactory(),
        entityType: descriptor.entityType,
        entityId: descriptor.entityId,
        operation: 'upsert',
        updatedAt,
        deviceId,
        localHash: descriptor.hash,
        refs: descriptor.refs,
        envelope: await cipher.encrypt(plaintext, {
          entityType: descriptor.entityType,
          entityId: descriptor.entityId,
          operation: 'upsert',
          updatedAt
        })
      }
      state.pending.push(mutation)
      latestPending.set(key, mutation)
    }

    const knownKeys = new Set([...Object.keys(state.manifest), ...latestPending.keys()])
    for (const key of knownKeys) {
      if (current.has(key)) continue
      const pending = latestPending.get(key)
      const manifest = state.manifest[key]
      if (pending?.operation === 'delete' || (!pending && (!manifest || manifest.deleted))) continue
      const source = pending ?? manifest
      if (!source) continue
      if (state.pending.length >= this.maxPendingMutations) return
      const updatedAt = Math.max(
        Math.max(0, Math.trunc(Number(this.now()) || 0)),
        Math.trunc(Number(source.updatedAt) || 0) + 1
      )
      const deletedAt = new Date(updatedAt).toISOString()
      const refs = source.refs ?? {}
      const entityType = source.entityType ?? JSON.parse(key)[0]
      const entityId = source.entityId ?? JSON.parse(key)[1]
      if (entityType === 'settings' && this.adapter.isLocalOnlySetting?.(entityId)) continue
      const plaintext = createSyncPlaintext({ entityType, entityId, operation: 'delete', deletedAt, refs })
      const mutation = {
        mutationId: this.idFactory(),
        entityType,
        entityId,
        operation: 'delete',
        updatedAt,
        deviceId,
        localHash: null,
        refs,
        envelope: await cipher.encrypt(plaintext, { entityType, entityId, operation: 'delete', updatedAt })
      }
      state.pending.push(mutation)
      latestPending.set(key, mutation)
    }
  }

  async #pushPending({ accountId, deviceId, state, cipher, summary }) {
    let effectiveBatchSize = this.pushBatchSize
    while (state.pending.length > 0) {
      const pendingBatch = takePendingBatch(state.pending, effectiveBatchSize, deviceId)
      const batch = pendingBatch.batch
      let response
      try {
        response = await this.apiClient.pushSyncBatch({
          protocolVersion: CLOUD_SYNC_PROTOCOL_VERSION,
          deviceId: pendingBatch.deviceId,
          mutations: batch.map(toWireMutation)
        })
      } catch (error) {
        if (error?.code !== 'sync_batch_too_large') throw error
        if (batch.length === 1) {
          const recordError = new Error('One encrypted sync record exceeds the server size limit')
          recordError.code = 'sync_record_too_large'
          recordError.cause = error
          throw recordError
        }
        effectiveBatchSize = Math.max(1, Math.floor(batch.length / 2))
        continue
      }
      if (response?.protocol_version !== CLOUD_SYNC_PROTOCOL_VERSION || !Array.isArray(response.results)) {
        throw new Error('Cloud sync server returned an invalid push response')
      }
      const resultById = new Map(response.results.map(result => [result.mutation_id, result]))
      for (const mutation of batch) {
        const result = resultById.get(mutation.mutationId)
        if (!result || !Number.isSafeInteger(result.mutation_revision) || result.mutation_revision <= 0) {
          throw new Error('Cloud sync push response omitted a mutation result')
        }
        const canonical = await this.#decryptServerRecord(result.record, cipher)
        const applied = await this.#acceptCanonical({
          state,
          canonical,
          expectedMutation: mutation,
          deferForPending: hasPendingForKey(state, canonical.key, mutation.mutationId)
        })
        if (applied) summary.applied += 1
        state.pending = state.pending.filter(item => item.mutationId !== mutation.mutationId)
        summary.pushed += 1
        if (result.accepted !== true) summary.conflicts += 1
      }
      await this.stateStore.save(accountId, state)
    }
  }

  async #pullChanges({ accountId, state, cipher, summary }) {
    let pages = 0
    let hasMore = true
    while (hasMore) {
      if (pages >= this.maxPullPages) throw new Error('Cloud sync pull page limit exceeded')
      pages += 1
      const previousCursor = state.cursor
      const page = await this.apiClient.pullSyncPage({
        protocolVersion: CLOUD_SYNC_PROTOCOL_VERSION,
        cursor: state.cursor,
        limit: this.pullPageSize
      })
      if (
        page?.protocol_version !== CLOUD_SYNC_PROTOCOL_VERSION ||
        !Array.isArray(page.changes) ||
        !Number.isSafeInteger(page.next_cursor) ||
        page.next_cursor < state.cursor
      ) {
        throw new Error('Cloud sync server returned an invalid pull page')
      }
      for (const record of page.changes) {
        const canonical = await this.#decryptServerRecord(record, cipher)
        const manifest = state.manifest[canonical.key]
        if (manifest && canonical.revision <= Number(manifest.revision ?? 0)) continue
        const deferForPending = hasPendingForKey(state, canonical.key)
        const applied = await this.#acceptCanonical({ state, canonical, deferForPending })
        if (applied) summary.applied += 1
        summary.pulled += 1
      }
      state.cursor = page.next_cursor
      hasMore = page.has_more === true
      if (hasMore && state.cursor <= previousCursor) throw new Error('Cloud sync pull cursor did not advance')
      await this.stateStore.save(accountId, state)
    }
  }

  async #decryptServerRecord(serverRecord, cipher) {
    const record = assertServerRecord(serverRecord)
    const context = {
      entityType: record.entity_type,
      entityId: record.entity_id,
      operation: record.operation,
      updatedAt: record.updated_at_ms
    }
    const plaintext = parseSyncPlaintext(await cipher.decrypt(record.envelope, context), context)
    const key = syncRecordKey(context.entityType, context.entityId)
    const value = context.operation === 'upsert' ? plaintext.value : null
    const tombstone = context.operation === 'delete' ? plaintext.tombstone : null
    return {
      key,
      entityType: context.entityType,
      entityId: context.entityId,
      operation: context.operation,
      updatedAt: context.updatedAt,
      revision: record.revision,
      deviceId: record.device_id,
      value,
      tombstone,
      hash: context.operation === 'upsert' ? hashSyncValue(value) : null,
      refs: context.operation === 'upsert'
        ? extractTombstoneRefs(context.entityType, value)
        : cloneRefs(tombstone?.refs)
    }
  }

  async #acceptCanonical({ state, canonical, expectedMutation = null, deferForPending = false }) {
    if (canonical.entityType === 'settings' && this.adapter.isLocalOnlySetting?.(canonical.entityId)) return false
    const previous = state.manifest[canonical.key]
    if (previous && canonical.revision < Number(previous.revision ?? 0)) return false
    if (previous && canonical.revision === Number(previous.revision ?? 0) && !expectedMutation) return false
    const localState = typeof this.adapter.readRecordState === 'function'
      ? await this.adapter.readRecordState(canonical.entityType, canonical.entityId)
      : { record: await this.adapter.readRecord(canonical.entityType, canonical.entityId), snapshot: null }
    const local = localState.record
    const localHash = descriptorHash(local)
    const localIsDeleted = !local || (
      canonical.entityType === 'settings' && local.value === null && previous?.deleted
    )
    let localIsClean
    if (expectedMutation) {
      localIsClean = expectedMutation.operation === 'delete'
        ? localIsDeleted
        : localHash === expectedMutation.localHash
    } else if (!previous) {
      localIsClean = localIsDeleted
    } else {
      localIsClean = previous.deleted ? localIsDeleted : localHash === previous.hash
    }

    let applied = false
    if (!deferForPending && localIsClean) {
      const alreadyCanonical = canonical.operation === 'delete'
        ? localIsDeleted
        : localHash === canonical.hash
      if (!alreadyCanonical) {
        const result = await this.adapter.applyRecord(canonical, { expectedSnapshot: localState.snapshot })
        applied = result?.applied !== false
      }
    }

    state.manifest[canonical.key] = {
      entityType: canonical.entityType,
      entityId: canonical.entityId,
      hash: canonical.hash,
      updatedAt: canonical.updatedAt,
      revision: canonical.revision,
      deviceId: canonical.deviceId,
      deleted: canonical.operation === 'delete',
      refs: canonical.refs,
      previousHash: canonical.operation === 'delete'
        ? (previous?.deleted ? previous.previousHash : previous?.hash ?? null)
        : null
    }
    return applied
  }
}

function cloneRefs(refs) {
  return refs && typeof refs === 'object' ? JSON.parse(JSON.stringify(refs)) : {}
}
