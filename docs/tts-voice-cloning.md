# TTS & Voice Cloning (Lemonade contract)

Source of truth in code: `supportsVoiceCloning()`, `resolveTtsVoice()`,
`getTtsReferenceAudio()`, `ttsFromText()` — all in `src/server.ts`.

## Lemonade's actual contract (verified, not guessed)

- OpenMOSS TTS reads the clone sample from **`reference_wav_b64`** (base64 WAV).
  It **silently ignores** `reference_audio` (a vLLM MOSS-recipe name) — a request
  using the wrong name clones nothing and falls back to the server default.
- OpenMOSS has **no server-side voice registry**: a `voice` value like `"Ava"` is an
  inert hint string. `MOSS-VoiceGen` takes a description via `voice_design_description`,
  not `voice` (used by this extension as `audio-lab.ttsVoiceDescription`, below).
- Kokoro **cannot clone voices** — it only honors the `voice` preset.

## Request matrix (`ttsFromText`)

| Model | State | Request carries |
|---|---|---|
| MOSS | `ttsRefVoice` set | `reference_wav_b64` only — `voice` omitted |
| MOSS | no reference, `ttsVoiceDescription` set | `voice_design_description` (Lemonade designs the voice) |
| MOSS | no reference, no description | neither field (Lemonade default voice) |
| Kokoro | either | `voice: <ttsVoiceKokoro \| "nova">` — reference and description ignored |

Rules: never send `voice` + `reference_wav_b64` together; never send
`voice_design_description` alongside a reference (the reference wins — it is
the more explicit user choice); never read the reference
file for Kokoro (a stale `ttsRefVoice` path must not abort a Kokoro request —
only MOSS aborts on an unreadable reference).

## Settings involved

- `audio-lab.pickedTtsModel` — selected TTS model id (eligibility via `audio-lab.ttsModels`).
- `audio-lab.ttsVoiceKokoro` — Kokoro preset, default `"nova"` (list sourced from
  Lemonade's `TTSSettings.tsx`; link in README).
- `audio-lab.ttsRefVoice` — reference WAV path, set via "Set as Voice Reference"
  on an audio file; cleared via the inline `×` on the picked MOSS row
  (`TTS_PICKED_WITH_REF` context value, see `docs/treeview-commands.md`).
- `audio-lab.ttsVoiceDescription` — free-text voice description for MOSS
  models; sent as `voice_design_description` only when no reference is set.
  The picked MOSS row shows `Voice design: <description>` in that state.
- `audio-lab.ttsFormat` — `wav` | `mp3`, sent as `response_format`.

## Past incident (reference — do not regress)

`ttsFromText` once sent `reference_audio` and dropped `voice` when a reference was
present, so clone requests carried **no voice info at all** → inconsistent server-default
output. Fixed by the `reference_wav_b64` rename. Any rename of these fields must be
verified against Lemonade's server code, not other servers' recipes.

## Lemonade app voice modes: Plain / Describe / Clone (verified 2026-11-05)

The Lemonade desktop app's TTS composer has three voice modes for OpenMOSS
models. All three POST to the **same** endpoint (`/api/v1/audio/speech`, via the
app's `textToSpeech` in `src/app/src/api.ts`); they differ only in which model
is called, with which fields, and how many times. The app's single text box
changes meaning per mode (verified in `src/app/src/components/ChatView.tsx`).

| Mode | Requests | What the text box is |
|---|---|---|
| **Plain** | 1 call: `{model: TTS, input, voice: <style>}` | "Voice style" — a style instruction (e.g. "cheerful, whispering"), sent as `voice`. Steers delivery of the model's default voice; not a voice identity. |
| **Describe** | 2 calls: (1) `{model: MOSS-VoiceGen, input: "Hello there. This is a short sample of the voice you described.", voice: <description>}` → sample WAV; (2) `{model: TTS, input, reference_wav_b64: <sample>}` | "Voice description" (e.g. "warm low female voice, British accent"). |
| **Clone** | 1 call: `{model: TTS, input, reference_wav_b64: <attached WAV>, voice: <style note, optional>}` | "Style note" only — the real input is the paperclip-attached WAV. |

Key facts:

- **Describe is not a duplicate of Clone.** Both converge on a final
  `reference_wav_b64` request, but the reference's source differs: Clone uses a
  WAV the user already has (a real recording); Describe *manufactures* the
  reference from words via VoiceGen, for when no recording exists.
- **Server-side shortcut:** sending `voice_design_description` directly on a
  speech request to a clone-capable model makes Lemonade render the sample and
  use it as the reference internally — one call instead of the app's two. Per
  the route docs (`audio_speech.cpp`): "Only this field triggers design;
  `voice` never does." (When the target model *is* VoiceGen itself, the app
  passes the description in `voice` instead.)
- **Extension coverage today:** Clone is implemented (`ttsRefVoice`); Describe
  is implemented (`ttsVoiceDescription` → `voice_design_description`, only
  when no reference is set); a Plain style instruction for MOSS is not
  exposed (this extension omits `voice` for MOSS — see request matrix).
