export class NativeBackupPicker {
  constructor({ uniApi } = {}) {
    this.uniApi = uniApi
  }

  async pick() {
    if (typeof this.uniApi?.aiChatPickAttachments !== 'function') {
      throw new Error('当前 Android 安装包未包含备份文件选择能力')
    }
    const result = await new Promise((resolve, reject) => {
      this.uniApi.aiChatPickAttachments({
        mode: 'backup-json',
        maxCount: 1,
        success: resolve,
        fail: error => reject(new Error(error?.errMsg || error?.message || (error?.errCode ? `备份文件选择失败 (${error.errCode})` : '备份文件选择失败')))
      })
    })
    return Array.isArray(result?.files) ? result.files[0] || null : null
  }
}
