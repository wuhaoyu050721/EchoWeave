import { extractModelErrorMessage, ModelHttpError } from '../../core/model-http-error.js'

export { ModelHttpError } from '../../core/model-http-error.js'

export class BrowserFetchTransport {
  constructor({ fetch: fetchOverride, proxyPath = '/__ai_proxy' } = {}) {
    const fetchFunction = fetchOverride || globalThis.fetch?.bind(globalThis)
    if (!fetchFunction) {
      throw new Error('当前环境不支持 Fetch API')
    }
    this.fetch = fetchFunction
    this.proxyPath = proxyPath
  }

  async request({ url, method = 'GET', headers = {}, body, signal, onChunk, responseType = 'text' } = {}) {
    let response
    let errorBody

    if (this.proxyPath) {
      response = await this.fetch(this.proxyPath, {
        method,
        headers: { ...headers, 'x-ai-target-url': url },
        body,
        signal
      })
      if (response.status === 404) {
        errorBody = await response.text()
        const proxyRouteMissing = !errorBody && !response.headers.get('content-type')
        if (proxyRouteMissing) {
          response = await this.fetch(url, { method, headers, body, signal })
          errorBody = undefined
        }
      }
    } else {
      response = await this.fetch(url, { method, headers, body, signal })
    }

    if (!response.ok) {
      errorBody ??= await response.text()
      throw new ModelHttpError(extractModelErrorMessage(errorBody, response.status), {
        status: response.status,
        body: errorBody,
        code: response.status === 401 || response.status === 403 ? 'authentication_error' : 'http_error'
      })
    }

    if (onChunk && response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value?.length) {
          onChunk(value)
        }
      }
      return { status: response.status, headers: response.headers, text: '' }
    }

    if (responseType === 'arraybuffer') {
      return {
        status: response.status,
        headers: response.headers,
        text: '',
        data: new Uint8Array(await response.arrayBuffer())
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      text: await response.text()
    }
  }
}
