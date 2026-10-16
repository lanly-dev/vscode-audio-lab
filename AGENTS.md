# AGENTS.md — Audio Lab (`lanly-dev.audio-lab`)

VS Code extension: transcribe audio / generate subtitles / text-to-speech via a
local [Lemonade server](https://lemonade-server.ai) (`http://localhost:13305`).

## Layout

- `src/extension.ts` — activation, command registration (single place).
- `src/server.ts` — Lemonade HTTP calls: `getLemonadeStatus`, `transcribeAudio`,
  `createSubtitles`, `ttsFromText`, `supportsVoiceCloning`, `resolveTtsVoice`.
- `src/treeview.ts` — `LemonadeTreeDataProvider` (singleton), all tree rows.
- `src/treeItem.ts` — `AudioLabTreeItem`: carries `fullPath` (never tooltip).
- `src/utils.ts` — shared helpers; `AUDIO_EXTENSIONS` is the single source of truth.
- `src/types.ts` — Lemonade API shapes. `package.json` — contributes, settings, menus.

## Workflow (every change)

1. **Plan** — read the relevant doc in `docs/` first, state which files change.
2. **Work** — implement; run `npm run verify` (tsc + eslint + package.json parse).
3. **Review** — re-read your own diff; fill in the PR template checklist
   (`.github/pull_request_template.md`).
4. **Compound** — append to `docs/decisions.md`; update the touched doc if behavior changed.
   A change without a compound step is incomplete.

## Rules

- Commands: `audio-lab.ncp.*` = tree/editor context only (hidden from palette via
  `"when": "false"` in `menus.commandPalette`); `audio-lab.*` = palette-visible.
  Keep this split — see `docs/treeview-commands.md`.
- Settings writes: `saveAudioLabSetting()` (`src/utils.ts`) covers
  `pickedSttModel`/`pickedTtsModel`/`lemonadeServerUrl`; `ttsRefVoice` persists via
  its own inspect-then-update in `treeview.ts:setTtsRefVoice` (workspaceFolder →
  workspace → global). Both degrade gracefully with no folder open — never write
  config blindly.
- TTS request fields: MOSS clones via `reference_wav_b64` (base64); Kokoro sends only
  `voice`. Never send both, never invent field names — see `docs/tts-voice-cloning.md`.
- Paths on tree items travel via `AudioLabTreeItem.fullPath`, not tooltips/labels.
- Capability checks read model `labels` (`hasTransCapability`/`hasTtsCapability`),
  never model-id substrings — except cloning, which is an id check by design.

## Docs (evergreen — keep current)

- `docs/architecture.md` — data flow, settings, key invariants.
- `docs/tts-voice-cloning.md` — Lemonade TTS contract, request matrix.
- `docs/treeview-commands.md` — command naming, menus, `contextValue`s.
- `docs/decisions.md` — append-only log; newest at bottom.
- `README.md` = user docs; `DEV.md` = scratch notes. Don't duplicate either here.
