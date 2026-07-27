export const CHARACTER_STATUS_SETTING_KEY = 'characterStatusEnabled'

export async function readCharacterStatusEnabled(repository) {
  const value = await repository?.getSetting?.(CHARACTER_STATUS_SETTING_KEY, true)
  return value !== false
}
