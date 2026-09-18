import { ProgressLocation, Uri, commands } from 'vscode'
import { workspace, window } from 'vscode'
import fs from 'fs'
import path from 'path'

import { LemonadeModel, LemonadeStatus } from './types'
import {
  showTheTranscript,
  SubtitleSegment,
  formatSrt,
  formatVtt,
  saveSubtitleFile
} from './utils'
import LemonadeTreeDataProvider from './treeview'

// Function to get Lemonade server status and available models
export async function getLemonadeStatus(): Promise<LemonadeStatus> {
  const serverUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')
  try {
    let models: LemonadeModel[] = []
    const modelsResponse = await fetch(`${serverUrl}/v1/models`)

    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json()
      models = modelsData.data || []
    } else throw new Error(`Failed to fetch models: Server returned ${modelsResponse.status}`)

    return {
      models,
      url: serverUrl!,
      rawData: { models },
      isRunning: true
    }
  } catch (error) {
    throw new Error(`Cannot connect to server: ${(error as Error).message}`)
  }
}

export async function pickModel(modelId: string, lemonadeProvider: LemonadeTreeDataProvider): Promise<void> {
  if (!modelId) {
    window.showInformationMessage('No model selected.')
    return
  }
  await workspace.getConfiguration('audio-lab').update('pickedModel', modelId)
  await lemonadeProvider.refreshStatus()
}

export async function transcribeAudio(lemonadeProvider?: LemonadeTreeDataProvider, fullPath?: string) {
  const model = workspace.getConfiguration('audio-lab').get<string>('pickedModel')
  if (!model) {
    window.showWarningMessage('No model selected. Please pick a model first.')
    return
  }

  let targetUri: Uri | undefined = fullPath ? Uri.file(fullPath) : undefined
  if (!targetUri) {
    const files = await window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Audio Files': ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm'] }
    })
    if (files && files.length > 0) targetUri = files[0]
    else {
      window.showWarningMessage('No audio file selected. Please open or select an audio file first.')
      return
    }
  }

  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm']
  const ext = targetUri.fsPath.split('.').pop()?.toLowerCase()
  if (!audioExtensions.includes(ext || '')) {
    window.showWarningMessage('Selected file is not an audio file. Please select an audio file.')
    return
  }

  const fileName = path.basename(targetUri.fsPath)
  let serverUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')!

  // Clean trailing slashes if present
  serverUrl = serverUrl.replace(/\/+$/, '')

  // Wrap the blocking request in VS Code's progress notification
  if (lemonadeProvider) lemonadeProvider.setTranscribing(targetUri.fsPath, true)
  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Transcribing ${fileName}`,
        cancellable: false
      },
      async (progress) => {
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
            body: formData
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
          console.error('AudioLab: transcription error:', error)
          window.showErrorMessage(`Transcription failed: ${(error as Error).message}`)
        }
      }
    )
  } finally {
    if (lemonadeProvider) lemonadeProvider.setTranscribing(targetUri.fsPath, false)
  }
}

export async function createSubtitles(
  lemonadeProvider?: LemonadeTreeDataProvider,
  fullPath?: string
) {
  const model = workspace.getConfiguration('audio-lab').get<string>('pickedModel')
  if (!model) {
    window.showWarningMessage('No model selected. Please pick a model first.')
    return
  }

  let targetUri: Uri | undefined = fullPath ? Uri.file(fullPath) : undefined
  if (!targetUri) {
    const files = await window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Audio Files': ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm', 'opus', 'amr', 'au', 'aiff'] }
    })
    if (files && files.length > 0) targetUri = files[0]
    else {
      window.showWarningMessage('No audio file selected. Please open or select an audio file first.')
      return
    }
  }

  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm', 'opus', 'amr', 'au', 'aiff']
  const ext = targetUri.fsPath.split('.').pop()?.toLowerCase()
  if (!audioExtensions.includes(ext || '')) {
    window.showWarningMessage('Selected file is not an audio file. Please select an audio file.')
    return
  }

  const fileName = path.basename(targetUri.fsPath)
  let serverUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')!
  serverUrl = serverUrl.replace(/\+$/, '')

  const format = workspace.getConfiguration('audio-lab').get<'srt' | 'vtt'>('subtitleFormat') ?? 'srt'

  if (lemonadeProvider) lemonadeProvider.setTranscribing(targetUri.fsPath, true)
  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Creating subtitles for ${fileName}`,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: `Transcribing with model: ${model}...` })

        try {
          const audioBuffer = await fs.promises.readFile(targetUri.fsPath)

          // First, try to get proper timestamped segments by importing the
          // formatter utilities (already imported at the top of this file).
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
            body: formData
          })

          if (directResponse.ok) {
            const text = await directResponse.text()
            // Validate the response looks like actual subtitle content
            if (directFormat === 'srt' && text.includes('-->')) 
              subtitleContent = text
            else if (directFormat === 'vtt' && text.startsWith('WEBVTT')) 
              subtitleContent = text
            
          }

          // Attempt 2: Fallback to verbose_json and format segments locally
          if (!subtitleContent) {
            const jsonFormData = new FormData()
            jsonFormData.append('file', new Blob([audioBuffer]), fileName)
            jsonFormData.append('model', model)
            jsonFormData.append('response_format', 'verbose_json')

            const jsonResponse = await fetch(`${serverUrl}/v1/audio/transcriptions`, {
              method: 'POST',
              body: jsonFormData
            })

            if (!jsonResponse.ok) {
              const errText = await jsonResponse.text().catch(() => '')
              throw new Error(`Server returned ${jsonResponse.status}: ${errText || jsonResponse.statusText}`)
            }

            const data = await jsonResponse.json()

            // OpenAI-compatible verbose_json returns either a top-level "segments" array
            // or nests it inside "results"/"speech" depending on the backend.
            let segments: SubtitleSegment[] = []
            if (Array.isArray(data?.segments)) 
              segments = data.segments as SubtitleSegment[]
            else if (data?.results?.segments && Array.isArray(data.results.segments)) 
              segments = data.results.segments as SubtitleSegment[]
            else if (data?.speech && Array.isArray(data.speech)) {
              segments = data.speech.map((s: unknown, i: number) => {
                const o = s as Record<string, unknown>
                return { id: i, start: Number(o.start) || 0, end: Number(o.end) || 0, text: String(o.text ?? '') }
              })
            }

            if (segments.length === 0) {
              // Fallbacks: if the server returned plain text only, create a single-segment subtitle
              const transcribedText = data?.text || data?.transcript || ''
              if (transcribedText) 
                segments = [{ start: 0, end: 3600, text: transcribedText }]
              else {
                window.showErrorMessage('Subtitle creation failed: no text or segments returned.')
                return
              }
            }

            subtitleContent = format === 'vtt' ? formatVtt(segments) : formatSrt(segments)
          }

          const subPath = await saveSubtitleFile(targetUri.fsPath, subtitleContent, format)

          const subName = path.basename(subPath)
          window.showInformationMessage(
            `Subtitles saved: ${subName}`,
            'Reveal in Explorer',
            'Open'
          ).then((action) => {
            if (action === 'Reveal in Explorer' || action === 'Open') 
              commands.executeCommand('revealFileInOS', Uri.file(subPath))
            
            if (action === 'Open') 
              workspace.openTextDocument(Uri.file(subPath)).then((doc) => window.showTextDocument(doc))
            
          })
        } catch (error) {
          console.error('AudioLab: subtitle creation error:', error)
          window.showErrorMessage(`Subtitle creation failed: ${(error as Error).message}`)
        }
      }
    )
  } finally {
    if (lemonadeProvider) lemonadeProvider.setTranscribing(targetUri.fsPath, false)
  }
}
