import { commands, env, workspace, window } from 'vscode'
import { Position, Uri, TreeItem } from 'vscode'

import LemonadeTreeDataProvider from './treeview'
import { LemonadeModel } from './types'

export async function changeServerUrl(lemonadeProvider: LemonadeTreeDataProvider) {
  const currentUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')
  const url = await window.showInputBox({
    prompt: 'Enter Lemonade server URL (include port)',
    value: currentUrl,
    placeHolder: 'http://localhost:13305',
    validateInput: (value) => {
      if (!value) return 'URL cannot be empty'
      try {
        new URL(value)
        return
      } catch {
        return 'Please enter a valid URL (include http:// or https://)'
      }
    }
  })

  if (!url) return
  const config = workspace.getConfiguration('audio-lab')
  await config.update('lemonadeServerUrl', url)
  await lemonadeProvider.refreshStatus()
  window.showInformationMessage(`Server URL updated to: ${url}`)
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a Lemonade model can transcribe audio, determined from its capability
 * labels (e.g. `transcription`, `realtime-transcription`) rather than by matching
 * the model id/name. This is more robust than a name heuristic because it stays
 * correct regardless of the model's family (Whisper, etc.).
 */
export function hasTransCapability(model: LemonadeModel): boolean {
  const labels = (model.labels || []).map((label) => label.toLowerCase())
  return labels.some((label) => label.includes('transcription'))
}

/**
 * Whether a model is allowed for transcription, based on the user-configured
 * `audio-lab.transcriptionModels` list. Patterns are matched against the model
 * id (case-insensitive substring), so `["whisper"]` matches Whisper model ids
 * while excluding others (e.g. moonshine). A model not in the list is filtered
 * out of the transcription selection UI.
 */
export function isAllowedTransModel(model: LemonadeModel, patterns: string[]): boolean {
  const id = (model.id || '').toLowerCase()
  const normalized = (patterns || []).map((pattern) => pattern.trim().toLowerCase()).filter((p) => p.length > 0)
  if (normalized.length === 0) return false
  return normalized.some((pattern) => id.includes(pattern))
}

export async function showTheTranscript(fileName: string, transcribedText: string) {
  // Sanitize the file name by replacing spaces and invalid characters
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_\-]/g, '_')
  const dynamicTitle = `Transcript_${sanitizedFileName}.txt`

  const uri = Uri.parse(`untitled:${dynamicTitle}`)
  const doc = await workspace.openTextDocument(uri)
  const editor = await window.showTextDocument(doc)

  await editor.edit(editBuilder => editBuilder.insert(new Position(0, 0), transcribedText))
}

export async function openServerUrl() {
  const serverUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')
  if (!serverUrl) {
    window.showWarningMessage('No server URL configured.')
    return
  }
  await env.openExternal(Uri.parse(serverUrl))
}

export async function openSettings() {
  await commands.executeCommand('workbench.action.openSettings', '@ext:lanly-dev.audio-lab')
}

export async function revealInExplorer(item: TreeItem) {
  if (!item.tooltip) {
    console.error('Item tooltip is missing.')
    return
  }
  const uri = Uri.file(item.tooltip.toString())
  commands.executeCommand('revealFileInOS', uri)
}
