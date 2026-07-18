import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEGACY_ANDROID_DATABASE_ALIASES,
  LOCAL_WORKSPACE_ID,
  androidDatabaseForWorkspace,
  assertWorkspaceId,
  browserDatabaseNameForWorkspace,
  deriveAccountWorkspaceId,
  normalizeAccountNamespace,
  workspaceIdFromSession
} from '../src/workspace/workspace-id.js'

test('derives a stable account workspace from immutable user.id, not username', () => {
  const first = deriveAccountWorkspaceId({ id: 42, username: 'before' })
  const renamed = deriveAccountWorkspaceId({ id: '42', username: 'after' })
  const other = deriveAccountWorkspaceId({ id: 43, username: 'before' })

  assert.equal(first, renamed)
  assert.notEqual(first, other)
  assert.match(first, /^account-[a-f0-9]{64}$/)
  assert.equal(workspaceIdFromSession({ user: { id: 42 } }), first)
})

test('includes the cloud service namespace to isolate equal ids from different servers', () => {
  const user = { id: 'shared-id' }
  const first = deriveAccountWorkspaceId(user, { accountNamespace: 'https://cloud-a.example' })
  const second = deriveAccountWorkspaceId(user, { accountNamespace: 'https://cloud-b.example' })

  assert.notEqual(first, second)
  assert.equal(
    normalizeAccountNamespace('HTTPS://CLOUD-A.EXAMPLE:443/api/'),
    'https://cloud-a.example/api'
  )
  assert.equal(
    deriveAccountWorkspaceId(user, { accountNamespace: 'HTTPS://CLOUD-A.EXAMPLE:443/' }),
    deriveAccountWorkspaceId(user, { accountNamespace: 'https://cloud-a.example' })
  )
})

test('never places account input directly in a database name or SQLite path', () => {
  const workspaceId = deriveAccountWorkspaceId({ id: "../../x'; DROP TABLE messages; --" })
  const browserName = browserDatabaseNameForWorkspace(workspaceId)
  const android = androidDatabaseForWorkspace(workspaceId)

  assert.match(browserName, /^ai-chat-custom-account-[a-f0-9]{64}$/)
  assert.match(android.name, /^ai_chat_account_[a-f0-9]{64}$/)
  assert.equal(android.path, `_doc/${android.name}.db`)
  assert.doesNotMatch(`${browserName}${android.path}`, /\.\.|DROP|['";]/)
  assert.throws(() => assertWorkspaceId('../local'), /workspaceId/)
})

test('maps local to legacy databases and recognizes both Android legacy names', () => {
  assert.equal(browserDatabaseNameForWorkspace(LOCAL_WORKSPACE_ID), 'ai-chat-custom')
  assert.deepEqual(androidDatabaseForWorkspace(LOCAL_WORKSPACE_ID), {
    name: 'ai-chat-custom',
    path: '_doc/ai-chat-custom.db'
  })
  assert.deepEqual(LEGACY_ANDROID_DATABASE_ALIASES.map(item => item.name), [
    'ai-chat-custom',
    'ai_chat_local'
  ])
})

test('rejects sessions without a usable immutable user id', () => {
  assert.throws(() => workspaceIdFromSession({ user: { username: 'mutable' } }), /user\.id/)
  assert.throws(() => deriveAccountWorkspaceId({ id: '../x', username: 'name' }, { accountNamespace: '' }), /服务域/)
  assert.throws(() => deriveAccountWorkspaceId({ id: Number.MAX_SAFE_INTEGER + 1 }), /安全整数/)
})
