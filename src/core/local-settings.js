// Device security and transport choices must never travel with shared content.
// Keep app local: this record owns the application-lock PIN and enable switch.
export const DEVICE_LOCAL_SETTING_KEYS = Object.freeze([
  'app',
  'appLock',
  'appLockEnabled',
  'cloudDeviceId',
  'cloudAutoBackup',
  'cloudConfig',
  'networkProxy'
])

const localKeys = new Set(DEVICE_LOCAL_SETTING_KEYS)

export function portableSettings(settings = {}) {
  return Object.fromEntries(Object.entries(settings ?? {}).filter(([key]) => !localKeys.has(key)))
}
