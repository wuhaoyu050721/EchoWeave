export class NativeCharacterCardPicker {
  constructor({ uniApi } = {}) {
    this.uniApi = uniApi
  }

  async pick(source = 'file') {
    if (typeof this.uniApi?.aiChatPickAttachments !== 'function') {
      throw new Error('当前 Android 安装包未包含角色卡文件选择能力')
    }
    if (!['file', 'gallery'].includes(source)) {
      throw new Error('角色卡来源无效')
    }
    const result = await new Promise((resolve, reject) => {
      this.uniApi.aiChatPickAttachments({
        mode: source === 'gallery' ? 'character-card-gallery' : 'character-card-file',
        maxCount: 1,
        success: resolve,
        fail: error => reject(new Error(error?.errMsg || error?.message || (error?.errCode ? `角色卡选择失败 (${error.errCode})` : '角色卡选择失败')))
      })
    })
    return Array.isArray(result?.files) ? result.files[0] || null : null
  }
}
