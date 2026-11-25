# audiolab-recorder

Tiny cross-platform microphone recorder bundled with Audio Lab. It replaces
the old ffmpeg dependency (previously gated on the Easy Media Converter
extension, which never actually supplied an ffmpeg binary to spawn).

- One C file (`recorder.c`, ~130 lines) on top of **miniaudio 0.11.22**
  (vendored `miniaudio.h`, public domain / MIT-0 — see the license block at
  the end of the header). Backends come from miniaudio: WASAPI (Windows),
  CoreAudio (macOS), ALSA/PulseAudio (Linux, loaded dynamically at runtime).
- Output: 16 kHz, mono, 16-bit WAV — the shape the voice-reference flow wants.
  The WAV is written by hand (fixed 44-byte PCM header): in miniaudio
  0.11.22 the WAV *encoder* backend sits under the decoding gate, so
  `MA_NO_DECODING` silently removes it — writing the one fixed format
  directly keeps every size trim on.
- CLI contract: `audiolab-recorder <output.wav> [seconds]` (default 10 s,
  clamped to 1..3600). Exit 0 on success; errors on stderr, non-zero exit.

## Build

Per-platform binaries land in `../bin/<platform>-<arch>/` — build
intermediates only (gitignored). The build scripts then run `pack.mjs`,
which combines every built platform into ONE tracked file,
`../bin/audiolab-recorder-all`, and that is what ships in the extension
package (this `native/` folder itself is excluded via `.vscodeignore`).
At runtime the extension reads the bundle's index, extracts its own
platform's binary into global storage (named by a hash of its bytes),
marks it executable, and runs it.

- Linux / macOS: `./build.sh` (any C compiler; no other dependencies)
- Windows: `build.bat` from a Visual Studio Developer Command Prompt
- Re-pack without rebuilding: `node pack.mjs` — it lists exactly which
  platforms went in and skips any that have not been built yet.

Bundle layout (little-endian): magic `ALREC1`, u32 version, u32 entry
count, then per entry a u16 key length, the key (`win32-x64`,
`darwin-x64`, `darwin-arm64`, `linux-x64`), u32 payload offset and u32
payload length, then the payloads concatenated.

## Test without a microphone

Compile with `-DRECORDER_FORCE_NULL_BACKEND` to capture from miniaudio's
null backend (silence). The full pipeline — device, callback, WAV encoder —
runs unchanged, so the output file can be validated (format, sample rate,
duration) on machines with no capture hardware.
