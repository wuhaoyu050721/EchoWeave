// Drafts live only in memory and are scoped to both the account space and chat.
// Async operations retain their originating record instead of reading the active UI.
export function createComposerDraftStore(wrapRecord = value => value) {
  const workspaces = new Map()
  return {
    get(workspaceId, conversationId) {
      const workspaceKey = String(workspaceId || 'local')
      const conversationKey = String(conversationId || '')
      if (!workspaces.has(workspaceKey)) workspaces.set(workspaceKey, new Map())
      const drafts = workspaces.get(workspaceKey)
      if (!drafts.has(conversationKey)) {
        drafts.set(conversationKey, wrapRecord({ text: '', attachments: [], processing: false, sending: false }))
      }
      return drafts.get(conversationKey)
    },
    remove(workspaceId, conversationId) {
      workspaces.get(String(workspaceId || 'local'))?.delete(String(conversationId || ''))
    },
    clear() { workspaces.clear() }
  }
}

export function restoreUnsentDraft(draft, { content, attachments }) {
  // Preserve anything typed while the failed request was waiting for storage.
  draft.text = draft.text ? `${content}${content ? '\n' : ''}${draft.text}` : content
  draft.attachments = [...attachments, ...draft.attachments.filter(item => !attachments.includes(item))]
}
