import { NETWORK_PROXY_MODE_SMART, normalizeNetworkProxySetting, normalizeNetworkProxyUrl } from '../../core/network-proxy.js'

const PROXY_CACHE_TTL_MS = 30000
const PROXY_FAILURE_SUPPRESS_MS = 5 * 60 * 1000
const PROXY_DETECTION_TIMEOUT_MS = 2500

function currentTime(now) {
  const value = Number(now())
  return Number.isFinite(value) ? value : Date.now()
}

export function createAndroidNetworkProxy({
  nativeApi = null,
  now = () => Date.now(),
  detectionTimeoutMs = PROXY_DETECTION_TIMEOUT_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const nativeAvailable = typeof nativeApi?.aiChatDetectHttpProxy === 'function'
  const timeoutMs = Number.isFinite(detectionTimeoutMs) && detectionTimeoutMs > 0
    ? detectionTimeoutMs
    : PROXY_DETECTION_TIMEOUT_MS
  let cachedUrl = ''
  let cachedAt = 0
  let detectionCompleted = false
  let detectionFailed = false
  let detectionTimedOut = false
  let detectionFlight = null
  let suppressedUrl = ''
  let suppressedAt = 0

  const isSuppressed = (url, timestamp) => Boolean(url) &&
    url === suppressedUrl &&
    timestamp - suppressedAt < PROXY_FAILURE_SUPPRESS_MS

  const detect = ({ force = false } = {}) => {
    const timestamp = currentTime(now)
    if (force) {
      suppressedUrl = ''
      suppressedAt = 0
    } else if (detectionCompleted && !detectionFailed && timestamp - cachedAt < PROXY_CACHE_TTL_MS) {
      return Promise.resolve(cachedUrl)
    }
    if (detectionFlight) return detectionFlight.promise

    let resolveFlight
    const flight = {
      promise: new Promise(resolve => { resolveFlight = resolve }),
      timer: null,
      settled: false,
      cancel: null
    }
    detectionFlight = flight
    detectionCompleted = false
    detectionFailed = false
    detectionTimedOut = false

    // A timed-out or invalidated native call can still return later. Only its own
    // active flight may publish a result or release the current pending state.
    const finish = ({ url = '', failed = false, timedOut = false, cancelled = false } = {}) => {
      if (flight.settled) return
      flight.settled = true
      clearTimeoutImpl(flight.timer)
      if (detectionFlight === flight) {
        detectionFlight = null
        if (!cancelled) {
          cachedUrl = url
          cachedAt = currentTime(now)
          detectionCompleted = true
          detectionFailed = failed
          detectionTimedOut = timedOut
        }
      }
      resolveFlight(cancelled ? '' : url)
    }
    flight.cancel = () => finish({ cancelled: true })
    flight.timer = setTimeoutImpl(() => finish({ failed: true, timedOut: true }), timeoutMs)

    Promise.resolve()
      .then(() => flight.settled ? '' : nativeApi?.aiChatDetectHttpProxy?.() || '')
      .then(value => {
        if (flight.settled) return
        let url = ''
        try {
          url = normalizeNetworkProxyUrl(value)
        } catch (_) {
          // A missing or invalid HTTP proxy still allows normal Android routing.
        }
        finish({ url, failed: !nativeAvailable })
      })
      .catch(() => finish({ failed: true }))

    return flight.promise
  }

  const getProxyRoute = async value => {
    const setting = normalizeNetworkProxySetting(value)
    if (!setting.enabled) return { proxyUrl: '', allowDirectFallback: false }
    if (setting.mode !== NETWORK_PROXY_MODE_SMART) {
      return { proxyUrl: setting.url, allowDirectFallback: false }
    }
    const url = await detect()
    return {
      proxyUrl: isSuppressed(url, currentTime(now)) ? '' : url,
      allowDirectFallback: true
    }
  }

  return {
    nativeAvailable,
    detect,
    getDetectionState() {
      return {
        available: nativeAvailable,
        pending: Boolean(detectionFlight),
        completed: detectionCompleted,
        failed: detectionFailed,
        timedOut: detectionTimedOut,
        url: cachedUrl
      }
    },
    // 该代理地址已经让一次请求在收到任何数据前失败，短时间内不再使用它，避免每次都先等一次超时
    reportFailure(url) {
      const value = String(url || '').trim()
      // 只熔断自动探测出来的端口：手动填写的地址是用户的明确选择，不该被静默跳过
      if (!value || value !== cachedUrl) return
      suppressedUrl = value
      suppressedAt = currentTime(now)
    },
    invalidate() {
      detectionFlight?.cancel()
      cachedUrl = ''
      cachedAt = 0
      detectionCompleted = false
      detectionFailed = false
      detectionTimedOut = false
      suppressedUrl = ''
      suppressedAt = 0
    },
    getProxyRoute,
    async getProxyUrl(value) {
      return (await getProxyRoute(value)).proxyUrl
    }
  }
}
