# Architecture

Audio Lab is a thin VS Code client over a local Lemonade server
(default `http://localhost:13305`, setting `audio-lab.lemonadeServerUrl`).
No local ML, no bundling of models — every heavy call is `fetch()` in `src/server.ts`.

## Data flow

```
User action (tree click / context menu / palette / editor menu)
  → command handler in src/extension.ts
    → src/server.ts (HTTP to Lemonade) + src/utils.ts (helpers)
      → LemonadeTreeDataProvider.refreshStatus()/refreshTree() re-renders
```

- Extension host state lives in the `LemonadeTreeDataProvider` singleton
  (`src/treeview.ts`, `createOrGet()`). Persisted picks live in VS Code settings;
  session-only fallbacks (`sessionPickedSttModel`/`sessionPickedTtsModel`) cover
  the no-workspace-folder case — see `saveAudioLabSetting()` in `src/utils.ts`.
- Server "status" has no `isRunning` flag by design: `getLemonadeStatus()` resolves
  only on a successful `GET /v1/models`; a dead server surfaces as a rejected promise.
- Lemonade model objects are typed in `src/types.ts` (`LemonadeModel`, `LemonadeStatus`).

## Key invariants (do not break)

1. `AUDIO_EXTENSIONS` (`src/utils.ts`) is the single source of truth for pickers,
   validation (`isAudioFile`/`resolveAudioTarget`), and the Media Files tree.
2. Tree items carry paths via `AudioLabTreeItem.fullPath`, never via tooltip text
   (tooltips change; commands receive the item object).
3. Capability checks read model **`labels`** (`hasTransCapability`/`hasTtsCapability`,
   `isAllowedTransModel`/`isAllowedTtsModel`) — not id substrings. Exception: voice
   cloning is an id check (`supportsVoiceCloning`), because Lemonade exposes no
   "cloning" label; see `docs/tts-voice-cloning.md`.
4. Settings writes go through `saveAudioLabSetting()` (`pickedSttModel` /
   `pickedTtsModel` / `lemonadeServerUrl`) or the inspect-based update in
   `setTtsRefVoice()` (`ttsRefVoice`). Any other direct
   `getConfiguration('audio-lab').update(...)` call is a bug.
5. `npx tsc --noEmit` must pass; `package.json` must re-parse after edits.
