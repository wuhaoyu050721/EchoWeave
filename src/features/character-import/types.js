export const CHARACTER_IMPORT_LIMITS = Object.freeze({
  maxPngBytes: 50 * 1024 * 1024,
  maxJsonBytes: 5 * 1024 * 1024,
  maxAssetBytes: 20 * 1024 * 1024,
  maxTotalAssetBytes: 100 * 1024 * 1024,
  maxAssets: 500,
  maxChunks: 2048,
  maxTextFieldCharacters: 2 * 1024 * 1024
})

export const CARD_METADATA_KEYWORDS = Object.freeze(['ccv3', 'chara'])
export const CARD_ASSET_KEYWORD_PREFIX = 'chara-ext-asset_'

export const UNSAFE_EXTENSION_KEYS = Object.freeze([
  'regex_scripts',
  'scripts',
  'script',
  'javascript',
  'html',
  'iframe',
  'plugins',
  'tools'
])

export function mergeCharacterImportLimits(overrides = {}) {
  return { ...CHARACTER_IMPORT_LIMITS, ...overrides }
}
