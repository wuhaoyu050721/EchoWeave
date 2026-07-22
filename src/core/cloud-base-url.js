export const DEFAULT_CLOUD_BASE_URL = 'https://www.surtr.cn:8018'

const LEGACY_CLOUD_BASE_URLS = new Set([
  'http://118.145.98.165:8018',
  'https://118.145.98.165:8018',
  'http://surtr.cn:8018',
  'https://surtr.cn:8018',
  'http://www.surtr.cn:8018'
])

export function normalizeCloudBaseUrl(value) {
  const normalized = String(value ?? '').trim().replace(/\/+$/, '')
  const match = normalized.match(/^(https?):\/\/([^/]+)(.*)$/i)
  if (!match) return normalized
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3]}`
}

export function resolveCloudRequestBaseUrl(value) {
  const normalized = normalizeCloudBaseUrl(value)
  return LEGACY_CLOUD_BASE_URLS.has(normalized) ? DEFAULT_CLOUD_BASE_URL : normalized
}
