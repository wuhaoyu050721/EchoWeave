import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAbortController,
  installAbortControllerPolyfill
} from '../src/core/abort-controller-polyfill.js'

test('installs an AbortController compatible with the App request transports', () => {
  const runtime = {}
  installAbortControllerPolyfill(runtime)
  const controller = new runtime.AbortController()
  let calls = 0
  const listener = () => { calls += 1 }

  controller.signal.addEventListener('abort', listener, { once: true })
  controller.abort()
  controller.abort()

  assert.equal(controller.signal.aborted, true)
  assert.equal(controller.signal.reason.name, 'AbortError')
  assert.equal(calls, 1)
})

test('creates a fallback controller when the global runtime API is missing', () => {
  const nativeAbortController = globalThis.AbortController
  globalThis.AbortController = undefined
  try {
    const controller = createAbortController()
    controller.abort()
    assert.equal(controller.signal.aborted, true)
  } finally {
    globalThis.AbortController = nativeAbortController
  }
})
