# Character Card Import POC

Date: 2026-07-16

## Result

- `@risuai/ccardlib` 0.4.2 builds in the browser Vite pipeline and HBuilderX 5.15 App pipeline.
- The real `src/苏墨.png` fixture is a valid 1,658,836-byte PNG with `chara` and `ccv3` tEXt chunks.
- `ccv3` is selected before `chara`.
- The fixture normalizes to Character Card V3 and retains all 8 embedded lorebook entries and its alternate greeting.
- Character metadata is removed from the display-avatar PNG without re-encoding the image.
- Script-like extensions such as `regex_scripts` are detected, retained as inert data, and require import confirmation.

## Compatibility Finding

The real fixture declares `chara_card_v3`, but also carries V1 compatibility fields at the JSON root. Calling `CCardLib.character.check()` directly classifies it as V1 and a blind V1-to-V3 conversion drops the lorebook. The importer therefore:

1. trusts an internally consistent explicit `spec` and `spec_version` before heuristic detection;
2. removes root compatibility mirrors from the canonical validation input;
3. fills spec defaults required by the library, including lorebook `extensions`;
4. passes the explicit source version to conversion; and
5. rejects conversion if lorebook, greeting, or asset counts decrease.

## Automated Coverage

- Real hybrid V3 fixture.
- Synthetic Tavern V1, Character Card V2, and Character Card V3.
- Numeric `character_version` normalization.
- `ccv3` priority and conflicting duplicate metadata.
- Embedded `chara-ext-asset_*` extraction.
- PNG signature, chunk boundaries, CRC, IEND, tEXt separator, Base64, UTF-8, and JSON validation.

RCC, legacy RisuAI binary blocks, iTXt, and zTXt remain outside the confirmed MVP scope.
