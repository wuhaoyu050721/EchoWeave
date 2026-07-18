let sequence = 0

export function createRuntimeId({
  cryptoApi = globalThis.crypto,
  now = Date.now,
  random = Math.random
} = {}) {
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID.call(cryptoApi)
  }

  sequence = (sequence + 1) % 0xffffff
  const timestamp = Math.max(0, Number(now()) || 0).toString(36)
  const entropy = Math.floor(Math.abs(Number(random()) || 0) * 0x100000000)
    .toString(36)
    .padStart(7, '0')
  return `local-${timestamp}-${sequence.toString(36).padStart(4, '0')}-${entropy}`
}
