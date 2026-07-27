import { createBackup, prepareImport } from '../core/backup-format.js'
import { MAX_PORTABLE_BACKUP_BYTES, serializePortableBackup } from '../core/backup-size.js'
import { createRuntimeId } from '../core/runtime-id.js'

export class BackupService {
  constructor({ repository, idFactory = createRuntimeId, now = () => new Date() } = {}) {
    this.repository = repository
    this.idFactory = idFactory
    this.now = now
  }

  async exportData() {
    return createBackup(await this.repository.readBackupData(), this.now())
  }

  async exportText(maxBytes = MAX_PORTABLE_BACKUP_BYTES) {
    const data = await this.exportData()
    return { data, ...serializePortableBackup(data, maxBytes) }
  }

  async importData(payload) {
    const prepared = prepareImport(payload, this.idFactory)
    await this.repository.importRecords(prepared)
    return {
      providers: prepared.providers.length,
      conversations: prepared.conversations.length,
      messages: prepared.messages.length,
      attachments: prepared.attachments.length
    }
  }
}
