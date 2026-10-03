const EMPTY_EXPLANATIONS = Object.freeze({
  no_bytes: '连接已结束，但没有收到响应正文。',
  no_text: '收到了接口响应，但没有可显示的正文。',
  reasoning_only: '接口只返回了思考过程，没有返回回答正文。',
  tool_only: '接口只返回了工具调用，没有返回回答正文。',
  hidden_only: '接口返回了状态或记忆字段，但没有可显示的正文。',
  whitespace: '接口返回的正文只有空白字符。',
  unrecognized_format: '收到了接口响应，但无法识别为当前接口格式。'
})

export function isEmptyCompletedReply(message) {
  if (message?.role !== 'assistant' || message.status !== 'completed') return false
  if (String(message.displayContent ?? message.content ?? '').trim()) return false
  return ![...(message.attachments || []), ...(message.imageAttachments || []), ...(message.textAttachments || [])]
    .some(attachment => attachment && !attachment.deletedAt)
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Math.floor(value)) : '未知'
}

function label(value) {
  const text = String(value ?? '')
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(text) ? text : '未知'
}

export function messageResponseDetails(message = {}) {
  const detail = message.responseDiagnostics
  if (!detail || typeof detail !== 'object') {
    return '这条历史消息没有记录响应详情，无法确认当时上游是否返回了内容。\n更新后的请求会记录接收字节数和正文数量；可手动重试后查看。'
  }
  const lines = []
  if (EMPTY_EXPLANATIONS[detail.emptyKind]) lines.push(EMPTY_EXPLANATIONS[detail.emptyKind])
  lines.push(`请求：${({ send: '发送', retry: '重试', continue: '续写' })[detail.requestKind] || '对话'} · HTTP ${detail.status ? count(detail.status) : '未知'}`)
  if (detail.transportObserved === true) {
    lines.push(`已接收：${count(detail.receivedBytes)} 字节 · ${count(detail.chunkCount)} 个分块`)
  } else lines.push('接收字节数：未记录，不能据此判断上游是否返回')
  lines.push(`解析：${label(detail.responseFormat)} · ${count(detail.sseEventCount)} 个流式事件`)
  lines.push(`正文：${count(detail.textCharacters)} 字符 · 可显示：${count(detail.visibleCharacters)} 字符`)
  if (Number(detail.reasoningCharacters) > 0) lines.push(`思考过程：${count(detail.reasoningCharacters)} 字符`)
  if (Number(detail.toolCallCount) > 0) lines.push(`工具调用：${count(detail.toolCallCount)}`)
  if (Number(detail.imageCount) > 0) lines.push(`图片：${count(detail.imageCount)}`)
  lines.push(`结束原因：${label(detail.finishReason)} · 结束标记：${detail.doneReceived === true ? '已收到' : '未收到'}`)
  if (message.errorCode) lines.push(`错误类型：${label(message.errorCode)}`)
  lines.push('这些记录不含密钥、提示词或回复原文。')
  return lines.join('\n')
}
