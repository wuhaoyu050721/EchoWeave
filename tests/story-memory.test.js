import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractStoryMemory,
  normalizeStoryMemory,
  storyMemoryHasChanges
} from '../src/core/story-memory.js'

test('extracts a complete story memory block and hides it from visible content', () => {
  const source = `Story body.
<echo_story_memory>
{
  "sceneSummary": "The gate opened.",
  "characterPatches": [
    {
      "characterId": "char-1",
      "field": "relationship_memory",
      "content": "Lyra now trusts the silver key.",
      "confidence": 1.4
    }
  ],
  "worldBookEntries": [
    {
      "name": "Silver Gate",
      "keys": ["gate", "silver key"],
      "content": "The silver gate opens only after midnight.",
      "constant": true,
      "confidence": -1
    }
  ]
}
</echo_story_memory>`

  const result = extractStoryMemory(source)

  assert.equal(result.content, 'Story body.')
  assert.equal(result.pending, false)
  assert.equal(result.memory.sceneSummary, 'The gate opened.')
  assert.equal(result.memory.characterPatches[0].characterId, 'char-1')
  assert.equal(result.memory.characterPatches[0].content, 'Lyra now trusts the silver key.')
  assert.equal(result.memory.characterPatches[0].confidence, 1)
  assert.equal(result.memory.worldBookEntries[0].name, 'Silver Gate')
  assert.deepEqual(result.memory.worldBookEntries[0].keys, ['gate', 'silver key'])
  assert.equal(result.memory.worldBookEntries[0].confidence, 0)
  assert.equal(storyMemoryHasChanges(result.memory), true)
})

test('can hide an incomplete story memory block while it is still streaming', () => {
  const source = 'Visible paragraph.\n<echo_story_memory>{"sceneSummary": "half'

  const kept = extractStoryMemory(source)
  const hidden = extractStoryMemory(source, { hideIncomplete: true })

  assert.equal(kept.content, source)
  assert.equal(kept.pending, true)
  assert.equal(kept.memory, null)
  assert.equal(hidden.content, 'Visible paragraph.')
  assert.equal(hidden.pending, true)
  assert.match(hidden.raw, /<echo_story_memory>/)
})

test('normalizes sparse story memory payloads into bounded arrays', () => {
  const memory = normalizeStoryMemory({
    summary: 'Summary alias',
    characterPatches: [
      { characterName: 'Lyra', value: 'Remembered by name.' },
      { characterId: 'char-empty', content: '' }
    ],
    worldBookEntries: [
      { title: 'Tower', key: 'tower', description: 'The tower moves.' },
      { name: 'Blank', content: '' }
    ]
  })

  assert.equal(memory.sceneSummary, 'Summary alias')
  assert.deepEqual(memory.characterPatches.map(item => item.content), ['Remembered by name.'])
  assert.deepEqual(memory.worldBookEntries.map(item => item.content), ['The tower moves.'])
  assert.deepEqual(memory.worldBookEntries[0].keys, ['tower'])
})
