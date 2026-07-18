# Remove Fake Status Bar Design

**Date:** 2026-07-13

## Goal

Remove the browser-drawn time, signal, Wi-Fi, and battery row so packaged mobile builds use only the operating system status bar.

## Behavior

- Delete the visible `.status-bar` template and `.status-icons` content.
- Remove the unused `BatteryFull`, `Signal`, and `Wifi` Lucide imports and component registration.
- Remove the fake status-bar CSS height, typography, and icon spacing.
- Keep the chat toolbar, conversation header, provider header, and settings header as the first visible application row.

## Native Safe Area

The page uses `navigationStyle: "custom"`, so removing all top spacing would allow the native status bar to cover application controls. Add invisible top padding to `.app-shell` using:

```css
padding-top: var(--status-bar-height, 0px);
```

In the browser preview the value is 0. In a packaged uni-app build the platform-provided status-bar height keeps the first toolbar below the native status bar without drawing duplicate status content.

## Scope

- No changes to chat, provider, settings, persistence, API, or attachment behavior.
- Keep the bottom gesture-handle preview unchanged in this task.
- Re-capture the 390 x 844 chat screen and confirm the toolbar starts at the top in browser preview with no blank simulated row.

## Verification

- Unit tests and production build pass.
- Browser DOM contains no `.status-bar` or `.status-icons` elements.
- Browser screenshot contains no simulated time, signal, Wi-Fi, or battery row.
- Chat toolbar, composer, attachment popover, and message area remain inside the viewport with no overlap.
