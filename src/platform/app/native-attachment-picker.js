import { ATTACHMENT_LIMITS } from '../../core/attachment-policy.js'

const PICKER_MODES = new Set(['image', 'image-file', 'camera', 'file'])

export class NativeAttachmentPicker {
  constructor({ uniApi, attachmentService, limits = ATTACHMENT_LIMITS } = {}) {
    this.uniApi = uniApi
    this.attachmentService = attachmentService
    this.limits = limits
  }

  async pick(mode, { existing = [], maxCount = null } = {}) {
    if (!PICKER_MODES.has(mode)) throw new Error('附件选择类型无效')
    if (!this.attachmentService?.prepareFiles) throw new Error('Android 附件服务不可用')
    if (typeof this.uniApi?.aiChatPickAttachments !== 'function') {
      throw new Error('当前 Android 基座未包含附件选择插件')
    }
    const availableCount = this.limits.maxCount - existing.length
    if (availableCount <= 0) throw new Error(`最多选择 ${this.limits.maxCount} 个附件`)
    const requestedCount = Number(maxCount)
    const selectionCount = Number.isFinite(requestedCount) && requestedCount > 0
      ? Math.min(availableCount, Math.floor(requestedCount))
      : availableCount

    const result = await new Promise((resolve, reject) => {
      try {
        this.uniApi.aiChatPickAttachments({
          mode,
          maxCount: selectionCount,
          success: resolve,
          fail: error => reject(new Error(error?.errMsg || error?.message || (error?.errCode ? `系统附件选择失败 (${error.errCode})` : '系统附件选择失败')))
        })
      } catch (error) {
        reject(error)
      }
    })
    const files = Array.isArray(result?.files) ? result.files : []
    if (!files.length) return []
    return this.attachmentService.prepareFiles(files, { existing })
  }
}
