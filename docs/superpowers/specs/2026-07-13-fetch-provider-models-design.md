# Fetch Provider Models Design

**Date:** 2026-07-13

## Goal

Add a dedicated model-list action to the existing provider form. It requests the OpenAI-compatible `/models` endpoint using the current unsaved form values and updates the model selector without persisting the provider.

## User Experience

- Add a `获取模型列表` button beside the existing `测试连接` action.
- While loading, show `获取中...` and disable provider save, connection test, and repeated model-list requests.
- On success, replace the form's `modelsCache` with the returned model identifiers.
- Preserve the current `defaultModel` when it is non-empty, even if it is not returned by `/models`.
- When `defaultModel` is empty, select the first returned model.
- Show `已获取 N 个模型` after success.
- On failure, keep all form values unchanged and display the normalized request error.

## Persistence Rules

- Fetching models must not call `saveProvider` or write provider changes to IndexedDB.
- A new provider uses the API key currently entered in the form.
- An existing provider with a non-empty form key uses that temporary key.
- An existing provider whose key field is blank reuses the previously encrypted key by decrypting it only for the request.
- The plaintext key must not be returned to the page, logged, exported, or persisted.

## Architecture

### ProviderService

Add `fetchModels(form)`:

1. Validate and normalize the current base URL.
2. Resolve the request key from the form or the existing encrypted provider record.
3. Build a temporary OpenAI-compatible request profile.
4. Call `provider.listModels(profile)`.
5. Return only the model identifier array.

This method performs no repository writes.

### Provider Page

Add `providerLoadingModels` state and include it in `providerBusy`. The click handler calls `providerService.fetchModels(providerForm)`, updates `providerForm.modelsCache`, optionally chooses the first model when no default exists, and reports success or failure through the existing toast/error surfaces.

### Protocol Boundary

The UI continues to depend on `ProviderService`, not directly on `OpenAIProvider` or browser transport. Future provider protocols can implement equivalent model discovery behind the same service boundary.

## Error Handling

- Missing or malformed base URLs use the existing URL validation messages.
- Missing saved providers or key-decryption failures surface through the existing error banner.
- HTTP and authentication failures retain the current form and model cache.
- An empty model response is a valid success with `0` models and does not clear a non-empty default model.

## Testing

- ProviderService unit tests verify unsaved form values are sent without repository writes.
- Unit tests verify blank edit keys reuse the encrypted stored key.
- Unit tests verify a temporary entered key overrides the stored key.
- UI-state tests cover first-model selection only when the default is empty.
- Playwright verifies the new button loads mock models, preserves unsaved fields, updates the dropdown, and does not alter layout or produce console errors at 390 x 844.

## Out Of Scope

- Automatically saving the provider.
- Changing the existing connection-test behavior.
- Adding protocol-specific endpoint fields.
- Android, PHP, MySQL, or cloud-sync changes.
