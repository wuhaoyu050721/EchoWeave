import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildVirtualMessageLayout } from '../src/app/chat-presentation.js'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

function createScheduler() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  const ticks = []
  return {
    get now() { return now },
    setTimeout(callback, delay = 0) {
      const id = nextId++
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    nextTick(callback) { if (callback) ticks.push(callback) },
    flushOneTick() { ticks.shift()?.() },
    flushTicks() {
      let remaining = 100
      while (ticks.length && remaining-- > 0) ticks.shift()()
      assert.ok(remaining > 0, 'nextTick queue must settle')
    },
    advance(milliseconds) {
      const until = now + milliseconds
      let remaining = 100
      while (remaining-- > 0) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
        if (!next) break
        const [id, timer] = next
        timers.delete(id)
        now = timer.at
        timer.callback()
      }
      assert.ok(remaining > 0, 'timer queue must settle')
      now = until
    }
  }
}

function readScrollMethods(scheduler) {
  const start = source.indexOf('resetChatVirtualWindow() {')
  const end = source.indexOf('showToast(message) {', start)
  assert.ok(start >= 0 && end > start, 'read the actual chat scrolling method block')
  const dependencies = {
    buildVirtualMessageLayout,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    Date: class extends Date { static now() { return scheduler.now } }
  }
  for (const match of source.matchAll(/const (CHAT_[A-Z_]+) = (\d+)/g)) {
    dependencies[match[1]] = Number(match[2])
  }
  return new Function(...Object.keys(dependencies), `return ({ ${source.slice(start, end)} })`)(...Object.values(dependencies))
}

function createPage({ native = false, scrollTop = 600, scrollHeight = 1000, viewportHeight = 400 } = {}) {
  const scheduler = createScheduler()
  const scrolls = []
  const target = native ? {} : {
    scrollTop,
    scrollHeight,
    clientHeight: viewportHeight,
    scrollTo({ top }) {
      scrolls.push(top)
      this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight)
    }
  }
  const page = {
    $refs: { chatScroll: { $el: target } },
    $nextTick: scheduler.nextTick,
    ui: { screen: 'chat' },
    messageItems: [],
    messageHistoryHasMore: false,
    chatScrollIntoView: '',
    chatScrollRevision: 0,
    chatScrollTimer: null,
    chatVirtualScrollTimer: null,
    chatVirtualMeasureTimer: null,
    chatVirtualScrollTop: scrollTop,
    chatVirtualViewportHeight: viewportHeight,
    chatVirtualPinnedToBottom: true,
    chatScrollPaused: false,
    chatScrollLastTop: null,
    chatScrollTouchY: null,
    chatScrollTouchDirection: 0,
    chatVirtualMeasurements: new Map(),
    chatVirtualMeasurementRevision: 0,
    chatVirtualSuppressMeasurementScroll: false,
    chatHistoryAutoLoadTimer: null,
    chatHistoryAutoLoadArmed: false,
    _chatVirtualPendingScroll: null,
    ...readScrollMethods(scheduler)
  }
  function scrollTo(top, height = scrollHeight) {
    if (!native) {
      target.scrollTop = top
      target.scrollHeight = height
    }
    page.onChatScroll({ detail: { scrollTop: top, scrollHeight: height } })
  }
  return { page, target, scheduler, scrolls, scrollTo }
}

const touch = y => ({ touches: [{ clientY: y }] })

test('wheel intent pauses immediately at the actual viewport position before a native scroll callback', () => {
  const { page, target, scheduler, scrollTo, scrolls } = createPage()
  scrollTo(600)
  page.chatVirtualScrollTop = 0
  target.scrollTop = 584
  page.scrollChatToBottom()

  page.onChatWheel({ deltaY: -16 })

  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualScrollTop, 584, 'unpinning must not reuse an older callback position')
  assert.equal(page._chatVirtualPendingScroll, null)
  scheduler.advance(100)
  scheduler.flushTicks()
  assert.deepEqual(scrolls, [])
  assert.equal(page.chatVirtualPinnedToBottom, false, 'the old pending true sample must not restore following')
  assert.equal(page.chatVirtualScrollTop, 584)
})

for (const offset of [8, 16, 24]) {
  test(`native scroll details pause after an upward ${offset}px movement and only resume at the actual bottom`, () => {
    const { page, scheduler, scrollTo } = createPage({ native: true })
    scrollTo(600)
    scheduler.advance(100)
    scheduler.flushTicks()

    scrollTo(600 - offset)
    assert.equal(page.chatScrollPaused, true)
    assert.equal(page.chatVirtualPinnedToBottom, false)
    assert.equal(page.chatVirtualScrollTop, 600 - offset)

    scrollTo(596)
    scheduler.advance(100)
    scheduler.flushTicks()
    assert.equal(page.chatVirtualPinnedToBottom, false, 'four pixels from the bottom is still history reading')
    assert.equal(page.chatScrollPaused, true)

    scrollTo(600)
    assert.equal(page.chatScrollPaused, false)
    assert.equal(page.chatVirtualPinnedToBottom, true)
  })
}

for (const immediate of [false, true]) {
  test(`${immediate ? '80ms immediate retry' : '64ms stream timer'} cannot scroll after upward touch intent`, () => {
    const { page, scheduler, scrolls } = createPage()
    page.scrollChatToBottom(immediate)
    page.onChatTouchStart(touch(200))
    page.onChatTouchMove(touch(208))
    page.onChatTouchEnd()
    scheduler.advance(160)
    scheduler.flushTicks()

    assert.equal(page.chatScrollPaused, true)
    assert.equal(page.chatVirtualPinnedToBottom, false)
    assert.equal(page.chatScrollIntoView, '')
    assert.deepEqual(scrolls, [])
  })
}

for (const completedTicks of [0, 1]) {
  test(`wheel pause invalidates a bottom request after ${completedTicks} completed nextTick callbacks`, () => {
    const { page, scheduler, scrolls } = createPage()
    page.requestChatScrollToBottom()
    for (let index = 0; index < completedTicks; index += 1) scheduler.flushOneTick()

    page.onChatWheel({ deltaY: -4 })
    scheduler.flushTicks()

    assert.equal(page.chatScrollIntoView, '')
    assert.equal(page.chatVirtualPinnedToBottom, false)
    assert.deepEqual(scrolls, [])
  })
}

test('touch contact temporarily holds following and a tap resumes it without entering history mode', () => {
  const { page, scheduler, scrolls } = createPage()
  page.onChatTouchStart(touch(200))
  page.scrollChatToBottom()
  page.requestChatScrollToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()
  assert.deepEqual(scrolls, [])
  assert.equal(page.chatScrollPaused, false)

  page.onChatTouchEnd()
  scheduler.advance(100)
  scheduler.flushTicks()
  assert.deepEqual(scrolls, [1000])
  assert.equal(page.chatVirtualPinnedToBottom, true)
})

test('a late bottom callback during an upward touch gesture cannot resume automatic following', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true })
  scrollTo(600)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(212))
  scrollTo(584)
  scrollTo(600)
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  page.onChatTouchEnd()
  page.scrollChatToBottom()
  scheduler.advance(100)
  scheduler.flushTicks()
  assert.equal(page.chatScrollIntoView, '')
})

test('content growth at the same scroll position keeps ordinary streaming follow enabled', () => {
  const { page, scheduler, scrollTo, scrolls } = createPage()
  scrollTo(600)
  scheduler.advance(100)
  scheduler.flushTicks()

  scrollTo(600, 1120)
  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  page.scrollChatToBottom()
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.deepEqual(scrolls, [1120])
})

test('explicit return to latest clears a pause and restores bottom following', () => {
  const { page, scheduler, target, scrolls } = createPage({ scrollTop: 584 })
  page.onChatWheel({ deltaY: -16 })

  page.scrollChatToBottom(true, true)
  scheduler.flushTicks()
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  assert.equal(target.scrollTop, 600)
  assert.deepEqual(scrolls, [1000, 1000])
})

test('pending row measurements and repeated stream updates respect a history pause', () => {
  const { page, scheduler, target, scrolls } = createPage({ scrollTop: 584 })
  let rowHeight = 100
  page.messageItems = [{ id: 'streaming-message' }]
  target.querySelectorAll = () => [{
    dataset: { chatMessageId: 'streaming-message' },
    getBoundingClientRect: () => ({ height: rowHeight })
  }]
  page.scheduleChatVirtualMeasurement()
  page.onChatWheel({ deltaY: -16 })

  for (let index = 0; index < 30; index += 1) {
    rowHeight += 10
    target.scrollHeight += 10
    page.scrollChatToBottom()
    page.scheduleChatVirtualMeasurement()
    scheduler.advance(200)
    scheduler.flushTicks()
  }

  assert.equal(page.chatVirtualMeasurements.get('streaming-message'), rowHeight)
  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(target.scrollTop, 584)
  assert.deepEqual(scrolls, [])
})

test('history navigation keys pause following while editing keys in an input do not', () => {
  const { page, scheduler, scrolls } = createPage()
  page.onChatScrollKeydown({ key: 'ArrowUp', target: { closest: () => ({ tagName: 'TEXTAREA' }) } })
  assert.equal(page.chatScrollPaused, false)
  page.onChatScrollKeydown({ key: 'ArrowDown', target: { closest: () => null } })
  assert.equal(page.chatScrollPaused, false)

  page.scrollChatToBottom()
  page.onChatScrollKeydown({ key: 'PageUp', target: { closest: () => null } })
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.deepEqual(scrolls, [])
})

test('focusing loaded history enters a pause and cancels queued bottom scrolling and geometry samples', () => {
  const { page, scheduler, scrolls, scrollTo } = createPage()
  page.messageItems = [{ id: 'earlier' }, { id: 'history-anchor' }, { id: 'latest' }]
  page.chatVirtualMeasurements.set('earlier', 780)
  page.chatVirtualMeasurements.set('history-anchor', 100)
  page.chatVirtualMeasurements.set('latest', 520)
  scrollTo(600)
  page.scrollChatToBottom(true)
  scheduler.flushOneTick()

  page.focusChatVirtualMessage('history-anchor')

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatVirtualScrollTop, 780)
  assert.equal(page.chatScrollTimer, null)
  assert.equal(page.chatVirtualScrollTimer, null)
  assert.equal(page._chatVirtualPendingScroll, null)
  scheduler.advance(160)
  scheduler.flushTicks()
  assert.equal(page.chatVirtualScrollTop, 780, 'old geometry must not replace the selected history position')
  assert.equal(page.chatScrollIntoView, '')
  assert.deepEqual(scrolls, [])
})

test('native history focus can resume following at the bottom even when prepended rows increase scrollTop', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true })
  scrollTo(600)
  scheduler.advance(100)
  scheduler.flushTicks()
  page.messageItems = [{ id: 'earlier' }, { id: 'history-anchor' }, { id: 'latest' }]
  page.chatVirtualMeasurements.set('earlier', 780)
  page.chatVirtualMeasurements.set('history-anchor', 100)
  page.chatVirtualMeasurements.set('latest', 520)

  page.focusChatVirtualMessage('history-anchor')
  // Prepending history can increase the anchor's absolute top without any upward scroll callback.
  scrollTo(780, 1400)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  scrollTo(1000, 1400)

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
})
