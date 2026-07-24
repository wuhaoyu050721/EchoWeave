export const STREAMING_SETTING_KEY = 'streamingEnabled'

export async function readStreamingEnabled(repository) {
  const value = await repository?.getSetting?.(STREAMING_SETTING_KEY, true)
  return value !== false
}
