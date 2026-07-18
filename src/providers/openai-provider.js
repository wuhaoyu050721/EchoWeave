import { buildOpenAIEndpoint } from '../core/provider-url.js'
import { bytesToDataUrl, extractImageOutputs } from '../core/image-output.js'
import { OpenAISseParser } from '../core/sse-parser.js'

const IMAGE_GENERATION_TIMEOUT = 5 * 60 * 1000
const IMAGE_DOWNLOAD_TIMEOUT = 2 * 60 * 1000

function buildHeaders(apiKey, accept = 'application/json') {
  const headers = {
    Accept: accept,
    'Content-Type': 'application/json'
  }
  if (String(apiKey ?? '').trim()) {
    headers.Authorization = `Bearer ${String(apiKey).trim()}`
  }
  return headers
}

function attachmentName(value) {
  return String(value ?? 'attachment.txt').replace(/[\r\n]+/g, ' ').trim() || 'attachment.txt'
}

function headerValue(headers, name) {
  if (headers?.get) return headers.get(name) || ''
  const wanted = String(name).toLowerCase()
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wanted)?.[1] || ''
}

function responseBytes(response) {
  if (response?.data instanceof Uint8Array) return response.data
  if (response?.data instanceof ArrayBuffer) return new Uint8Array(response.data)
  if (ArrayBuffer.isView(response?.data)) {
    return new Uint8Array(response.data.buffer, response.data.byteOffset, response.data.byteLength)
  }
  return new Uint8Array()
}

function responseText(response) {
  if (typeof response?.text === 'string' && response.text) return response.text
  const bytes = responseBytes(response)
  return bytes.length ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : ''
}

function sniffImageMimeType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66) return 'image/avif'
  return ''
}

function imageRequestOptions(request = {}) {
  const body = {
    model: request.model,
    prompt: String(request.prompt ?? '').trim(),
    n: Number(request.n) > 0 ? Math.floor(Number(request.n)) : 1
  }
  for (const key of ['size', 'quality', 'style', 'background', 'output_format', 'output_compression', 'moderation', 'response_format']) {
    if (request[key] !== undefined && request[key] !== null && request[key] !== '') body[key] = request[key]
  }
  return body
}

export function serializeOpenAIMessages(messages = []) {
  return messages.map(message => {
    const role = String(message?.role ?? '')
    const content = String(message?.content ?? '')
    const attachments = Array.isArray(message?.attachments) ? message.attachments : []
    if (role !== 'user' || !attachments.length) return { role, content }

    const parts = []
    if (content.trim()) parts.push({ type: 'text', text: content })
    for (const attachment of attachments) {
      if (attachment?.kind === 'image') {
        const dataUrl = String(attachment.dataUrl ?? '')
        if (!dataUrl.startsWith('data:image/')) throw new Error('图片附件无效')
        parts.push({ type: 'image_url', image_url: { url: dataUrl } })
        continue
      }
      if (attachment?.kind === 'text') {
        const name = attachmentName(attachment.name)
        const text = String(attachment.textContent ?? '')
        if (!text) throw new Error('文本附件无效')
        parts.push({ type: 'text', text: `[Attachment start: ${name}]\n${text}\n[Attachment end: ${name}]` })
        continue
      }
      throw new Error('附件类型无效')
    }
    return { role, content: parts }
  })
}

export class OpenAIProvider {
  constructor({ transport } = {}) {
    if (!transport) {
      throw new Error('OpenAIProvider 需要 ChatTransport')
    }
    this.transport = transport
    this.protocolType = 'openai-compatible'
  }

  async listModels(profile) {
    const response = await this.transport.request({
      url: buildOpenAIEndpoint(profile.baseUrl, 'models'),
      method: 'GET',
      headers: buildHeaders(profile.apiKey)
    })
    let payload
    try {
      payload = JSON.parse(response.text)
    } catch {
      throw new Error('模型列表响应不是有效 JSON')
    }
    if (!Array.isArray(payload?.data)) {
      throw new Error('模型列表响应缺少 data 数组')
    }
    return payload.data
      .map((item) => String(item?.id ?? '').trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
  }

  async testConnection(profile) {
    return this.listModels(profile)
  }

  async streamChat(profile, request, handlers = {}) {
    let finishReason = null
    let parseError = null
    const rawImages = []
    const parser = new OpenAISseParser({
      imageBaseUrl: profile.baseUrl,
      onDelta: handlers.onDelta,
      onDone: handlers.onDone,
      onFinishReason: (value, payload) => {
        finishReason = value
        handlers.onFinishReason?.(value, payload)
      },
      onError: (error) => {
        parseError = error
        handlers.onError?.(error)
      },
      onImage: (image) => rawImages.push(image)
    })

    await this.transport.request({
      url: buildOpenAIEndpoint(profile.baseUrl, 'chat/completions'),
      method: 'POST',
      headers: buildHeaders(profile.apiKey, 'text/event-stream'),
      body: JSON.stringify({
        model: request.model,
        messages: serializeOpenAIMessages(request.messages),
        stream: true
      }),
      signal: request.signal,
      onChunk: (chunk) => parser.feed(chunk)
    })
    parser.finish()
    if (parseError) {
      throw parseError
    }
    const images = await this.resolveImageOutputs(rawImages, request.signal)
    images.forEach(image => handlers.onImage?.(image))
    return { finishReason, images }
  }

  async generateImage(profile, request = {}, handlers = {}) {
    const prompt = String(request.prompt ?? '').trim()
    if (!prompt) throw new Error('图片提示词不能为空')
    const response = await this.transport.request({
      url: buildOpenAIEndpoint(profile.baseUrl, 'images/generations'),
      method: 'POST',
      headers: buildHeaders(profile.apiKey, 'application/json, image/*'),
      body: JSON.stringify(imageRequestOptions({ ...request, prompt })),
      signal: request.signal,
      responseType: 'arraybuffer',
      timeout: Math.max(IMAGE_GENERATION_TIMEOUT, Number(profile.requestTimeout) || 0)
    })
    const bytes = responseBytes(response)
    const declaredMimeType = String(headerValue(response.headers, 'content-type')).split(';')[0].trim().toLowerCase()
    const binaryMimeType = declaredMimeType.startsWith('image/') ? declaredMimeType : sniffImageMimeType(bytes)
    let rawImages
    if (binaryMimeType && bytes.length) {
      rawImages = [{ dataUrl: bytesToDataUrl(bytes, binaryMimeType), mimeType: binaryMimeType, byteSize: bytes.byteLength }]
    } else {
      let payload
      try {
        payload = JSON.parse(responseText(response))
      } catch {
        throw new Error('生图接口响应既不是有效 JSON，也不是可识别图片')
      }
      rawImages = extractImageOutputs(payload, { baseUrl: profile.baseUrl })
    }
    if (!rawImages.length) throw new Error('生图接口没有返回图片')
    const images = await this.resolveImageOutputs(rawImages, request.signal)
    images.forEach(image => handlers.onImage?.(image))
    return { images, revisedPrompt: images.find(image => image.revisedPrompt)?.revisedPrompt || null }
  }

  async resolveImageOutputs(images, signal) {
    const resolved = []
    for (const image of images) {
      if (!image?.sourceUrl || image.dataUrl) {
        resolved.push(image)
        continue
      }
      try {
        const response = await this.transport.request({
          url: image.sourceUrl,
          method: 'GET',
          headers: { Accept: 'image/*' },
          signal,
          responseType: 'arraybuffer',
          timeout: IMAGE_DOWNLOAD_TIMEOUT
        })
        const bytes = response?.data instanceof Uint8Array
          ? response.data
          : response?.data instanceof ArrayBuffer
            ? new Uint8Array(response.data)
            : new Uint8Array()
        if (bytes.length) {
          const mimeType = headerValue(response.headers, 'content-type') || image.mimeType
          resolved.push({
            ...image,
            mimeType: String(mimeType).split(';')[0].toLowerCase() || image.mimeType,
            byteSize: bytes.byteLength,
            dataUrl: bytesToDataUrl(bytes, mimeType)
          })
          continue
        }
      } catch (error) {
        if (signal?.aborted) throw error
      }
      resolved.push(image)
    }
    return resolved
  }
}
