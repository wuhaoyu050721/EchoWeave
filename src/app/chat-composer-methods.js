import { restoreUnsentDraft } from './composer-drafts.js'
import { groupMentionQuery, insertGroupMention } from '../core/group-chat.js'
import { setGenerationMode, setGenerating } from '../ui-state.js'
const COMPOSER_MIN_HEIGHT = 44
const COMPOSER_MAX_HEIGHT = 132
const COMPOSER_LINE_HEIGHT = 22

export const composerMethods = {
			handleComposerKeydown(event) {
				if (event?.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || event.isComposing || event.keyCode === 229 || event.repeat) return
				if (!this.canSend || this.ui.generating || this.attachmentProcessing || this.composerDraft.sending) return
				if (!this.draftMessage.trim() && !this.pendingAttachments.length) return
				event.preventDefault?.()
				return this.sendMessage()
			},
			resizeComposerInput(event) {
				const lineCount = Number(event?.detail?.lineCount)
				if (Number.isFinite(lineCount) && lineCount > 0) {
					this.composerInputHeight = Math.min(COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT + (lineCount - 1) * COMPOSER_LINE_HEIGHT)
					return
				}

				const ref = Array.isArray(this.$refs.composerInput) ? this.$refs.composerInput[0] : this.$refs.composerInput
				const textarea = ref?.tagName === 'TEXTAREA' ? ref : ref?.$el?.querySelector?.('textarea')
				if (!textarea || typeof textarea.scrollHeight !== 'number') return

				textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`
				const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.ceil(textarea.scrollHeight)))
				textarea.style.height = `${nextHeight}px`
				this.composerInputHeight = nextHeight
			},
			setImageGenerationMode() {
				if (this.pendingAttachments.length) { this.showToast('生图模式暂不支持输入附件'); return }
				setGenerationMode(this.ui, 'image')
			},
			closeComposerMenus() { this.attachmentMenuOpen = false; this.emojiMenuOpen = false },
			closeStoryMenus() { this.modelMenuOpen = false; this.closeComposerMenus() },
			toggleAttachmentMenu() { this.modelMenuOpen = false; this.emojiMenuOpen = false; this.attachmentMenuOpen = !this.attachmentMenuOpen },
			toggleEmojiMenu() { this.modelMenuOpen = false; this.attachmentMenuOpen = false; this.emojiMenuOpen = !this.emojiMenuOpen },
			appendEmoji(emoji) { this.draftMessage += emoji; this.emojiMenuOpen = false },
			focusComposer() {
				this.$nextTick(() => {
					const ref = Array.isArray(this.$refs.composerInput) ? this.$refs.composerInput[0] : this.$refs.composerInput
					const input = ref?.focus ? ref : ref?.$el?.querySelector?.('textarea')
					input?.focus?.()
				})
			},
			openGroupMention() {
				if (!this.activeGroupConversation || this.ui.generating) return
				this.closeComposerMenus()
				if (groupMentionQuery(this.draftMessage) === null) {
					this.draftMessage = `${this.draftMessage}${this.draftMessage && !/\s$/.test(this.draftMessage) ? ' ' : ''}@`
				}
				this.focusComposer()
			},
			selectGroupMention(participant) {
				this.draftMessage = insertGroupMention(this.draftMessage, participant?.nameSnapshot)
				this.focusComposer()
			},
			chooseAttachmentAction(action) {
				this.closeComposerMenus()
				if (this.services?.nativeAttachmentPicker) {
					this.handleNativeAttachmentAction(action)
					return
				}
				this.$nextTick(() => {
					const target = this.$refs[action?.inputRef]
					const ref = Array.isArray(target) ? target[0] : target
					const input = ref?.type ? ref : ref?.$el?.querySelector?.('input')
					if (input?.type === 'file') {
						this.attachmentInputContext = { draft: this.composerDraft, services: this.services }
						input.click()
						return
					}
					this.openNativeAttachmentPicker(action)
				})
			},
			async handleNativeAttachmentAction(action) {
				if (this.attachmentProcessing) return
				const draft = this.composerDraft
				const services = this.services
				draft.processing = true
				this.errorMessage = ''
				try {
					const prepared = await services.nativeAttachmentPicker.pick(action?.id, { existing: draft.attachments })
					draft.attachments = [...draft.attachments, ...prepared]
				} catch (error) {
					if (draft === this.composerDraft) this.handleError(error, '附件处理失败')
				} finally {
					draft.processing = false
				}
			},
			openNativeAttachmentPicker(action) {
				if (typeof document === 'undefined') {
					this.handleError(new Error('当前 App 运行环境需要原生文件选择适配器'), '附件选择失败')
					return
				}
				const context = { draft: this.composerDraft, services: this.services }
				const nativeInput = document.createElement('input')
				nativeInput.type = 'file'
				nativeInput.accept = action?.id === 'file' ? this.textAttachmentAccept : 'image/*'
				nativeInput.multiple = action?.id !== 'camera'
				if (action?.id === 'camera') nativeInput.setAttribute('capture', 'environment')
				nativeInput.style.display = 'none'
				document.body.appendChild(nativeInput)
				let cleanupTimer = 0
				const cleanup = () => {
					clearTimeout(cleanupTimer)
					nativeInput.remove()
				}
				nativeInput.addEventListener('change', event => {
					Promise.resolve(this.handleAttachmentSelection(event, context)).finally(cleanup)
				}, { once: true })
				nativeInput.addEventListener('cancel', cleanup, { once: true })
				cleanupTimer = setTimeout(cleanup, 5 * 60 * 1000)
				nativeInput.click()
			},
			async handleAttachmentSelection(event, context = null) {
				const input = event?.target
				const files = input?.files
				const { draft, services } = context || this.attachmentInputContext || { draft: this.composerDraft, services: this.services }
				this.attachmentInputContext = null
				if (!files?.length || draft.processing) return
				draft.processing = true
				if (draft === this.composerDraft) this.errorMessage = ''
				try {
					const prepared = await services.attachmentService.prepareFiles(files, { existing: draft.attachments })
					draft.attachments = [...draft.attachments, ...prepared]
				} catch (error) {
					if (draft === this.composerDraft) this.handleError(error, '附件处理失败')
				} finally {
					draft.processing = false
					if (input) input.value = ''
				}
			},
			removePendingAttachment(index) {
				if (this.attachmentProcessing) return
				this.pendingAttachments.splice(index, 1)
			},
			async sendMessage() {
				if (!this.canSend) return
				const services = this.services
				const conversationId = this.ui.activeConversationId
				const draft = this.composerDraft
				if (this.messageHistoryTrimmed) await this.reloadLatestMessages()
				if (services !== this.services || conversationId !== this.ui.activeConversationId || draft.sending) return
				this.closeComposerMenus()
				const content = draft.text
				const pendingAttachments = draft.attachments
				let userMessagePersisted = false
				draft.text = ''
				draft.attachments = []
				draft.sending = true
				this.errorMessage = ''
				try {
					const result = await services.chatService.send({
						conversationId,
						providerProfileId: this.activeProvider?.id || null,
						content,
						attachments: pendingAttachments,
						mode: this.ui.generationMode,
						onMessage: message => {
							if (message.role === 'user') userMessagePersisted = true
							if (services === this.services && conversationId === this.ui.activeConversationId) this.upsertMessage(message)
						},
						onState: ({ generating }) => { if (services === this.services) setGenerating(this.ui, generating) }
					})
					if (services !== this.services) return
					if (result?.autoHandoffLimitReached) this.showToast('AI 接力已达到每轮 8 条上限')
					await this.loadConversations()
				} catch (error) {
					if (!userMessagePersisted) restoreUnsentDraft(draft, { content, attachments: pendingAttachments })
					if (draft === this.composerDraft && services === this.services) this.handleError(error)
				} finally {
					draft.sending = false
				}
			},
			handleComposerAction() {
				if (this.ui.generating) { this.stopGeneration(); return }
				if (this.canStoryContinue && !this.draftMessage.trim() && !this.pendingAttachments.length) {
					this.continueMessage(this.latestCompletedAssistantMessage.id)
					return
				}
				if (this.canSend) { this.sendMessage(); return }
				if (this.ui.generationMode === 'chat') this.startVoiceInput()
			},
			startVoiceInput() {
				this.closeComposerMenus()
				if (typeof plus === 'undefined' || typeof plus.speech?.startRecognize !== 'function') { this.showToast('当前环境不支持语音输入'); return }
				const draft = this.composerDraft
				plus.speech.startRecognize({ userInterface: true, continue: false }, result => {
					const recognized = String(result ?? '').trim()
					if (recognized) draft.text = `${draft.text}${draft.text ? ' ' : ''}${recognized}`
				}, error => { if (draft === this.composerDraft) this.handleError(new Error(error?.message || '语音识别失败'), '语音输入失败') })
			},
			stopGeneration() { this.services.chatService.stop() },
}
