import { extractModelErrorMessage, ModelHttpError } from '../../core/model-http-error.js'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DEFAULT_PARTIAL_IDLE_TIMEOUT_MS = 60000
let requestSequence = 0
let installedNativeApi = null
const pendingRequests = new Map()

function createAbortError() {
  const error = new Error('模型请求已停止')
  error.name = 'AbortError'
  error.code = 'request_aborted'
  return error
}

function base64ToBytes(value) {
  const encoded = String(value ?? '').replace(/\s+/g, '')
  if (!encoded) return new Uint8Array()
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array(Math.max(0, Math.floor(encoded.length * 3 / 4) - padding))
  let outputIndex = 0
  let bits = 0
  let bitCount = 0
  for (const character of encoded) {
    if (character === '=') break
    const valueIndex = BASE64_ALPHABET.indexOf(character)
    if (valueIndex < 0) continue
    bits = (bits << 6) | valueIndex
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      if (outputIndex < bytes.length) bytes[outputIndex++] = (bits >> bitCount) & 0xff
    }
  }
  return outputIndex === bytes.length ? bytes : bytes.slice(0, outputIndex)
}

function normalizeHeaders(value) {
  const result = {}
  for (const header of Array.isArray(value) ? value : []) {
    const name = String(header?.name ?? '').trim().toLowerCase()
    if (name) result[name] = String(header?.value ?? '')
  }
  return result
}

function failureError(result = {}, timeout = 60000) {
  const code = String(result.code || 'network_error')
  if (code === 'request_aborted') return createAbortError()
  const status = Number(result.statusCode || 0)
  const body = String(result.body || '')
  if (code === 'http_error' || status >= 400) {
    return new ModelHttpError(extractModelErrorMessage(body, status), {
      status,
      body,
      code: status === 401 || status === 403 ? 'authentication_error' : 'http_error'
    })
  }
  const nativeMessage = String(result.message || '')
  const timedOut = code === 'request_timeout' ||
    /SocketTimeoutException|\btimeout\b|timed\s*out/i.test(nativeMessage)
  const timeoutSeconds = Math.max(1, Math.round(Number(timeout) / 1000))
  const error = new Error(timedOut
    ? `模型接口响应超时（最长等待 ${timeoutSeconds} 秒），请重试或检查接口网络`
    : nativeMessage || 'Android 网络请求失败')
  error.code = timedOut ? 'request_timeout' : code
  if (status) error.statusCode = status
  return error
}

function createPartialIdleTimeoutError(timeout) {
  const timeoutSeconds = Math.max(1, Math.round(Number(timeout) / 1000))
  const error = new Error(`模型流式连接超过 ${timeoutSeconds} 秒没有新内容，已保留当前回复，可直接续写`)
  error.code = 'stream_idle_timeout'
  return error
}

export class NativeStreamingTransport {
  constructor({
    nativeApi,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    partialIdleTimeoutMs = DEFAULT_PARTIAL_IDLE_TIMEOUT_MS
  } = {}) {
    if (
      typeof nativeApi?.onAiChatStreamEvent !== 'function' ||
      typeof nativeApi?.aiChatStreamRequest !== 'function' ||
      typeof nativeApi?.aiChatStreamCancel !== 'function'
    ) {
      throw new Error('NativeStreamingTransport 需要 Android 原生流式 API')
    }
    this.nativeApi = nativeApi
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.partialIdleTimeoutMs = Math.max(1, Number(partialIdleTimeoutMs) || DEFAULT_PARTIAL_IDLE_TIMEOUT_MS)
    if (installedNativeApi !== nativeApi) {
      nativeApi.onAiChatStreamEvent((event = {}) => {
        pendingRequests.get(String(event.requestId || ''))?.(event)
      })
      installedNativeApi = nativeApi
    }
  }

  request({
    url,
    method = 'POST',
    headers = {},
    body = '',
    timeout = 60000,
    signal,
    onChunk,
    onLateChunk,
    onHeaders
  } = {}) {
    if (signal?.aborted) return Promise.reject(createAbortError())
    const requestId = `${Date.now()}-${++requestSequence}`

    return new Promise((resolve, reject) => {
      let settled = false
      let aborted = false
      let partialIdleTimer = null
      const clearPartialIdleTimer = () => {
        if (partialIdleTimer === null) return
        this.clearTimeoutFn(partialIdleTimer)
        partialIdleTimer = null
      }
      const cleanup = () => {
        clearPartialIdleTimer()
        signal?.removeEventListener('abort', abortRequest)
      }
      const settle = (callback, value) => {
        if (settled) return
        settled = true
        cleanup()
        pendingRequests.delete(requestId)
        callback(value)
      }
      const resetPartialIdleTimer = () => {
        clearPartialIdleTimer()
        partialIdleTimer = this.setTimeoutFn(() => {
          if (settled || aborted || signal?.aborted) return
          settle(reject, createPartialIdleTimeoutError(this.partialIdleTimeoutMs))
          try {
            this.nativeApi.aiChatStreamCancel(requestId)
          } catch (_) {}
        }, this.partialIdleTimeoutMs)
      }
      const abortRequest = () => {
        if (settled || aborted) return
        aborted = true
        settle(reject, createAbortError())
        try {
          this.nativeApi.aiChatStreamCancel(requestId)
        } catch (_) {}
      }

      signal?.addEventListener('abort', abortRequest, { once: true })
      pendingRequests.set(requestId, (event = {}) => {
        const eventType = String(event.eventType || '')
        if (eventType === 'headers') {
          if (!settled && !aborted && !signal?.aborted) {
            onHeaders?.({
              statusCode: Number(event.statusCode || 0),
              headers: normalizeHeaders(event.headers)
            })
          }
          return
        }
        if (eventType === 'chunk') {
          const bytes = base64ToBytes(event.data)
          if (!bytes.length) return
          if (settled || aborted || signal?.aborted) onLateChunk?.(bytes)
          else {
            resetPartialIdleTimer()
            onChunk?.(bytes)
          }
          return
        }
        if (settled || aborted || signal?.aborted) {
          pendingRequests.delete(requestId)
          return
        }
        if (eventType === 'success') {
          const status = Number(event.statusCode || 0)
          settle(resolve, { status, headers: normalizeHeaders(event.headers), text: '' })
          return
        }
        if (eventType === 'failure') settle(reject, failureError(event, timeout))
      })
      try {
        this.nativeApi.aiChatStreamRequest({
          requestId,
          url: String(url || ''),
          method: String(method || 'POST'),
          headers: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })),
          body: String(body ?? ''),
          timeout: Number(timeout) || 60000
        })
      } catch (error) {
        settle(reject, error)
      }
    })
  }
}
