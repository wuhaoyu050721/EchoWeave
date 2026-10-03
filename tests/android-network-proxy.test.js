import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndroidNetworkProxy } from '../src/platform/app/android-network-proxy.js'

function manualTimers() {
  let nextId = 0
  const pending = new Map()
  const scheduledDelays = []
  return {
    scheduledDelays,
    setTimeoutImpl(callback, delay) {
      const id = ++nextId
      scheduledDelays.push(delay)
      pending.set(id, callback)
      return id
    },
    clearTimeoutImpl(id) {
      pending.delete(id)
    },
    fireNext() {
      const [id, callback] = pending.entries().next().value
      pending.delete(id)
      callback()
    },
    get pendingCount() { return pending.size }
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flushNativeSettlement = () => new Promise(resolve => setImmediate(resolve))

test('detects and caches a native phone HTTP proxy', async () => {
  let calls = 0
  let timestamp = 1000
  const proxy = createAndroidNetworkProxy({
    now: () => timestamp,
    nativeApi: {
      async aiChatDetectHttpProxy() {
        calls += 1
        return 'http://127.0.0.1:7890/'
      }
    }
  })

  assert.equal(await proxy.detect(), 'http://127.0.0.1:7890')
  assert.equal(await proxy.detect(), 'http://127.0.0.1:7890')
  assert.equal(calls, 1)
  timestamp += 31000
  assert.equal(await proxy.detect(), 'http://127.0.0.1:7890')
  assert.equal(calls, 2)
})

test('deduplicates concurrent detection and ignores invalid native values', async () => {
  let resolveDetection
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    nativeApi: {
      aiChatDetectHttpProxy() {
        calls += 1
        return new Promise(resolve => { resolveDetection = resolve })
      }
    }
  })

  const first = proxy.detect()
  const second = proxy.detect()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  resolveDetection('socks5://127.0.0.1:7891')
  assert.equal(await first, '')
})

test('uses manual URLs and ignores stale manual URLs in smart mode', async () => {
  const proxy = createAndroidNetworkProxy({
    nativeApi: { aiChatDetectHttpProxy: async () => '' }
  })

  assert.equal(await proxy.getProxyUrl({ enabled: true, mode: 'manual', url: '127.0.0.1:7897' }), 'http://127.0.0.1:7897')
  assert.equal(await proxy.getProxyUrl({ enabled: true, mode: 'smart', url: '' }), '')
  assert.equal(await proxy.getProxyUrl({ enabled: true, mode: 'smart', url: '127.0.0.1:7897' }), '')
  assert.equal(await proxy.getProxyUrl({ enabled: false, mode: 'smart', url: '127.0.0.1:7897' }), '')
})

test('reports whether the packaged app exposes the native detection API', async () => {
  const withNative = createAndroidNetworkProxy({ nativeApi: { aiChatDetectHttpProxy: async () => '' } })
  assert.equal(withNative.nativeAvailable, true)
  await withNative.detect()
  assert.deepEqual(withNative.getDetectionState(), {
    available: true, pending: false, completed: true, failed: false, timedOut: false, url: ''
  })

  const withoutNative = createAndroidNetworkProxy({ nativeApi: null })
  assert.equal(withoutNative.nativeAvailable, false)
  assert.equal(await withoutNative.detect(), '')
  assert.equal(withoutNative.getDetectionState().failed, true)

  const failing = createAndroidNetworkProxy({
    nativeApi: { aiChatDetectHttpProxy: async () => { throw new Error('boom') } }
  })
  assert.equal(await failing.detect(), '')
  assert.equal(failing.getDetectionState().failed, true)
})

test('stops using a proxy address that already failed before returning any data', async () => {
  let timestamp = 5000
  const proxy = createAndroidNetworkProxy({
    now: () => timestamp,
    nativeApi: { aiChatDetectHttpProxy: async () => 'http://127.0.0.1:7890' }
  })
  const setting = { enabled: true, mode: 'smart', url: '' }

  assert.equal(await proxy.getProxyUrl(setting), 'http://127.0.0.1:7890')
  proxy.reportFailure('http://127.0.0.1:7890')
  assert.equal(await proxy.getProxyUrl(setting), '')
  timestamp += 5 * 60 * 1000
  assert.equal(await proxy.getProxyUrl(setting), 'http://127.0.0.1:7890')

  proxy.reportFailure('http://127.0.0.1:7890')
  assert.equal(await proxy.getProxyUrl(setting), '')
  assert.equal(await proxy.detect({ force: true }), 'http://127.0.0.1:7890')
  assert.equal(await proxy.getProxyUrl(setting), 'http://127.0.0.1:7890')
})

test('never suppresses a manually configured proxy address', async () => {
  const proxy = createAndroidNetworkProxy({
    nativeApi: { aiChatDetectHttpProxy: async () => 'http://127.0.0.1:7890' }
  })
  const manual = { enabled: true, mode: 'manual', url: 'http://127.0.0.1:7890' }

  await proxy.detect()
  proxy.reportFailure('http://127.0.0.1:7890')
  assert.equal(await proxy.getProxyUrl({ ...manual, mode: 'smart' }), '')
  assert.equal(await proxy.getProxyUrl(manual), 'http://127.0.0.1:7890')
  assert.deepEqual(await proxy.getProxyRoute(manual), {
    proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: false
  })
})

test('bounds a never-returning native detection to 2500 ms and releases all concurrent waiters', async () => {
  const timers = manualTimers()
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: {
      aiChatDetectHttpProxy() {
        calls += 1
        return new Promise(() => {})
      }
    }
  })

  const first = proxy.detect()
  const second = proxy.detect({ force: true })
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.deepEqual(timers.scheduledDelays, [2500])
  assert.equal(proxy.getDetectionState().pending, true)
  timers.fireNext()
  assert.deepEqual(await Promise.all([first, second]), ['', ''])
  assert.equal(timers.pendingCount, 0)
  assert.deepEqual(proxy.getDetectionState(), {
    available: true, pending: false, completed: true, failed: true, timedOut: true, url: ''
  })
})

for (const lateOutcome of ['resolve', 'reject']) {
  test(`retries immediately after timeout and ignores a late native ${lateOutcome} while the retry is pending`, async () => {
    const timers = manualTimers()
    const oldNative = deferred()
    const newNative = deferred()
    let calls = 0
    const proxy = createAndroidNetworkProxy({
      ...timers,
      detectionTimeoutMs: 40,
      nativeApi: { aiChatDetectHttpProxy: () => ++calls === 1 ? oldNative.promise : newNative.promise }
    })

    const first = proxy.detect()
    await Promise.resolve()
    timers.fireNext()
    assert.equal(await first, '')
    const retry = proxy.detect()
    await Promise.resolve()
    assert.equal(calls, 2)
    assert.deepEqual(timers.scheduledDelays, [40, 40])
    assert.deepEqual(proxy.getDetectionState(), {
      available: true, pending: true, completed: false, failed: false, timedOut: false, url: ''
    })
    if (lateOutcome === 'resolve') oldNative.resolve('http://127.0.0.1:7897')
    else oldNative.reject(new Error('old native failure'))
    await flushNativeSettlement()
    assert.equal(proxy.detect(), retry)
    assert.equal(proxy.getDetectionState().pending, true)
    assert.equal(proxy.getDetectionState().url, '')
    assert.equal(timers.pendingCount, 1)

    newNative.resolve('http://127.0.0.1:7890')
    assert.equal(await retry, 'http://127.0.0.1:7890')
    assert.equal(timers.pendingCount, 0)
    assert.deepEqual(proxy.getDetectionState(), {
      available: true, pending: false, completed: true, failed: false, timedOut: false,
      url: 'http://127.0.0.1:7890'
    })
  })
}

test('a timed-out native result cannot replace a newer completed result', async () => {
  const timers = manualTimers()
  const oldNative = deferred()
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: {
      aiChatDetectHttpProxy: () => ++calls === 1 ? oldNative.promise : 'http://127.0.0.1:7890'
    }
  })
  const first = proxy.detect()
  await Promise.resolve()
  timers.fireNext()
  await first
  assert.equal(await proxy.detect({ force: true }), 'http://127.0.0.1:7890')
  const state = proxy.getDetectionState()
  oldNative.resolve('http://127.0.0.1:7897')
  await flushNativeSettlement()
  assert.deepEqual(proxy.getDetectionState(), state)
  assert.equal(timers.pendingCount, 0)
})

test('invalidate releases pending callers and prevents their late result from affecting a new flight', async () => {
  const timers = manualTimers()
  const oldNative = deferred()
  const newNative = deferred()
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: { aiChatDetectHttpProxy: () => ++calls === 1 ? oldNative.promise : newNative.promise }
  })

  const oldFlight = proxy.detect()
  await Promise.resolve()
  proxy.invalidate()
  assert.equal(await oldFlight, '')
  assert.equal(timers.pendingCount, 0)
  assert.deepEqual(proxy.getDetectionState(), {
    available: true, pending: false, completed: false, failed: false, timedOut: false, url: ''
  })

  const newFlight = proxy.detect()
  await Promise.resolve()
  oldNative.resolve('http://127.0.0.1:7897')
  await flushNativeSettlement()
  assert.equal(proxy.detect(), newFlight)
  assert.equal(proxy.getDetectionState().pending, true)
  assert.equal(proxy.getDetectionState().url, '')
  assert.equal(timers.pendingCount, 1)
  newNative.resolve('http://127.0.0.1:7890')
  assert.equal(await newFlight, 'http://127.0.0.1:7890')
  assert.equal(calls, 2)
  assert.equal(timers.pendingCount, 0)
})

test('invalidate before the detection starts prevents the cancelled native call from starting', async () => {
  const timers = manualTimers()
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: { aiChatDetectHttpProxy: () => { calls += 1; return 'http://127.0.0.1:7890' } }
  })
  const flight = proxy.detect()
  proxy.invalidate()
  assert.equal(await flight, '')
  await flushNativeSettlement()
  assert.equal(calls, 0)
  assert.equal(timers.pendingCount, 0)
  assert.equal(proxy.getDetectionState().completed, false)
})

test('manual routing bypasses a pending native detection and never allows direct fallback', async () => {
  const timers = manualTimers()
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: { aiChatDetectHttpProxy: () => new Promise(() => {}) }
  })
  const flight = proxy.detect()
  await Promise.resolve()
  assert.deepEqual(await proxy.getProxyRoute({ enabled: true, mode: 'manual', url: '127.0.0.1:7890' }), {
    proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: false
  })
  assert.equal(await proxy.getProxyUrl({ enabled: true, mode: 'manual', url: '127.0.0.1:7890' }), 'http://127.0.0.1:7890')
  assert.equal(proxy.getDetectionState().pending, true)
  proxy.invalidate()
  await flight
})

test('routing preserves smart fallback policy and ignores saved manual URLs after timeout', async () => {
  const timers = manualTimers()
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: {
      aiChatDetectHttpProxy() { calls += 1; return new Promise(() => {}) }
    }
  })
  assert.deepEqual(await proxy.getProxyRoute({ enabled: false, mode: 'smart', url: '127.0.0.1:7897' }), {
    proxyUrl: '', allowDirectFallback: false
  })
  assert.deepEqual(await proxy.getProxyRoute({ enabled: true, mode: 'manual', url: '127.0.0.1:7890' }), {
    proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: false
  })
  assert.equal(calls, 0)

  const route = proxy.getProxyRoute({ enabled: true, mode: 'smart', url: '127.0.0.1:7897' })
  await Promise.resolve()
  timers.fireNext()
  assert.deepEqual(await route, { proxyUrl: '', allowDirectFallback: true })
  assert.equal(proxy.getDetectionState().timedOut, true)
})

test('native rejection clears the timer and permits a new detection', async () => {
  const timers = manualTimers()
  let calls = 0
  const proxy = createAndroidNetworkProxy({
    ...timers,
    nativeApi: {
      aiChatDetectHttpProxy() {
        if (++calls === 1) throw new Error('bridge failed')
        return 'http://127.0.0.1:7890'
      }
    }
  })
  assert.equal(await proxy.detect(), '')
  assert.equal(timers.pendingCount, 0)
  assert.equal(proxy.getDetectionState().failed, true)
  assert.equal(proxy.getDetectionState().timedOut, false)
  assert.equal(await proxy.detect(), 'http://127.0.0.1:7890')
  assert.equal(calls, 2)
  assert.equal(timers.pendingCount, 0)
  assert.equal(proxy.getDetectionState().failed, false)
})
