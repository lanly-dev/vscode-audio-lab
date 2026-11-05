# Decisions (append-only — newest at bottom)

Record: date · what · why · alternatives rejected. One entry per meaningful change.

- 2026-10-16 · `reference_audio` → `reference_wav_b64` in `ttsFromText`. Lemonade's
  OpenMOSS server only reads `reference_wav_b64` (verified in its server code + clone
  test); the old name came from vLLM's MOSS recipe and was silently ignored, so clone
  requests carried no voice info. Field names must be verified against Lemonade, not
  other servers.
- 2026-10-16 · Removed `audio-lab.ttsVoiceMoss` entirely (not just its default).
  OpenMOSS has no voice registry, so the `Ava`/`Bella` enum was an inert hint string.
  MOSS rows now show `Default voice` when no reference is set.
- 2026-10-16 · Cloning scoped to MOSS via `supportsVoiceCloning()` (id substring
  `moss` — deliberate exception to the labels-based capability rule). Kokoro ignores
  `ttsRefVoice`, always sends its preset, default aligned to declared `"nova"`
  (code had hardcoded `"coral"`).
- 2026-10-16 · "Clear Voice Reference" moved from the audio-file context menu to an
  inline × on the picked cloning-capable TTS row (`TTS_PICKED_WITH_REF`, `group:`
  inline). Rationale: clearing acts on the TTS selection, not on a file; inline
  keeps it visible exactly when meaningful.
- 2026-10-16 · Compound setup: added `AGENTS.md` (pointer map + Plan→Work→Review→
  Compound loop) and `docs/` (`architecture`, `tts-voice-cloning`,
  `treeview-commands`, this log). Convention going forward: every behavior change
  appends here and updates the touched doc.
- 2026-10-16 · Compound practice: added `.github/pull_request_template.md` (loop
  checklist + test report) and `npm run verify` (`scripts/verify.js`: tsc + eslint
  + package.json parse) so the loop is enforced at PR time, not just documented.
- 2026-10-18 · Restructured src/extension.ts to match the vscode-emc activation
  pattern: module-level provider state (let treeViewProvider), const rc =
  commands.registerCommand shorthand, flat context.subscriptions.push(rc(...), ...)
  registration block grouped by command category (internal / ncp / palette),
  top-level setupTreeview() hook, and deactivate() with explicit return type.
  All 19 commands and the config-change listener are preserved unchanged; no
  behavior change. npm run verify passes clean.
- 2026-10-18 · Added "Create Text File" command (`audio-lab.ncp.createTextFile`) to the Media Files tree view:
  right-click on `MEDIA_HEADER` (workspace root) or a `MEDIA_DIRECTORY` node to create a `.txt` file,
  which is then opened in the editor. Command is `ncp.*` (context menu only, hidden from palette).
  Menu entry uses `viewItem == MEDIA_HEADER || viewItem == MEDIA_DIRECTORY` with group `1_modification@1`.
  Implementation in `src/server.ts` uses `workspace.fs.writeFile` + `workspace.openTextDocument`.
- 2026-10-18 · Added "Rename" command (`audio-lab.ncp.renameMediaFileItem`) to media file tree items:
  right-click on `AUDIO_ITEM`, `AUDIO_ITEM_TRANSCRIBING`, `SUBTITLE_ITEM`, or `TEXT_ITEM` to rename
  a file via `workspace.fs.rename`, then refreshes the tree. Command is `ncp.*` (context menu only,
  hidden from palette). Menu entry uses group `1_modification@6`.
- 2026-10-18 · VS Code's custom `TreeView` API does **not** support inline label
  rename (no `editable` on `TreeItemLabel`, no `onDidChangeLabel` event). The
  pencil-icon rename is not available for extension-provided tree views. The
  working rename path is: right-click media file → **Rename** →
  `window.showInputBox()` → `workspace.fs.rename()` → `refreshTree()`.
- 2026-11-05 · Documented the Lemonade app's three voice modes (Plain / Describe /
  Clone) in `docs/tts-voice-cloning.md`. Verified against Lemonade source
  (`ChatView.tsx`, `api.ts`, `audio_speech.cpp`): all three POST to
  `/v1/audio/speech`; Describe converges on `reference_wav_b64` like Clone but
  with a VoiceGen-generated sample, so it is not a duplicate of Clone — the
  reference source differs. Server-side `voice_design_description` delivers
  Describe in one call. Records the extension's coverage gap: Describe
  unimplemented, cheapest path is that one field in `ttsFromText`.
- 2026-11-05 · Processing group elapsed time. Fixed: the "Processing" group in the
  Dashboard (`AUDIO_LAB_DASHBOARD`) displayed a static elapsed time because
  `getProcessingChildren()` only recomputed `{taskType} {elapsed} elapsed` when the
  tree re-rendered — there was no timer ticking the elapsed time. Added a 1s
  `setInterval` started in `LemonadeTreeDataProvider.setTranscribing()` when the
  first task starts and cleared when the last task ends. Each tick calls
  `refreshProcessingDescriptions()` → fires `onDidChangeTreeData` → `getProcessingChildren()`
  so displayed elapsed times now update every second. Verified with `npm run verify`
  (tsc + eslint + package.json parse). No change to how processing tasks run, only
  to the displayed elapsed time.
