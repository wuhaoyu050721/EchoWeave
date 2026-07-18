function normalizeFileError(error, fallback) {
  if (error instanceof Error) return error
  const detail = error?.errMsg || error?.message || error?.code || error?.errCode
  return new Error(detail ? `${fallback}：${detail}` : fallback)
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_SOURCE_CHUNK_BYTES = 12 * 1024
const NATIVE_DOWNLOAD_CHUNK_BYTES = 768 * 1024

const IMAGE_EXTENSION_BY_MIME_TYPE = Object.freeze({
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
})

function normalizedBinaryBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  throw new Error('导出的二进制数据无效')
}

function bytesToBase64(bytes) {
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += BASE64_SOURCE_CHUNK_BYTES) {
    const end = Math.min(bytes.length, offset + BASE64_SOURCE_CHUNK_BYTES)
    let chunk = ''
    for (let index = offset; index < end; index += 3) {
      const first = bytes[index]
      const hasSecond = index + 1 < bytes.length
      const hasThird = index + 2 < bytes.length
      const second = hasSecond ? bytes[index + 1] : 0
      const third = hasThird ? bytes[index + 2] : 0
      chunk += BASE64_ALPHABET[first >> 2]
      chunk += BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)]
      chunk += hasSecond ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)] : '='
      chunk += hasThird ? BASE64_ALPHABET[third & 63] : '='
    }
    chunks.push(chunk)
  }
  return chunks.join('')
}

function resolveNativeDownloadWriter(nativeApi) {
  const candidates = [nativeApi, globalThis.__aiChatNativeApis, globalThis.uni]
  for (const candidate of candidates) {
    if (typeof candidate === 'function') return candidate
    if (typeof candidate?.aiChatWriteDownloadFile === 'function') {
      return options => candidate.aiChatWriteDownloadFile(options)
    }
  }
  return null
}

function callNativeDownloadWriter(nativeWriter, options) {
  return new Promise((resolve, reject) => {
    try {
      nativeWriter({
        ...options,
        success: resolve,
        fail: error => reject(normalizeFileError(error, '写入导出文件失败'))
      })
    } catch (error) {
      reject(normalizeFileError(error, '写入导出文件失败'))
    }
  })
}

async function writeBytesWithNative({ nativeWriter, fileName, source, mimeType }) {
  let sessionId = ''
  try {
    const started = await callNativeDownloadWriter(nativeWriter, {
      operation: 'begin',
      fileName,
      mimeType: String(mimeType || 'application/octet-stream'),
      totalBytes: source.byteLength
    })
    sessionId = String(started?.sessionId ?? '')
    if (!sessionId) throw new Error('原生下载写入会话创建失败')

    for (let offset = 0; offset < source.byteLength; offset += NATIVE_DOWNLOAD_CHUNK_BYTES) {
      const chunk = source.subarray(offset, Math.min(source.byteLength, offset + NATIVE_DOWNLOAD_CHUNK_BYTES))
      await callNativeDownloadWriter(nativeWriter, {
        operation: 'append',
        sessionId,
        base64: bytesToBase64(chunk)
      })
    }

    const completed = await callNativeDownloadWriter(nativeWriter, { operation: 'commit', sessionId })
    return completed?.filePath || completed?.uri || fileName
  } catch (error) {
    if (sessionId) {
      await callNativeDownloadWriter(nativeWriter, { operation: 'abort', sessionId }).catch(() => {})
    }
    throw normalizeFileError(error, '写入导出文件失败')
  }
}

function requestLegacyStoragePermission(plusApi, destinationLabel = '下载目录') {
  const osName = String(plusApi?.os?.name ?? '').trim().toLowerCase()
  if (osName && osName !== 'android') return Promise.resolve()
  const majorVersion = Number.parseInt(String(plusApi?.os?.version ?? ''), 10)
  if (!Number.isFinite(majorVersion) || majorVersion > 9) return Promise.resolve()
  const requestPermissions = plusApi?.android?.requestPermissions
  if (typeof requestPermissions !== 'function') {
    return Promise.reject(new Error(`当前安装包无法申请${destinationLabel}写入权限`))
  }
  return new Promise((resolve, reject) => {
    requestPermissions(
      ['android.permission.WRITE_EXTERNAL_STORAGE'],
      result => {
        const denied = [...(result?.deniedPresent ?? []), ...(result?.deniedAlways ?? [])]
        if (denied.length) reject(new Error(`需要存储权限才能保存到${destinationLabel}`))
        else resolve()
      },
      error => reject(normalizeFileError(error, `申请${destinationLabel}写入权限失败`))
    )
  })
}

function imageMimeType(attachment) {
  const declared = String(attachment?.mimeType ?? '').trim().toLowerCase().split(';')[0]
  if (IMAGE_EXTENSION_BY_MIME_TYPE[declared]) return declared
  return /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(String(attachment?.dataUrl ?? ''))?.[1]?.toLowerCase() || ''
}

function imageExtension(attachment) {
  const mimeExtension = IMAGE_EXTENSION_BY_MIME_TYPE[imageMimeType(attachment)]
  if (mimeExtension) return mimeExtension
  const candidates = [attachment?.name, attachment?.sourceUrl]
  for (const candidate of candidates) {
    const match = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(String(candidate ?? '').trim())
    const extension = String(match?.[1] ?? '').toLowerCase()
    if (extension === 'jpeg') return 'jpg'
    if (['avif', 'gif', 'jpg', 'png', 'webp'].includes(extension)) return extension
  }
  return 'png'
}

function imageFileStem(attachment) {
  const originalName = String(attachment?.name ?? '').trim().replace(/\.[a-z0-9]{2,5}$/i, '')
  const sanitized = originalName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
  return sanitized || 'ai-chat-image'
}

function validImageDataUrl(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+$/i.test(String(value ?? '').replace(/\s+/g, ''))
}

function validRemoteImageUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value ?? '').trim())
}

function downloadRemoteImage(uniApi, sourceUrl) {
  if (typeof uniApi?.downloadFile !== 'function') {
    return Promise.reject(new Error('当前安装包缺少图片下载能力'))
  }
  return new Promise((resolve, reject) => {
    uniApi.downloadFile({
      url: sourceUrl,
      success(result) {
        const statusCode = Number(result?.statusCode)
        if (Number.isFinite(statusCode) && (statusCode < 200 || statusCode >= 300)) {
          reject(new Error(`下载图片失败：HTTP ${statusCode}`))
          return
        }
        if (!result?.tempFilePath) {
          reject(new Error('下载图片后未获得临时文件'))
          return
        }
        resolve(result.tempFilePath)
      },
      fail: error => reject(normalizeFileError(error, '下载图片失败'))
    })
  })
}

function writeDataUrlToTemporaryImage(plusApi, dataUrl, fileName) {
  const Bitmap = plusApi?.nativeObj?.Bitmap
  if (typeof Bitmap !== 'function') {
    return Promise.reject(new Error('当前安装包缺少图片解码能力'))
  }
  return new Promise((resolve, reject) => {
    let bitmap
    const temporaryPath = `_doc/${fileName}`
    try {
      bitmap = new Bitmap(`image-export-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    } catch (error) {
      reject(normalizeFileError(error, '创建图片缓存失败'))
      return
    }
    let settled = false
    const clear = () => {
      try { bitmap.clear?.() } catch (_) {}
    }
    const fail = (error, fallback) => {
      if (settled) return
      settled = true
      clear()
      reject(normalizeFileError(error, fallback))
    }
    const save = () => {
      if (typeof bitmap.save !== 'function') {
        fail(null, '当前安装包缺少图片缓存写入能力')
        return
      }
      bitmap.save(
        temporaryPath,
        { overwrite: true },
        result => {
          if (settled) return
          settled = true
          clear()
          resolve(result?.target || temporaryPath)
        },
        error => fail(error, '写入图片缓存失败')
      )
    }
    if (typeof bitmap.loadBase64Data !== 'function') {
      fail(null, '当前安装包不支持图片数据解码')
      return
    }
    bitmap.loadBase64Data(dataUrl, save, error => fail(error, '读取图片数据失败'))
  })
}

function saveLocalImageToPhotoAlbum({ plusApi, uniApi, filePath }) {
  if (typeof uniApi?.saveImageToPhotosAlbum === 'function') {
    return new Promise((resolve, reject) => {
      uniApi.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(filePath),
        fail: error => reject(normalizeFileError(error, '保存图片到相册失败'))
      })
    })
  }
  if (typeof plusApi?.gallery?.save === 'function') {
    return new Promise((resolve, reject) => {
      plusApi.gallery.save(
        filePath,
        () => resolve(filePath),
        error => reject(normalizeFileError(error, '保存图片到相册失败'))
      )
    })
  }
  return Promise.reject(new Error('当前安装包缺少系统相册保存能力'))
}

function removeTemporaryImage(plusApi, filePath) {
  if (!String(filePath ?? '').startsWith('_doc/') || typeof plusApi?.io?.resolveLocalFileSystemURL !== 'function') return
  plusApi.io.resolveLocalFileSystemURL(
    filePath,
    entry => entry?.remove?.(() => {}, () => {}),
    () => {}
  )
}

export function createJsonExportFileName(now = new Date()) {
  const iso = new Date(now).toISOString()
  return `ai-chat-backup-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}.json`
}

export function createImageExportFileName(attachment = {}, now = new Date()) {
  const iso = new Date(now).toISOString()
  const timestamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`
  return `${imageFileStem(attachment)}-${timestamp}.${imageExtension(attachment)}`
}

export async function saveImageToPhotoAlbum({ plusApi, uniApi, fileName, dataUrl, sourceUrl } = {}) {
  if (!plusApi) throw new Error('当前环境不是 App，无法写入系统相册')
  if (!fileName || /[\\/]/.test(fileName)) throw new Error('图片文件名无效')

  const normalizedDataUrl = String(dataUrl ?? '').replace(/\s+/g, '')
  const normalizedSourceUrl = String(sourceUrl ?? '').trim()
  if (!validImageDataUrl(normalizedDataUrl) && !validRemoteImageUrl(normalizedSourceUrl)) {
    throw new Error('图片数据无效，无法保存')
  }

  await requestLegacyStoragePermission(plusApi, '系统相册')
  let temporaryPath = ''
  const generatedTemporaryPath = validImageDataUrl(normalizedDataUrl) ? `_doc/${fileName}` : ''
  try {
    temporaryPath = generatedTemporaryPath
      ? await writeDataUrlToTemporaryImage(plusApi, normalizedDataUrl, fileName)
      : await downloadRemoteImage(uniApi, normalizedSourceUrl)
    await saveLocalImageToPhotoAlbum({ plusApi, uniApi, filePath: temporaryPath })
    return temporaryPath
  } finally {
    removeTemporaryImage(plusApi, generatedTemporaryPath || temporaryPath)
  }
}

export function downloadImageInBrowser({ documentApi = globalThis.document, fileName, dataUrl, sourceUrl } = {}) {
  if (!fileName || /[\\/]/.test(fileName)) throw new Error('图片文件名无效')
  const normalizedDataUrl = String(dataUrl ?? '').replace(/\s+/g, '')
  const normalizedSourceUrl = String(sourceUrl ?? '').trim()
  const href = validImageDataUrl(normalizedDataUrl)
    ? normalizedDataUrl
    : validRemoteImageUrl(normalizedSourceUrl) ? normalizedSourceUrl : ''
  if (!href) throw new Error('图片数据无效，无法下载')
  if (typeof documentApi?.createElement !== 'function') throw new Error('当前浏览器不支持图片下载')

  const anchor = documentApi.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  documentApi.body?.appendChild?.(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove?.()
  }
  return fileName
}

export async function exportTextToDownloads({ plusApi, fileName, content } = {}) {
  const io = plusApi?.io
  if (typeof io?.requestFileSystem !== 'function' || io.PUBLIC_DOWNLOADS === undefined) {
    return Promise.reject(new Error('当前安装包缺少文件导出能力'))
  }
  if (!fileName || /[\\/]/.test(fileName)) {
    return Promise.reject(new Error('导出文件名无效'))
  }

  await requestLegacyStoragePermission(plusApi)

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error, fallback) => {
      if (settled) return
      settled = true
      reject(normalizeFileError(error, fallback))
    }

    io.requestFileSystem(io.PUBLIC_DOWNLOADS, fileSystem => {
      if (typeof fileSystem?.root?.getFile !== 'function') {
        fail(null, '无法访问系统下载目录')
        return
      }
      fileSystem.root.getFile(fileName, { create: true, exclusive: false }, fileEntry => {
        if (typeof fileEntry?.createWriter !== 'function') {
          fail(null, '无法创建备份文件')
          return
        }
        fileEntry.createWriter(writer => {
          let truncated = false
          const complete = () => {
            if (settled) return
            settled = true
            resolve(fileEntry.fullPath || fileName)
          }
          writer.onerror = error => fail(error, '写入备份文件失败')
          writer.onwriteend = () => {
            if (truncated) {
              complete()
              return
            }
            truncated = true
            writer.onwriteend = complete
            try {
              writer.seek?.(0)
              writer.write(String(content ?? ''))
            } catch (error) {
              fail(error, '写入备份文件失败')
            }
          }
          try {
            if (typeof writer.truncate !== 'function') throw new Error('文件写入器不支持安全覆盖')
            writer.truncate(0)
          } catch (error) {
            fail(error, '写入备份文件失败')
          }
        }, error => fail(error, '无法创建备份文件'))
      }, error => fail(error, '无法在下载目录创建文件'))
    }, error => fail(error, '无法访问系统下载目录'))
  })
}

export async function exportBytesToDownloads({
  plusApi,
  nativeApi,
  fileName,
  bytes,
  mimeType = 'application/octet-stream'
} = {}) {
  if (!fileName || /[\\/]/.test(fileName)) throw new Error('导出文件名无效')
  const source = normalizedBinaryBytes(bytes)
  const nativeWriter = resolveNativeDownloadWriter(nativeApi)
  if (nativeWriter) {
    return writeBytesWithNative({ nativeWriter, fileName, source, mimeType })
  }

  const io = plusApi?.io
  if (typeof io?.requestFileSystem !== 'function' || io.PUBLIC_DOWNLOADS === undefined) {
    throw new Error('当前安装包缺少文件导出能力')
  }
  if (typeof Blob !== 'function') throw new Error('当前安装包不支持原始二进制文件写入')

  await requestLegacyStoragePermission(plusApi)
  const payload = new Blob([source], { type: String(mimeType || 'application/octet-stream') })
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error, fallback) => {
      if (settled) return
      settled = true
      reject(normalizeFileError(error, fallback))
    }
    io.requestFileSystem(io.PUBLIC_DOWNLOADS, fileSystem => {
      if (typeof fileSystem?.root?.getFile !== 'function') {
        fail(null, '无法访问系统下载目录')
        return
      }
      fileSystem.root.getFile(fileName, { create: true, exclusive: false }, fileEntry => {
        if (typeof fileEntry?.createWriter !== 'function') {
          fail(null, '无法创建导出文件')
          return
        }
        fileEntry.createWriter(writer => {
          let truncated = false
          const complete = () => {
            if (settled) return
            settled = true
            resolve(fileEntry.fullPath || fileName)
          }
          writer.onerror = error => fail(error, '写入导出文件失败')
          writer.onwriteend = () => {
            if (truncated) {
              complete()
              return
            }
            truncated = true
            writer.onwriteend = complete
            try {
              writer.seek?.(0)
              writer.write(payload)
            } catch (error) {
              fail(error, '写入导出文件失败')
            }
          }
          try {
            if (typeof writer.truncate !== 'function') throw new Error('文件写入器不支持安全覆盖')
            writer.truncate(0)
          } catch (error) {
            fail(error, '写入导出文件失败')
          }
        }, error => fail(error, '无法创建导出文件'))
      }, error => fail(error, '无法在下载目录创建文件'))
    }, error => fail(error, '无法访问系统下载目录'))
  })
}
