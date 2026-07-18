# Multimodal Attachments Design

## Goal

Implement working image, camera, and text-file attachments for browser and Android chat. Attachments must be locally persistent, included in OpenAI-compatible multimodal requests, reusable during retry and context continuation, and recoverable through encrypted local and cloud backups.

## Scope

### Included

- Select up to four attachments per user message.
- Select images from the gallery.
- Capture an image with the system camera.
- Select supported UTF-8 text and source-code files.
- Compress images before persistence and transmission.
- Preview and remove pending attachments before sending.
- Send attachment-only messages.
- Render sent image thumbnails and text-file rows.
- Preview sent images and text-file contents.
- Persist attachments independently from messages in IndexedDB and SQLite.
- Include attachments in retries and subsequent context.
- Include encrypted attachment bodies in cloud backup and cross-device restore.
- Include attachments in local JSON export and import.

### Excluded

- PDF, Word, spreadsheet, archive, audio, and video parsing.
- OpenAI Files API and Responses API uploads.
- Public server-side file URLs.
- Provider-specific file APIs.
- OCR or document conversion.

## Limits

- Maximum attachments per user message: 4.
- Maximum combined prepared attachment size per message: 8 MB.
- Maximum prepared image size: 2 MB.
- Maximum image dimension: 1600 pixels on the longest edge.
- Maximum decoded UTF-8 text-file size: 200 KB.
- Cloud backup HTTP payload limit: 100 MB.
- Images are encoded as JPEG after compression unless transparency requires PNG.

## Attachment Model

Attachments are independent records. Messages contain ordered attachment IDs and never embed binary bodies directly.

```js
{
  id: 'attachment-id',
  conversationId: 'conversation-id',
  messageId: 'message-id',
  kind: 'image', // image | text
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  byteSize: 182734,
  dataUrl: 'data:image/jpeg;base64,...',
  textContent: null,
  width: 1280,
  height: 960,
  createdAt: '2026-07-14T00:00:00.000Z'
}
```

Text records use `textContent` and set `dataUrl`, `width`, and `height` to null. Image records use `dataUrl` and set `textContent` to null.

A user message stores:

```js
{
  ...message,
  content: 'Please inspect these files',
  attachmentIds: ['attachment-1', 'attachment-2']
}
```

`attachmentIds` preserves display and request order.

## Storage

### IndexedDB

Increase the database version from 1 to 2. Add an `attachments` object store keyed by `id`, with non-unique `conversationId` and `messageId` indexes.

### SQLite

Add migration version 2 with an `attachments` table. The table follows the existing payload pattern and stores indexed identity columns plus the complete encoded attachment payload.

### Repository Interface

Both repositories expose the same methods:

```js
saveAttachments(attachments)
listMessageAttachments(messageId)
listConversationAttachments(conversationId)
listAllAttachments()
deleteAttachmentsByMessage(messageId)
```

`createMessagePair(userMessage, assistantMessage, attachments)` atomically stores the two messages and all prepared attachments. Deleting a conversation atomically deletes its messages and attachments.

## Attachment Preparation

Create a platform-neutral attachment preparation service with injected file-reading and image-processing adapters.

### Images

1. Validate that the input MIME type starts with `image/`.
2. Decode the image.
3. Resize so the longest edge is no more than 1600 pixels.
4. Encode at a bounded quality and reduce quality iteratively until the result is no more than 2 MB.
5. Preserve PNG only when transparency is present; otherwise encode JPEG.
6. Reject corrupt or still-oversized images before persistence.

### Text Files

Supported extensions are `.txt`, `.md`, `.markdown`, `.json`, `.jsonl`, `.csv`, `.xml`, `.yaml`, `.yml`, `.html`, `.htm`, `.css`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.vue`, `.py`, `.php`, `.java`, `.kt`, `.kts`, `.swift`, `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cs`, `.go`, `.rs`, `.rb`, `.sh`, `.bash`, `.zsh`, `.sql`, `.ini`, `.toml`, `.conf`, `.properties`, `.env`, and `.log`.

1. Accept a listed extension or one of these MIME families: `text/*`, `application/json`, `application/xml`, `application/javascript`, `application/x-yaml`, and `application/yaml`.
2. Reject source files larger than 200 KB before decoding.
3. Decode as UTF-8 with fatal decoding enabled.
4. Reject invalid UTF-8 and empty files.
5. Preserve the decoded text exactly for the model request and preview.

### Selection Limits

Pending attachments are validated after preparation. The UI rejects a fifth attachment or a combined prepared size above 8 MB. Cancellation does not show an error.

## Selection UI

The existing lower-left plus menu keeps its current layout and actions.

- `Image` opens a multi-select image input.
- `Camera` opens an image input with `capture="environment"`.
- `File` opens a file input limited to supported text extensions and MIME types.

Hidden native file inputs are the browser and Android WebView implementation. Android acceptance testing must verify gallery selection, camera capture, and system file selection before the feature is considered complete.

Pending attachments appear above the composer:

- Images show a stable square thumbnail.
- Text files show an icon, file name, and formatted size.
- Every item has an icon-only remove button with an accessible label.
- Processing shows a fixed-height loading row and disables send.
- Text is optional when at least one prepared attachment exists.

Sent user messages render their attachments before message text. Clicking an image opens the platform image preview. Clicking a text-file row opens a read-only modal with the file name and content.

## Chat Flow

`ChatService.send` accepts:

```js
send({ conversationId, content, attachments, onMessage, onConversation, onState })
```

The service allows a blank text value when attachments are present. It assigns message and attachment IDs, stores the attachment records atomically with the message pair, and uses the message text or first attachment name to derive a new-conversation title.

Retry locates the preceding user message and loads its attachments. It creates only a new assistant message and never duplicates attachment records.

## Context And Provider Mapping

Internal request messages use:

```js
{
  role: 'user',
  content: 'Please inspect these files',
  attachments: [attachmentRecord]
}
```

The context builder preserves eligible attachments and applies these costs:

- Text content and text-file content count by character length.
- Every image consumes a fixed context budget of 4000 characters.
- If limits are reached, older complete messages and their attachments are removed together.
- The newest user message is always retained as a complete unit even when its text files exceed the normal character budget.

The OpenAI-compatible provider maps an attached user message to Chat Completions content parts:

```js
{
  role: 'user',
  content: [
    { type: 'text', text: 'Please inspect these files' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }
  ]
}
```

Each text file becomes one text content part with explicit boundaries:

```text
[Attachment start: config.json]
<exact decoded content>
[Attachment end: config.json]
```

If there is no message text, only attachment-derived parts are sent. System and assistant messages remain plain strings. A model capability error marks the assistant message as failed while preserving the user message and attachments for model switching and retry.

## Backup And Restore

### Local Backup

Create format version 2 with an `attachments` array. Import accepts versions 1 and 2. Version 1 is treated as having no attachments.

During import, provider, conversation, message, and attachment IDs are remapped. Every attachment must reference an imported conversation and message. Invalid references reject the entire import before any writes.

### Cloud Backup

Create inner cloud format version 2 with an `attachments` array. Version 1 restore remains supported. Attachment names and bodies exist only inside the encrypted AES-256-GCM cloud envelope.

The outer envelope cryptographic version remains 1 because its KDF and cipher format do not change.

Increase the PHP application backup limit to 100 MB and set Nginx `client_max_body_size` to `110m`. The UI maps HTTP 413 to a clear backup-size error.

## Error Handling

- Unsupported file types are rejected before reading their body.
- Corrupt images, invalid UTF-8, empty text files, and oversized inputs show specific errors.
- Selection cancellation is silent.
- Attachment processing failure does not mutate pending attachments or database records.
- Database failure rolls back messages and attachments together.
- A provider rejection preserves the sent user message and attachments and marks the assistant response failed.
- Restore rejects missing attachment references, unsupported formats, and invalid attachment records atomically.
- Cloud backups over 100 MB fail without replacing the previous valid backup.

## Testing

Automated coverage includes:

- Image type, dimensions, compression target, count, and total-size limits.
- Text extension, MIME type, UTF-8, empty-file, and 200 KB limits.
- Direct and proxy browser transport behavior for larger request bodies.
- Attachment-only messages, atomic persistence, retry reuse, and context trimming.
- OpenAI image and text content-part serialization.
- IndexedDB version 2 storage, lookup, and cascade deletion.
- SQLite migration 2, lookup, atomic writes, and cascade deletion.
- Local backup V1 compatibility, V2 export/import, and ID remapping.
- Cloud backup V1 compatibility, V2 encryption/restore, and ID remapping.
- Composer selection, preview, removal, processing, rendering, and modal behavior.
- PHP and Nginx backup-size handling.

Manual visual validation uses mobile viewports and checks that pending attachment rows, thumbnails, long file names, error messages, composer height, and bottom navigation do not overlap.

## Acceptance Criteria

1. A user can select gallery images, capture an image, or choose supported text files from the lower-left plus menu.
2. Prepared attachments can be previewed, removed, and sent with or without message text.
3. Images are sent as OpenAI-compatible `image_url` parts and text files as bounded text parts.
4. Sent attachments survive reload, retry, local export/import, cloud backup, and cross-device restore.
5. Conversation deletion removes associated attachments.
6. Old databases and V1 backups continue to work.
7. Invalid or oversized attachments never create partial messages or records.
8. Full automated tests, browser build, PHP tests, and mobile visual checks pass.
