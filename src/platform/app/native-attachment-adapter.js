function nativePrepared(file) {
  return file?.nativePrepared && typeof file.nativePrepared === 'object' ? file.nativePrepared : null
}

export class NativeAttachmentAdapter {
  async prepareImage(file) {
    const prepared = nativePrepared(file)
    if (!prepared?.dataUrl?.startsWith('data:image/') || !prepared.byteSize || !prepared.width || !prepared.height) {
      throw new Error('原生图片处理结果无效')
    }
    return {
      dataUrl: prepared.dataUrl,
      mimeType: prepared.mimeType || file?.type || 'image/jpeg',
      byteSize: Number(prepared.byteSize),
      width: Number(prepared.width),
      height: Number(prepared.height)
    }
  }

  async readUtf8Text(file) {
    const prepared = nativePrepared(file)
    if (typeof prepared?.textContent !== 'string' || !prepared.byteSize) {
      throw new Error('原生文本处理结果无效')
    }
    return {
      textContent: prepared.textContent,
      byteSize: Number(prepared.byteSize)
    }
  }
}
