export const ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 4,
  maxCombinedBytes: 8 * 1024 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  maxImageDimension: 1600,
  maxTextBytes: 200 * 1024,
  imageContextCost: 4000
})

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'xml', 'yaml', 'yml', 'html', 'htm', 'css',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'php', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'sh', 'bash', 'zsh', 'sql', 'ini',
  'toml', 'conf', 'properties', 'env', 'log'
])

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-yaml',
  'application/yaml'
])

function fileExtension(name) {
  const normalized = String(name ?? '').trim().toLowerCase()
  if (normalized === '.env' || normalized.endsWith('/.env')) return 'env'
  const dot = normalized.lastIndexOf('.')
  return dot >= 0 && dot < normalized.length - 1 ? normalized.slice(dot + 1) : ''
}

export const TEXT_ATTACHMENT_ACCEPT = [
  ...[...TEXT_EXTENSIONS].map(extension => `.${extension}`),
  'text/*',
  ...TEXT_MIME_TYPES
].join(',')

export function classifyTextFile(file = {}) {
  const mimeType = String(file.type ?? '').trim().toLowerCase()
  return TEXT_EXTENSIONS.has(fileExtension(file.name)) || mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType)
}

function rounded(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

export function formatAttachmentSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0)
  if (size < 1024) return `${Math.round(size)} B`
  if (size < 1024 * 1024) return `${rounded(size / 1024)} KB`
  return `${rounded(size / (1024 * 1024))} MB`
}
