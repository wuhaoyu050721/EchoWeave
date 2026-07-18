function readWithFileReader(file, method, FileReaderClass = globalThis.FileReader) {
  if (!FileReaderClass) return Promise.reject(new Error('当前环境不支持文件读取'))
  return new Promise((resolve, reject) => {
    const reader = new FileReaderClass()
    reader.addEventListener('load', () => resolve(reader.result), { once: true })
    reader.addEventListener('error', () => reject(reader.error || new Error('文件读取失败')), { once: true })
    reader[method](file)
  })
}

async function defaultReadArrayBuffer(file) {
  if (typeof file?.arrayBuffer === 'function') return file.arrayBuffer()
  return readWithFileReader(file, 'readAsArrayBuffer')
}

function defaultReadDataUrl(file) {
  return readWithFileReader(file, 'readAsDataURL')
}

function defaultDecodeImage(dataUrl, ImageClass = globalThis.Image) {
  if (!ImageClass) return Promise.reject(new Error('当前环境不支持图片解码'))
  return new Promise((resolve, reject) => {
    const image = new ImageClass()
    image.addEventListener('load', () => resolve({
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      hasTransparency: null
    }), { once: true })
    image.addEventListener('error', () => reject(new Error('图片已损坏或无法解码')), { once: true })
    image.src = dataUrl
  })
}

function defaultCreateCanvas(width, height) {
  const canvas = globalThis.document?.createElement?.('canvas')
  if (!canvas) throw new Error('当前环境不支持图片压缩')
  canvas.width = width
  canvas.height = height
  return canvas
}

function blobToDataUrl(blob) {
  return readWithFileReader(blob, 'readAsDataURL')
}

async function defaultEncodeCanvas(canvas, mimeType, quality) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片编码失败')), mimeType, quality)
  })
  return { dataUrl: await blobToDataUrl(blob), byteSize: blob.size }
}

function canvasHasTransparency(context, width, height) {
  if (!context?.getImageData) return false
  const pixels = context.getImageData(0, 0, width, height).data
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true
  }
  return false
}

export class WebAttachmentAdapter {
  constructor({
    readArrayBuffer = defaultReadArrayBuffer,
    readDataUrl = defaultReadDataUrl,
    decodeImage = defaultDecodeImage,
    createCanvas = defaultCreateCanvas,
    encodeCanvas = defaultEncodeCanvas,
    TextDecoderClass = globalThis.TextDecoder
  } = {}) {
    this.readArrayBuffer = readArrayBuffer
    this.readDataUrl = readDataUrl
    this.decodeImage = decodeImage
    this.createCanvas = createCanvas
    this.encodeCanvas = encodeCanvas
    this.TextDecoderClass = TextDecoderClass
  }

  async readUtf8Text(file) {
    const buffer = await this.readArrayBuffer(file)
    if (!this.TextDecoderClass) throw new Error('当前环境不支持 UTF-8 文本解码')
    try {
      const bytes = new Uint8Array(buffer)
      return {
        textContent: new this.TextDecoderClass('utf-8', { fatal: true }).decode(bytes),
        byteSize: bytes.byteLength
      }
    } catch {
      throw new Error('文本文件不是有效的 UTF-8 编码')
    }
  }

  async prepareImage(file, { maxDimension, maxBytes }) {
    const source = await this.readDataUrl(file)
    const decoded = await this.decodeImage(source)
    if (!decoded?.width || !decoded?.height) throw new Error('图片尺寸无效')
    const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = this.createCanvas(width, height)
    const context = canvas.getContext?.('2d')
    if (!context?.drawImage) throw new Error('当前环境不支持图片压缩')
    context.drawImage(decoded.image, 0, 0, width, height)

    const sourceSupportsAlpha = ['image/png', 'image/webp'].includes(String(file?.type ?? '').toLowerCase())
    const hasTransparency = decoded.hasTransparency == null
      ? sourceSupportsAlpha && canvasHasTransparency(context, width, height)
      : Boolean(decoded.hasTransparency)
    const mimeType = hasTransparency ? 'image/png' : 'image/jpeg'
    const qualities = mimeType === 'image/png' ? [undefined] : [0.86, 0.78, 0.70, 0.62, 0.54]
    let encoded = null
    for (const quality of qualities) {
      encoded = await this.encodeCanvas(canvas, mimeType, quality)
      if (Number(encoded?.byteSize) <= maxBytes) {
        return { ...encoded, mimeType, width, height }
      }
    }
    throw new Error('图片压缩后仍超过 2 MB')
  }
}
