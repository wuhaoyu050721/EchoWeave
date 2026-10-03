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

function isProxyFallbackCandidate(error) {
  if (!error || error.name === 'AbortError' || error.code === 'request_aborted') return false
  if (error instanceof ModelHttpError) return false
  if (Number(error.status) > 0 || Number(error.statusCode) > 0) return false
  if (['request_timeout', 'stream_idle_timeout'].includes(error.code)) return false
  // Only a positively identified failure to connect is safe to retry. A timeout
  // or reset before the first response byte can still follow an accepted POST.
  return /ECONNREFUSED|connection refused|ENETUNREACH|network is unreachable|no route to host|UnknownHostException|unable to resolve host|ENOTFOUND/i.test(String(error.message || ''))
}

export class UniRequestTransport {
  constructor({ uniApi, streamingTransport = null, getProxyRoute = null, getProxyUrl = null, onProxyFailure = null } = {}) {
    if (!uniApi?.request) throw new Error('UniRequestTransport 需要 uni.request')
    this.uniApi = uniApi
    this.streamingTransport = streamingTransport
    this.getProxyRoute = getProxyRoute
    this.getProxyUrl = getProxyUrl
    this.onProxyFailure = onProxyFailure
  }

  request({
    url,
    method = 'GET',
    headers = {},
    body,
    signal,
    onChunk,
    onHeaders,
    responseType = 'text',
    timeout = 60000
  } = {}) {
    if (signal?.aborted) return Promise.reject(createAbortError())
    const options = {
      url,
      method,
      headers,
      body,
      signal,
      onChunk,
      onHeaders,
      responseType,
      timeout,
      streaming: typeof onChunk === 'function'
    }
    const resolvedRoute = typeof this.getProxyRoute === 'function'
      ? Promise.resolve().then(() => this.getProxyRoute()).then(route => ({
        proxyUrl: String(route?.proxyUrl || '').trim(),
        allowDirectFallback: route?.allowDirectFallback === true
      }))
      : typeof this.getProxyUrl === 'function'
        ? Promise.resolve().then(() => this.getProxyUrl()).then(value => ({
          proxyUrl: String(value || '').trim(),
          allowDirectFallback: false
        }))
        : null
    if (!resolvedRoute) return this.dispatchWithFallback(options, '')
    return resolvedRoute.then(({ proxyUrl, allowDirectFallback }) => this.dispatchWithFallback(options, proxyUrl, allowDirectFallback))
  }

  // Preserve fallback for an unreachable detected proxy, but never replay a
  // request whose delivery is uncertain or which has received HTTP headers.
  dispatchWithFallback(options, proxyUrl, allowDirectFallback = false) {
    if (options.signal?.aborted) return Promise.reject(createAbortError())
    if (proxyUrl && !this.streamingTransport) {
      const error = new Error('当前安装包不支持代理请求，请更新应用后重试')
      error.code = 'proxy_transport_unavailable'
      return Promise.reject(error)
    }
    const proxyApplied = Boolean(proxyUrl && this.streamingTransport)
    let receivedBytes = 0
    let receivedHeaders = false
    const sourceOnChunk = options.onChunk
    const onChunk = proxyApplied
      ? bytes => {
        receivedBytes += bytes?.byteLength || bytes?.length || 0
        if (typeof sourceOnChunk === 'function') sourceOnChunk(bytes)
      }
      : sourceOnChunk
    const onHeaders = response => {
      receivedHeaders = true
      options.onHeaders?.(response)
    }
    const attempt = attemptProxyUrl => this.dispatch({ ...options, onChunk, onHeaders }, attemptProxyUrl)

    if (!proxyApplied || !allowDirectFallback) return attempt(proxyUrl)
    return attempt(proxyUrl).catch(error => {
      if (receivedHeaders || receivedBytes > 0 || options.signal?.aborted) throw error
      if (!isProxyFallbackCandidate(error)) throw error
      try {
        this.onProxyFailure?.(proxyUrl, error)
      } catch (_) {}
      return attempt('')
    })
  }

  dispatch(options, proxyUrl) {
    const { url, method, headers, body, signal, onChunk, onHeaders, responseType, timeout, streaming } = options
    if (signal?.aborted) return Promise.reject(createAbortError())
    if (streaming && this.streamingTransport) {
      return this.streamingTransport.request({ url, proxyUrl, method, headers, body, signal, onChunk, onHeaders, timeout })
    }
    if (proxyUrl && this.streamingTransport) {
      return this.requestViaNativeProxy({ url, proxyUrl, method, headers, body, signal, onChunk, onHeaders, responseType, timeout })
    }
    return this.requestViaUni({ url, method, headers, body, signal, streaming, responseType, timeout, onChunk, onHeaders })
  }

  requestViaNativeProxy({ url, proxyUrl, method, headers, body, signal, onChunk, onHeaders, responseType, timeout }) {
    const binaryResponse = responseType === 'arraybuffer'
    const chunks = []
    return this.streamingTransport.request({
      url, proxyUrl, method, headers, body, signal, timeout, onHeaders,
      onChunk: bytes => {
        chunks.push(bytes)
        onChunk?.(bytes)
      }
    }).then(response => {
      const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
      const data = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.length
      }
      return {
        status: response.status,
        headers: response.headers || {},
        text: binaryResponse ? '' : new TextDecoder().decode(data),
        ...(binaryResponse ? { data } : {})
      }
    })
  }

  requestViaUni({ url, method, headers, body, signal, streaming, responseType, timeout, onChunk, onHeaders }) {
    return new Promise((resolve, reject) => {
      let task
      let settled = false
      let aborted = false
      let receivedChunkBytes = 0
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
          // Some Android runtimes accept onChunkReceived but only deliver the
          // response body in success. Preserve it when no chunk arrived; never
          // replay the aggregate body after live chunks have already been used.
          const responseText = streaming && receivedChunkBytes > 0 ? '' : toText(response.data)
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

      if (typeof onHeaders === 'function' && typeof task?.onHeadersReceived === 'function') {
        task.onHeadersReceived(response => {
          if (!settled && !aborted && !signal?.aborted) {
            onHeaders({ statusCode: response?.statusCode, headers: response?.header || {} })
          }
        })
      }
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
          if (bytes.length) {
            receivedChunkBytes += bytes.length
            onChunk(bytes)
          }
        })
      }
      signal?.addEventListener('abort', abortRequest, { once: true })
    })
  }
}
