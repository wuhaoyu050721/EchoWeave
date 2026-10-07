import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
const start = source.indexOf('requestCharacterCardUpdate({ characterId } = {}) {')
const end = source.indexOf('async startCharacterChat(character) {', start)
assert.ok(start >= 0 && end > start)

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture(overrides = {}) {
  const original = { id: 'original', name: '原来的角色', createdAt: '2026-01-01' }
  const updatedCard = { character: { name: '新版角色' }, requiresSensitiveExtensionConfirmation: false }
  const writes = [], imports = [], chats = [], errors = [], toasts = [], reads = []
  const methods = new Function('markRaw', 'inspectCharacterCard', 'commitCharacterImport', 'commitCharacterUpdate', `return ({ ${source.slice(start, end)} })`)(
    value => value,
    overrides.inspect || (async () => updatedCard),
    async (preview, options) => { imports.push({ preview, options }); return { character: { id: 'new' }, duplicateOfCharacterIds: [] } },
    overrides.commit || (async (preview, options) => { writes.push({ preview, options }); return { character: { ...original, name: '新版角色' } } })
  )
  const page = {
    services: { repository: { getCharacter: async () => structuredClone(original) }, chatService: { activeRequest: null } },
    dataLoadRevision: 1, characterItems: [original], customCharacterDraft: null,
    ui: { generating: false }, characterSaveBusy: false,
    $refs: { characterCardInput: { click() {} } },
    $nextTick(callback) { callback?.(); return Promise.resolve() },
    showToast(text) { toasts.push(text) }, handleError(error, message) { errors.push({ error, message }) },
    async loadCharacters() { reads.push('characters') },
    async loadWorldBooks() { reads.push('books') },
    async loadConversations() { reads.push('conversations') },
    async startCharacterChat(character) { chats.push(character) },
    async startStoryFromCharacter(character) { chats.push(character) },
    ...methods
  }
  page.resetCharacterImport()
  return { page, original, updatedCard, writes, imports, chats, errors, toasts, reads }
}

async function openUpdate(page) {
  page.requestCharacterCardUpdate({ characterId: 'original' })
  await page.handleCharacterCardSelection({ target: { files: [{}], value: 'card.png' } })
}

test('card update targets the captured identity and snapshot without starting or rewriting chats', async () => {
  const { page, original, writes, imports, chats, reads } = fixture()
  await openUpdate(page)
  // Navigating to a different role cannot redirect the already-selected update.
  page.ui.activeCharacterId = 'another'
  await page.commitCharacterPreview(true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].options.characterId, original.id)
  assert.deepEqual(writes[0].options.expectedCharacter, original)
  assert.equal(writes[0].options.repository, page.services.repository)
  assert.equal(imports.length, 0)
  assert.equal(chats.length, 0)
  assert.deepEqual(reads, ['characters', 'books', 'conversations'])
  assert.equal(page.characterImportSession, null)
  assert.equal(page.characterImportBusy, false)
})

test('cancelled update clears target so the next normal import creates a separate role', async () => {
  const { page, writes, imports } = fixture()
  await openUpdate(page)
  page.closeCharacterImportPreview()
  assert.equal(page.characterImportSession, null)
  page.openCharacterCardPicker('file')
  await page.handleCharacterCardSelection({ target: { files: [{}], value: 'card.png' } })
  await page.commitCharacterPreview(false)
  assert.equal(writes.length, 0)
  assert.equal(imports.length, 1)
  assert.equal(imports[0].options.characterId, undefined)
})

test('successful update waits for old list reads before fetching the new character and conversation display', async () => {
  const committed = deferred(), oldRead = deferred()
  const { page, reads } = fixture({ commit: async () => { committed.resolve(); return {} } })
  await openUpdate(page)
  page.characterLoadPromise = oldRead.promise
  const pending = page.commitCharacterPreview(false)
  await committed.promise
  await Promise.resolve()
  assert.deepEqual(reads, [])
  oldRead.resolve()
  await pending
  assert.deepEqual(reads, ['characters', 'books', 'conversations'])
})

test('native picker cancellation releases update mode and loading', async () => {
  const { page } = fixture()
  page.services.nativeCharacterCardPicker = { pick: async () => null }
  page.requestCharacterCardUpdate({ characterId: 'original' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(page.characterImportSession, null)
  assert.equal(page.characterImportBusy, false)
})

test('current generation blocks card updates even after leaving the generating conversation', async () => {
  const { page, writes, toasts } = fixture()
  page.services.chatService.activeRequest = { requestId: 'group-reply' }
  page.requestCharacterCardUpdate({ characterId: 'original' })
  assert.equal(page.characterImportSession, null)
  page.services.chatService.activeRequest = null
  await openUpdate(page)
  page.services.chatService.activeRequest = { requestId: 'story-reply' }
  await page.commitCharacterPreview(false)
  assert.equal(writes.length, 0)
  assert.equal(page.characterImportBusy, false)
  assert.equal(toasts.length, 2)
})

test('a parse finishing after a workspace switch cannot populate the new workspace preview', async () => {
  const parsing = deferred(), entered = deferred()
  const { page, updatedCard } = fixture({ inspect: async () => { entered.resolve(); return parsing.promise } })
  page.requestCharacterCardUpdate({ characterId: 'original' })
  const pending = page.handleCharacterCardSelection({ target: { files: [{}], value: 'card.png' } })
  await entered.promise
  page.services = { repository: { getCharacter: async () => null } }
  page.dataLoadRevision += 1
  page.resetCharacterImport()
  parsing.resolve(updatedCard)
  await pending
  assert.equal(page.characterImportSession, null)
  assert.equal(page.characterImportPreview, null)
  assert.equal(page.characterImportBusy, false)
})

test('workspace switch while waiting to commit prevents writing to either workspace', async () => {
  const { page, writes } = fixture()
  await openUpdate(page)
  const tick = deferred()
  page.$nextTick = () => tick.promise
  const pending = page.commitCharacterPreview(false)
  page.services = { repository: {} }
  page.dataLoadRevision += 1
  page.resetCharacterImport()
  tick.resolve()
  await pending
  assert.equal(writes.length, 0)
  assert.equal(page.characterImportBusy, false)
})

test('a completed old-workspace update cannot clear another workspace new import or display success there', async () => {
  const write = deferred(), entered = deferred()
  const { page, toasts } = fixture({ commit: async () => { entered.resolve(); return write.promise } })
  await openUpdate(page)
  const pending = page.commitCharacterPreview(false)
  await entered.promise
  page.services = { repository: { getCharacter: async () => null } }
  page.dataLoadRevision += 1
  page.resetCharacterImport()
  page.openCharacterCardPicker('file')
  const newSession = page.characterImportSession
  write.resolve({ character: { id: 'original' } })
  await pending
  assert.equal(page.characterImportSession, newSession)
  assert.equal(toasts.length, 0)
})

test('sensitive confirmation and failed commits leave the preview available without creating chats', async () => {
  const { page, writes, toasts } = fixture()
  await openUpdate(page)
  page.characterImportPreview.requiresSensitiveExtensionConfirmation = true
  page.characterImportConfirmed = false
  await page.commitCharacterPreview(false)
  assert.equal(writes.length, 0)
  assert.match(toasts[0], /高级扩展/)
  const failed = fixture({ commit: async () => { throw new Error('原卡已被修改') } })
  await openUpdate(failed.page)
  const preview = failed.page.characterImportPreview
  await failed.page.commitCharacterPreview(false)
  assert.equal(failed.page.characterImportPreview, preview)
  assert.equal(failed.page.characterImportBusy, false)
  assert.equal(failed.errors[0].message, '角色卡更新失败')
  assert.equal(failed.chats.length, 0)
})
