function redactString(value, secrets, maxDetailLength) {
  let text = String(value ?? '').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]')
  }
  return text.slice(0, maxDetailLength)
}

function sanitize(value, secrets, maxDetailLength, key = '') {
  if (/authorization|api.?key/i.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactString(value, secrets, maxDetailLength)
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets, maxDetailLength))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, secrets, maxDetailLength, childKey)
      ])
    )
  }
  return value
}

function copyEntries(entries) {
  return entries.map((entry) => sanitize(entry, [], Number.MAX_SAFE_INTEGER))
}

export function createDiagnosticLogStore({
  now = () => Date.now(),
  maxEntries = 500,
  maxDetailLength = 240
} = {}) {
  let items = []

  return {
    add(type, detail = {}) {
      const { secrets: rawSecrets = [], ...rawDetail } = detail
      const secrets = rawSecrets.map((secret) => String(secret ?? '')).filter(Boolean)
      const safeDetail = sanitize(rawDetail, secrets, maxDetailLength)
      items = [...items, { timestamp: now(), type: String(type), ...safeDetail }].slice(-maxEntries)
    },

    clear() {
      items = []
    },

    entries() {
      return copyEntries(items)
    },

    exportData(metadata = {}) {
      return {
        version: 1,
        exportedAt: new Date(now()).toISOString(),
        metadata: sanitize(metadata, [], maxDetailLength),
        entries: copyEntries(items)
      }
    }
  }
}
