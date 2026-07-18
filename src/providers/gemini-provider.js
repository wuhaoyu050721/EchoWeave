import { GeminiSseParser } from '../core/gemini-sse-parser.js'
import { extractImageOutputs } from '../core/image-output.js'
import { buildGeminiEndpoint, buildGeminiModelEndpoint } from '../core/provider-url.js'

const IMAGE_GENERATION_TIMEOUT = 5 * 60 * 1000

function buildHeaders(apiKey, accept = 'application/json') {
  const headers = {
    Accept: accept,
    'Content-Type': 'application/json'
  }
  const key = String(apiKey ?? '').trim()
  if (key) headers['x-goog-api-key'] = key
  return headers
}

function attachmentName(value) {
  return String(value ?? 'attachment.txt').replace(/[\r\n]+/g, ' ').trim() || 'attachment.txt'
}

function inlineImagePart(attachment) {
  const dataUrl = String(attachment?.dataUrl ?? '')
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/_=\s-]+)$/i.exec(dataUrl)
  if (!match) throw new Error('图片附件无效')
  const data = match[2].replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!data || !/^[a-z0-9+/]+={0,2}$/i.test(data)) throw new Error('图片附件无效')
  return { inlineData: { mimeType: match[1].toLowerCase(), data } }
}

function messageParts(message) {
  const parts = []
  const content = String(message?.content ?? '')
  if (content.trim()) parts.push({ text: content })
  for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
    if (attachment?.kind === 'image') {
      parts.push(inlineImagePart(attachment))
      continue
    }
    if (attachment?.kind === 'text') {
      const text = String(attachment.textContent ?? '')
      if (!text) throw new Error('文本附件无效')
      const name = attachmentName(attachment.name)
      parts.push({ text: `[Attachment start: ${name}]\n${text}\n[Attachment end: ${name}]` })
      continue
    }
    throw new Error('附件类型无效')
  }
  return parts
}

function pushContent(contents, role, parts) {
  if (!parts.length) return
  const previous = contents[contents.length - 1]
  if (previous?.role === role) previous.parts.push(...parts)
  else contents.push({ role, parts })
}

export function serializeGeminiMessages(messages = []) {
  const contents = []
  const systemParts = []
  for (const message of messages) {
    const role = String(message?.role ?? '').trim().toLowerCase()
    if (role === 'system') {
      const text = String(message?.content ?? '').trim()
      if (text) systemParts.push({ text })
      continue
    }
    if (!['user', 'assistant', 'model'].includes(role)) throw new Error(`Gemini 不支持消息角色：${role || '空'}`)
    pushContent(contents, role === 'user' ? 'user' : 'model', messageParts(message))
  }
  if (contents[0]?.role === 'model') {
    const opening = contents.shift()
    const openingText = opening.parts
      .filter(part => typeof part?.text === 'string' && part.text.trim())
      .map(part => part.text.trim())
      .join('\n')
    if (openingText) {
      systemParts.push({ text: `The assistant already sent this opening message:\n${openingText}` })
    }
  }
  if (!contents.length) throw new Error('Gemini 请求缺少有效消息')
  return {
    contents,
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {})
  }
}

function responseTextParts(payload) {
  const parts = []
  for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      if (!part?.thought && typeof part?.text === 'string' && part.text.trim()) parts.push(part.text.trim())
    }
  }
  return parts
}

function imageGenerationConfig(request = {}) {
  const imageConfig = {}
  const aspectRatio = String(request.aspectRatio ?? request.aspect_ratio ?? '').trim()
  const imageSize = String(request.imageSize ?? request.image_size ?? '').trim()
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio
  if (imageSize) imageConfig.imageSize = imageSize
  return {
    responseModalities: ['TEXT', 'IMAGE'],
    ...(Object.keys(imageConfig).length ? { imageConfig } : {})
  }
}

export class GeminiProvider {
  constructor({ transport } = {}) {
    if (!transport) throw new Error('GeminiProvider 需要 ChatTransport')
    this.transport = transport
    this.protocolType = 'gemini'
  }

  async listModels(profile) {
    const endpoint = buildGeminiEndpoint(profile.baseUrl, 'models')
    const modelIds = new Set()
    let pageToken = ''
    for (let page = 0; page < 20; page += 1) {
      const query = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const response = await this.transport.request({
        url: `${endpoint}?${query}`,
        method: 'GET',
        headers: buildHeaders(profile.apiKey)
      })
      let payload
      try {
        payload = JSON.parse(response.text)
      } catch {
        throw new Error('Gemini 模型列表响应不是有效 JSON')
      }
      if (!Array.isArray(payload?.models)) throw new Error('Gemini 模型列表响应缺少 models 数组')
      for (const model of payload.models) {
        const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : []
        if (methods.length && !methods.includes('generateContent')) continue
        const id = String(model?.name ?? '').trim().replace(/^models\//i, '')
        if (id) modelIds.add(id)
      }
      pageToken = String(payload.nextPageToken ?? '').trim()
      if (!pageToken) break
    }
    return [...modelIds].sort((left, right) => left.localeCompare(right))
  }

  testConnection(profile) {
    return this.listModels(profile)
  }

  async streamChat(profile, request, handlers = {}) {
    let finishReason = null
    let parseError = null
    let eventCount = 0
    const images = []
    const imageSources = new Set()
    const addImage = (image) => {
      const source = image?.dataUrl || image?.sourceUrl
      if (!source || imageSources.has(source)) return
      imageSources.add(source)
      images.push(image)
      handlers.onImage?.(image)
    }
    const parser = new GeminiSseParser({
      imageBaseUrl: profile.baseUrl,
      onEvent: (data) => {
        eventCount += 1
        handlers.onEvent?.(data)
      },
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
      onImage: addImage
    })

    await this.transport.request({
      url: buildGeminiModelEndpoint(profile.baseUrl, request.model, 'streamGenerateContent', 'alt=sse'),
      method: 'POST',
      headers: buildHeaders(profile.apiKey, 'text/event-stream'),
      body: JSON.stringify(serializeGeminiMessages(request.messages)),
      signal: request.signal,
      timeout: Number(profile.requestTimeout) || 60000,
      onChunk: chunk => parser.feed(chunk)
    })
    parser.finish()
    if (parseError) throw parseError
    if (!eventCount) throw new Error('Gemini 流式响应不包含有效 SSE 事件')
    return { finishReason, images }
  }

  async generateImage(profile, request = {}, handlers = {}) {
    const prompt = String(request.prompt ?? '').trim()
    if (!prompt) throw new Error('图片提示词不能为空')
    const response = await this.transport.request({
      url: buildGeminiModelEndpoint(profile.baseUrl, request.model, 'generateContent'),
      method: 'POST',
      headers: buildHeaders(profile.apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: imageGenerationConfig(request)
      }),
      signal: request.signal,
      timeout: Math.max(IMAGE_GENERATION_TIMEOUT, Number(profile.requestTimeout) || 0)
    })
    let payload
    try {
      payload = JSON.parse(response.text)
    } catch {
      throw new Error('Gemini 生图响应不是有效 JSON')
    }
    if (payload?.error) throw new Error(String(payload.error.message || 'Gemini 生图请求失败'))
    const images = extractImageOutputs(payload, { baseUrl: profile.baseUrl })
    if (!images.length) {
      const explanation = responseTextParts(payload).join(' ').slice(0, 160)
      throw new Error(explanation ? `Gemini 生图响应没有图片：${explanation}` : 'Gemini 生图响应没有图片')
    }
    images.forEach(image => handlers.onImage?.(image))
    return { images, revisedPrompt: null }
  }
}
