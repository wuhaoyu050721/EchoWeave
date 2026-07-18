# Chat Reference Redesign Design

**Date:** 2026-07-13

## Goal

Redesign the existing mobile chat screen to match the supplied reference while preserving the working chat lifecycle. Add a multifunction attachment entry to the lower-left plus button without implementing attachment upload in this phase.

## Reference

- Source image: `C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-59c4e504-48fb-42df-814b-69573ce67d89.png`
- Target viewport: 390 x 844.
- The implementation should reproduce the reference hierarchy, spacing, message-card treatment, composer framing, and compact mobile rhythm while retaining the app's existing monochrome and green provider branding.

## Chat Toolbar

- Keep the left menu action for returning to conversations.
- Display `provider name · model name` as the dominant toolbar label and keep it selectable.
- Replace the current security shortcut with a history icon matching the reference hierarchy.
- Keep the existing conversation-management menu on the far right.
- The history action is visual-only in this phase and shows a short toast when tapped.

## Message Layout

### User Messages

- Align to the right in a pale cool-gray bubble with generous horizontal padding.
- Place the timestamp on the lower-right line.
- Show a blue double-check icon beside the timestamp when `message.status === 'completed'`.
- Reuse the current user-message `completed` state as the read indicator. No new database field or migration is required.
- A later assistant failure does not remove the double check because the user content was already submitted successfully.

### Assistant Messages

- Keep the provider avatar to the left and enlarge it slightly to match the reference.
- Render content inside a white bordered card with a soft shadow and larger internal spacing.
- Place copy, approval, and disapproval actions at the lower-left.
- Place the assistant timestamp at the lower-right.
- Keep retry available for completed and non-completed responses.
- During generation, show animated green dots inside the card and retain a clear stop-generation action.

## Composer

- Wrap the composer in one rounded bordered surface above the gesture handle.
- Use a rounded-square plus button on the left, a soft inset text field in the center, and a solid indigo send/stop button on the right.
- Preserve Enter-to-send, disabled state, stop generation, and new-conversation behavior outside the plus button.
- The plus button no longer creates a conversation; it toggles the attachment menu.

## Attachment Entry

- Open a compact popover above the lower-left plus button.
- Show three icon actions: `图片`, `拍照`, and `文件`.
- Selecting an action closes the menu and shows `将在后续版本支持`.
- Clicking outside the popover closes it.
- Do not open a file picker, read local files, create attachment records, modify messages, modify backups, or change model request payloads in this phase.

## State And Accessibility

- Add `attachmentMenuOpen` to page-local UI state.
- Close the menu when navigating away from chat, opening the model menu, sending, or starting a new conversation.
- Give the plus button `aria-label="添加附件"` and each menu action a clear accessible name.
- Keep stable dimensions so opening the menu does not move the composer or message list.

## Architecture

- Keep the redesign inside `pages/index/index.vue`; no protocol, repository, encryption, backup, or service changes are needed.
- Add a pure UI helper only if tests need stable read-receipt or attachment-action behavior outside the component.
- Continue using the existing Lucide icon library already installed by the project.

## Error And Edge States

- Empty chats retain the existing empty state but use the redesigned spacing.
- Long provider/model names truncate without moving toolbar actions.
- Long user and assistant content wraps without horizontal scrolling.
- The attachment popover stays within the 390 px frame and remains above the composer.
- Streaming, cancelled, interrupted, and failed assistant states keep their existing behavior and are restyled to fit the new card.

## Testing And Visual QA

- Add UI-state tests for completed user-message read receipts and attachment actions when represented by pure helpers.
- Run the complete unit suite and production build.
- Use Playwright at 390 x 844 to verify message rendering, double checks, attachment-menu open/close actions, send, streaming, stop, retry visibility, and console health.
- Capture the redesigned chat screen and compare it with the supplied reference.
- Fix P0, P1, and P2 visual differences before handoff; document remaining P3 differences in `design-qa.md`.

## Out Of Scope

- Real image, camera, or file selection.
- Attachment storage, encryption, backup, synchronization, or upload.
- Multimodal OpenAI request payloads.
- Remote delivery/read receipts.
- Android, PHP, MySQL, or cloud-sync changes.
