export const DEFAULT_CHAT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export function resolveChatRequestTimeout(profile) {
  const configured = Number(profile?.requestTimeout)
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CHAT_REQUEST_TIMEOUT_MS
  return Math.max(DEFAULT_CHAT_REQUEST_TIMEOUT_MS, Math.round(configured))
}
