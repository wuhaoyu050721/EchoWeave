const NUMBER_FIELDS = [
  'status', 'chunkCount', 'receivedBytes', 'sseEventCount', 'payloadCount',
  'textDeltaCount', 'textCharacters', 'reasoningCharacters', 'toolCallCount',
  'imageCount', 'visibleCharacters', 'rawCharacters'
]
const FINISH_REASONS = new Set([
  'stop', 'length', 'content_filter', 'tool_calls', 'function_call',
  'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST',
  'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY'
])
const EMPTY_KINDS = new Set(['no_bytes', 'no_text', 'reasoning_only', 'tool_only', 'hidden_only', 'whitespace', 'unrecognized_format'])
const MAX_FALLBACK_BYTES = 2 * 1024 * 1024

export function sanitizeResponseDiagnostics(value = {}) {
  const output = {}
  for (const key of NUMBER_FIELDS) {
    const number = Number(value[key])
    if (Number.isFinite(number) && number >= 0) output[key] = Math.floor(number)
  }
  for (const key of ['stream', 'transportObserved', 'doneReceived']) {
    if (typeof value[key] === 'boolean') output[key] = value[key]
  }
  output.protocolType = ['gemini', 'openai-compatible'].includes(value.protocolType) ? value.protocolType : 'unknown'
  output.requestKind = ['send', 'retry', 'continue'].includes(value.requestKind) ? value.requestKind : 'send'
  output.responseFormat = ['sse', 'json'].includes(value.responseFormat) ? value.responseFormat : 'unknown'
  output.finishReason = FINISH_REASONS.has(value.finishReason) ? value.finishReason : value.finishReason ? 'other' : ''
  output.emptyKind = EMPTY_KINDS.has(value.emptyKind) ? value.emptyKind : ''
  const contentType = String(value.contentType || '').split(';')[0].trim().toLowerCase()
  output.contentType = ['text/event-stream', 'application/json', 'text/plain', 'text/html'].includes(contentType) ? contentType : contentType ? 'other' : ''
  return output
}

export function chatResponseError(code, message, diagnostics) {
  const error = new Error(message)
  error.code = code
  error.responseDiagnostics = sanitizeResponseDiagnostics(diagnostics)
  return error
}

export function emptyChatResponseError(diagnostics = {}) {
  let emptyKind = 'no_text'
  let message = '接口请求已结束，但没有返回可显示的回复正文，请重试或检查接口响应诊断'
  if (diagnostics.reasoningCharacters > 0) {
    emptyKind = 'reasoning_only'
    message = '接口只返回了思考内容，没有返回回复正文，请重试或检查模型与输出限制'
  } else if (diagnostics.toolCallCount > 0) {
    emptyKind = 'tool_only'
    message = '接口只返回了工具调用，没有返回回复正文；当前对话未执行工具，请检查接口配置'
  } else if (diagnostics.transportObserved === true && diagnostics.receivedBytes === 0) {
    emptyKind = 'no_bytes'
    message = '请求已结束，但客户端没有收到响应字节，请查看接口响应诊断后重试'
  } else if (['content_filter', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(diagnostics.finishReason)) {
    message = '接口结束了本次回复并报告内容限制，没有返回正文，请查看响应诊断中的结束原因'
  }
  return chatResponseError('empty_response', message, { ...diagnostics, emptyKind })
}

function textLength(value) {
  return typeof value === 'string' ? value.length : 0
}

function headerValue(headers, key) {
  if (typeof headers?.get === 'function') return headers.get(key) || ''
  return Object.entries(headers || {}).find(([name]) => name.toLowerCase() === key)?.[1] || ''
}

// Records only response shape and counts. The bounded buffer exists solely to
// support endpoints that return ordinary JSON despite stream=true; it is never
// included in diagnostics or persisted with a message.
export function createChatResponseObserver(protocolType, stream, handlers = {}) {
  const state = {
    protocolType, stream, transportObserved: false, status: 0, contentType: '',
    chunkCount: 0, receivedBytes: 0, sseEventCount: 0, payloadCount: 0,
    textDeltaCount: 0, textCharacters: 0, reasoningCharacters: 0, toolCallCount: 0,
    imageCount: 0, finishReason: '', doneReceived: false, responseFormat: 'unknown'
  }
  let buffered = []
  let bufferedBytes = 0
  let truncated = false
  const observeBytes = (bytes, isChunk) => {
    if (!bytes?.length) return
    state.transportObserved = true
    state.receivedBytes += bytes.length
    if (isChunk) state.chunkCount += 1
    if (!state.sseEventCount && !truncated) {
      bufferedBytes += bytes.length
      if (bufferedBytes > MAX_FALLBACK_BYTES) {
        truncated = true
        buffered = []
      } else buffered.push(bytes.slice())
    }
  }
  const observer = {
    state,
    snapshot: () => sanitizeResponseDiagnostics(state),
    chunk(bytes) { observeBytes(bytes, true) },
    response(response = {}) {
      state.transportObserved = true
      state.status = Number(response.status ?? response.statusCode) || state.status
      state.contentType = headerValue(response.headers, 'content-type') || state.contentType
    },
    returnedText(text) { observeBytes(new TextEncoder().encode(String(text || '')), false) },
    event(data) {
      state.sseEventCount += 1
      state.responseFormat = 'sse'
      buffered = []
      handlers.onEvent?.(data)
    },
    payload(payload) {
      state.payloadCount += 1
      if (protocolType === 'gemini') {
        if (payload?.promptFeedback?.blockReason) state.finishReason = payload.promptFeedback.blockReason
        for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
          for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
            if (part?.thought) state.reasoningCharacters += textLength(part.text)
            if (part?.functionCall) state.toolCallCount += 1
          }
        }
      } else {
        for (const choice of Array.isArray(payload?.choices) ? payload.choices : []) {
          const content = choice?.delta || choice?.message || {}
          state.reasoningCharacters += textLength(content.reasoning_content) + textLength(content.reasoning)
          state.toolCallCount += Array.isArray(content.tool_calls) ? content.tool_calls.length : content.function_call ? 1 : 0
        }
      }
    },
    delta(text, payload) {
      state.textDeltaCount += 1
      state.textCharacters += String(text || '').length
      handlers.onDelta?.(text, payload)
    },
    finishReason(reason, payload) {
      state.finishReason = reason
      handlers.onFinishReason?.(reason, payload)
    },
    done() {
      state.doneReceived = true
      handlers.onDone?.()
    },
    fallbackPayload() {
      if (state.sseEventCount || !state.receivedBytes) return null
      if (truncated) throw chatResponseError('invalid_sse_response', '接口返回了过大的非流式响应，无法按流式对话解析，请关闭流式输出后重试', { ...state, emptyKind: 'unrecognized_format' })
      const decoder = new TextDecoder()
      const text = buffered.map(bytes => decoder.decode(bytes, { stream: true })).join('') + decoder.decode()
      try {
        const payload = JSON.parse(text)
        state.responseFormat = 'json'
        return payload
      } catch {
        throw chatResponseError('invalid_sse_response', '接口返回了数据，但不是有效的 SSE 或 JSON 对话响应，请检查接口协议与响应诊断', { ...state, emptyKind: 'unrecognized_format' })
      }
    },
    assertContent(images = []) {
      state.imageCount = images.length
      if (!state.textCharacters && !images.length) throw emptyChatResponseError(state)
    },
    attachError(error) {
      const status = Number(error?.status ?? error?.statusCode)
      if (status > 0) {
        state.status = status
        state.transportObserved = true
      }
      if (error && typeof error === 'object') error.responseDiagnostics = sanitizeResponseDiagnostics({ ...state, ...error.responseDiagnostics })
      return error
    }
  }
  return observer
}
