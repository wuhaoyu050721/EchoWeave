export const WORLD_BOOK_IMPORT_LIMITS = Object.freeze({
  maxJsonBytes: 5 * 1024 * 1024,
  maxEntries: 5000,
  maxNameCharacters: 200,
  maxEntryCharacters: 512 * 1024,
  maxTotalContentCharacters: 5 * 1024 * 1024
})

export const WORLD_BOOK_UNSAFE_KEYS = Object.freeze([
  'regex_scripts', 'scripts', 'script', 'javascript', 'html', 'iframe', 'plugins', 'tools'
])

export function mergeWorldBookImportLimits(overrides = {}) {
  return { ...WORLD_BOOK_IMPORT_LIMITS, ...overrides }
}
