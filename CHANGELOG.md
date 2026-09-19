# Change Log
All notable changes to the "Audio Lab" extension will be documented in this file.\
Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]
- Queue/transcribing
- Summary/describing the audio
- TTS
- WebSocket log

## [0.0.3] - 2026-09-19
- `audio-lab.subtitleFormat` config option (`srt` / `vtt`)
- "Create Subtitles" tree view context menu and command palette action
- "Delete" context menu for audio and subtitle items (moves to trash with confirmation)
- "Transcribe Audio From File Chooser" and "Create Subtitles From File Chooser" commands (work with no folder open)
- Server URL normalization and `http(s)`-only validation
- Session-only model pick when no workspace is open (workspace settings left untouched)
- Show/hide unrelated models inline toggle (eye / eye-closed) on the Available Models header
- Stale picked model is cleared when the server no longer offers it
- Tree view "Audio & Subtitles" group lists subtitle files (`.srt`, `.vtt`) alongside audio files
- Unicode transcript titles preserved (only file-system/URI-unsafe characters are replaced)
- webpack 5.111.1 compiled successfully in 1229 ms
- 9 files, 52.34 KB, 1.138.0
```
audio-lab-0.0.3.vsix
├─ [Content_Types].xml
├─ extension.vsixmanifest
└─ extension/
   ├─ LICENSE.txt [1.06 KB]
   ├─ changelog.md [3.28 KB]
   ├─ package.json [7.36 KB]
   ├─ readme.md [3.93 KB]
   ├─ dist/
   │  └─ extension.js [19.71 KB]
   └─ media/
      ├─ audio-lab-icon.svg [2.82 KB]
      └─ audio-lab.png [37.38 KB]
```

### Notes
- Platform: Windows-only development; other OSes may work but are untested.
- Lemonade: Tested against an external server only

## [0.0.2] - 2026-08-18
- Improved tree view
- Added support for other transcription models
- Added a spinning indicator
- Added an activity badge
- Added the `audio-lab.transcriptionModels` config
- webpack 5.109.2 compiled successfully in 2788 ms
- 9 files, 49.74 KB, 1.133.0, req1.125.0
```
audio-lab-0.0.2.vsix
├─ [Content_Types].xml
├─ extension.vsixmanifest
└─ extension/
   ├─ LICENSE.txt [1.06 KB]
   ├─ changelog.md [1.84 KB]
   ├─ package.json [5.14 KB]
   ├─ readme.md [4.09 KB]
   ├─ dist/
   │  └─ extension.js [12.87 KB]
   └─ media/
      ├─ audio-lab-icon.svg [2.82 KB]
      └─ audio-lab.png [37.38 KB]
```

### Notes
- `audio-lab.transcriptionModels` was added because Moonshine models only allow RIFF/WAV files. Even when a WAV file is used, no text is returned yet, so more research is needed.

## [0.0.1] - 2026-08-01
- Treeview showing Lemonade server status, the list of installed models, and the audio files in the workspace
- Transcribe audio files
- Initial release
- webpack 5.109.2 compiled successfully in 1078 ms
- 9 files, 48.79 KB, 1.131.0, req1.125.0
```
audio-lab-0.0.1.vsix
├─ [Content_Types].xml
├─ extension.vsixmanifest
└─ extension/
   ├─ LICENSE.txt [1.06 KB]
   ├─ changelog.md [1.02 KB]
   ├─ package.json [4.64 KB]
   ├─ readme.md [3.22 KB]
   ├─ dist/
   │  └─ extension.js [14.91 KB]
   └─ media/
      ├─ audio-lab-icon.svg [2.82 KB]
      └─ audio-lab.png [37.38 KB]
```
