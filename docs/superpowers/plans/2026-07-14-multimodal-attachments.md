# Multimodal Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent image, camera, and supported text-file attachments that render in chat, serialize to OpenAI-compatible multimodal requests, and survive local and encrypted cloud backup.

**Architecture:** Store attachment bodies in an independent repository collection and reference them from user messages by ordered IDs. A preparation service validates and compresses browser/App `File` objects, `ChatService` owns atomic persistence, the context builder attaches records to selected messages, and `OpenAIProvider` owns wire-format conversion. Backup formats move to V2 while accepting V1, and the outer cloud encryption envelope remains unchanged.

**Tech Stack:** Vue 3 Options API, uni-app/HBuilderX, IndexedDB, plus.sqlite, Canvas/FileReader APIs, OpenAI-compatible Chat Completions, Node test runner, fake-indexeddb, PHP 8.3, MySQL 5.7, Nginx.

## Global Constraints

- Maximum 4 attachments per message and 8 MB combined prepared size.
- Images: longest edge at most 1600 px and prepared body at most 2 MB.
- Text files: supported extension or MIME only, valid non-empty UTF-8, at most 200 KB.
- Image and text attachment bodies must be included inside the existing encrypted cloud envelope.
- Local and cloud backup V1 must remain restorable; new exports use V2.
- Outer cloud envelope `version` remains `1`.
- PHP accepts at most 100 MB backup JSON; Nginx uses `client_max_body_size 110m`.
- Existing chat layout and lower-left plus-menu layout remain unchanged.
- The workspace is not a Git repository. Replace commit steps with test checkpoints and do not initialize Git implicitly.

---

### Task 1: Attachment Policy And Preparation Service

**Files:**
- Create: `src/core/attachment-policy.js`
- Create: `src/services/attachment-service.js`
- Create: `src/platform/browser/web-attachment-adapter.js`
- Create: `tests/attachment-policy.test.js`
- Create: `tests/attachment-service.test.js`
- Create: `tests/web-attachment-adapter.test.js`

**Interfaces:**
- Produces `ATTACHMENT_LIMITS`, `classifyTextFile(file)`, and `formatAttachmentSize(bytes)`.
- Produces `AttachmentService.prepareFiles(files, { existing = [] })` returning prepared records without persistence IDs.
- Consumes adapter methods `prepareImage(file, limits)` and `readUtf8Text(file)`.

- [ ] **Step 1: Write failing attachment-policy tests**

```js
test('accepts supported text files and rejects binary documents', () => {
  assert.equal(classifyTextFile({ name: 'config.json', type: 'application/json' }), true)
  assert.equal(classifyTextFile({ name: '.env', type: '' }), true)
  assert.equal(classifyTextFile({ name: 'report.pdf', type: 'application/pdf' }), false)
})

test('formats stable attachment sizes', () => {
  assert.equal(formatAttachmentSize(1024), '1 KB')
  assert.equal(formatAttachmentSize(1536 * 1024), '1.5 MB')
})
```

- [ ] **Step 2: Run policy tests and verify missing exports fail**

Run: `node --test tests/attachment-policy.test.js`

Expected: FAIL because `src/core/attachment-policy.js` does not exist.

- [ ] **Step 3: Implement exact limits and type classification**

```js
export const ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 4,
  maxCombinedBytes: 8 * 1024 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  maxImageDimension: 1600,
  maxTextBytes: 200 * 1024,
  imageContextCost: 4000
})

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'xml', 'yaml', 'yml', 'html', 'htm', 'css',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'php', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'sh', 'bash', 'zsh', 'sql', 'ini',
  'toml', 'conf', 'properties', 'env', 'log'
])
```

Implement MIME acceptance for `text/*`, JSON, XML, JavaScript, and YAML MIME types. Treat `.env` as an extension even though it begins with a dot.

- [ ] **Step 4: Write failing preparation-service tests**

```js
test('prepares image and text attachments in selection order', async () => {
  const service = new AttachmentService({
    adapter: {
      prepareImage: async file => ({ dataUrl: 'data:image/jpeg;base64,AA==', width: 800, height: 600, byteSize: 128 }),
      readUtf8Text: async file => ({ textContent: 'hello', byteSize: 5 })
    }
  })
  const prepared = await service.prepareFiles([
    { name: 'photo.png', type: 'image/png', size: 500 },
    { name: 'notes.txt', type: 'text/plain', size: 5 }
  ])
  assert.deepEqual(prepared.map(item => item.kind), ['image', 'text'])
})

test('rejects count and combined-size violations without partial output', async () => {
  const service = new AttachmentService({ adapter: oversizedAdapter })
  await assert.rejects(service.prepareFiles(fiveFiles), /最多选择 4 个附件/)
  await assert.rejects(service.prepareFiles(twoLargeImages), /附件总大小不能超过 8 MB/)
})
```

- [ ] **Step 5: Implement `AttachmentService` validation**

The service must validate existing plus selected count before processing, process files sequentially to preserve order, reject empty text, reject invalid types before body reads, and return:

```js
{
  kind: 'image' | 'text',
  name: file.name,
  mimeType: normalizedMime,
  byteSize,
  dataUrl: string | null,
  textContent: string | null,
  width: number | null,
  height: number | null
}
```

- [ ] **Step 6: Write and implement the browser/WebView adapter tests**

Inject `FileReader`, image decoding, canvas creation, and `TextDecoder` so Node tests do not need a real DOM. `readUtf8Text` must use `new TextDecoder('utf-8', { fatal: true })`. `prepareImage` must resize to 1600 px, encode JPEG from quality `0.86` downward in `0.08` steps to `0.54`, and reject if still larger than 2 MB. Preserve PNG only when the decoded image reports transparency.

- [ ] **Step 7: Run the Task 1 test checkpoint**

Run: `node --test tests/attachment-policy.test.js tests/attachment-service.test.js tests/web-attachment-adapter.test.js`

Expected: all Task 1 tests pass.

---

### Task 2: IndexedDB And SQLite Attachment Persistence

**Files:**
- Modify: `src/platform/browser/indexeddb-repository.js`
- Modify: `src/platform/app/plus-sqlite-repository.js`
- Modify: `tests/indexeddb-repository.test.js`
- Modify: `tests/plus-sqlite-repository.test.js`

**Interfaces:**
- Produces `saveAttachments`, `listMessageAttachments`, `listConversationAttachments`, `listAllAttachments`, and `deleteAttachmentsByMessage` on both repositories.
- Changes `createMessagePair(userMessage, assistantMessage, attachments = [])` to persist all records atomically.
- Changes `readBackupData()` and `importRecords()` to include `attachments`.

- [ ] **Step 1: Add failing IndexedDB persistence and cascade tests**

```js
test('stores attachments atomically with a message pair', async () => {
  const repository = await createRepository()
  await repository.createMessagePair(user, assistant, [attachment])
  assert.deepEqual((await repository.listMessageAttachments(user.id)).map(item => item.id), ['a1'])
  assert.equal((await repository.readBackupData()).attachments.length, 1)
})

test('deleting a conversation deletes its attachments', async () => {
  await repository.deleteConversation('c1')
  assert.equal((await repository.listConversationAttachments('c1')).length, 0)
})
```

- [ ] **Step 2: Verify IndexedDB tests fail before the version upgrade**

Run: `node --test tests/indexeddb-repository.test.js`

Expected: FAIL because attachment methods and store are absent.

- [ ] **Step 3: Upgrade IndexedDB to version 2**

Change the constructor default to `databaseVersion = 2`. During `upgradeneeded`, create `attachments` with key path `id`, and indexes on `messageId` and `conversationId`. Extend message-pair and import transactions to include the attachment store. Delete attachments in the same transaction as conversation and message deletion.

- [ ] **Step 4: Add failing SQLite migration and atomic-write tests**

Assert applied migrations are `[1, 2]` and verify this schema:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON attachments (conversation_id);
```

- [ ] **Step 5: Implement SQLite migration 2 and repository methods**

Add `attachmentSql(attachment)` using the existing encoded payload convention. Include attachments in transactional message-pair writes, imports, reads, and conversation deletion.

- [ ] **Step 6: Run repository checkpoint**

Run: `node --test tests/indexeddb-repository.test.js tests/plus-sqlite-repository.test.js`

Expected: all repository tests pass and old record tests remain green.

---

### Task 3: Context Selection And OpenAI Multimodal Serialization

**Files:**
- Modify: `src/core/chat-context.js`
- Modify: `src/providers/openai-provider.js`
- Modify: `tests/chat-context.test.js`
- Modify: `tests/openai-provider.test.js`

**Interfaces:**
- `buildChatContext({ messages, attachments, systemPrompt, maxMessages, maxCharacters })` returns user messages with an ordered `attachments` array.
- Export `serializeOpenAIMessages(messages)` from `openai-provider.js` for direct testing.

- [ ] **Step 1: Write failing context tests**

```js
test('keeps attachment-only user messages and trims old images as whole messages', () => {
  const context = buildChatContext({
    messages: [attachmentOnlyMessage, newestTextMessage],
    attachments: [imageAttachment],
    maxCharacters: 100
  })
  assert.deepEqual(context.map(item => item.id), ['newest'])
})

test('always retains the newest attached user message', () => {
  const context = buildChatContext({
    messages: [largeTextFileMessage],
    attachments: [largeTextAttachment],
    maxCharacters: 100
  })
  assert.equal(context[0].attachments[0].id, 'a1')
})
```

- [ ] **Step 2: Implement attachment-aware eligibility and budget cost**

User messages are eligible when text is non-empty or `attachmentIds` is non-empty. Group attachment records by `messageId`, order them by the message's `attachmentIds`, add text-file character count and 4000 characters per image, and remove older messages atomically. Return selected persisted messages as `{ id, role, content, attachments }`, using an empty attachment array for assistant messages. Return the optional system entry as `{ role: 'system', content }`. `serializeOpenAIMessages` removes internal IDs before transport.

- [ ] **Step 3: Write failing OpenAI serialization tests**

```js
test('serializes image and text attachments as ordered content parts', () => {
  assert.deepEqual(serializeOpenAIMessages([internalMessage]), [{
    role: 'user',
    content: [
      { type: 'text', text: 'Review these' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } },
      { type: 'text', text: '[Attachment start: notes.txt]\nhello\n[Attachment end: notes.txt]' }
    ]
  }])
})
```

- [ ] **Step 4: Implement provider serialization**

Keep system, assistant, and unattached user content as strings. For attached users, emit message text first when non-empty, then attachment parts in selected order. Reject malformed attachment records before issuing the transport request.

- [ ] **Step 5: Run context/provider checkpoint**

Run: `node --test tests/chat-context.test.js tests/openai-provider.test.js`

Expected: plain chat behavior and multimodal behavior both pass.

---

### Task 4: ChatService Atomic Send And Retry Reuse

**Files:**
- Modify: `src/services/chat-service.js`
- Modify: `tests/chat-service.test.js`

**Interfaces:**
- Consumes prepared records from Task 1 and repository methods from Task 2.
- `send({ conversationId, content, attachments = [], onMessage, onConversation, onState })` accepts attachment-only messages.
- Retry loads existing attachment records and does not persist duplicates.

- [ ] **Step 1: Write failing attachment-only send test**

```js
test('persists attachment-only messages and sends multimodal context', async () => {
  await chatService.send({ conversationId: 'conversation-1', content: '', attachments: [preparedImage] })
  const messages = await repository.listMessages('conversation-1')
  const saved = await repository.listMessageAttachments(messages[0].id)
  assert.equal(messages[0].attachmentIds.length, 1)
  assert.equal(saved[0].messageId, messages[0].id)
  assert.equal(provider.requests[0].messages.at(-1).attachments[0].id, saved[0].id)
})
```

- [ ] **Step 2: Write failing retry reuse test**

Retry the assistant response and assert the repository attachment count remains one while the second provider request includes the same attachment ID.

- [ ] **Step 3: Implement send and retry changes**

Generate user-message ID first, materialize persisted attachment records with IDs, `conversationId`, `messageId`, and `createdAt`, set ordered `attachmentIds`, and pass all records to `createMessagePair`. Permit blank text only when attachments exist. Derive a new title from text or the first attachment name. Before every generation, load `listConversationAttachments(conversation.id)` and pass them into `buildChatContext`.

- [ ] **Step 4: Run ChatService checkpoint**

Run: `node --test tests/chat-service.test.js`

Expected: send, stop, failure, retry, attachment-only, and attachment-reuse tests pass.

---

### Task 5: V2 Local And Cloud Backup Formats

**Files:**
- Modify: `src/core/backup-format.js`
- Modify: `src/core/cloud-backup-format.js`
- Modify: `src/services/backup-service.js`
- Modify: `tests/backup-format.test.js`
- Modify: `tests/cloud-backup-format.test.js`
- Modify: `tests/backup-service.test.js`
- Modify: `tests/cloud-backup-service.test.js`

**Interfaces:**
- Local export uses `formatVersion: 2` and an `attachments` array.
- Cloud payload uses `cloudFormatVersion: 2` and an `attachments` array.
- V1 input maps to `attachments: []`.

- [ ] **Step 1: Write failing V1 compatibility and V2 remapping tests**

Create one V1 fixture without attachments and one V2 fixture with provider, conversation, message, and attachment references. Assert V1 restores with zero attachments and V2 remaps all four ID types while preserving attachment order and body.

- [ ] **Step 2: Implement local V2 backup**

Create maps for provider IDs, conversation IDs, message IDs, and attachment IDs before mapping entities. Validate every attachment has a supported `kind`, a valid ID, and references both an imported conversation and message. Reject before repository writes on any mismatch.

- [ ] **Step 3: Implement cloud V2 backup**

Keep provider keys and prompt handling unchanged. Clone attachment bodies only inside the inner payload. On restore, remap `conversationId`, `messageId`, and message `attachmentIds`; reject invalid cross-references atomically.

- [ ] **Step 4: Extend backup services and repository calls**

Pass `attachments` through `readBackupData`, `createBackup`, `prepareImport`, `createCloudBackupPayload`, `prepareCloudRestore`, and `importRecords`. Return attachment counts from import/restore results without removing existing count fields.

- [ ] **Step 5: Run backup checkpoint**

Run: `node --test tests/backup-format.test.js tests/cloud-backup-format.test.js tests/backup-service.test.js tests/cloud-backup-service.test.js`

Expected: V1 and V2 fixtures pass, and sensitive-field tests remain green.

---

### Task 6: Service Factories And Composer State

**Files:**
- Modify: `src/app/create-browser-services.js`
- Modify: `src/app/create-app-services.js`
- Modify: `src/ui-state.js`
- Modify: `tests/platform-services.test.js`
- Modify: `tests/ui-state.test.js`

**Interfaces:**
- Both platform factories return `attachmentService`.
- `canSendMessage(ui, draft, hasProvider, attachmentCount = 0, attachmentProcessing = false)` enables attachment-only sends and blocks processing.
- Attachment actions identify the corresponding hidden input.

- [ ] **Step 1: Add failing factory and send-guard tests**

```js
assert.equal(canSendMessage(ui, '', true, 1, false), true)
assert.equal(canSendMessage(ui, '', true, 1, true), false)
assert.equal(canSendMessage(ui, '', true, 0, false), false)
```

Assert browser and App services expose an object with `prepareFiles`.

- [ ] **Step 2: Wire the shared WebAttachmentAdapter and AttachmentService**

Instantiate them in both factories after repository/vault initialization. Do not make attachment selection part of the repository or provider service.

- [ ] **Step 3: Extend attachment action metadata**

Use stable values:

```js
[
  { id: 'image', label: '图片', icon: 'Image', inputRef: 'imageAttachmentInput' },
  { id: 'camera', label: '拍照', icon: 'Camera', inputRef: 'cameraAttachmentInput' },
  { id: 'file', label: '文件', icon: 'FileText', inputRef: 'fileAttachmentInput' }
]
```

- [ ] **Step 4: Run service/state checkpoint**

Run: `node --test tests/platform-services.test.js tests/ui-state.test.js`

Expected: platform selection and all send guards pass.

---

### Task 7: Composer, Message Rendering, And Preview UI

**Files:**
- Modify: `pages/index/index.vue`
- Modify: `tests/cloud-backup-ui.test.js`
- Modify: `tests/ui-state.test.js`
- Create: `tests/attachment-ui.test.js`

**Interfaces:**
- UI state adds `pendingAttachments`, `attachmentProcessing`, and `attachmentPreview`.
- `chooseAttachmentAction(action)` opens `this.$refs[action.inputRef]`.
- `handleAttachmentSelection(event)` prepares and appends files.
- `removePendingAttachment(index)`, `previewImageAttachment(attachment)`, and `previewTextAttachment(attachment)` provide interactions.

- [ ] **Step 1: Add failing source-level UI tests**

Assert the page contains three hidden inputs with these exact behaviors:

```html
<input ref="imageAttachmentInput" type="file" accept="image/*" multiple />
<input ref="cameraAttachmentInput" type="file" accept="image/*" capture="environment" />
<input ref="fileAttachmentInput" type="file" :accept="textAttachmentAccept" multiple />
```

Also assert pending-item remove buttons, sent attachment rendering, text preview modal, and that the old placeholder toast is absent.

- [ ] **Step 2: Implement selection and pending-state methods**

Close the plus menu before opening a picker. Reset each input value after handling so the same file can be reselected. Append prepared attachments only after the entire batch succeeds. Keep existing pending items unchanged on failure.

- [ ] **Step 3: Implement send integration and message hydration**

Pass `pendingAttachments` to `chatService.send`, clear them only after the user message has been persisted, and hydrate message display records by calling `listMessageAttachments` when opening a chat. Update `upsertMessage` to preserve callback-provided attachments. Use `[图片]` or `[文件]` as a conversation preview for attachment-only messages.

- [ ] **Step 4: Implement visual components without changing layout structure**

Add a fixed-height pending strip above the textarea, 56 px image tiles, compact text-file rows, icon-only remove buttons, image grids inside user messages, and a read-only text modal. Long file names must use ellipsis. The composer and bottom navigation must not overlap at 390x830 and 360x800.

- [ ] **Step 5: Run UI checkpoint**

Run: `node --test tests/attachment-ui.test.js tests/ui-state.test.js tests/cloud-backup-ui.test.js`

Expected: all source-level interaction and layout contracts pass.

- [ ] **Step 6: Run Playwright visual and interaction verification**

Use `http://localhost:5174/#/` at 390x830 and 360x800. Exercise: open chat, open plus menu, attach a generated PNG and TXT file, remove one, send attachment-only, open image preview, open text preview, and retry the assistant response. Capture console errors and screenshots outside the repository.

Expected: no overlap, no horizontal overflow, no console errors, and pending/sent attachment states are visible.

---

### Task 8: Server Backup Limit And Clear Client Error

**Files:**
- Modify: `server/src/CloudBackupApp.php`
- Modify: `server/tests/integration.php`
- Modify: `src/services/cloud-api-client.js`
- Modify: `tests/cloud-api-client.test.js`
- Remote modify: `/www/server/panel/vhost/nginx/extension/118.145.98.165_8018/api.conf`
- Remote deploy: `/www/wwwroot/118.145.98.165_8018/src/CloudBackupApp.php`

**Interfaces:**
- `CloudBackupApp` defaults to `104857600` maximum backup bytes and accepts an injected lower limit in tests.
- Cloud client maps HTTP 413 to code `backup_too_large` and message `云端备份超过 100 MB 上限`.

- [ ] **Step 1: Write a failing PHP size-limit test without allocating 100 MB**

Change the constructor contract to:

```php
public function __construct(private PDO $pdo, private $clock = null, private int $maxBackupBytes = 104857600)
```

In the integration test, instantiate a second app with `maxBackupBytes: 128`, upload an envelope larger than 128 JSON bytes, and assert status 413 and code `backup_too_large`.

- [ ] **Step 2: Implement the configurable 100 MB default**

Replace the 10 MB constant use with `$this->maxBackupBytes`; reject before reading or updating the existing backup row.

- [ ] **Step 3: Add and implement the client 413 mapping test**

Mock a transport `ModelHttpError` with status 413 and assert CloudApiClient rethrows an error with code `backup_too_large` and the Chinese limit message.

- [ ] **Step 4: Run local server/client checkpoint**

Run: `php server/tests/integration.php`

Run: `node --test tests/cloud-api-client.test.js`

Expected: both pass.

- [ ] **Step 5: Back up and deploy remote server changes**

Back up the live PHP file and Nginx extension with a timestamp. Upload `CloudBackupApp.php`, run `php -l`, add `client_max_body_size 110m;` at server context in `api.conf`, run `nginx -t`, and reload only after a successful config test.

- [ ] **Step 6: Verify real HTTP behavior**

Run the existing register/login/upload/download/delete/logout E2E sequence against `http://118.145.98.165:8018`. Also send an intentionally oversized request using an injected local PHP app test rather than a 100 MB remote payload. Verify `/config.php` and `/src/CloudBackupApp.php` remain externally 404.

---

### Task 9: Full Regression, Build, Android Validation, And Documentation

**Files:**
- Modify: `design-qa.md`
- Modify: `docs/superpowers/specs/2026-07-14-multimodal-attachments-design.md` only if implementation requires a documented, user-approved deviation

**Interfaces:**
- No new production interface; this task proves all prior contracts together.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Run: `php server/tests/bootstrap-paths.php`

Run: `php server/tests/integration.php`

Expected: zero failures.

- [ ] **Step 2: Run browser and HBuilderX builds**

Run: `npm run build`

Run:

```powershell
$projectDir='C:\path\to\EchoWeave'
$hbuilderxDir='C:\path\to\HBuilderX'
$env:UNI_INPUT_DIR=$projectDir
$env:UNI_OUTPUT_DIR="$env:TEMP\echo-weave-app-build"
& "$hbuilderxDir\plugins\node\node.exe" "$hbuilderxDir\plugins\uniapp-cli-vite\node_modules\@dcloudio\vite-plugin-uni\bin\uni.js" build -p app
```

Expected: Vite production build and App build exit successfully.

- [ ] **Step 3: Validate browser end to end**

At `http://localhost:5174/#/`, attach a compressed image and text file, send with and without text, reload, retry, back up, restore in a clean browser context, and confirm attachment previews remain usable.

- [ ] **Step 4: Validate Android WebView selection and transport**

On the available Android runtime, verify gallery selection, camera capture, system text-file selection, SQLite persistence, app restart, streaming response, stop, retry, immediate backup, and restore. Record any emulator limitation separately; do not mark Android attachment selection complete without observing each picker.

- [ ] **Step 5: Update QA evidence**

Document viewport sizes, attachment samples, request payload shape, backup/restore result, screenshots, console/log status, server E2E status, and any remaining Android environment risk in `design-qa.md`.

- [ ] **Step 6: Final verification gate**

Re-run `npm test`, `npm run build`, both PHP tests, `nginx -t`, a small live HTTP backup E2E, and inspect the final screenshots before claiming completion.
