function isContextMessage(message) {
  if (!message || message.deletedAt || !['user', 'assistant'].includes(message.role)) {
    return false
  }
  if (message.role === 'user') {
    return Boolean(String(message.content ?? '').trim()) || (Array.isArray(message.attachmentIds) && message.attachmentIds.length > 0)
  }
  if (message.status === 'completed') {
    return Boolean(String(message.content ?? '').trim())
  }
  return message.status === 'interrupted' && Boolean(String(message.content ?? '').trim())
}

export function buildChatContext({
  messages = [],
  attachments = [],
  systemPrompt = '',
  postHistoryPrompt = '',
  maxMessages = 40,
  maxCharacters = 60000
} = {}) {
  const prompt = String(systemPrompt ?? '').trim()
  const trailingPrompt = String(postHistoryPrompt ?? '').trim()
  const characterBudget = Math.max(0, Number(maxCharacters) || 0)
  const countBudget = Math.max(1, Number(maxMessages) || 1)
  const eligible = messages
    .filter(isContextMessage)
    .slice()
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))

  const attachmentsById = new Map(attachments.map(attachment => [attachment.id, attachment]))
  const messageAttachments = new Map(eligible.map(message => [
    message.id,
    (message.attachmentIds ?? []).map(id => attachmentsById.get(id)).filter(Boolean)
  ]))

  const selected = []
  let usedCharacters = prompt.length + trailingPrompt.length
  for (let index = eligible.length - 1; index >= 0 && selected.length < countBudget; index -= 1) {
    const message = eligible[index]
    const content = String(message.content ?? '')
    const attachmentCost = (messageAttachments.get(message.id) ?? []).reduce((total, attachment) => {
      if (attachment.kind === 'image') return total + 4000
      if (attachment.kind === 'text') return total + String(attachment.textContent ?? '').length
      return total
    }, 0)
    const messageCost = content.length + attachmentCost
    const exceedsBudget = usedCharacters + messageCost > characterBudget
    if (exceedsBudget && selected.length > 0) {
      break
    }
    if (exceedsBudget && selected.length === 0 && characterBudget > prompt.length) {
      selected.push(message)
      break
    }
    if (!exceedsBudget) {
      selected.push(message)
      usedCharacters += messageCost
    }
  }

  const context = selected.reverse().map(({ id, role, content }) => {
    const result = { role, content: String(content) }
    const related = messageAttachments.get(id) ?? []
    if (related.length) result.attachments = related
    return result
  })
  if (prompt) {
    context.unshift({ role: 'system', content: prompt })
  }
  if (trailingPrompt) {
    context.push({ role: 'system', content: trailingPrompt })
  }
  return context
}
