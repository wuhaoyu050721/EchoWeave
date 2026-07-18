import { importError } from './errors.js'

function timestampValue(now) {
  const value = typeof now === 'function' ? now() : now
  return value instanceof Date ? value.toISOString() : String(value || new Date().toISOString())
}

export function mapCharacterToDomain(preview, { idFactory, now = () => new Date().toISOString() } = {}) {
  if (typeof idFactory !== 'function') throw importError('missing_id_factory', '角色导入缺少 ID 生成器', { stage: 'commit' })
  if (!preview?.cardV3?.data || !preview?.commitData?.avatarDataUrl) {
    throw importError('invalid_import_preview', '角色卡预览数据不完整', { stage: 'commit' })
  }
  const timestamp = timestampValue(now)
  const characterId = idFactory()
  const assets = preview.commitData.assets.map(asset => ({
    ...asset,
    id: idFactory(),
    characterId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }))
  const avatar = assets.find(asset => asset.type === 'icon') || assets.find(asset => asset.source === 'avatar')
  const worldBooks = []
  if (preview.cardV3.data.character_book) {
    worldBooks.push({
      id: idFactory(),
      characterId,
      scope: 'character',
      source: 'character-card',
      name: preview.cardV3.data.character_book.name || `${preview.cardV3.data.name} 世界书`,
      data: preview.cardV3.data.character_book,
      sourceHash: preview.source.hash,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    })
  }
  const character = {
    id: characterId,
    name: preview.cardV3.data.name,
    nickname: preview.cardV3.data.nickname || '',
    description: preview.cardV3.data.description,
    tags: preview.cardV3.data.tags,
    creator: preview.cardV3.data.creator,
    characterVersion: preview.cardV3.data.character_version,
    card: preview.cardV3,
    sourceVersion: preview.character.sourceVersion,
    sourceFileName: preview.source.name,
    sourceHash: preview.source.hash,
    avatarAssetId: avatar?.id || null,
    worldBookIds: worldBooks.map(book => book.id),
    assetIds: assets.map(asset => asset.id),
    cloudBackupAllowed: true,
    importedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }
  return { character, worldBooks, characterAssets: assets }
}
