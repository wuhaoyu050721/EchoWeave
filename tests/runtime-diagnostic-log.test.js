import assert from 'node:assert/strict'
import test from 'node:test'

import { getRuntimeDiagnosticLogStore } from '../src/core/runtime-diagnostic-log.js'

test('shares runtime diagnostics between chat and the diagnostics page', () => {
  const first = getRuntimeDiagnosticLogStore()
  first.clear()
  first.add('chat_status_request', { statusProtocolInFirstSystem: true })

  const second = getRuntimeDiagnosticLogStore()
  assert.equal(second, first)
  assert.deepEqual(second.entries().map(entry => entry.type), ['chat_status_request'])

  second.clear()
})
