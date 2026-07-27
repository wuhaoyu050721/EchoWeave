import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAppLockRecord,
  isAppLockRecord,
  normalizeAppLockSetting,
  verifyAppLockPin
} from '../src/core/app-lock.js'

test('stores only a salted PIN hash and verifies it in constant-work form', async () => {
  const record = await createAppLockRecord('1937', {
    random: byteLength => new Uint8Array(byteLength).fill(7)
  })

  assert.equal(isAppLockRecord(record), true)
  assert.equal(JSON.stringify(record).includes('1937'), false)
  assert.equal(await verifyAppLockPin('1937', record), true)
  assert.equal(await verifyAppLockPin('1938', record), false)
})

test('rejects weak PIN values and never enables an incomplete legacy setting', async () => {
  await assert.rejects(createAppLockRecord('12'), /4-8/)
  await assert.rejects(createAppLockRecord('abcd'), /4-8/)
  assert.deepEqual(normalizeAppLockSetting({ appLockEnabled: true }), { enabled: false, record: null })
})

test('settings UI gates startup and exposes real PIN controls on a second-level page', async () => {
  const source = await import('node:fs/promises')
    .then(fs => fs.readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'))

  assert.match(source, /data-testid="app-lock-entry"[^>]+openAppLockSettings\(ui\)/)
  assert.match(source, /data-testid="app-lock-settings-page"/)
  assert.match(source, /data-testid="app-lock-toggle"[^>]+role="switch"/)
  assert.match(source, /data-testid="app-lock-gate"/)
  assert.match(source, /createAppLockRecord\(this\.appLockPin\)/)
  assert.match(source, /verifyAppLockPin\(this\.appLockUnlockPin,\s*this\.appLockRecord\)/)
  assert.match(source, /onHide\(\)[\s\S]*lockOnNextShow/)
})
