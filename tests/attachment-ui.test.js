import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('chat UI exposes working attachment inputs and pending controls', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /ref="imageAttachmentInput"[^>]+type="file"[^>]+accept="image\/\*"[^>]+multiple/)
  assert.match(source, /ref="cameraAttachmentInput"[^>]+type="file"[^>]+accept="image\/\*"[^>]+capture="environment"/)
  assert.match(source, /ref="fileAttachmentInput"[^>]+type="file"[^>]+:accept="textAttachmentAccept"[^>]+multiple/)
  assert.match(source, /handleAttachmentSelection/)
  assert.match(source, /removePendingAttachment/)
  assert.match(source, /pending-attachment-strip/)
  assert.match(source, /document\.createElement\(['"]input['"]\)/)
  assert.match(source, /nativeInput\.type\s*=\s*['"]file['"]/)
  assert.match(source, /handleNativeAttachmentAction/)
  assert.match(source, /nativeAttachmentPicker/)
  assert.doesNotMatch(source, /将在后续版本支持/)
})

test('Telegram-style composer controls keep emoji, attachment, voice, and send actions functional', async () => {
  const [source, manifest] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8')
  ])

  assert.match(source, /class="composer-emoji"[^>]+@click="toggleEmojiMenu"/)
  assert.match(source, /class="composer-smile-icon"[^>]+src="\/static\/chat\/smile\.png"/)
  assert.match(source, /class="composer-attachment"[^>]+aria-label="添加附件"[^>]+@click="toggleAttachmentMenu"/)
  assert.match(source, /<Paperclip\s+:size="27"/)
  assert.match(source, /<Mic\s+v-else\s+:size="26"/)
  assert.match(source, /appendEmoji\(emoji\)/)
  assert.match(source, /plus\.speech\.startRecognize/)
  assert.match(manifest, /"Speech"\s*:\s*\{\}/)
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/)
})

test('composer stays compact when empty and grows to five wrapped lines across browser and App runtimes', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /<textarea ref="composerInput" class="composer-input"[^>]+rows="1"[^>]+maxlength="-1"[^>]+:style="\{ height: composerInputHeight \+ 'px' \}"[^>]+@linechange="resizeComposerInput"/)
  assert.doesNotMatch(source, /<textarea[^>]+auto-height/)
  assert.doesNotMatch(source, /class="composer-input"[^>]+@confirm="sendMessage"/)
  assert.doesNotMatch(source, /class="composer-input"[^>]+@keydown\.enter\.exact\.prevent="sendMessage"/)
  assert.match(source, /const COMPOSER_MIN_HEIGHT = 44/)
  assert.match(source, /const COMPOSER_MAX_HEIGHT = 132/)
  assert.match(source, /event\?\.detail\?\.lineCount/)
  assert.match(source, /textarea\.scrollHeight/)
  assert.match(source, /\.composer\s*\{[^}]*align-items:\s*center[^}]*height:\s*56px[^}]*min-height:\s*56px[^}]*max-height:\s*56px/s)
  assert.match(source, /\.composer\.has-attachments,\s*\.composer\.is-multiline\s*\{[^}]*align-items:\s*flex-end[^}]*height:\s*auto[^}]*max-height:\s*none/s)
  assert.match(source, /\.composer-input\s*\{[^}]*min-height:\s*44px[^}]*max-height:\s*132px[^}]*line-height:\s*22px[^}]*overflow-y:\s*auto[^}]*white-space:\s*pre-wrap/s)
  assert.match(source, /\.composer-smile-icon\s*\{[^}]*transform:\s*translateY\(-3px\)/s)
  assert.match(source, /\.app-shell\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s)
})

test('sent attachments render image and text preview entry points', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /message\.attachments/)
  assert.match(source, /previewImageAttachment/)
  assert.match(source, /previewTextAttachment/)
  assert.match(source, /attachmentPreviewImageStyle/)
  assert.match(source, /class="attachment-preview-image"[^>]+:style="attachmentPreviewImageStyle/)
  assert.match(source, /attachment-preview-modal/)
  assert.match(source, /listMessageAttachments/)
  assert.match(source, /attachments:\s*pendingAttachments/)
})

test('generated assistant images expose image mode and history rendering', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /generation-mode-tabs/)
  assert.match(source, />生图</)
  assert.match(source, /mode:\s*this\.ui\.generationMode/)
  assert.match(source, /assistant-image-grid/)
  assert.match(source, /assistant-image-surface/)
  assert.match(source, /media-message-meta/)
  assert.match(source, /imageAttachments\(message\)\.length === 1 \? 'widthFix' : 'aspectFill'/)
  assert.match(source, /\.media-message\s*\{[^}]*position:\s*relative[^}]*width:\s*min\(252px,\s*68vw\)/s)
  assert.match(source, /\.sent-image-button\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s)
  assert.match(source, /预览生成图片/)
  assert.match(source, /<AppImage[^>]+attachmentSource\(attachment\)/)
  assert.doesNotMatch(source, /message\.role\s*!==\s*['"]user['"]\s*\|\|\s*!message\.attachmentIds/)
})

test('chat images can be saved and message text supports native long-press selection', async () => {
  const [source, manifest] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8')
  ])

  assert.equal((source.match(/class="image-download-button"/g) || []).length, 2)
  assert.equal((source.match(/@click\.stop="downloadImageAttachment\(attachment\)"/g) || []).length, 2)
  assert.match(source, /aria-label="保存预览图片"[^>]+@click="downloadImageAttachment\(attachmentPreview\.attachment\)"/)
  assert.match(source, /async downloadImageAttachment\(attachment\)/)
  assert.match(source, /saveImageToPhotoAlbum\(\{/)
  assert.match(source, /图片已保存到系统相册/)
  assert.match(source, /downloadImageInBrowser\(\{/)

  assert.equal((source.match(/class="message-content" selectable user-select/g) || []).length, 2)
  assert.doesNotMatch(source, /class="message-content"[^>]+@longpress/)
  assert.match(source, /\.message-content\s*\{[^}]*-webkit-user-select:\s*text[^}]*user-select:\s*text[^}]*cursor:\s*text/s)
  assert.match(source, /class="attachment-preview-text"[^>]*>\s*<text selectable user-select>/)

  assert.match(manifest, /"Gallery"\s*:\s*\{\}/)
})
