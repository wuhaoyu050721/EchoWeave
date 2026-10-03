import { extractImageOutputs } from './image-output.js'

export class OpenAISseParser {
  constructor(handlers = {}) {
    this.handlers = handlers
    this.decoder = new TextDecoder('utf-8', { fatal: false })
    this.currentLine = ''
    this.dataLines = []
    this.pendingCarriageReturn = false
    this.done = false
    this.finished = false
  }

  feed(bytes) {
    if (this.done || this.finished || !bytes?.length) {
      return
    }
    this.#consumeText(this.decoder.decode(bytes, { stream: true }))
  }

  finish() {
    if (this.finished) {
      return
    }
    this.finished = true
    this.#consumeText(this.decoder.decode())
    if (this.pendingCarriageReturn) {
      this.pendingCarriageReturn = false
      this.#finishLine()
    }
    if (this.currentLine) {
      this.#finishLine()
    }
    this.#dispatchEvent()
  }

  #consumeText(text) {
    for (const character of text) {
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false
        this.#finishLine()
        if (character === '\n') {
          continue
        }
      }

      if (character === '\r') {
        this.pendingCarriageReturn = true
      } else if (character === '\n') {
        this.#finishLine()
      } else {
        this.currentLine += character
      }
    }
  }

  #finishLine() {
    const line = this.currentLine
    this.currentLine = ''

    if (!line) {
      this.#dispatchEvent()
      return
    }
    if (line.startsWith(':')) {
      return
    }

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }
    if (field === 'data') {
      this.dataLines.push(value)
    }
  }

  #dispatchEvent() {
    if (!this.dataLines.length || this.done) {
      this.dataLines = []
      return
    }

    const data = this.dataLines.join('\n')
    this.dataLines = []
    this.handlers.onEvent?.(data)

    if (data.trim() === '[DONE]') {
      this.done = true
      this.handlers.onDone?.()
      return
    }

    const shouldParse = Boolean(
      this.handlers.onDelta ||
      this.handlers.onImage ||
      this.handlers.onFinishReason ||
      this.handlers.onError ||
      !this.handlers.onEvent
    )
    if (!shouldParse) {
      return
    }

    try {
      const payload = JSON.parse(data)
      this.handlers.onPayload?.(payload)
      if (payload?.error) {
        const error = new Error('接口在流式响应中返回了错误，请检查接口状态或输出限制')
        error.code = 'upstream_response_error'
        throw error
      }
      const choice = payload?.choices?.[0]
      const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ??
        choice?.delta?.refusal ?? choice?.message?.refusal
      if (typeof content === 'string' && content) {
        this.handlers.onDelta?.(content, payload)
      } else if (content && typeof content === 'object') {
        for (const part of Array.isArray(content) ? content : [content]) {
          if (typeof part?.text === 'string' && part.text) this.handlers.onDelta?.(part.text, payload)
        }
      }
      if (choice?.finish_reason) {
        this.handlers.onFinishReason?.(choice.finish_reason, payload)
      }
      for (const image of extractImageOutputs(payload, { baseUrl: this.handlers.imageBaseUrl })) {
        this.handlers.onImage?.(image, payload)
      }
    } catch (error) {
      const parserError = new Error(error?.code === 'upstream_response_error' ? error.message : '无法解析模型 SSE 数据，请检查接口响应格式')
      parserError.code = error?.code || 'invalid_sse_response'
      parserError.cause = error
      parserError.data = data
      this.handlers.onError?.(parserError)
    }
  }
}
