export function createAbortError(message = '请求已停止') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = 'request_aborted'
  return error
}

function callListener(listener, signal, event) {
  try {
    if (typeof listener === 'function') listener.call(signal, event)
    else listener?.handleEvent?.(event)
  } catch (error) {
    globalThis.console?.error?.(error)
  }
}

export class AbortSignalPolyfill {
  constructor() {
    this.aborted = false
    this.reason = undefined
    this.onabort = null
    this.listeners = []
  }

  addEventListener(type, listener, options = {}) {
    if (type !== 'abort' || !listener) return
    if (this.listeners.some((entry) => entry.listener === listener)) return
    this.listeners.push({ listener, once: Boolean(options && typeof options === 'object' && options.once) })
  }

  removeEventListener(type, listener) {
    if (type !== 'abort' || !listener) return
    this.listeners = this.listeners.filter((entry) => entry.listener !== listener)
  }

  throwIfAborted() {
    if (this.aborted) throw this.reason || createAbortError()
  }

  abort(reason) {
    if (this.aborted) return
    this.aborted = true
    this.reason = reason || createAbortError()
    const event = { type: 'abort', target: this, currentTarget: this }
    const currentListeners = this.listeners.slice()
    for (const entry of currentListeners) {
      if (entry.once) this.removeEventListener('abort', entry.listener)
      callListener(entry.listener, this, event)
    }
    callListener(this.onabort, this, event)
  }
}

export class AbortControllerPolyfill {
  constructor() {
    this.signal = new AbortSignalPolyfill()
  }

  abort(reason) {
    this.signal.abort(reason)
  }
}

export function installAbortControllerPolyfill(target = globalThis) {
  if (typeof target.AbortSignal !== 'function') target.AbortSignal = AbortSignalPolyfill
  if (typeof target.AbortController !== 'function') target.AbortController = AbortControllerPolyfill
  return target
}

export function createAbortController() {
  const Controller = typeof globalThis.AbortController === 'function'
    ? globalThis.AbortController
    : AbortControllerPolyfill
  return new Controller()
}

installAbortControllerPolyfill()
