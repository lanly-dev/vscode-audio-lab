# Tree View & Commands

Source of truth: `src/extension.ts` (registration), `src/treeview.ts` (rows),
`package.json` → `contributes.views`, `commands`, `menus`, `configuration`.

## View layout (`AUDIO_LAB_DASHBOARD`)

```
Lemonade Server Status
├─ <server URL>
├─ Status: ● Running
├─ Installed Models (n)
│  ├─ STT / Subgen  — selectable rows (click = pickModel)
│  ├─ TTS           — selectable rows (click = pickTtsModel)
│  └─ Other (hidden unless eye-toggle; shows non-STT/TTS models, display-only)
└─ Media Files (workspace audio + srt/vtt + txt)
```

## Command naming convention

| Prefix | Meaning | Example |
|---|---|---|
| `audio-lab.internal.*` | invoked programmatically from tree clicks, not menus | `internal.pickModel` |
| `audio-lab.ncp.*` | **n**o **c**ommand **p**alette — tree/editor context menus only | `ncp.transcribeAudioItem` |
| `audio-lab.*` | palette-visible user commands | `audio-lab.changeServerUrl` |

When adding a command: register in `extension.ts`, declare in `package.json`
`commands` + place in `menus`, and hide `ncp.*`/`internal.*` from the palette via
`menus.commandPalette` (`"when": "false"`).

## `contextValue`s on tree rows (menu `when` clauses)

- `AUDIO_ITEM` / `SUBTITLE_ITEM` / `TEXT_ITEM` — Media Files rows.
- `TTS_PICKED_WITH_REF` — picked TTS row, **only** when the model supports cloning
  (`supportsVoiceCloning()`) **and** `ttsRefVoice` is set. Owns the inline clear-`×`
  (`clearVoiceRefItem`, `group: inline`). A picked row with no reference carries no
  context value → no context menu at all.
- `setVoiceRefItem` stays on `AUDIO_ITEM` rows (that's where a sample is chosen from).

## Gotchas

- "Set as Voice Reference" must be reachable with **no workspace folder open** —
  `saveAudioLabSetting()` degrades to session-only instead of erroring.
- After any mutation (pick model, set/clear reference, delete file), call
  `refreshStatus()` or `refreshTree()` — the view never updates itself.
- `onDidChangeConfiguration` for `audio-lab.*` triggers `refreshStatus()`.
