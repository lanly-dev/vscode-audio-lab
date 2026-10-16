# TTS & Voice Cloning (Lemonade contract)

Source of truth in code: `supportsVoiceCloning()`, `resolveTtsVoice()`,
`getTtsReferenceAudio()`, `ttsFromText()` — all in `src/server.ts`.

## Lemonade's actual contract (verified, not guessed)

- OpenMOSS TTS reads the clone sample from **`reference_wav_b64`** (base64 WAV).
  It **silently ignores** `reference_audio` (a vLLM MOSS-recipe name) — a request
  using the wrong name clones nothing and falls back to the server default.
- OpenMOSS has **no server-side voice registry**: a `voice` value like `"Ava"` is an
  inert hint string. `MOSS-VoiceGen` takes a description via `voice_design_description`,
  not `voice` (not currently used by this extension).
- Kokoro **cannot clone voices** — it only honors the `voice` preset.

## Request matrix (`ttsFromText`)

| Model | `ttsRefVoice` set | Request carries |
|---|---|---|
| MOSS | yes | `reference_wav_b64` only — `voice` omitted |
| MOSS | no | neither field (Lemonade default voice) |
| Kokoro | either | `voice: <ttsVoiceKokoro \| "nova">` — reference ignored |

Rules: never send `voice` + `reference_wav_b64` together; never read the reference
file for Kokoro (a stale `ttsRefVoice` path must not abort a Kokoro request —
only MOSS aborts on an unreadable reference).

## Settings involved

- `audio-lab.pickedTtsModel` — selected TTS model id (eligibility via `audio-lab.ttsModels`).
- `audio-lab.ttsVoiceKokoro` — Kokoro preset, default `"nova"` (list sourced from
  Lemonade's `TTSSettings.tsx`; link in README).
- `audio-lab.ttsRefVoice` — reference WAV path, set via "Set as Voice Reference"
  on an audio file; cleared via the inline `×` on the picked MOSS row
  (`TTS_PICKED_WITH_REF` context value, see `docs/treeview-commands.md`).
- `audio-lab.ttsFormat` — `wav` | `mp3`, sent as `response_format`.

## Past incident (reference — do not regress)

`ttsFromText` once sent `reference_audio` and dropped `voice` when a reference was
present, so clone requests carried **no voice info at all** → inconsistent server-default
output. Fixed by the `reference_wav_b64` rename. Any rename of these fields must be
verified against Lemonade's server code, not other servers' recipes.
