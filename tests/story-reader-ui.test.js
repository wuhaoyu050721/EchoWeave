import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
const reader = await readFile(new URL('../src/components/story-reader.vue', import.meta.url), 'utf8')
const block = await readFile(new URL('../src/components/story-reader-block.vue', import.meta.url), 'utf8')

test('story conversations use the dedicated reader while regular chats retain their existing surface', () => {
  assert.match(page, /<template v-if="activeStoryConversation">\s*<StoryReader/s)
  assert.match(page, /<template v-else>\s*<view class="chat-toolbar">/s)
  assert.match(page, /'chat-active': ui\.screen === 'chat' && !activeStoryConversation/)
  assert.match(page, /'story-reader-active': ui\.screen === 'chat' && activeStoryConversation/)
  assert.match(page, /@update:mode="saveStoryReaderMode"/)
  assert.match(page, /readStoryReaderMode\(this\.services\.repository\)/)
  assert.match(page, /setSetting\?\.\(STORY_READER_MODE_SETTING_KEY, nextMode\)/)
})

test('reader exposes page and scroll modes, swipe paging, history loading, and story controls', () => {
  assert.match(reader, /data-testid="story-page-mode"/)
  assert.match(reader, /data-testid="story-scroll-mode"/)
  assert.match(reader, /@touchstart="handleTouchStart"/)
  assert.match(reader, /@touchend="handleTouchEnd"/)
  assert.match(reader, /Math\.abs\(deltaX\) < 44/)
  assert.match(reader, /aria-label="上一页"/)
  assert.match(reader, /aria-label="下一页"/)
  assert.match(reader, /class="story-reader-scroll"/)
  assert.match(reader, /\$emit\('load-earlier'\)/)
  assert.match(reader, /placeholder="输入事件走向，留空续写"/)
  assert.match(reader, /\$emit\('stop'\)/)
  assert.match(reader, /\$emit\('retry', \$event\)/)
  assert.match(reader, /@continue="continueStory"/)
})

test('scroll mode exposes a toolbar action that jumps to the story end and saves that position', () => {
	assert.match(reader, /v-if="normalizedMode === 'scroll'"[^>]*data-testid="story-scroll-bottom"/s)
	assert.match(reader, /aria-label="滚动到底部"/)
	assert.match(reader, /id="story-scroll-end" class="story-scroll-tail"/)
	assert.match(reader, /scrollStoryToBottom\(\) \{[^]*this\.storyScrollIntoView = STORY_SCROLL_END_ANCHOR_ID/)
	assert.match(reader, /this\.positionForBlock\(finalBlock, storyTextLength\(finalBlock\.text\)\)/)
	assert.match(reader, /!Number\.isFinite\(scrollHeight\) \|\| !Number\.isFinite\(clientHeight\) \|\| scrollHeight <= 0/)
	assert.match(reader, /target && 'scrollTop' in target[^]*target\.scrollTop = maximumTop/)
})

test('story continuation starts directly without opening reader chrome or menus', () => {
  assert.equal((block.match(/@click\.stop="\$emit\('continue', block\.messageId\)"/g) || []).length, 2)
	assert.match(reader, /continueStory\(messageId\) \{\s*this\.readerChromeVisible = false\s*this\.closeBookmarkPanel\(\)\s*this\.\$emit\('close-menus'\)\s*this\.\$emit\('continue', messageId\)\s*this\.\$nextTick\(\(\) => this\.resetReaderShellScroll\(\)\)\s*\}/s)
  assert.match(page, /async continueMessage\(messageId\) \{\s*if \(this\.ui\.generating\) return\s*this\.closeStoryMenus\(\)/s)
})

test('page turns animate the prose layer in both directions without moving the controls', () => {
	assert.match(reader, /:key="pageAnimationKey" class="story-page-content" :class="pageTurnClass"/)
	assert.match(reader, /pageTurnDirection = normalizedIndex > this\.currentPageIndex \? 'forward' : 'backward'/)
	assert.match(reader, /\.story-page-content\.turn-forward\s*\{[^}]*animation:\s*story-page-turn-forward 260ms/s)
	assert.match(reader, /\.story-page-content\.turn-backward\s*\{[^}]*animation:\s*story-page-turn-backward 260ms/s)
	assert.match(reader, /@keyframes story-page-turn-forward/)
	assert.match(reader, /@keyframes story-page-turn-backward/)
	assert.match(reader, /@media \(prefers-reduced-motion:\s*reduce\)[^]*\.story-page-content\.turn-forward,[^]*\.story-page-content\.turn-backward \{ animation: none; \}/)
	assert.match(reader, /<\/view>\s*<view class="story-page-controls">/)
})

test('reader supports persistent per-story bookmarks with add, jump, and delete actions', () => {
	assert.match(reader, /data-testid="story-bookmark-menu"/)
	assert.match(reader, /data-testid="story-bookmark-panel"/)
	assert.match(reader, /data-testid="story-bookmark-toggle"/)
	assert.match(reader, /createStoryReaderBookmark\(this\.conversation\?\.id, position, this\.bookmarkExcerpt\(position\)\)/)
	assert.match(reader, /this\.\$emit\('update:bookmarks', nextBookmarks\)/)
	assert.match(reader, /openBookmark\(value\)[^]*storyPageIndexForPosition\(this\.storyPages, bookmark\)[^]*this\.changePage\(pageIndex, \{ position: bookmark \}\)/)
	assert.match(reader, /removeBookmark\(bookmark\)[^]*this\.\$emit\('update:bookmarks'/)
	assert.match(page, /:bookmarks="storyReaderBookmarks"/)
	assert.match(page, /@update:bookmarks="saveStoryReaderBookmarks"/)
	assert.match(page, /readStoryReaderBookmarks\(this\.services\?\.repository, conversationId\)/)
	assert.match(page, /repository\.setSetting\(key, next\)/)
	assert.match(page, /await this\.waitForStoryReaderBookmarksSave\(\)/)
})

test('page mode preserves the visible page while generated story content grows', () => {
  assert.match(reader, /initialPagePositioned: false/)
  assert.match(reader, /const previousPosition = this\.positionForPage\(previousPages\?\.\[previousIndex\], this\.readingPosition\)/)
  assert.match(reader, /const anchoredIndex = storyPageIndexForPosition\(nextPages, previousPosition\)/)
  assert.doesNotMatch(reader, /const followedLatest/)
})

test('page and scroll modes share a stable paragraph and character-offset reading position', () => {
  assert.match(block, /:data-story-source-id="sourceId"/)
  assert.match(block, /:data-story-source-offset="sourceOffset"/)
  assert.match(reader, /ref="storyScroll"[^>]*:scroll-top="storyScrollTop"[^>]*@scroll="handleStoryScroll"/)
	assert.match(reader, /captureScrollReadingPosition\(\)/)
	assert.match(reader, /storyPageIndexForPosition\(pages, this\.positionForConversation\(position\)\)/)
	assert.match(reader, /storyTextOffsetAtReadingLine\(selectedNode, readingLine\)/)
	assert.match(reader, /storyTextRectAtOffset\(node, relativeOffset\)/)
	assert.match(reader, /for \(const child of Array\.from\(node\?\.childNodes \|\| \[\]\)\)/)
	assert.match(reader, /textNode\.nodeValue \?\? textNode\.textContent \?\? textNode\.data/)
	assert.match(reader, /const desiredTop = currentScrollTop \+ anchorTop - readingLine/)
	assert.match(reader, /Number\.isFinite\(measuredScrollTop\)/)
	assert.match(block, /domId\(\) \{ return storyBlockDomId\(this\.block\) \}/)
	assert.match(reader, /this\.storyScrollIntoView = anchorId/)
	assert.match(reader, /this\.retryScrollPositionRestore\(normalized, revision, attempt\)/)
	assert.match(reader, /attempt >= STORY_SCROLL_RESTORE_MAX_ATTEMPTS/)
	assert.match(reader, /if \(normalizeStoryReaderMode\(value\) === 'page'\) \{\s*this\.cancelScrollPositionRestore\(\)/)
	assert.match(reader, /this\.\$emit\('update:readerPosition', normalized\)/)
})

test('story reading positions are loaded and debounced per conversation', () => {
  assert.match(page, /:reader-position="storyReaderPosition"/)
  assert.match(page, /@update:readerPosition="queueStoryReaderPositionSave"/)
	assert.match(page, /const conversationId = this\.activeStoryConversation\s*\? String\(this\.activeConversation\?\.id \|\| ''\)/)
  assert.match(page, /STORY_READER_POSITION_SAVE_DELAY = 220/)
  assert.match(page, /storyReaderPositionSettingKey\(pending\?\.conversationId\)/)
  assert.match(page, /readStoryReaderPosition\(this\.services\?\.repository, conversationId\)/)
  assert.match(page, /await this\.flushStoryReaderPositionSave\(\)/)
	assert.match(page, /const activeWrite = this\.storyReaderPositionWritePromise \|\| Promise\.resolve\(\)/)
	assert.match(page, /const position = normalizeStoryReaderPosition\(pending\?\.position, pending\?\.conversationId\)/)
	assert.match(page, /\.then\(\(\) => repository\.setSetting\(key, position\)\)/)
})

test('reader chrome starts hidden and toggles from a deliberate center-page tap', () => {
  assert.match(reader, /readerChromeVisible: false/)
  assert.match(reader, /'story-chrome-visible': readerChromeShown/)
  assert.match(reader, /data-testid="story-reader-top-chrome"/)
  assert.match(reader, /data-testid="story-reader-composer"/)
  assert.match(reader, /@click="handleReaderClick"/)
  assert.match(reader, /relativeX >= rect\.width \* 0\.24/)
  assert.match(reader, /this\.readerChromeVisible = !this\.readerChromeVisible/)
	assert.match(reader, /'story-chrome-hidden': !readerChromeShown/)
	assert.match(reader, /overflow: clip/)
	assert.match(reader, /resetReaderShellScroll\(\)/)
})

test('leaving a story captures the current position before the parent flushes it', () => {
	assert.match(reader, /@click="leaveStory"/)
	assert.match(reader, /leaveStory\(\) \{[^]*captureScrollReadingPosition\(\)[^]*\$emit\('back'\)/)
	assert.match(page, /async backToConversations\(\) \{[^]*await this\.flushStoryReaderPositionSave\(\)/)
})

test('reader presents prose and user choices as book content instead of chat bubbles', () => {
  assert.match(block, /class="story-prose"/)
  assert.match(block, /class="story-event-label">事件走向/)
  assert.match(block, /font-family: "Songti SC"/)
  assert.match(block, /text-indent: 2em/)
  assert.doesNotMatch(reader, /message-bubble|user-bubble|assistant-body/)
})
