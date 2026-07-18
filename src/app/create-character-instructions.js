import { buildCharacterPromptBundle, mergePromptBundles } from '../core/character-prompt.js'

export function createUserNameResolver(repository) {
  return async () => String(await repository.getSetting('profileName', '用户') || '用户').trim() || '用户'
}

export async function syncProfileNameFromCloudSession(repository, session) {
  const username = String(session?.user?.username ?? '').trim()
  if (!username) return ''
  if (!repository?.setSetting) throw new Error('本地用户名存储服务不可用')
  await repository.setSetting('profileName', username)
  return username
}

export function createChatInstructionResolver({ repository, vault, getUserName = createUserNameResolver(repository) } = {}) {
  return async (conversation, { messages = [] } = {}) => {
    let globalPrompt = ''
    if (conversation?.systemPromptMode === 'override' && conversation.encryptedSystemPrompt) {
      globalPrompt = await vault.decryptString(conversation.encryptedSystemPrompt)
    } else if (conversation?.systemPromptMode !== 'disabled') {
      const settings = await repository.getSetting('systemPrompt', { enabled: false, encryptedValue: null })
      if (settings.enabled && settings.encryptedValue) globalPrompt = await vault.decryptString(settings.encryptedValue)
    }
    if (!conversation?.characterId || !repository.getCharacter) return globalPrompt

    const character = await repository.getCharacter(conversation.characterId)
    if (!character || character.deletedAt) return globalPrompt
    const availableBooks = repository.listWorldBooks
      ? await repository.listWorldBooks({ characterId: character.id, includeGlobal: true })
      : []
    const worldBooks = availableBooks.filter(book => (
      book.characterId === character.id ||
      (book.scope === 'global' && (!book.characterIds?.length || book.characterIds.includes(character.id)))
    ))
    const characterBundle = buildCharacterPromptBundle({
      character,
      worldBooks,
      messages,
      userName: await getUserName()
    })
    return mergePromptBundles(globalPrompt, characterBundle)
  }
}
