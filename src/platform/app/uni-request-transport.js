import { extractModelErrorMessage, ModelHttpError } from '../../core/model-http-error.js'

function createAbortError() {
  const error = new Error('模型请求已停止')
  error.name = 'AbortError'
  error.code = 'request_aborted'
  return error
}

function toText(value) {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  return new Uint8Array()
}

export class UniRequestTransport {
  constructor({ uniApi, streamingTransport = null } = {}) {
    if (!uniApi?.request) throw new Error('UniRequestTransport 需要 uni.request')
    this.uniApi = uniApi
    this.streamingTransport = streamingTransport
  }

  request({
    url,
    method = 'GET',
    headers = {},
    body,
    signal,
    onChunk,
    responseType = 'text',
    timeout = 60000
  } = {}) {
    if (signal?.aborted) return Promise.reject(createAbortError())
    const streaming = typeof onChunk === 'function'
    if (streaming && this.streamingTransport) {
      return this.streamingTransport.request({ url, method, headers, body, signal, onChunk, timeout })
    }

    return new Promise((resolve, reject) => {
      let task
      let settled = false
      let aborted = false
      const binaryResponse = responseType === 'arraybuffer'
      const cleanup = () => signal?.removeEventListener('abort', abortRequest)
      const settle = (callback, value) => {
        if (settled) return
        settled = true
        cleanup()
        callback(value)
      }
      const abortRequest = () => {
        if (settled || aborted) return
        aborted = true
        task?.abort?.()
        settle(reject, createAbortError())
      }

      task = this.uniApi.request({
        url,
        method,
        header: headers,
        data: body,
        timeout,
        dataType: binaryResponse ? 'arraybuffer' : 'text',
        responseType: streaming || binaryResponse ? 'arraybuffer' : 'text',
        enableChunked: streaming,
        success: (response = {}) => {
          if (aborted || signal?.aborted) {
            settle(reject, createAbortError())
            return
          }
          const status = Number(response.statusCode || 0)
          const responseText = streaming ? '' : toText(response.data)
          if (status < 200 || status >= 300) {
            settle(reject, new ModelHttpError(extractModelErrorMessage(responseText, status), {
              status,
              body: responseText,
              code: status === 401 || status === 403 ? 'authentication_error' : 'http_error'
            }))
            return
          }
          const result = { status, headers: response.header || {}, text: binaryResponse ? '' : responseText }
          if (binaryResponse) result.data = toBytes(response.data)
          settle(resolve, result)
        },
        fail: (result = {}) => {
          if (aborted || signal?.aborted) {
            settle(reject, createAbortError())
            return
          }
          const timedOut = /timeout/i.test(String(result.errMsg ?? ''))
          const error = new Error(timedOut
            ? `模型请求超时（已等待 ${Math.max(1, Math.round(Number(timeout) / 1000))} 秒）`
            : result.errMsg || 'App 网络请求失败')
          error.code = timedOut ? 'request_timeout' : 'network_error'
          settle(reject, error)
        }
      })

      if (streaming) {
        if (!task || typeof task.onChunkReceived !== 'function') {
          const error = new Error('当前 App 运行时不支持 onChunkReceived')
          error.code = 'chunk_callback_unsupported'
          settle(reject, error)
          task?.abort?.()
          return
        }
        task.onChunkReceived((result = {}) => {
          if (settled || aborted || signal?.aborted) return
          const bytes = toBytes(result.data)
          if (bytes.length) onChunk(bytes)
        })
      }
      signal?.addEventListener('abort', abortRequest, { once: true })
    })
  }
}
