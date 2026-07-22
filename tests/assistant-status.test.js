import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantStatusProgressColor, assistantStatusSectionsForDisplay, createAssistantStatusOverview, extractAssistantStatus } from '../src/core/assistant-status.js'

const sample = `“哥哥，我好想你。”她张开双臂，向你走来。

-----
<sumo_monitor>
<status>
[当前状态|重逢伪装]
[当前位置|避难所门内]
[好感度|60]
[小摩锐评|开局索要抱抱]
</status>
<body_data>
[服装|白色短袖，深蓝色短裙]
[姿势|双臂张开，准备拥抱]
</body_data>
<private_parts>
[后庭|紧致闭合]
[子宫|平静]
</private_parts>
</sumo_monitor>`

test('extracts a trailing character monitor into structured status sections', () => {
  const result = extractAssistantStatus(sample)

  assert.equal(result.content, '“哥哥，我好想你。”她张开双臂，向你走来。')
  assert.equal(result.status.rootTag, 'sumo_monitor')
  assert.equal(result.status.summary, '重逢伪装 · 避难所门内 · 好感度 60')
  assert.deepEqual(result.status.sections.map(section => section.label), ['当前状态', '外观与动作', '私密状态'])
  assert.deepEqual(result.status.sections[0].items[0], { label: '当前状态', value: '重逢伪装' })
  assert.match(result.status.raw, /<private_parts>/)
})

test('creates a compact overview for the status bar and sheet header', () => {
  const { status } = extractAssistantStatus(sample)

  assert.deepEqual(createAssistantStatusOverview(status), {
    primary: '重逢伪装',
    location: '避难所门内',
    scoreLabel: '好感度',
    scoreValue: '60',
    scorePercent: 60
  })
  assert.equal(createAssistantStatusOverview(null), null)
  assert.equal(createAssistantStatusOverview({ summary: '状态已更新', sections: [] }).primary, '状态已更新')
})

test('hides private status sections by default without changing parsed status data', () => {
  const { status } = extractAssistantStatus(sample)

  assert.deepEqual(
    assistantStatusSectionsForDisplay(status).map(section => section.label),
    ['当前状态', '外观与动作']
  )
  assert.deepEqual(
    assistantStatusSectionsForDisplay(status, { showPrivate: true }).map(section => section.label),
    ['当前状态', '外观与动作', '私密状态']
  )
  assert.equal(status.sections.length, 3)
  assert.match(status.raw, /<private_parts>/)
})

test('normalizes ratio scores into a progress percentage', () => {
  const overview = createAssistantStatusOverview({
    summary: '关系变化',
    sections: [{ items: [{ label: '亲密度', value: '8/10' }] }]
  })

  assert.equal(overview.scoreValue, '8/10')
  assert.equal(overview.scorePercent, 80)
})

test('changes the progress color as the status score grows', () => {
  assert.equal(assistantStatusProgressColor(0), '#85929a')
  assert.equal(assistantStatusProgressColor(20), '#85929a')
  assert.equal(assistantStatusProgressColor(21), '#3f8fbd')
  assert.equal(assistantStatusProgressColor(40), '#3f8fbd')
  assert.equal(assistantStatusProgressColor(41), '#2fa49f')
  assert.equal(assistantStatusProgressColor(60), '#2fa49f')
  assert.equal(assistantStatusProgressColor(61), '#e0a12f')
  assert.equal(assistantStatusProgressColor(80), '#e0a12f')
  assert.equal(assistantStatusProgressColor(81), '#e64e75')
  assert.equal(assistantStatusProgressColor(100), '#e64e75')
  assert.equal(assistantStatusProgressColor('8/10'), '#e0a12f')
  assert.equal(assistantStatusProgressColor('unknown'), '#2fa49f')
})

test('supports sibling state sections and case-insensitive status tags', () => {
  const result = extractAssistantStatus(`正文\n<Status_Block mode="full">[心情:开心]</Status_Block>\n<inventory>[金币|3]</inventory>`)

  assert.equal(result.content, '正文')
  assert.equal(result.status.sections.length, 2)
  assert.deepEqual(result.status.sections[0].items, [{ label: '心情', value: '开心' }])
  assert.equal(result.status.sections[1].label, '随身物品')
})

test('recognizes an arbitrary wrapper containing only structured status sections', () => {
  const result = extractAssistantStatus(`正文\n<card_output><status>[状态|警觉]</status><body_data>[姿势|站立]</body_data></card_output>`)

  assert.equal(result.content, '正文')
  assert.equal(result.status.rootTag, 'card_output')
  assert.deepEqual(result.status.sections.map(section => section.label), ['当前状态', '外观与动作'])
})

test('does not consume ordinary XML containers or fenced examples', () => {
  const ordinary = '<response><status>200</status></response>'
  const fenced = '示例：\n```xml\n<status>[状态|演示]</status>\n```'

  assert.deepEqual(extractAssistantStatus(ordinary), { content: ordinary, status: null, pending: false })
  assert.deepEqual(extractAssistantStatus(fenced), { content: fenced, status: null, pending: false })
})

test('accepts the canonical monitor when a model fences it, keeps it inline, or adds trailing text', () => {
  const monitor = '<sumo_monitor><status>[当前状态|开心]</status><body_data>[姿势|挥手]</body_data></sumo_monitor>'
  const fenced = extractAssistantStatus(`正文\n\`\`\`xml\n${monitor}\n\`\`\``)
  const inline = extractAssistantStatus(`正文${monitor}`)
  const trailing = extractAssistantStatus(`正文\n${monitor}\n补充一句。`)

  assert.equal(fenced.content, '正文')
  assert.equal(fenced.status.rootTag, 'sumo_monitor')
  assert.equal(inline.content, '正文')
  assert.equal(inline.status.summary, '开心')
  assert.equal(trailing.content, '正文\n\n补充一句。')
  assert.deepEqual(trailing.status.sections[1].items, [{ label: '姿势', value: '挥手' }])
})

test('hides an unfinished canonical monitor even when it starts inline or in a code fence', () => {
  const inline = '正文<sumo_monitor><status>[当前状态|开心]'
  const fenced = '正文\n```xml\n<sumo_monitor>\n<status>[当前状态|开心]'

  assert.deepEqual(extractAssistantStatus(inline, { hideIncomplete: true }), {
    content: '正文', status: null, pending: true
  })
  assert.deepEqual(extractAssistantStatus(fenced, { hideIncomplete: true }), {
    content: '正文', status: null, pending: true
  })
})

test('hides an unfinished status block only while a reply is streaming', () => {
  const partial = '正在靠近你。\n\n---\n<sumo_monitor>\n<status>\n[当前位置|门口]'

  assert.deepEqual(extractAssistantStatus(partial), { content: partial, status: null, pending: false })
  assert.deepEqual(extractAssistantStatus(partial, { hideIncomplete: true }), {
    content: '正在靠近你。',
    status: null,
    pending: true
  })
})
