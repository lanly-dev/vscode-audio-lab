import { ProgressLocation, Uri } from 'vscode'
import { workspace, window } from 'vscode'
import fs from 'fs'
import path from 'path'

import { LemonadeModel, LemonadeStatus } from './types'
import { showTheTranscript } from './utils'
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
