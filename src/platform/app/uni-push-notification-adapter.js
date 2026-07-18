export const REPLY_NOTIFICATION_CHANNEL_ID = 'zhiyu_ai_reply_v1'

const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS'

function androidMajorVersion(plusApi) {
  if (String(plusApi?.os?.name || '').toLowerCase() !== 'android') return 0
  const major = Number.parseInt(String(plusApi?.os?.version || '').split('.')[0], 10)
  return Number.isFinite(major) ? major : 0
}

function notificationAuthorization(uniApi) {
  try { return uniApi?.getAppAuthorizeSetting?.()?.notificationAuthorized || 'unknown' }
  catch (_) { return 'unknown' }
}

export class UniPushNotificationAdapter {
  constructor({ uniApi, plusApi } = {}) {
    this.uniApi = uniApi
    this.plusApi = plusApi
    this.pushListener = null
    this.listenerMode = null
  }

  get supported() {
    return Boolean(
      typeof this.uniApi?.createPushMessage === 'function' ||
      typeof this.plusApi?.push?.createMessage === 'function'
    )
  }

  async initialize(onClick) {
    this.configureChannel()
    if (this.pushListener) return

    this.pushListener = event => {
      if (event?.type && event.type !== 'click') return
      Promise.resolve(onClick?.(event)).catch(() => {})
    }
    if (typeof this.uniApi?.onPushMessage === 'function') {
      this.uniApi.onPushMessage(this.pushListener)
      this.listenerMode = 'uni'
    } else if (typeof this.plusApi?.push?.addEventListener === 'function') {
      this.plusApi.push.addEventListener('click', this.pushListener)
      this.listenerMode = 'plus'
    }
  }

  configureChannel() {
    try {
      const manager = this.uniApi?.getPushChannelManager?.() || this.plusApi?.push?.getChannelManager?.()
      manager?.setPushChannel?.({
        channelId: REPLY_NOTIFICATION_CHANNEL_ID,
        channelDesc: 'AI 回复提醒',
        enableLights: true,
        enableVibration: true,
        importance: 4,
        lockscreenVisibility: 0
      })
    } catch (_) {}
  }

  async isAuthorized() {
    if (!this.supported) return false
    const authorization = notificationAuthorization(this.uniApi)
    if (authorization === 'authorized') return true
    if (authorization === 'denied' || authorization === 'config error') return false
    return androidMajorVersion(this.plusApi) < 13
  }

  async requestPermission() {
    if (!this.supported) return false
    if (await this.isAuthorized()) return true
    if (androidMajorVersion(this.plusApi) < 13) return false
    if (typeof this.plusApi?.android?.requestPermissions !== 'function') return false

    return new Promise(resolve => {
      try {
        this.plusApi.android.requestPermissions([POST_NOTIFICATIONS], result => {
          const granted = Array.isArray(result?.granted) && result.granted.includes(POST_NOTIFICATIONS)
          resolve(granted || notificationAuthorization(this.uniApi) === 'authorized')
        }, () => resolve(false))
      } catch (_) {
        resolve(false)
      }
    })
  }

  openSettings() {
    if (typeof this.uniApi?.openAppAuthorizeSetting !== 'function') return Promise.resolve(false)
    return new Promise(resolve => {
      try {
        this.uniApi.openAppAuthorizeSetting({
          success: () => resolve(true),
          fail: () => resolve(false)
        })
      } catch (_) {
        resolve(false)
      }
    })
  }

  showReplyNotification({ title, content, payload }) {
    if (typeof this.uniApi?.createPushMessage === 'function') {
      return new Promise((resolve, reject) => {
        try {
          this.uniApi.createPushMessage({
            title,
            content,
            payload,
            cover: false,
            channelId: REPLY_NOTIFICATION_CHANNEL_ID,
            category: 'IM',
            sound: 'system',
            when: Date.now(),
            success: resolve,
            fail: error => reject(new Error(error?.errMsg || error?.message || '创建回复通知失败'))
          })
        } catch (error) {
          reject(error)
        }
      })
    }
    if (typeof this.plusApi?.push?.createMessage === 'function') {
      this.plusApi.push.createMessage(content, JSON.stringify(payload), {
        title,
        cover: false,
        sound: 'system',
        when: new Date()
      })
      return Promise.resolve()
    }
    return Promise.reject(new Error('当前安装包未包含通知模块'))
  }

  dispose() {
    if (this.listenerMode === 'uni' && this.pushListener && typeof this.uniApi?.offPushMessage === 'function') {
      this.uniApi.offPushMessage(this.pushListener)
    }
    this.pushListener = null
    this.listenerMode = null
  }
}
