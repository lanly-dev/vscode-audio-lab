import { ProgressLocation, Uri, commands } from 'vscode'
import { workspace, window } from 'vscode'
import fs from 'fs'
import path from 'path'

import { LemonadeModel, LemonadeStatus } from './types'
import {
  formatSrt,
  formatVtt,
  getServerUrl,
  resolveAudioTarget,
  saveAudioLabSetting,
  saveSubtitleFile,
  showTheTranscript,
  SubtitleSegment
} from './utils'
import LemonadeTreeDataProvider from './treeview'

// Function to get Lemonade server status and available models
export async function getLemonadeStatus(): Promise<LemonadeStatus> {
  const serverUrl = getServerUrl()
  try {
    let models: LemonadeModel[] = []
    const modelsResponse = await fetch(`${serverUrl}/v1/models`)

    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json()
      models = modelsData.data || []
    } else throw new Error(`Failed to fetch models: Server returned ${modelsResponse.status}`)

    return { models, url: serverUrl }
  } catch (error) {
    throw new Error(`Cannot connect to server: ${(error as Error).message}`)
  }
}

export async function pickSttModel(modelId: string, provider: LemonadeTreeDataProvider): Promise<void> {
  if (!modelId) {
    window.showInformationMessage('No model selected.')
    return
  }
  // Without a folder open there is no settings file to write to, so the pick is
  // kept for this session only instead of raising a settings error.
  const saved = await saveAudioLabSetting('pickedSttModel', modelId)
  provider.setSessionPickedSttModel(saved ? null : modelId)
  await provider.refreshStatus()
}

export async function pickTtsModel(modelId: string, provider: LemonadeTreeDataProvider): Promise<void> {
  if (!modelId) {
    window.showInformationMessage('No TTS model selected.')
    return
  }
  const saved = await saveAudioLabSetting('pickedTtsModel', modelId)
  provider.setSessionPickedTtsModel(saved ? null : modelId)
  await provider.refreshStatus()
}

/**
 * Does this model support voice cloning via a reference WAV sample? Only
 * MOSS models do (sent as `reference_wav_b64`); Kokoro has no cloning
 * support and always uses its `ttsVoiceKokoro` preset.
 */
export function supportsVoiceCloning(modelId: string | undefined): boolean {
  return (modelId || '').toLowerCase().includes('moss')
}

/**
 * Resolve the effective voice for a TTS model. Cloning-capable models (MOSS)
 * never send `voice` — they send `reference_wav_b64` instead when
 * `audio-lab.ttsRefVoice` is set, and nothing otherwise. Kokoro always uses
 * `audio-lab.ttsVoiceKokoro`, falling back to the declared "nova"
 * default; a reference file is never consulted for Kokoro.
 */
export function resolveTtsVoice(modelId: string | undefined): string | undefined {
  if (supportsVoiceCloning(modelId)) return undefined
  return workspace.getConfiguration('audio-lab').get<string>('ttsVoiceKokoro') || 'nova'
}

/**
 * Read the reference WAV file (if `audio-lab.ttsRefVoice` is set) and return
 * its base64-encoded contents for voice cloning. Returns `undefined` when no
 * reference is configured.
 */
export async function getTtsReferenceAudio(): Promise<string | undefined> {
  const refPath = workspace.getConfiguration('audio-lab').get<string>('ttsRefVoice')
  if (!refPath) return undefined
  try {
    const buffer = await fs.promises.readFile(refPath)
    return buffer.toString('base64')
  } catch (error) {
    console.error(`AudioLab: failed to read voice reference file "${refPath}":`, error)
    window.showWarningMessage(`Could not read voice reference file: ${refPath}`)
    return undefined
  }
}

/**
 * Generate speech from text via Lemonade `POST /v1/audio/speech`
 * (OpenAI-compatible). Text is supplied by the caller (a plain-text file from
 * the tree view, or the active text editor); the resulting audio file is saved
 * next to the workspace (or chosen via save dialog) and revealed to the user.
 *
 * Shared by `genSpeechFromFile` and `genSpeechFromEditor`.
 */
async function ttsFromText(text: string, sourceLabel: string, provider?: LemonadeTreeDataProvider): Promise<void> {
  const configuredModel = workspace.getConfiguration('audio-lab').get<string>('pickedTtsModel')
  const model = provider?.getPickedTtsModel() ?? configuredModel
  if (!model) {
    window.showWarningMessage('No TTS model selected. Please pick a model under the TTS section first.')
    return
  }

  const cloning = supportsVoiceCloning(model)
  const voice = resolveTtsVoice(model)
  const format = workspace.getConfiguration('audio-lab').get<string>('ttsFormat') || 'wav'
  const serverUrl = getServerUrl()

  const title = `Generating speech with ${model}`
  await window.withProgress({ location: ProgressLocation.Notification, title }, async (progress) => {
    progress.report({ message: `Generating speech from ${sourceLabel}...` })
    try {
      // Only cloning-capable models (MOSS) use a reference sample. Kokoro
      // cannot clone voices, so a configured reference is ignored there and
      // the `ttsVoiceKokoro` preset is always sent.
      let referenceAudio: string | undefined
      if (cloning) {
        referenceAudio = await getTtsReferenceAudio()
        // If a voice reference is configured but the file can't be read, abort
        // rather than silently generating speech with the wrong voice.
        const refVoice = workspace.getConfiguration('audio-lab').get<string>('ttsRefVoice')
        if (refVoice && !referenceAudio) throw new Error(`Voice reference file could not be read: ${refVoice}`)
      }
      const response = await fetch(`${serverUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: text,
          response_format: format,
          // When voice cloning with a reference audio sample, send only the
          // reference — the `voice` preset is not applicable. When no voice is
          // configured (e.g. MOSS), omit `voice` and let
          // the server use its own default.
          ...(referenceAudio
            ? { reference_wav_b64: referenceAudio }
            : voice ? { voice } : {})
        })
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`Server returned ${response.status}: ${errText || response.statusText}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      if (!arrayBuffer.byteLength) throw new Error('Server returned empty audio.')

      const ext = format.toLowerCase() === 'mp3' ? 'mp3' : format.toLowerCase() === 'wav' ? 'wav' : format.toLowerCase()
      const defaultName = `tts_${Date.now()}.${ext}`
      let target: Uri | undefined
      if (workspace.workspaceFolders?.length) target = Uri.joinPath(workspace.workspaceFolders[0].uri, defaultName)
      else {
        target = await window.showSaveDialog({ defaultUri: Uri.file(defaultName), filters: { Audio: [ext] } })
        if (!target) return
      }
      await workspace.fs.writeFile(target, new Uint8Array(arrayBuffer))
      const fileName = path.basename(target.fsPath)
      const msg = `Speech audio file saved: ${fileName}`
      window.showInformationMessage(msg, 'Reveal in Explorer', 'Open').then(async (action) => {
        if (action === 'Reveal in Explorer') await commands.executeCommand('revealFileInOS', target)
        else if (action === 'Open') await commands.executeCommand('vscode.open', target)
      })
      provider?.refreshTree()
    } catch (error) {
      console.error('AudioLab: TTS error:', error)
      window.showErrorMessage(`Speech generation failed: ${(error as Error).message}`)
    }
  })
}

/**
 * Generate speech from the content of a plain-text file listed under
 * "Media Files" (tree view context menu on a `TEXT_ITEM`).
 */
export async function genSpeechFromFile(provider: LemonadeTreeDataProvider, fullPath?: string): Promise<void> {
  if (!fullPath) {
    window.showInformationMessage('No text file selected.')
    return
  }
  let content: string
  try {
    content = await fs.promises.readFile(fullPath, 'utf8')
  } catch (error) {
    window.showErrorMessage(`Could not read ${path.basename(fullPath)}: ${(error as Error).message}`)
    return
  }
  if (!content.trim()) {
    window.showInformationMessage(`${path.basename(fullPath)} is empty - nothing to convert to audio.`)
    return
  }
  await ttsFromText(content.trim(), `file ${path.basename(fullPath)}`, provider)
}

/**
 * Generate speech from the content of the active text editor (text editor context menu):
 * `useSelection` reads the current selection, otherwise the whole document.
 */
export async function genSpeechFromEditor(provider: LemonadeTreeDataProvider, useSelection: boolean): Promise<void> {
  const editor = window.activeTextEditor
  if (!editor) {
    window.showInformationMessage('No active text editor to read text from.')
    return
  }
  const text = useSelection ? editor.document.getText(editor.selection) : editor.document.getText()
  if (!text.trim()) {
    window.showInformationMessage(useSelection ? 'The selection is empty.' : 'The document is empty.')
    return
  }
  await ttsFromText(text.trim(), useSelection ? 'the selection' : 'the document', provider)
}

export async function transcribeAudio(provider?: LemonadeTreeDataProvider, fullPath?: string) {
  const configuredModel = workspace.getConfiguration('audio-lab').get<string>('pickedSttModel')
  const model = provider?.getPickedSttModel() ?? configuredModel
  if (!model) {
    window.showWarningMessage('No model selected. Please pick a model first.')
    return
  }

  const targetUri = await resolveAudioTarget(fullPath)
  if (!targetUri) return

  const fileName = path.basename(targetUri.fsPath)
  const serverUrl = getServerUrl()

  // Wrap the blocking request in VS Code's progress notification
  const controller = new AbortController()
  if (provider) provider.setTranscribing(targetUri.fsPath, true, controller)
  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Transcribing ${fileName}`,
        // The Cancel button is now supported; the request is aborted via the
        // controller both here and from the Processing tree item.
        cancellable: true
      },
      async (progress, token) => {
        // Surface cancellation to the request abort controller.
        token.onCancellationRequested(() => {
          if (!controller.signal.aborted) controller.abort()
        })
        progress.report({ message: `Processing with model: ${model}...` })

        try {
          // Read local file buffer
          const audioBuffer = await fs.promises.readFile(targetUri.fsPath)

          // Build standard multipart request
          const formData = new FormData()
          formData.append('file', new Blob([audioBuffer]), fileName)
          formData.append('model', model)

          // Lemonade's Whisper API endpoint
          const response = await fetch(`${serverUrl}/v1/audio/transcriptions`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
          })

          if (!response.ok) {
            const errText = await response.text().catch(() => '')
            throw new Error(`Server returned ${response.status}: ${errText || response.statusText}`)
          }

          const data = await response.json()
          const transcribedText = data?.text || data?.transcript || ''

          if (transcribedText) showTheTranscript(fileName, transcribedText)
          else window.showErrorMessage('Transcription finished, but no text was returned in response.')

        } catch (error) {
          // AbortError is only produced when the user cancels (the toast button
          // or the tree-item cancel), so stop quietly instead of surfacing a
          // failure message.
          if (error instanceof Error && error.name === 'AbortError') return
          console.error('AudioLab: transcription error:', error)
          window.showErrorMessage(`Transcription failed: ${(error as Error).message}`)
        }
      }
    )
  } finally {
    if (provider) provider.setTranscribing(targetUri.fsPath, false)
  }
}

export async function createSub(provider?: LemonadeTreeDataProvider, fullPath?: string) {
  const configuredModel = workspace.getConfiguration('audio-lab').get<string>('pickedSttModel')
  const model = provider?.getPickedSttModel() ?? configuredModel
  if (!model) {
    window.showWarningMessage('No model selected. Please pick a model first.')
    return
  }

  const targetUri = await resolveAudioTarget(fullPath)
  if (!targetUri) return

  const fileName = path.basename(targetUri.fsPath)
  const serverUrl = getServerUrl()

  const format = workspace.getConfiguration('audio-lab').get<'srt' | 'vtt'>('subtitleFormat') ?? 'srt'

  // AbortController lets the user stop an in-flight subtitle request from the
  // Processing tree item or the notification's Cancel button.
  const controller = new AbortController()
  if (provider) provider.setTranscribing(targetUri.fsPath, true, controller)
  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Creating subtitles for ${fileName}`,
        // The Cancel button is now supported; the request is aborted via the
        // controller both here and from the Processing tree item.
        cancellable: true
      },
      async (progress, token) => {
        // Surface cancellation to the request abort controller.
        token.onCancellationRequested(() => {
          if (!controller.signal.aborted) controller.abort()
        })
        progress.report({ message: `Transcribing with model: ${model}...` })

        try {
          const audioBuffer = await fs.promises.readFile(targetUri.fsPath)
          let subtitleContent: string | undefined

          // Attempt 1: Request `srt` or `vtt` response_format directly from the
          // server. whisper.cpp / Lemonade returns fully timestamped content.
          const directFormat = format === 'vtt' ? 'vtt' : 'srt'
          const formData = new FormData()
          formData.append('file', new Blob([audioBuffer]), fileName)
          formData.append('model', model)
          formData.append('response_format', directFormat)

          const directResponse = await fetch(`${serverUrl}/v1/audio/transcriptions`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
          })
          if (directResponse.ok) {
            const text = await directResponse.text()
            // Validate the response looks like actual subtitle content
            if (directFormat === 'srt' && text.includes('-->')) subtitleContent = text
            else if (directFormat === 'vtt' && text.startsWith('WEBVTT')) subtitleContent = text
          }

          // Attempt 2: Fallback to verbose_json and format segments locally
          if (!subtitleContent) {
            const jsonFormData = new FormData()
            jsonFormData.append('file', new Blob([audioBuffer]), fileName)
            jsonFormData.append('model', model)
            jsonFormData.append('response_format', 'verbose_json')

            const jsonResponse = await fetch(`${serverUrl}/v1/audio/transcriptions`, {
              method: 'POST',
              body: jsonFormData,
              signal: controller.signal
            })

            if (!jsonResponse.ok) {
              const errText = await jsonResponse.text().catch(() => '')
              throw new Error(`Server returned ${jsonResponse.status}: ${errText || jsonResponse.statusText}`)
            }

            const data = await jsonResponse.json()

            let segments: SubtitleSegment[] = []
            const topLevelSegments = Array.isArray(data?.segments) ? data.segments : []
            const nestedSegments = Array.isArray(data?.results?.segments) ? data.results.segments : []
            const speechSegments = Array.isArray(data?.speech) ? data.speech : []

            if (topLevelSegments.length > 0) segments = topLevelSegments as SubtitleSegment[]
            else if (nestedSegments.length > 0) segments = nestedSegments as SubtitleSegment[]
            else if (speechSegments.length > 0) {
              segments = speechSegments.map((item: unknown, index: number) => {
                const speechItem = item as Record<string, unknown>
                return {
                  id: index,
                  start: Number(speechItem.start) || 0,
                  end: Number(speechItem.end) || 0,
                  text: String(speechItem.text ?? '')
                }
              })
            }

            if (segments.length === 0) {
              // Fallbacks: if the server returned plain text only, create a single-segment subtitle
              const transcribedText = data?.text || data?.transcript || ''
              if (transcribedText) segments = [{ start: 0, end: 3600, text: transcribedText }]
              else {
                window.showErrorMessage('Subtitle creation failed: no text or segments returned.')
                return
              }
            }
            subtitleContent = format === 'vtt' ? formatVtt(segments) : formatSrt(segments)
          }

          const subPath = await saveSubtitleFile(targetUri.fsPath, subtitleContent, format)

          const subName = path.basename(subPath)
          window.showInformationMessage(`Subtitles saved: ${subName}`, 'Reveal in Explorer', 'Open')
            .then((action) => handleSubtitlesSavedAction(action, subPath))
        } catch (error) {
          // AbortError is only produced when the user cancels (the toast button
          // or the tree-item cancel), so stop quietly instead of surfacing a
          // failure message.
          if (error instanceof Error && error.name === 'AbortError') return
          console.error('AudioLab: subtitle creation error:', error)
          window.showErrorMessage(`Subtitle creation failed: ${(error as Error).message}`)
        }
      }
    )
  } finally {
    if (provider) provider.setTranscribing(targetUri.fsPath, false)
  }
}

/**
 * React to the button the user pressed in the "subtitles saved" notification,
 * revealing the file in the OS or opening it in an editor. A dismissed
 * notification (`undefined`) does nothing.
 */
async function handleSubtitlesSavedAction(action: string | undefined, subPath: string): Promise<void> {
  if (action === 'Reveal in Explorer') {
    await commands.executeCommand('revealFileInOS', Uri.file(subPath))
    return
  }
  if (action === 'Open') {
    const doc = await workspace.openTextDocument(Uri.file(subPath))
    await window.showTextDocument(doc)
  }
}

/**
 * Create a new text file in the Media Files tree view.
 * When invoked on `MEDIA_HEADER` the file is created in the workspace root;
 * when invoked on a `MEDIA_DIRECTORY` node it is created inside that folder.
 */
export async function createTextFile(provider?: LemonadeTreeDataProvider, fullPath?: string): Promise<void> {
  const targetDir = fullPath || (workspace.workspaceFolders?.[0]?.uri.fsPath || '')
  if (!targetDir) {
    window.showWarningMessage('No workspace folder is open. Open a folder first to create a text file.')
    return
  }

  const fileName = await window.showInputBox({
    prompt: 'Enter text file name',
    value: 'notes.txt',
    validateInput: (value) => {
      if (!value.trim()) return 'File name is required'
      if (!value.toLowerCase().endsWith('.txt')) return 'File name must end with .txt'
      return null
    }
  })
  if (!fileName) return

  const targetUri = Uri.joinPath(Uri.file(targetDir), fileName)

  try {
    await workspace.fs.writeFile(targetUri, new Uint8Array())
    window.showInformationMessage(`Created ${fileName}`)
    provider?.refreshTree()

    const doc = await workspace.openTextDocument(targetUri)
    await window.showTextDocument(doc)
  } catch (error) {
    window.showErrorMessage(`Could not create ${fileName}: ${(error as Error).message}`)
  }
}

/**
 * Rename a media file in the tree view (audio, subtitle, or text file).
 * Prompts for the new name and renames via workspace.fs.rename, then refreshes the tree.
 */
export async function renameMediaFile(provider?: LemonadeTreeDataProvider, fullPath?: string): Promise<void> {
  if (!fullPath) {
    window.showWarningMessage('No file selected to rename.')
    return
  }

  const oldUri = Uri.file(fullPath)
  const oldName = path.basename(fullPath)

  const newName = await window.showInputBox({
    prompt: 'Enter new file name',
    value: oldName,
    validateInput: (value) => {
      if (!value.trim()) return 'File name is required'
      if (value === oldName) return null
      const dir = path.dirname(fullPath)
      const candidate = Uri.joinPath(Uri.file(dir), value)
      if (fs.existsSync(candidate.fsPath)) return 'A file with that name already exists'
      return null
    }
  })
  if (!newName || newName === oldName) return

  const newUri = Uri.joinPath(Uri.file(path.dirname(fullPath)), newName)

  try {
    await workspace.fs.rename(oldUri, newUri)
    window.showInformationMessage(`Renamed ${oldName} to ${newName}`)
    provider?.refreshTree()
  } catch (error) {
    window.showErrorMessage(`Could not rename ${oldName}: ${(error as Error).message}`)
  }
}


