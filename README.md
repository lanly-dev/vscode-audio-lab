# Audio Lab Extension
Transform audio into text seamlessly with [Lemonade🍋](https://lemonade-server.ai), all within your VS Code IDE.
<a href="https://marketplace.visualstudio.com/items?itemName=lanly-dev.audio-lab" target="_blank">
  <img src='https://code.visualstudio.com/favicon.ico' width='13'/>
</a>
<a href="https://open-vsx.org/extension/lanly-dev/audio-lab" target="_blank">
  <img src='https://open-vsx.org/favicon.ico' width='12'/>
</a>

## Intro
Audio Lab seamlessly integrates transcription into your development workflow. Transcribe audio files directly from VS Code, eliminating the need to switch context and simplifying the whole process.

<img src='https://github.com/lanly-dev/vscode-audio-lab/blob/main/media/screenshot.gif?raw=true'>

## Key Features
- **Seamless IDE Integration**: Transcribe audio without leaving your coding environment.
- **Lemonade Server Powered**: Built on the powerful Lemonade server for fast, reliable transcription.
- **Configurable Transcription Models**: Control which Lemonade models are eligible for transcription through a settings allowlist (Whisper models are enabled by default).
- **Intuitive Tree View**: Browse audio files and server status with ease.

## Quick Start

### 1. Configure the Server URL
Set your Lemonade server URL in VS Code settings:
```json
{
  "audio-lab.lemonadeServerUrl": "http://localhost:13305"
}
```
Or use the Command Palette:
1. `Ctrl+Shift+P` → **AudioLab: Change Lemonade Server URL**
2. Enter your server URL

### 2. Open the Audio Lab View
Click the **AudioLab** icon in the Activity Bar.

### 3. Select a Model
- Expand the **Available Models** section.
- Click any transcription model that is downloaded or installed in Lemonade to select it for transcription. If a model is not included by default, configure `audio-lab.transcriptionModels` to allow it.
- Note: Selected models appear with a green dot indicator.

### 4. Transcribe an Audio File
**From the tree view:**
1. Expand **Audio Files** and navigate to the folder you want.
2. Right-click (or use the action) on any audio file.
3. Select **Transcribe Audio**.

**From the file picker:**
1. `Ctrl+Shift+P` → **AudioLab: Transcribe Audio From File Chooser**
2. Select an audio file.

### 5. View Results
The transcription opens in a new editor tab once processing is complete.

## Supported Audio Formats
MP3, WAV, OGG, M4A, FLAC, AAC, WMA, WebM, Opus, AMR, AU, AIFF

## Extension Settings
- `audio-lab.lemonadeServerUrl`: URL of the running Lemonade server. Default: `http://localhost:13305`
- `audio-lab.pickedModel`: Currently selected transcription model ID. Default: `null`
- `audio-lab.transcriptionModels`: Which models are eligible for transcription. This is a list of model-id substrings (case-insensitive). A model is selectable if it is transcription-capable and its ID matches an entry. Default: `["whisper"]`, so Whisper models are selectable while others (for example, `moonshine`) are filtered out. Add an ID or substring to allow more models; an empty list shows no selectable models.

## Tree View Structure
```txt
AudioLab (Activity Bar)
└─Lemonade Server Status
  ├─https://your-server-url     [Server URL]
  ├─Status: ● Running           [Server status indicator]
  ├─Available Models (5)
  │ ├─whisper-large-v3t         [Selected - green dot]
  │ ├─whisper-large-v3          [Selectable - click to select]
  │ ├─whisper-tiny              [Selectable - click to select]
  │ └─z-image-turbo             [Displayed only - not transcription-capable]
  └─Audio Files
    ├─dir1/
    │ ├─demo.mp3
    │ └─recording.wav
    ├─dir2/
    │ └─interview.m4a
   ...
```

## Requirements
- Lemonade must be installed and running.
- You need transcription-capable models downloaded in Lemonade.

## Release Notes

### 0.0.2
- Improved treeview
- Added support for other transcription models labeled by Lemonade
- Added an Activity Bar badge
- Added the `audio-lab.transcriptionModels` setting to control which models are selectable for transcription

### 0.0.1
- Transcribe audio using Lemonade Server
- Initial release of the extension

**Enjoy!**
