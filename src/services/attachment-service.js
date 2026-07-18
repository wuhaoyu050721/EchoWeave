import { ATTACHMENT_LIMITS, classifyTextFile } from '../core/attachment-policy.js'

function normalizedFile(file) {
  return {
    file,
    name: String(file?.name ?? '').trim() || '未命名附件',
    mimeType: String(file?.type ?? '').trim().toLowerCase(),
    sourceBytes: Math.max(0, Number(file?.size) || 0)
  }
}

export class AttachmentService {
  constructor({ adapter, limits = ATTACHMENT_LIMITS } = {}) {
    if (!adapter?.prepareImage || !adapter?.readUtf8Text) throw new Error('AttachmentService 需要附件处理适配器')
    this.adapter = adapter
    this.limits = limits
  }

  async prepareFiles(files, { existing = [] } = {}) {
    const selected = Array.from(files ?? []).map(normalizedFile)
    if (!selected.length) return []
    if (existing.length + selected.length > this.limits.maxCount) throw new Error(`最多选择 ${this.limits.maxCount} 个附件`)

    const classified = selected.map(item => {
      if (item.mimeType.startsWith('image/')) return { ...item, kind: 'image' }
      if (classifyTextFile(item.file)) {
        if (item.sourceBytes > this.limits.maxTextBytes) throw new Error('文本文件不能超过 200 KB')
        return { ...item, kind: 'text' }
      }
      throw new Error(`不支持的文件类型：${item.name}`)
    })

    const prepared = []
    for (const item of classified) {
      if (item.kind === 'image') {
        const result = await this.adapter.prepareImage(item.file, {
          maxDimension: this.limits.maxImageDimension,
          maxBytes: this.limits.maxImageBytes
        })
        if (!result?.dataUrl || Number(result.byteSize) > this.limits.maxImageBytes) throw new Error('图片不能超过 2 MB')
        prepared.push({
          kind: 'image',
          name: item.name,
          mimeType: result.mimeType || item.mimeType,
          byteSize: Number(result.byteSize) || 0,
          dataUrl: result.dataUrl,
          textContent: null,
          width: Number(result.width) || null,
          height: Number(result.height) || null
        })
        continue
      }

      const result = await this.adapter.readUtf8Text(item.file)
      const textContent = String(result?.textContent ?? '')
      const byteSize = Number(result?.byteSize) || 0
      if (byteSize > this.limits.maxTextBytes) throw new Error('文本文件不能超过 200 KB')
      if (!textContent.trim()) throw new Error('文本文件不能为空')
      prepared.push({
        kind: 'text',
        name: item.name,
        mimeType: item.mimeType || 'text/plain',
        byteSize,
        dataUrl: null,
        textContent,
        width: null,
        height: null
      })
    }

    const combinedBytes = [...existing, ...prepared].reduce((total, item) => total + (Number(item?.byteSize) || 0), 0)
    if (combinedBytes > this.limits.maxCombinedBytes) throw new Error('附件总大小不能超过 8 MB')
    return prepared
  }
}
