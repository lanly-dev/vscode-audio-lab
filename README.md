# Audio Lab Extension
Transform audio into text seamlessly with [Lemonade🍋](https://lemonade-server.ai), all within your VS Code IDE.
<a href="https://marketplace.visualstudio.com/items?itemName=lanly-dev.audio-lab" target="_blank">
  <img src='https://code.visualstudio.com/favicon.ico' width='10'/>
</a>
<a href="https://open-vsx.org/extension/lanly-dev/audio-lab" target="_blank">
  <img src='https://open-vsx.org/favicon.ico' width='10'/>
</a>

## Intro
Audio Lab seamlessly integrates transcription into your development workflow. Transcribe audio files directly from VS Code, eliminating the need to switch context and simplifying the whole process.

<img src='https://github.com/lanly-dev/vscode-audio-lab/blob/main/media/screenshot.gif?raw=true'>

## Key Features
- **Seamless IDE Integration**: Transcribe audio without leaving your coding environment.
- **Lemonade Server Powered**: Built on the powerful Lemonade server for fast, reliable transcription.
- **Configurable Transcription Models**: Control which Lemonade models are eligible for transcription through a settings allowlist (Whisper models are enabled by default).
- **Intuitive Tree View**: Browse audio and subtitle files plus server status with ease.
- **Subtitle Generation**: Create SRT or VTT subtitle files from audio directly in VS Code.
- **Text-to-Speech (TTS)**: Synthesize text (editor selection or input box) to audio via Lemonade `POST /v1/audio/speech`, with a dedicated `Tts` tree section (kokoro-v1, MOSS-TTS-Local, MOSS-VoiceGen, OpenMOSS-TTS).

## Supported Audio Formats
MP3, WAV, OGG, M4A, FLAC, AAC, WMA, WebM, Opus, AMR, AU, AIFF

Subtitle files (SRT, VTT) are listed in the tree view next to their audio file, for reference.

## Extension Settings
- `audio-lab.lemonadeServerUrl`: URL of the running Lemonade server. Default: `http://localhost:13305`. Changing it via the command requires an open workspace folder, because the value is stored in workspace settings.
- `audio-lab.pickedModel`: Currently selected transcription model ID. Default: `null`
- `audio-lab.transcriptionModels`: Which models are eligible for transcription. This is a list of model-id substrings (case-insensitive). A model is selectable if it is transcription-capable and its ID matches an entry. Default: `["whisper"]`, so Whisper models are selectable while others (for example, `moonshine`) are filtered out. Add an ID or substring to allow more models; an empty list shows no selectable models.
- `audio-lab.ttsModels`: Which models are eligible for TTS. Default: `["kokoro", "moss", "tts", "voicegen"]`, so `kokoro-v1`, `MOSS-TTS-Local`, `MOSS-VoiceGen`, `OpenMOSS-TTS` show under `Installed Models > TTS`.
- `audio-lab.pickedTtsModel`: Currently selected TTS model ID. Default: `null`
- `audio-lab.ttsVoice`: Voice for TTS (`voice` field). Default: `"coral"`
- `audio-lab.ttsFormat`: Audio format for generated speech (`wav` or `mp3`). Default: `"wav"`
- `audio-lab.subtitleFormat`: Subtitle format to use when creating subtitles from audio. `"srt"` (default) is the widely supported SubRip format; `"vtt"` is WebVTT for web playback.

## Tree View Structure
```txt
AudioLab (Activity Bar)
└─Lemonade Server Status
  ├─https://your-server-url     [Server URL]
  ├─Status: ● Running           [Server status indicator]
  ├─Installed Models (5)
  │ ├─STT / Subgen (3)
  │ │ ├─whisper-large-v3t       [Selected - green dot]
  │ │ ├─whisper-large-v3        [Selectable - click to select]
  │ │ └─whisper-tiny            [Selectable - click to select]
  │ ├─TTS (1)
  │ │ └─kokoro-v1               [Selectable - click to select]
  │ └─Other (1)                 [Hidden by default - eye toggle on the header]
  │   └─z-image-turbo           [Displayed only - not STT/TTS capable]
  └─Audio & Subtitles
    ├─dir1/
    │ ├─demo.mp3
    │ ├─recording.wav
    │ └─recording.srt           [Subtitle file - display only]
    ├─dir2/
    │ └─interview.m4a
   ...
```

## Requirements
- Lemonade must be installed and running.
- You need transcription-capable models downloaded in Lemonade, IMO: Whisper-Large-v3-Turbo was the only on that work well

## Release Notes
### 0.0.3
- Show subtitle files (SRT, VTT) in the treeview
- Add inline button to toggle viewing of unrelated models
- Add Delete context-menu option
- Add Create Subtitles feature
- Fix Unicode file-name handling in transcript titles

### 0.0.2
- Improve treeview
- Add support for other transcription models labeled by Lemonade
- Add an Activity Bar badge
- Add the `audio-lab.transcriptionModels` setting to control which models are selectable for transcription

### 0.0.1
- Transcribe audio using Lemonade Server
- Initial release of the extension

**Enjoy!**
