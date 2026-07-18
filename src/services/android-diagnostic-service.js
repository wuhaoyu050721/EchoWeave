import { GEMINI_PROTOCOL, normalizeProviderProtocol } from '../core/provider-protocol.js'
import { buildGeminiModelEndpoint, buildOpenAIEndpoint } from '../core/provider-url.js'
import { GeminiSseParser } from '../core/gemini-sse-parser.js'
import { OpenAISseParser } from '../core/sse-parser.js'
import { createAbortController } from '../core/abort-controller-polyfill.js'

function createState(startedAt) {
  return {
    status: 'connecting',
    startedAt,
    firstChunkMs: null,
    durationMs: 0,
    chunkCount: 0,
    byteCount: 0,
    eventCount: 0,
    lateChunkCount: 0,
    finishReason: null,
    doneReceived: false,
    errorMessage: ''
  }
}

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === 'AbortError' || error?.code === 'request_aborted'
}

function validateConfig({ baseUrl, model, prompt } = {}) {
  if (!String(baseUrl ?? '').trim()) throw new Error('基础地址不能为空')
  if (!String(model ?? '').trim()) throw new Error('模型不能为空')
  if (!String(prompt ?? '').trim()) throw new Error('测试提示词不能为空')
}

function diagnosticError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function createDiagnosticRequest(config, protocolType, apiKey) {
  const model = String(config.model).trim()
  const prompt = String(config.prompt).trim()
  if (protocolType === GEMINI_PROTOCOL) {
    return {
      endpoint: buildGeminiModelEndpoint(config.baseUrl, model, 'streamGenerateContent', 'alt=sse'),
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-goog-api-key': apiKey } : {})
      },
      body: { contents: [{ role: 'user', parts: [{ text: prompt }] }] }
    }
  }
  return {
    endpoint: buildOpenAIEndpoint(config.baseUrl, 'chat/completions'),
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: { model, messages: [{ role: 'user', content: prompt }], stream: true }
  }
}

export class AndroidDiagnosticService {
  constructor({ transport, logStore, now = () => Date.now() } = {}) {
    if (!transport?.request) throw new Error('AndroidDiagnosticService 需要诊断传输层')
    if (!logStore?.add) throw new Error('AndroidDiagnosticService 需要诊断日志存储')
    this.transport = transport
    this.logStore = logStore
    this.now = now
    this.active = null
  }

  isRunning() {
    return Boolean(this.active)
  }

  stop() {
    if (!this.active || this.active.stopping) return false
    this.active.stopping = true
    this.active.controller.abort()
    return true
  }

  async start(config = {}, handlers = {}) {
    if (this.active) throw new Error('已有 Android 流式诊断正在运行')
    validateConfig(config)
    const protocolType = normalizeProviderProtocol(config.protocolType)
    const apiKey = String(config.apiKey ?? '').trim()
    const diagnosticRequest = createDiagnosticRequest(config, protocolType, apiKey)
    const endpoint = diagnosticRequest.endpoint

    const startedAt = this.now()
    const state = createState(startedAt)
    const controller = createAbortController()
    const emitState = () => handlers.onState?.({ ...state })
    const addLog = (type, detail = {}) => {
      this.logStore.add(type, { ...detail, secrets: [apiKey] })
      handlers.onLog?.(this.logStore.entries())
    }
    const updateDuration = () => {
      state.durationMs = Math.max(0, this.now() - startedAt)
    }
    let output = ''
    let parseError = null

    this.active = { controller, stopping: false }
    addLog('request_start', {
      message: `POST ${endpoint}`,
      model: String(config.model).trim(),
      protocolType
    })
    emitState()

    const Parser = protocolType === GEMINI_PROTOCOL ? GeminiSseParser : OpenAISseParser
    const parser = new Parser({
      onEvent: (data) => {
        state.eventCount += 1
        addLog('sse_event', { message: data.trim() === '[DONE]' ? '[DONE]' : data })
      },
      onDelta: (delta) => {
        output += delta
        handlers.onDelta?.(delta, output)
      },
      onFinishReason: (reason) => {
        state.finishReason = reason
      },
      onDone: () => {
        state.doneReceived = true
      },
      onError: (error) => {
        parseError = error
      }
    })

    try {
      await this.transport.request({
        url: endpoint,
        method: 'POST',
        headers: diagnosticRequest.headers,
        body: JSON.stringify(diagnosticRequest.body),
        timeout: Number(config.timeout) || 30000,
        signal: controller.signal,
        onHeaders: (headers) => addLog('response_headers', { headers }),
        onChunk: (bytes) => {
          if (state.status === 'connecting') {
            state.status = 'streaming'
            state.firstChunkMs = Math.max(0, this.now() - startedAt)
          }
          state.chunkCount += 1
          state.byteCount += bytes.byteLength
          updateDuration()
          addLog('chunk', { index: state.chunkCount, bytes: bytes.byteLength })
          parser.feed(bytes)
          emitState()
        },
        onLateChunk: (bytes) => {
          state.lateChunkCount += 1
          addLog('late_chunk', { index: state.lateChunkCount, bytes: bytes.byteLength })
        }
      })
      parser.finish()
      if (parseError) throw parseError
      if (!state.chunkCount) {
        throw diagnosticError('empty_stream', '请求完成，但没有收到任何流式分块')
      }
      if (!state.eventCount) {
        const protocolLabel = protocolType === GEMINI_PROTOCOL ? 'Gemini' : 'OpenAI'
        throw diagnosticError('invalid_sse_response', `收到了响应分块，但内容不是 ${protocolLabel} SSE 数据`)
      }
      state.status = 'completed'
      addLog('request_complete', {
        doneReceived: state.doneReceived,
        finishReason: state.finishReason || ''
      })
    } catch (error) {
      if (isAbortError(error, controller.signal)) {
        state.status = 'aborted'
        addLog('request_aborted', { message: '用户停止诊断请求' })
      } else {
        state.status = 'failed'
        state.errorMessage = error?.message || 'Android 流式诊断失败'
        addLog('request_failed', { message: state.errorMessage, code: error?.code || '' })
      }
    } finally {
      updateDuration()
      this.active = null
      emitState()
    }

    return { ...state }
  }
}
