import { ATTACHMENT_LIMITS } from './attachment-policy.js'
import { normalizeImageOutput } from './image-output.js'

export const PROFILE_AVATAR_SETTING_KEY = 'profileAvatar'

function dataUrlByteLength(dataUrl) {
  const encoded = String(dataUrl ?? '').split(',', 2)[1]?.replace(/\s+/g, '') || ''
  if (!encoded) return 0
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding)
}

export function normalizeProfileAvatar(value) {
  if (!value) return null
  const normalized = normalizeImageOutput(value, 0, { assumeImage: true })
  if (!normalized?.dataUrl) return null
  const byteSize = dataUrlByteLength(normalized.dataUrl)
  if (!byteSize || byteSize > ATTACHMENT_LIMITS.maxImageBytes) return null
  return {
    version: 1,
    dataUrl: normalized.dataUrl,
    mimeType: normalized.mimeType,
    byteSize,
    width: normalized.width,
    height: normalized.height,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null
  }
}

export function createProfileAvatar(attachment, now = () => new Date().toISOString()) {
  const normalized = normalizeProfileAvatar(attachment)
  if (!normalized) throw new Error('头像图片无效或超过 2 MB')
  return { ...normalized, updatedAt: now() }
}
