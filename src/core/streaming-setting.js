export const STREAMING_SETTING_KEY = 'streamingEnabled'
export const STREAMING_SEGMENTED_DISPLAY_SETTING_KEY = 'streamingSegmentedDisplay'

export async function readStreamingEnabled(repository) {
  const value = await repository?.getSetting?.(STREAMING_SETTING_KEY, true)
  return value !== false
}

export async function readStreamingSegmentedDisplayEnabled(repository) {
  const value = await repository?.getSetting?.(STREAMING_SEGMENTED_DISPLAY_SETTING_KEY, false)
  return value === true
}
