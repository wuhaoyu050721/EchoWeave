import { decryptCloudBackup, encryptCloudBackup } from '../core/cloud-backup-crypto.js'
import { createCloudBackupPayload, prepareCloudRestore } from '../core/cloud-backup-format.js'
import { estimateEncryptedEnvelopeBytes } from '../core/backup-size.js'
import { encodeUtf8 } from '../core/text-encoding-polyfill.js'

export const MAX_CLOUD_BACKUP_BYTES = 100 * 1024 * 1024

function backupSizeError(byteSize, maxBytes) {
  const error = new Error('云端备份超过 100 MB 上限，请减少角色资源后重试')
  error.name = 'CloudApiError'
  error.status = 413
  error.code = 'backup_too_large'
  error.byteSize = byteSize
  error.maxBytes = maxBytes
  return error
}

function notifyProgress(onProgress, stage, detail = {}) {
  try {
    onProgress?.({ stage, ...detail })
  } catch (_) {}
}

export class CloudBackupService {
  constructor({
    backupService,
    repository,
    vault,
    apiClient,
    encrypt = encryptCloudBackup,
    decrypt = decryptCloudBackup,
    maxUploadBytes = MAX_CLOUD_BACKUP_BYTES
  } = {}) {
    const hasBackupService = backupService?.exportData && backupService?.importData
    const hasRepositoryPath = repository?.readBackupData && repository?.importRecords && vault?.encryptString && vault?.decryptString
    if ((!hasBackupService && !hasRepositoryPath) || !apiClient?.uploadBackup || !apiClient?.downloadBackup) {
      throw new Error('CloudBackupService 依赖不完整')
    }
    this.backupService = backupService
    this.repository = repository
    this.vault = vault
    this.apiClient = apiClient
    this.encrypt = encrypt
    this.decrypt = decrypt
    this.maxUploadBytes = maxUploadBytes
  }

  async upload({ deviceId, syncPassword, onProgress } = {}) {
    let transferBytes = 0
    try {
      notifyProgress(onProgress, 'estimating')
      const conservativeEstimate = await this.repository?.estimateBackupBytes?.()
      const estimatedStoredEnvelopeBytes = estimateEncryptedEnvelopeBytes(conservativeEstimate)
      if (Number.isFinite(conservativeEstimate)) {
        transferBytes = estimatedStoredEnvelopeBytes
        notifyProgress(onProgress, 'estimated', {
          sourceBytes: conservativeEstimate,
          estimatedUploadBytes: estimatedStoredEnvelopeBytes
        })
      }
      if (Number.isFinite(conservativeEstimate) && estimatedStoredEnvelopeBytes > this.maxUploadBytes) {
        throw backupSizeError(estimatedStoredEnvelopeBytes, this.maxUploadBytes)
      }

      notifyProgress(onProgress, 'reading', { estimatedUploadBytes: transferBytes || null })
      const payload = this.repository
        ? await createCloudBackupPayload(await this.repository.readBackupData(), this.vault)
        : await this.backupService.exportData()
      const serializedPayload = JSON.stringify(payload)
      const plaintextBytes = encodeUtf8(serializedPayload).byteLength
      const estimatedEnvelopeBytes = estimateEncryptedEnvelopeBytes(plaintextBytes)
      transferBytes = estimatedEnvelopeBytes
      notifyProgress(onProgress, 'encrypting', {
        sourceBytes: plaintextBytes,
        estimatedUploadBytes: estimatedEnvelopeBytes
      })
      if (estimatedEnvelopeBytes > this.maxUploadBytes) {
        throw backupSizeError(estimatedEnvelopeBytes, this.maxUploadBytes)
      }

      const envelope = await this.encrypt(payload, syncPassword, { serializedPayload })
      const byteSize = encodeUtf8(JSON.stringify(envelope)).byteLength
      transferBytes = byteSize
      if (byteSize > this.maxUploadBytes) throw backupSizeError(byteSize, this.maxUploadBytes)
      notifyProgress(onProgress, 'uploading', { sourceBytes: plaintextBytes, byteSize })
      const result = await this.apiClient.uploadBackup({ deviceId, envelope })
      notifyProgress(onProgress, 'completed', { sourceBytes: plaintextBytes, byteSize })
      return result
    } catch (error) {
      if (error && typeof error === 'object' &&
        !Number.isFinite(Number(error.backupByteSize)) && transferBytes > 0) {
        error.backupByteSize = transferBytes
      }
      notifyProgress(onProgress, 'failed', {
        byteSize: Number(error?.backupByteSize) || 0,
        code: String(error?.code || ''),
        status: Number(error?.status) || 0
      })
      throw error
    }
  }

  async restore({ syncPassword }) {
    const envelope = await this.apiClient.downloadBackup()
    const payload = await this.decrypt(envelope, syncPassword)
    if (this.repository) {
      const prepared = await prepareCloudRestore(payload, { vault: this.vault })
      await this.repository.importRecords(prepared)
      return {
        providers: prepared.providers.length,
        conversations: prepared.conversations.length,
        messages: prepared.messages.length,
        attachments: prepared.attachments.length,
        characters: prepared.characters.length,
        worldBooks: prepared.worldBooks.length,
        characterAssets: prepared.characterAssets.length
      }
    }
    return this.backupService.importData(payload)
  }

  getMetadata() { return this.apiClient.getBackupMetadata() }
  deleteBackup() { return this.apiClient.deleteBackup() }
}
