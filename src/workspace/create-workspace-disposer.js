export function createWorkspaceDisposer({
  chatService,
  replyNotificationService,
  repository,
  closeDeviceServices
} = {}) {
  let disposal = null
  return function disposeWorkspaceServices() {
    if (disposal) return disposal
    disposal = (async () => {
      let failure = null
      try {
        if (typeof chatService?.stopAndWait === 'function') await chatService.stopAndWait()
        else chatService?.stop?.()
      } catch (error) {
        failure = error
      }
      try {
        await replyNotificationService?.dispose?.()
      } catch (error) {
        failure ||= error
      }
      try {
        await repository?.close?.()
      } catch (error) {
        failure ||= error
      }
      try {
        await closeDeviceServices?.()
      } catch (error) {
        failure ||= error
      }
      if (failure) throw failure
    })()
    return disposal
  }
}
