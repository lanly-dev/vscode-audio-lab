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
  inline `×` on the picked cloning-capable TTS row (`TTS_PICKED_WITH_REF`, `group:
  inline`). Rationale: clearing acts on the TTS selection, not on a file; inline
  keeps it visible exactly when meaningful.
- 2026-10-16 · Compound setup: added `AGENTS.md` (pointer map + Plan→Work→Review→
  Compound loop) and `docs/` (`architecture`, `tts-voice-cloning`,
  `treeview-commands`, this log). Convention going forward: every behavior change
  appends here and updates the touched doc.
