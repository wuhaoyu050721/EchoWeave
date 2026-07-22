import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('shared dialogs render polished action, prompt, and confirmation states', async () => {
  const source = await readFile(new URL('../src/components/app-dialog-layer.vue', import.meta.url), 'utf8')

  assert.match(source, /role="dialog" aria-modal="true" aria-label="会话操作"/)
  assert.match(source, /data-testid="conversation-rename-action"/)
  assert.match(source, /data-testid="conversation-delete-action"/)
  assert.match(source, /:role="isPrompt \? 'dialog' : 'alertdialog'"/)
  assert.match(source, /data-testid="app-dialog-input"/)
  assert.match(source, /:disabled="confirmDisabled"/)
  assert.match(source, /@click\.self="\$emit\('cancel-dialog'\)"/)
  assert.match(source, /max\(14px, calc\(env\(safe-area-inset-bottom\) \+ 10px\)\)/)
  assert.match(source, /\.app-action-sheet\s*\{[^}]*border-radius:\s*8px 8px 0 0/s)
  assert.match(source, /\.app-confirm-dialog\s*\{[^}]*width:\s*min\(340px, 100%\)[^}]*border-radius:\s*8px/s)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
})

test('dialog promises settle through custom controls and Android back closes the top layer', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const backBlock = source.slice(source.indexOf('handleAppBack()'), source.indexOf('toggleConversationSearch()'))
  const dialogBlock = source.slice(source.indexOf('chooseConversationAction(conversation)'), source.indexOf('async manageConversation(conversation)'))

  assert.match(source, /:action-sheet="conversationActionSheet"/)
  assert.match(source, /:dialog="appDialog"/)
  assert.match(source, /@select-action="resolveConversationAction"/)
  assert.match(source, /@confirm-dialog="confirmAppDialog"/)
  assert.match(dialogBlock, /resolveConversationAction\(action\)/)
  assert.match(dialogBlock, /settleAppDialog\(value\)/)
  assert.match(dialogBlock, /this\.settleAppDialog\(title\)/)
  assert.match(backBlock, /if \(this\.appDialog\)[\s\S]+this\.cancelAppDialog\(\)/)
  assert.match(backBlock, /if \(this\.conversationActionSheet\)[\s\S]+this\.resolveConversationAction\(null\)/)
})
