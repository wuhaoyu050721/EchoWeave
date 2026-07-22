import assert from 'node:assert/strict'
import test from 'node:test'
import { extractTombstoneRefs, syncRecordKey, timestampFromRecord } from '../src/core/cloud-sync-protocol.js'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { CloudSyncEngine } from '../src/services/cloud-sync-engine.js'
import { CloudSyncRepositoryAdapter } from '../src/services/cloud-sync-repository-adapter.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function fakeCipherFactory(_password, { salt = '' } = {}) {
  return Promise.resolve({
    salt: salt || 'fake-encryption-salt',
    encrypt: async (plaintext, context) => ({
      version: 1,
      aad: Buffer.from(JSON.stringify(context)).toString('base64'),
      ciphertext: Buffer.from(JSON.stringify(plaintext)).toString('base64')
    }),
    decrypt: async (envelope, context) => {
      assert.equal(Buffer.from(envelope.aad, 'base64').toString(), JSON.stringify(context))
      return JSON.parse(Buffer.from(envelope.ciphertext, 'base64').toString())
    },
    close() {}
  })
}

function passwordAwareCipherFactory(password, { salt = '' } = {}) {
  const normalizedPassword = String(password)
  return Promise.resolve({
    salt: salt || 'password-aware-salt',
    encrypt: async (plaintext, context) => ({
      password: normalizedPassword,
      plaintext: clone(plaintext),
      context: clone(context)
    }),
    decrypt: async (envelope, context) => {
      if (envelope.password !== normalizedPassword) throw new Error('incorrect sync password')
      assert.deepEqual(envelope.context, context)
      return clone(envelope.plaintext)
    },
    close() {}
  })
}

class MemoryAdapter {
  constructor(records = []) {
    this.records = new Map()
    this.applied = []
    for (const record of records) this.put(record.entityType, record.entityId, record.value)
  }

  put(entityType, entityId, value) {
    this.records.set(syncRecordKey(entityType, entityId), { entityType, entityId, value: clone(value) })
  }

  remove(entityType, entityId) {
    this.records.delete(syncRecordKey(entityType, entityId))
  }

  value(entityType, entityId) {
    return clone(this.records.get(syncRecordKey(entityType, entityId))?.value)
  }

  async readRecords() {
    return Array.from(this.records.values(), record => this.#descriptor(record))
  }

  async readRecord(entityType, entityId) {
    return (await this.readRecordState(entityType, entityId)).record
  }

  async readRecordState(entityType, entityId) {
    const record = this.records.get(syncRecordKey(entityType, entityId))
    return {
      record: record ? this.#descriptor(record) : null,
      snapshot: {
        exists: Boolean(record),
        value: record ? clone(record.value) : null
      }
    }
  }

  async applyRecord(change, { expectedSnapshot } = {}) {
    await this.beforeApply?.(change)
    const current = this.records.get(syncRecordKey(change.entityType, change.entityId))
    const currentSnapshot = {
      exists: Boolean(current),
      value: current ? clone(current.value) : null
    }
    if (expectedSnapshot && JSON.stringify(currentSnapshot) !== JSON.stringify(expectedSnapshot)) {
      return { applied: false, reason: 'local_changed' }
    }
    this.applied.push(clone(change))
    if (change.operation === 'delete') this.remove(change.entityType, change.entityId)
    else this.put(change.entityType, change.entityId, change.value)
    return { applied: true }
  }

  #descriptor(record) {
    return {
      entityType: record.entityType,
      entityId: record.entityId,
      value: clone(record.value),
      sourceUpdatedAt: timestampFromRecord(record.value),
      refs: extractTombstoneRefs(record.entityType, record.value)
    }
  }
}

class MemoryStateStore {
  constructor() {
    this.states = new Map()
  }

  async load(accountId) {
    return clone(this.states.get(String(accountId)) ?? {
      version: 1,
      cursor: 0,
      encryptionSalt: '',
      manifest: {},
      pending: []
    })
  }

  async save(accountId, state) {
    this.states.set(String(accountId), clone(state))
  }

  current(accountId) {
    return clone(this.states.get(String(accountId)))
  }
}

class FakeSyncApi {
  constructor({ failAfterFirstPush = false } = {}) {
    this.revision = 0
    this.records = new Map()
    this.changes = []
    this.receipts = new Map()
    this.receivedMutationIds = []
    this.pushCalls = []
    this.failAfterFirstPush = failAfterFirstPush
    this.failed = false
  }

  async pushSyncBatch({ protocolVersion, deviceId, mutations }) {
    assert.equal(protocolVersion, 1)
    this.pushCalls.push({ deviceId, mutationIds: mutations.map(mutation => mutation.mutation_id) })
    const results = []
    for (const mutation of mutations) {
      this.receivedMutationIds.push(mutation.mutation_id)
      const requestHash = JSON.stringify({ deviceId, mutation })
      const existingReceipt = this.receipts.get(mutation.mutation_id)
      const key = syncRecordKey(mutation.entity_type, mutation.entity_id)
      if (existingReceipt) {
        assert.equal(existingReceipt.requestHash, requestHash)
        results.push({
          mutation_id: mutation.mutation_id,
          mutation_revision: existingReceipt.revision,
          accepted: existingReceipt.accepted,
          record: clone(this.records.get(key))
        })
        continue
      }

      this.revision += 1
      const current = this.records.get(key)
      const candidate = {
        entity_type: mutation.entity_type,
        entity_id: mutation.entity_id,
        operation: mutation.operation,
        updated_at_ms: mutation.updated_at_ms,
        device_id: deviceId,
        revision: this.revision,
        envelope: clone(mutation.envelope)
      }
      const accepted = !current || this.#compare(candidate, current) > 0
      if (accepted) {
        this.records.set(key, candidate)
        this.changes.push(clone(candidate))
      }
      this.receipts.set(mutation.mutation_id, { requestHash, revision: this.revision, accepted })
      results.push({
        mutation_id: mutation.mutation_id,
        mutation_revision: this.revision,
        accepted,
        record: clone(this.records.get(key))
      })
    }
    if (this.failAfterFirstPush && !this.failed) {
      this.failed = true
      const error = new Error('simulated response loss')
      error.code = 'network_error'
      throw error
    }
    return { protocol_version: 1, server_cursor: this.revision, results }
  }

  async pullSyncPage({ protocolVersion, cursor, limit }) {
    assert.equal(protocolVersion, 1)
    const available = this.changes.filter(change => change.revision > cursor)
    const changes = available.slice(0, limit)
    const hasMore = available.length > changes.length
    return {
      protocol_version: 1,
      changes: clone(changes),
      next_cursor: hasMore ? changes.at(-1).revision : this.revision,
      has_more: hasMore,
      server_cursor: this.revision
    }
  }

  #compare(left, right) {
    if (left.updated_at_ms !== right.updated_at_ms) return left.updated_at_ms - right.updated_at_ms
    const deleteDifference = Number(left.operation === 'delete') - Number(right.operation === 'delete')
    if (deleteDifference) return deleteDifference
    if (left.revision !== right.revision) return left.revision - right.revision
    return left.device_id.localeCompare(right.device_id)
  }
}

function ids(prefix) {
  let sequence = 0
  return () => `${prefix}-${++sequence}`
}

function createEngine(adapter, apiClient, stateStore, prefix) {
  return new CloudSyncEngine({
    adapter,
    apiClient,
    stateStore,
    cipherFactory: fakeCipherFactory,
    idFactory: ids(prefix),
    now: () => 1_800_000_000_000,
    pushBatchSize: 3,
    pullPageSize: 2
  })
}

const allEntityRecords = [
  { entityType: 'providers', entityId: 'p1', value: { id: 'p1', name: 'Provider', updatedAt: '2027-01-15T08:00:00.000Z' } },
  { entityType: 'conversations', entityId: 'c1', value: { id: 'c1', title: 'Chat', updatedAt: '2027-01-15T08:00:00.000Z' } },
  { entityType: 'messages', entityId: 'm1', value: { id: 'm1', conversationId: 'c1', sequence: 1, content: 'Secret message', updatedAt: '2027-01-15T08:00:00.000Z' } },
  { entityType: 'attachments', entityId: 'a1', value: { id: 'a1', conversationId: 'c1', messageId: 'm1', textContent: 'Secret attachment' } },
  { entityType: 'characters', entityId: 'ch1', value: { id: 'ch1', name: 'Character' } },
  { entityType: 'worldBooks', entityId: 'w1', value: { id: 'w1', scope: 'global', data: { entries: [{ content: 'Secret lore' }] } } },
  { entityType: 'characterAssets', entityId: 'ca1', value: { id: 'ca1', characterId: 'ch1', dataUrl: 'data:image/png;base64,AA==' } },
  { entityType: 'settings', entityId: 'appearance', value: { theme: 'light' } }
]

test('syncs every entity type across devices with paginated pull and physical-delete tombstones', async () => {
  const api = new FakeSyncApi()
  const adapterA = new MemoryAdapter(allEntityRecords)
  const adapterB = new MemoryAdapter()
  const stateA = new MemoryStateStore()
  const stateB = new MemoryStateStore()
  const engineA = createEngine(adapterA, api, stateA, 'device-a-mutation')
  const engineB = createEngine(adapterB, api, stateB, 'device-b-mutation')

  const first = await engineA.sync({ accountId: 'user-1', deviceId: 'device-a', syncPassword: 'sync password secret' })
  const second = await engineB.sync({ accountId: 'user-1', deviceId: 'device-b', syncPassword: 'sync password secret' })

  assert.equal(first.pushed, allEntityRecords.length)
  assert.equal(second.applied, allEntityRecords.length)
  assert.equal(stateB.current('user-1').cursor, api.revision)
  for (const record of allEntityRecords) {
    assert.deepEqual(adapterB.value(record.entityType, record.entityId), record.value)
  }

  adapterA.remove('providers', 'p1')
  const deletion = await engineA.sync({ accountId: 'user-1', deviceId: 'device-a', syncPassword: 'sync password secret' })
  assert.equal(deletion.pushed, 1)
  assert.equal(api.records.get(syncRecordKey('providers', 'p1')).operation, 'delete')

  await engineB.sync({ accountId: 'user-1', deviceId: 'device-b', syncPassword: 'sync password secret' })
  assert.equal(adapterB.value('providers', 'p1'), undefined)
  assert.equal(stateB.current('user-1').manifest[syncRecordKey('providers', 'p1')].deleted, true)

  adapterB.put('providers', 'p1', allEntityRecords[0].value)
  const staleRestore = await engineB.sync({ accountId: 'user-1', deviceId: 'device-b', syncPassword: 'sync password secret' })
  assert.equal(staleRestore.conflicts, 1)
  assert.equal(adapterB.value('providers', 'p1'), undefined)
  assert.equal(api.records.get(syncRecordKey('providers', 'p1')).operation, 'delete')
})

test('preserves character and avatar relationships across fresh SQLite devices', async () => {
  const api = new FakeSyncApi()
  const sourceSqlite = createNodePlusSqlite()
  const targetSqlite = createNodePlusSqlite()
  const sourceRepository = new PlusSqliteRepository({
    sqlite: sourceSqlite,
    databaseName: `sync-source-${crypto.randomUUID()}`,
    databasePath: '_doc/sync-source.db'
  })
  const targetRepository = new PlusSqliteRepository({
    sqlite: targetSqlite,
    databaseName: `sync-target-${crypto.randomUUID()}`,
    databasePath: '_doc/sync-target.db'
  })
  await sourceRepository.init()
  await targetRepository.init()

  const avatar = {
    id: 'avatar-1', characterId: 'character-1', type: 'icon', dataUrl: 'data:image/png;base64,AA==',
    createdAt: '2027-01-15T08:00:00.000Z', updatedAt: '2027-01-15T08:00:00.000Z', deletedAt: null
  }
  const character = {
    id: 'character-1', name: 'Su Mo', sourceHash: 'same-card', avatarAssetId: avatar.id,
    assetIds: [avatar.id], worldBookIds: [], updatedAt: '2027-01-15T08:00:00.000Z', deletedAt: null
  }
  const conversation = {
    id: 'conversation-1', title: character.name, characterId: character.id,
    characterNameSnapshot: character.name, characterAvatarAssetId: avatar.id,
    updatedAt: '2027-01-15T08:00:00.000Z', lastMessageAt: '2027-01-15T08:00:00.000Z', deletedAt: null
  }
  await sourceRepository.importRecords({
    conversations: [conversation],
    characters: [character],
    characterAssets: [avatar]
  })

  const vault = { encryptString: async value => value, decryptString: async value => value }
  const sourceEngine = createEngine(
    new CloudSyncRepositoryAdapter({ repository: sourceRepository, vault }),
    api,
    new MemoryStateStore(),
    'sqlite-source'
  )
  const targetEngine = createEngine(
    new CloudSyncRepositoryAdapter({ repository: targetRepository, vault }),
    api,
    new MemoryStateStore(),
    'sqlite-target'
  )

  await sourceEngine.sync({ accountId: 'sqlite-account', deviceId: 'source-device', syncPassword: 'sync password' })
  await targetEngine.sync({ accountId: 'sqlite-account', deviceId: 'target-device', syncPassword: 'sync password' })

  const restoredConversation = await targetRepository.getConversation(conversation.id)
  const restoredCharacter = await targetRepository.getCharacter(restoredConversation.characterId)
  const restoredAvatar = await targetRepository.getCharacterAsset(restoredConversation.characterAvatarAssetId)
  assert.equal(restoredCharacter.id, character.id)
  assert.equal(restoredCharacter.avatarAssetId, restoredAvatar.id)
  assert.equal(restoredAvatar.characterId, restoredCharacter.id)
  assert.equal(restoredAvatar.dataUrl, avatar.dataUrl)

  await sourceRepository.close()
  await targetRepository.close()
  sourceSqlite.closeAll()
  targetSqlite.closeAll()
})

test('retries the identical encrypted mutation after a lost push response', async () => {
  const api = new FakeSyncApi({ failAfterFirstPush: true })
  const adapter = new MemoryAdapter([
    { entityType: 'settings', entityId: 'privateSetting', value: { text: 'never store this plaintext in pending state' } }
  ])
  const stateStore = new MemoryStateStore()
  const engine = createEngine(adapter, api, stateStore, 'retry-mutation')
  const input = { accountId: 'user-retry', deviceId: 'device-retry', syncPassword: 'sync password secret' }

  await assert.rejects(engine.sync(input), /response loss/)
  const interruptedState = stateStore.current('user-retry')
  assert.equal(interruptedState.pending.length, 1)
  assert.equal(JSON.stringify(interruptedState).includes('never store this plaintext'), false)
  const pendingMutationId = interruptedState.pending[0].mutationId
  assert.equal(api.revision, 1)

  const retried = await engine.sync(input)

  assert.equal(retried.pending, 0)
  assert.equal(api.revision, 1)
  assert.deepEqual(api.receivedMutationIds, [pendingMutationId, pendingMutationId])
  assert.equal(stateStore.current('user-retry').cursor, 1)
})

test('pulls and verifies existing cloud records before a new device can push local data', async () => {
  const api = new FakeSyncApi()
  const sourceAdapter = new MemoryAdapter([{
    entityType: 'conversations',
    entityId: 'remote-conversation',
    value: { id: 'remote-conversation', title: 'Remote', updatedAt: '2027-01-15T08:00:00.000Z' }
  }])
  const sourceState = new MemoryStateStore()
  const sourceEngine = new CloudSyncEngine({
    adapter: sourceAdapter,
    apiClient: api,
    stateStore: sourceState,
    cipherFactory: passwordAwareCipherFactory,
    idFactory: ids('source-mutation'),
    now: () => 1_800_000_000_000
  })
  await sourceEngine.sync({
    accountId: 'password-account',
    deviceId: 'source-device',
    syncPassword: 'correct sync password'
  })

  const targetAdapter = new MemoryAdapter([{
    entityType: 'settings',
    entityId: 'local-default',
    value: { enabled: true, updatedAt: '2027-01-15T09:00:00.000Z' }
  }])
  const targetEngine = new CloudSyncEngine({
    adapter: targetAdapter,
    apiClient: api,
    stateStore: new MemoryStateStore(),
    cipherFactory: passwordAwareCipherFactory,
    idFactory: ids('wrong-password-mutation'),
    now: () => 1_800_000_000_000
  })
  const pushesBeforeWrongPassword = api.pushCalls.length

  await assert.rejects(
    targetEngine.sync({
      accountId: 'password-account',
      deviceId: 'new-device',
      syncPassword: 'incorrect password'
    }),
    /incorrect sync password/
  )

  assert.equal(api.pushCalls.length, pushesBeforeWrongPassword)
  assert.equal(api.records.has(syncRecordKey('settings', 'local-default')), false)
})

test('keeps a newer remote edit when an older offline edit syncs later', async () => {
  const api = new FakeSyncApi()
  const baseline = {
    id: 'shared-setting',
    content: 'baseline',
    updatedAt: '2027-01-15T08:00:00.000Z'
  }
  const adapterA = new MemoryAdapter([{ entityType: 'settings', entityId: 'shared-setting', value: baseline }])
  const adapterB = new MemoryAdapter()
  const engineA = createEngine(adapterA, api, new MemoryStateStore(), 'newer-device')
  const engineB = createEngine(adapterB, api, new MemoryStateStore(), 'offline-device')
  const syncInputA = { accountId: 'conflict-account', deviceId: 'device-a', syncPassword: 'sync password secret' }
  const syncInputB = { accountId: 'conflict-account', deviceId: 'device-b', syncPassword: 'sync password secret' }

  await engineA.sync(syncInputA)
  await engineB.sync(syncInputB)
  adapterB.put('settings', 'shared-setting', {
    ...baseline,
    content: 'older offline edit',
    updatedAt: '2027-01-15T09:00:00.000Z'
  })
  adapterA.put('settings', 'shared-setting', {
    ...baseline,
    content: 'newer remote edit',
    updatedAt: '2027-01-15T10:00:00.000Z'
  })

  await engineA.sync(syncInputA)
  const laterOfflineSync = await engineB.sync(syncInputB)

  assert.equal(laterOfflineSync.conflicts, 1)
  assert.equal(adapterB.value('settings', 'shared-setting').content, 'newer remote edit')
})

test('does not overwrite a local edit saved while a remote record is being applied', async () => {
  const api = new FakeSyncApi()
  const baseline = {
    id: 'race-setting',
    content: 'baseline',
    updatedAt: '2027-01-15T08:00:00.000Z'
  }
  const source = new MemoryAdapter([{ entityType: 'settings', entityId: 'race-setting', value: baseline }])
  const target = new MemoryAdapter()
  const sourceEngine = createEngine(source, api, new MemoryStateStore(), 'race-source')
  const targetEngine = createEngine(target, api, new MemoryStateStore(), 'race-target')
  const sourceInput = { accountId: 'race-account', deviceId: 'source', syncPassword: 'sync password secret' }
  const targetInput = { accountId: 'race-account', deviceId: 'target', syncPassword: 'sync password secret' }

  await sourceEngine.sync(sourceInput)
  await targetEngine.sync(targetInput)
  source.put('settings', 'race-setting', {
    ...baseline,
    content: 'remote edit',
    updatedAt: '2027-01-15T10:00:00.000Z'
  })
  await sourceEngine.sync(sourceInput)

  let injected = false
  target.beforeApply = async change => {
    if (injected || change.entityId !== 'race-setting') return
    injected = true
    target.put('settings', 'race-setting', {
      ...baseline,
      content: 'local edit during apply',
      updatedAt: '2027-01-15T11:00:00.000Z'
    })
  }
  await targetEngine.sync(targetInput)

  assert.equal(target.value('settings', 'race-setting').content, 'local edit during apply')
  target.beforeApply = null
  await targetEngine.sync(targetInput)
  await sourceEngine.sync(sourceInput)
  assert.equal(source.value('settings', 'race-setting').content, 'local edit during apply')
})

test('retries pending mutations with their original device id and splits newer device mutations', async () => {
  const api = new FakeSyncApi({ failAfterFirstPush: true })
  const adapter = new MemoryAdapter([allEntityRecords[0]])
  const stateStore = new MemoryStateStore()
  const engine = createEngine(adapter, api, stateStore, 'device-change')
  const accountId = 'device-change-account'

  await assert.rejects(
    engine.sync({ accountId, deviceId: 'device-old', syncPassword: 'sync password secret' }),
    /response loss/
  )
  const pendingMutationId = stateStore.current(accountId).pending[0].mutationId
  adapter.put('settings', 'new-device-setting', {
    enabled: true,
    updatedAt: '2027-01-15T09:00:00.000Z'
  })

  const retried = await engine.sync({
    accountId,
    deviceId: 'device-new',
    syncPassword: 'sync password secret'
  })

  assert.equal(retried.pending, 0)
  assert.deepEqual(api.pushCalls, [
    { deviceId: 'device-old', mutationIds: [pendingMutationId] },
    { deviceId: 'device-old', mutationIds: [pendingMutationId] },
    { deviceId: 'device-new', mutationIds: ['device-change-2'] }
  ])
})

test('shrinks an oversized push batch without changing pending mutations', async () => {
  const backingApi = new FakeSyncApi()
  const attemptedBatchSizes = []
  const api = {
    async pushSyncBatch(request) {
      attemptedBatchSizes.push(request.mutations.length)
      if (request.mutations.length > 1) {
        const error = new Error('batch too large')
        error.code = 'sync_batch_too_large'
        throw error
      }
      return backingApi.pushSyncBatch(request)
    },
    pullSyncPage: request => backingApi.pullSyncPage(request)
  }
  const adapter = new MemoryAdapter(allEntityRecords.slice(0, 3))
  const stateStore = new MemoryStateStore()
  const engine = createEngine(adapter, api, stateStore, 'split-mutation')

  const result = await engine.sync({
    accountId: 'user-split',
    deviceId: 'device-split',
    syncPassword: 'sync password secret'
  })

  assert.deepEqual(attemptedBatchSizes, [3, 1, 1, 1])
  assert.equal(result.pushed, 3)
  assert.equal(result.pending, 0)
  assert.equal(backingApi.revision, 3)
})

test('maps an oversized single encrypted record without dropping it from pending state', async () => {
  const api = {
    async pushSyncBatch() {
      const error = new Error('batch too large')
      error.code = 'sync_batch_too_large'
      throw error
    },
    async pullSyncPage() {
      return {
        protocol_version: 1,
        changes: [],
        next_cursor: 0,
        has_more: false,
        server_cursor: 0
      }
    }
  }
  const adapter = new MemoryAdapter(allEntityRecords.slice(0, 1))
  const stateStore = new MemoryStateStore()
  const engine = createEngine(adapter, api, stateStore, 'large-record')

  await assert.rejects(
    engine.sync({ accountId: 'user-large', deviceId: 'device-large', syncPassword: 'sync password secret' }),
    error => error.code === 'sync_record_too_large'
  )
  assert.equal(stateStore.current('user-large').pending.length, 1)
})

test('stages histories larger than the pending limit across multiple sync runs', async () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    entityType: 'messages',
    entityId: `history-${index + 1}`,
    value: {
      id: `history-${index + 1}`,
      conversationId: 'conversation-large',
      sequence: index + 1,
      content: `message ${index + 1}`,
      updatedAt: '2027-01-15T08:00:00.000Z'
    }
  }))
  const api = new FakeSyncApi()
  const adapter = new MemoryAdapter(records)
  const stateStore = new MemoryStateStore()
  const engine = new CloudSyncEngine({
    adapter,
    apiClient: api,
    stateStore,
    cipherFactory: fakeCipherFactory,
    idFactory: ids('bounded-history'),
    now: () => 1_800_000_000_000,
    pushBatchSize: 1,
    pullPageSize: 2,
    maxPendingMutations: 2,
    maxRounds: 1
  })
  const input = {
    accountId: 'user-large-history',
    deviceId: 'device-large-history',
    syncPassword: 'sync password secret'
  }

  const first = await engine.sync(input)
  assert.equal(first.pushed, 2)
  assert.equal(first.pending, 2)
  assert.equal(stateStore.current(input.accountId).pending.length, 2)

  const second = await engine.sync(input)
  assert.equal(second.pushed, 2)
  assert.equal(second.pending, 1)
  assert.equal(stateStore.current(input.accountId).pending.length, 1)

  const third = await engine.sync(input)
  assert.equal(third.pushed, 1)
  assert.equal(third.pending, 0)
  assert.equal(api.records.size, records.length)
})
