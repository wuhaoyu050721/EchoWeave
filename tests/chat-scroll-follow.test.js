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

function readScrollMethods(scheduler, uniApi = null) {
  const start = source.indexOf('resetChatVirtualWindow() {')
  const end = source.indexOf('showToast(message) {', start)
  assert.ok(start >= 0 && end > start, 'read the actual chat scrolling method block')
  const dependencies = {
    buildVirtualMessageLayout,
    getUniApi: () => uniApi,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    Date: class extends Date { static now() { return scheduler.now } }
  }
  for (const match of source.matchAll(/const (CHAT_[A-Z_]+) = (\d+)/g)) {
    dependencies[match[1]] = Number(match[2])
  }
  return new Function(...Object.keys(dependencies), `return ({ ${source.slice(start, end)} })`)(...Object.values(dependencies))
}

function createPage({ native = false, scrollTop = 600, scrollHeight = 1000, viewportHeight = 400, viewportMeasured = true, uniApi = null } = {}) {
  const scheduler = createScheduler()
  const scrolls = []
  // Most baseline cases have a verified viewport. Unknown/late native measurements
  // opt out explicitly instead of silently treating the rendering estimate as real geometry.
  const nativeApi = uniApi ?? (native && viewportMeasured ? createNativeMeasurement({ height: viewportHeight }).uniApi : null)
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
    ui: { screen: 'chat', activeConversationId: 'conversation-a' },
    chatLoadRevision: 1,
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
    chatScrollResumeAllowed: false,
    chatScrollResumeUntil: 0,
    chatScrollResumeSample: null,
    chatScrollEventWatermark: 0,
    chatScrollLastTop: null,
    chatScrollTouchY: null,
    chatScrollTouchStartY: null,
    chatScrollTouchDirection: 0,
    chatScrollTouchReadHistory: false,
    chatScrollViewportMeasured: viewportMeasured,
    chatScrollViewportRevision: 0,
    chatVirtualMeasurements: new Map(),
    chatVirtualMeasurementRevision: 0,
    chatVirtualSuppressMeasurementScroll: false,
    chatHistoryAutoLoadTimer: null,
    chatHistoryAutoLoadArmed: false,
    _chatVirtualPendingScroll: null,
    ...readScrollMethods(scheduler, nativeApi)
  }
  function scrollTo(top, height = scrollHeight, eventFields = {}) {
    if (!native) {
      target.scrollTop = top
      target.scrollHeight = height
    }
    page.onChatScroll({ ...eventFields, detail: { scrollTop: top, scrollHeight: height } })
  }
  return { page, target, scheduler, scrolls, scrollTo }
}

const touch = (y, timeStamp) => ({ touches: [{ clientY: y }], ...(timeStamp === undefined ? {} : { timeStamp }) })
const touchEnd = (y, timeStamp) => ({ type: 'touchend', changedTouches: [{ clientY: y }], ...(timeStamp === undefined ? {} : { timeStamp }) })

function createNativeMeasurement({ height = null } = {}) {
  const callbacks = []
  const uniApi = {
    createSelectorQuery() {
      return {
        in() { return this },
        select(selector) { assert.equal(selector, '.chat-scroll .uni-scroll-view .uni-scroll-view'); return this },
        boundingClientRect(callback) { callbacks.push(callback); this.callback = callback; return this },
        exec() { if (height > 0) this.callback({ height }) }
      }
    }
  }
  return { callbacks, uniApi }
}

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

    page.onChatTouchStart(touch(200))
    page.onChatTouchMove(touch(180))
    scrollTo(600)
    page.onChatTouchEnd(touchEnd(180))
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
  assert.equal(page.chatVirtualScrollTop, 584, 'a stale bottom callback must not move the native virtual reading window')
  page.onChatTouchEnd()
  page.scrollChatToBottom()
  scheduler.advance(100)
  scheduler.flushTicks()
  assert.equal(page.chatScrollIntoView, '')
})

for (const ending of ['touchend', 'touchcancel']) {
  test(`an old bottom callback after ${ending} cannot release an upward gesture's history pause`, () => {
    const { page, scheduler, scrollTo } = createPage({ native: true })
    scrollTo(600)
    scheduler.advance(100)
    scheduler.flushTicks()
    page.scrollChatToBottom(true)
    page.onChatTouchStart(touch(200))
    page.onChatTouchMove(touch(216))
    scrollTo(584)
    if (ending === 'touchcancel') page.onChatTouchCancel()
    else page.onChatTouchEnd(touchEnd(216))

    // Android can deliver an older programmatic scroll callback after the finger is lifted.
    scrollTo(600)
    page.scrollChatToBottom()
    scheduler.advance(160)
    scheduler.flushTicks()

    assert.equal(page.chatScrollPaused, true)
    assert.equal(page.chatVirtualPinnedToBottom, false)
    assert.equal(page.chatVirtualScrollTop, 584, 'a stale bottom callback must not move the native virtual reading window')
    assert.equal(page.chatScrollIntoView, '')
  })
}

test('a small finger reversal while reading upward does not authorize a delayed bottom callback', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true })
  scrollTo(600)
  scheduler.advance(100)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(220))
  scrollTo(580)

  page.onChatTouchMove(touch(217))
  scrollTo(600)
  page.onChatTouchEnd()
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatScrollIntoView, '')
})

test('a new touch discards geometry queued before the gesture began', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 300, scrollHeight: 1400 })
  page.pauseChatAutoFollow(300)
  scrollTo(300, 1400)
  scheduler.advance(100)
  scheduler.flushTicks()
  scrollTo(600, 1400)
  assert.ok(page._chatVirtualPendingScroll)

  page.onChatTouchStart(touch(200))
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatVirtualScrollTop, 300, 'the pre-gesture geometry cannot move the virtual reading window')
  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
})

test('an estimated native viewport cannot treat a slight history scroll as reaching the actual bottom', () => {
  // Native scroll-view has no DOM clientHeight. Its rendering estimate is 720px,
  // but the real visible area is 500px, so scrollTop 490 is still 10px from bottom.
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 500, viewportHeight: 720, viewportMeasured: false })
  scrollTo(500)
  scheduler.advance(100)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(216))
  scrollTo(484)
  page.onChatTouchEnd()

  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(170))
  scrollTo(490)
  page.onChatTouchEnd()
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatScrollIntoView, '')
})

test('touchend coordinates pause history reading when native scrolling swallowed touchmove', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true })
  scrollTo(600)
  scheduler.advance(100)
  page.onChatTouchStart(touch(200))
  page.onChatTouchEnd(touchEnd(216))

  assert.equal(page.chatScrollPaused, true, 'the final finger position itself proves upward reading intent')
  scrollTo(584)
  scrollTo(600)
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()
  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatScrollIntoView, '')
})

test('an unmeasured native bottom callback before touchend cannot move history when the final finger position proves upward reading', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 560, viewportHeight: 720, viewportMeasured: false })
  page.pauseChatAutoFollow(560)
  scrollTo(560)
  scheduler.advance(100)
  scheduler.flushTicks()

  page.onChatTouchStart(touch(200))
  // Native touchmove is swallowed and an old downward sample arrives while intent is unknown.
  scrollTo(600)
  scheduler.advance(100)
  scheduler.flushTicks()
  page.onChatTouchEnd(touchEnd(220))
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatVirtualScrollTop, 560)
  assert.equal(page.chatScrollLastTop, 560)
  assert.equal(page.chatScrollIntoView, '')
})

test('a deliberate new downward gesture restores following at the measured bottom after touchend', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true })
  scrollTo(600)
  scheduler.advance(100)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(240))
  scrollTo(560)
  page.onChatTouchEnd(touchEnd(240))
  assert.equal(page.chatScrollPaused, true)

  // This is a new gesture. The native component may only provide changedTouches at its end.
  page.onChatTouchStart(touch(200))
  page.onChatTouchEnd(touchEnd(160))
  scrollTo(600)
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  assert.match(page.chatScrollIntoView, /^chat-bottom-/)
})

test('touchend coordinates can confirm a downward gesture whose final native bottom callback arrived first', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 560 })
  scrollTo(560)
  scheduler.advance(100)
  assert.equal(page.chatScrollPaused, true)
  page.onChatTouchStart(touch(200))
  // Native scrolling may consume touchmove and report its final position before touchend.
  scrollTo(600)
  assert.equal(page.chatScrollPaused, true, 'the position alone does not prove a deliberate downward gesture')
  page.onChatTouchEnd(touchEnd(160))
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  assert.match(page.chatScrollIntoView, /^chat-bottom-/)
})

test('a new downward gesture cannot reuse a bottom sample recorded before history navigation', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true })
  scrollTo(600)
  scheduler.advance(100)
  scheduler.flushTicks()
  // History navigation changes the intended reading position before its scroll callback arrives.
  page.pauseChatAutoFollow(560)
  page.onChatTouchStart(touch(200))
  page.onChatTouchEnd(touchEnd(180))
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatScrollIntoView, '')
})

test('an older bottom event cannot replace a newer deferred near-bottom sample before touchend confirms direction', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 560, viewportHeight: 400 })
  scrollTo(560, 1000, { timeStamp: 100 })
  scheduler.advance(100)
  scheduler.flushTicks()
  assert.equal(page.chatScrollPaused, true)

  page.onChatTouchStart(touch(200, 200))
  // While touchmove is swallowed, keep the latest sample pending until intent is known.
  scrollTo(590, 1000, { timeStamp: 300 })
  scrollTo(600, 1000, { timeStamp: 250 })
  page.onChatTouchEnd(touchEnd(180, 320))
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true, 'the newest position is still ten pixels above the bottom')
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatVirtualScrollTop, 590)
  assert.equal(page.chatScrollLastTop, 590)
  assert.equal(page.chatScrollIntoView, '')
})

test('downward gesture permission expires before an unrelated bottom callback arrives ten seconds later', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 560 })
  scrollTo(560)
  scheduler.advance(100)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(160))
  page.onChatTouchEnd(touchEnd(160))
  scheduler.advance(10000)

  scrollTo(600)
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatVirtualScrollTop, 560)
  assert.equal(page.chatScrollIntoView, '')
})

for (const [description, staleTimeStamp] of [['before the latest touchstart', 190], ['before the last accepted scroll', 215]]) {
  test(`a native scroll sample timestamped ${description} cannot change the reading position`, () => {
    const { page, scheduler, scrollTo } = createPage({ native: true })
    scrollTo(600, 1000, { timeStamp: 100 })
    scheduler.advance(100)
    scrollTo(580, 1000, { timeStamp: 150 })
    scheduler.advance(100)
    page.onChatTouchStart(touch(200, 200))
    page.onChatTouchMove(touch(220, 210))
    if (staleTimeStamp === 215) scrollTo(580, 1000, { timeStamp: 220 })
    page.onChatTouchEnd(touchEnd(220, 230))

    // This is not the bottom, so rejection must rely on event ordering, not just atBottom.
    scrollTo(596, 1000, { timeStamp: staleTimeStamp })
    page.scrollChatToBottom()
    scheduler.advance(160)
    scheduler.flushTicks()

    assert.equal(page.chatScrollPaused, true)
    assert.equal(page.chatVirtualPinnedToBottom, false)
    assert.equal(page.chatScrollLastTop, 580)
    assert.equal(page.chatVirtualScrollTop, 580)
    assert.equal(page.chatScrollIntoView, '')
  })
}

for (const [inputClock, scrollClock, description] of [
  [1791000000000, 200, 'epoch touch events and monotonic native scroll events'],
  [200, 1791000000000, 'monotonic touch events and epoch native scroll events']
]) {
  test(`incompatible timestamp clocks do not freeze valid scrolling with ${description}`, () => {
    const { page, scheduler, scrollTo } = createPage({ native: true })
    scrollTo(600, 1000, { timeStamp: scrollClock })
    scheduler.advance(100)
    page.onChatTouchStart(touch(200, inputClock + 10))
    page.onChatTouchMove(touch(220, inputClock + 20))
    scrollTo(580, 1000, { timeStamp: scrollClock + 30 })
    page.onChatTouchEnd(touchEnd(220, inputClock + 40))
    scheduler.advance(100)
    scheduler.flushTicks()

    assert.equal(page.chatScrollPaused, true)
    assert.equal(page.chatScrollLastTop, 580)
    assert.equal(page.chatVirtualScrollTop, 580)

    page.onChatTouchStart(touch(200, inputClock + 100))
    page.onChatTouchMove(touch(160, inputClock + 120))
    scrollTo(600, 1000, { timeStamp: scrollClock + 130 })
    page.onChatTouchEnd(touchEnd(160, inputClock + 140))
    assert.equal(page.chatScrollPaused, false)
    assert.equal(page.chatVirtualPinnedToBottom, true)
  })
}

test('the App WebView scroll target is the scrolling parent of its inner content, not the outer wrapper', () => {
  const { page, scheduler, target: scrollingElement, scrolls } = createPage({ scrollTop: 560 })
  const content = { parentElement: scrollingElement }
  const wrapper = {
    clientHeight: 720,
    scrollHeight: 720,
    scrollTop: 0,
    querySelector(selector) { assert.equal(selector, '.uni-scroll-view-content'); return content }
  }
  page.$refs.chatScroll = { $el: wrapper }

  assert.equal(page.chatScrollTarget(), scrollingElement)
  page.pauseChatAutoFollow()
  assert.equal(page.chatVirtualScrollTop, 560)
  page.refreshChatScrollViewport()
  assert.equal(page.chatVirtualViewportHeight, 400)
  page.scrollChatToBottom(true, true)
  scheduler.flushTicks()
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(wrapper.scrollTop, 0)
  assert.equal(scrollingElement.scrollTop, 600)
  assert.deepEqual(scrolls, [1000, 1000])
})

test('a canceled downward gesture does not allow a later old bottom callback to resume following', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 560 })
  page.pauseChatAutoFollow(560)
  scrollTo(560)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(160))
  page.onChatTouchCancel()
  scrollTo(600)
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, true)
  assert.equal(page.chatVirtualPinnedToBottom, false)
  assert.equal(page.chatScrollIntoView, '')
})

test('return to latest still works when a native viewport has not yet been measured', () => {
  const { page, scheduler } = createPage({ native: true, scrollTop: 484, viewportHeight: 720, viewportMeasured: false })
  page.pauseChatAutoFollow(484)
  page.scrollChatToBottom(true, true)
  scheduler.flushTicks()
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  assert.match(page.chatScrollIntoView, /^chat-bottom-/)
})

test('measuring the native viewport allows genuine bottom detection without the rendering estimate', () => {
  const { callbacks, uniApi } = createNativeMeasurement()
  const { page, scrollTo } = createPage({ native: true, scrollTop: 484, viewportHeight: 720, viewportMeasured: false, uniApi })
  page.pauseChatAutoFollow(484)
  page.refreshChatScrollViewport()
  assert.equal(callbacks.length, 1)
  callbacks[0]({ height: 500 })
  assert.equal(page.chatVirtualViewportHeight, 500)
  assert.equal(page.chatScrollViewportMeasured, true)

  scrollTo(484)
  page.onChatTouchStart(touch(200))
  callbacks.at(-1)({ height: 500 })
  page.onChatTouchMove(touch(170))
  scrollTo(490)
  assert.equal(page.chatScrollPaused, true)
  scrollTo(500)
  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
})

test('a measured native viewport can confirm the bottom after a deliberate downward gesture finishes', () => {
  const { callbacks, uniApi } = createNativeMeasurement()
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 560, viewportHeight: 720, viewportMeasured: false, uniApi })
  page.pauseChatAutoFollow(560)
  scrollTo(560)
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(160))
  scrollTo(600)
  page.onChatTouchEnd(touchEnd(160))
  assert.equal(page.chatScrollPaused, true, 'the 720px rendering estimate cannot prove this is the bottom')

  callbacks.at(-1)({ height: 400 })
  page.scrollChatToBottom()
  scheduler.advance(160)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  assert.match(page.chatScrollIntoView, /^chat-bottom-/)
})

test('a viewport result from before a conversation reset cannot replace a newer measurement', () => {
  const { callbacks, uniApi } = createNativeMeasurement()
  const { page } = createPage({ native: true, viewportHeight: 720, viewportMeasured: false, uniApi })
  page.refreshChatScrollViewport()
  const staleCallback = callbacks[0]
  assert.equal(typeof staleCallback, 'function')
  page.resetChatVirtualWindow()
  page.refreshChatScrollViewport()
  const currentCallback = callbacks.at(-1)
  assert.notEqual(currentCallback, staleCallback)
  currentCallback({ height: 500 })
  staleCallback({ height: 720 })

  assert.equal(page.chatVirtualViewportHeight, 500)
  assert.equal(page.chatScrollViewportMeasured, true)
})

test('the first native scroll callback does not pause ordinary streaming while viewport measurement is pending', () => {
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 500, viewportHeight: 720, viewportMeasured: false })
  scrollTo(500)
  page.scrollChatToBottom()
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
  assert.match(page.chatScrollIntoView, /^chat-bottom-/)
})

test('queued scroll geometry cannot overwrite a later measured native viewport with its old estimate', () => {
  const { callbacks, uniApi } = createNativeMeasurement()
  const { page, scheduler, scrollTo } = createPage({ native: true, scrollTop: 490, viewportHeight: 720, viewportMeasured: false, uniApi })
  scrollTo(490)
  assert.ok(page._chatVirtualPendingScroll)
  page.refreshChatScrollViewport()
  callbacks[0]({ height: 500 })
  scheduler.advance(100)
  scheduler.flushTicks()

  assert.equal(page.chatVirtualViewportHeight, 500)
  assert.equal(page.chatScrollViewportMeasured, true)
})

for (const changedContext of ['conversation', 'load revision']) {
  test(`a late native viewport measurement is ignored after the ${changedContext} changes`, () => {
    const { callbacks, uniApi } = createNativeMeasurement()
    const { page } = createPage({ native: true, viewportHeight: 720, viewportMeasured: false, uniApi })
    page.refreshChatScrollViewport()
    if (changedContext === 'conversation') page.ui.activeConversationId = 'conversation-b'
    else page.chatLoadRevision += 1
    callbacks[0]({ height: 500 })

    assert.equal(page.chatVirtualViewportHeight, 720)
    assert.equal(page.chatScrollViewportMeasured, false)
  })
}

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
  page.onChatTouchStart(touch(200))
  page.onChatTouchMove(touch(160))
  scrollTo(1000, 1400)
  page.onChatTouchEnd(touchEnd(160))

  assert.equal(page.chatScrollPaused, false)
  assert.equal(page.chatVirtualPinnedToBottom, true)
})
