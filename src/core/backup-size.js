import { encodeUtf8 } from './text-encoding-polyfill.js'

export const MAX_PORTABLE_BACKUP_BYTES = 50 * 1024 * 1024

export function portableBackupSizeError(byteSize, maxBytes = MAX_PORTABLE_BACKUP_BYTES) {
  const error = new Error('备份文件超过 50 MB，无法保证在手机端重新导入，请删除部分大型图片资源后重试')
  error.name = 'BackupSizeError'
  error.code = 'backup_too_large'
  error.byteSize = byteSize
  error.maxBytes = maxBytes
  return error
}

export function serializePortableBackup(payload, maxBytes = MAX_PORTABLE_BACKUP_BYTES) {
  const content = JSON.stringify(payload)
  const byteSize = encodeUtf8(content).byteLength
  if (byteSize > maxBytes) throw portableBackupSizeError(byteSize, maxBytes)
  return { content, byteSize }
}

export function estimateEncryptedEnvelopeBytes(plaintextBytes) {
  const ciphertextBytes = Math.max(0, Number(plaintextBytes) || 0) + 16
  const base64Bytes = 4 * Math.ceil(ciphertextBytes / 3)
  return base64Bytes + 384
}
