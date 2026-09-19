import fs from 'fs'
import path from 'path'
import { commands, env, workspace, window } from 'vscode'
import { ConfigurationTarget, Position, Uri } from 'vscode'

import { LemonadeModel } from './types'
import AudioLabTreeItem from './treeItem'
import LemonadeTreeDataProvider from './treeview'

/** SRT segment from Whisper-style verbose_json response. */
export interface SubtitleSegment {
  id?: number
  start: number
  end: number
  text: string
}

/**
 * Audio file extensions accepted by the transcription endpoints and listed in
 * the audio file tree view. This is the single source of truth: the file
 * pickers, the validation and the tree view all read it, so they cannot drift
 * apart again.
 */
export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm', 'opus', 'amr', 'au', 'aiff'
]

/** Whether a file path ends with one of the supported audio extensions. */
export function isAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return AUDIO_EXTENSIONS.includes(ext)
}

/**
 * Read the configured Lemonade server URL, trimmed and with trailing slashes
 * removed so callers can always append `/v1/...` safely.
 */
export function getServerUrl(): string {
  const raw = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl') || ''
  return raw.trim().replace(/\/+$/, '')
}

/**
 * Resolve the audio file to work on: the path picked in the tree view when
 * given, otherwise a file chosen through the file picker. Returns `undefined`
 * after notifying the user when nothing usable was selected.
 */
export async function resolveAudioTarget(fullPath?: string): Promise<Uri | undefined> {
  if (fullPath) {
    const targetUri = Uri.file(fullPath)
    if (!isAudioFile(targetUri.fsPath)) {
      window.showWarningMessage('Selected file is not an audio file. Please select an audio file.')
      return undefined
    }
    return targetUri
  }

  const picked = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Audio Files': AUDIO_EXTENSIONS }
  })

  const targetUri = picked?.[0]
  if (!targetUri) {
    window.showWarningMessage('No audio file selected. Please open or select an audio file first.')
    return undefined
  }

  if (!isAudioFile(targetUri.fsPath)) {
    window.showWarningMessage('Selected file is not an audio file. Please select an audio file.')
    return undefined
  }
  return targetUri
}

/**
 * Format an array of segments into an SRT string.
 * Timestamps are formatted as `HH:MM:SS,mmm`.
 */
export function formatSrt(segments: SubtitleSegment[]): string {
  return segments
    .map((seg, idx) => {
      const start = formatTimestamp(seg.start)
      const end = formatTimestamp(seg.end)
      return `${idx + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`
    })
    .join('\n')
}

/**
 * Format an array of segments into a WebVTT string.
 * Timestamps are formatted as `HH:MM:SS.mmm`.
 */
export function formatVtt(segments: SubtitleSegment[]): string {
  const header = 'WEBVTT\n\n'
  const bodies = segments
    .map((seg) => {
      const start = formatVttTimestamp(seg.start)
      const end = formatVttTimestamp(seg.end)
      return `${start} --> ${end}\n${seg.text.trim()}\n`
    })
    .join('\n')
  return header + bodies
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`
}

function formatVttTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

/**
 * Write a subtitle file next to the audio file. Returns the path of the
 * created file so the caller can reveal it or notify the user.
 */
export async function saveSubtitleFile(
  audioFilePath: string,
  content: string,
  extension: 'srt' | 'vtt'
): Promise<string> {
  const baseName = path.basename(audioFilePath)
  const dirName = path.dirname(audioFilePath)
  const nameWithoutExt = baseName.replace(/\.[^.]+$/, '')
  const subPath = path.join(dirName, `${nameWithoutExt}.${extension}`)
  await fs.promises.writeFile(subPath, content, 'utf8')
  return subPath
}

/**
 * Whether settings can be persisted at all. This extension's settings are
 * window-scoped, so they live in workspace settings, which only exist while a
 * folder is open; without one, VS Code's `update()` throws, so writes are
 * skipped instead.
 */
export function canPersistSettings(): boolean {
  return !!workspace.workspaceFolders?.length
}

/**
 * Save one of this extension's own settings in workspace settings. Does nothing
 * when no folder is open (there is no settings file to write to) and reports
 * whether the value was stored.
 */
export async function saveAudioLabSetting(
  key: 'pickedModel' | 'lemonadeServerUrl',
  value: string | undefined
): Promise<boolean> {
  if (!canPersistSettings()) return false
  try {
    await workspace.getConfiguration('audio-lab').update(key, value, ConfigurationTarget.Workspace)
    return true
  } catch (error) {
    console.error(`AudioLab: failed to save audio-lab.${key}:`, error)
    window.showWarningMessage(`Could not save "audio-lab.${key}" to your settings.`)
    return false
  }
}

export async function changeServerUrl(lemonadeProvider: LemonadeTreeDataProvider) {
  const currentUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')
  const url = await window.showInputBox({
    prompt: 'Enter Lemonade server URL (include port)',
    value: currentUrl,
    placeHolder: 'http://localhost:13305',
    validateInput: (value) => isValidUrl(value) ? undefined : 'Please enter a valid http(s) URL (e.g. http://localhost:13305)'
  })

  if (!url) return
  if (!canPersistSettings()) {
    window.showWarningMessage('The Lemonade server URL is stored in workspace settings, so open a folder to change it.')
    return
  }
  const saved = await saveAudioLabSetting('lemonadeServerUrl', url)
  if (!saved) return
  await lemonadeProvider.refreshStatus()
  window.showInformationMessage(`Server URL updated to: ${url}`)
}

/**
 * Whether a value is a usable Lemonade server URL. Only http(s) URLs are
 * accepted, so other schemes (file:, vscode:, ...) can never reach `fetch` or
 * `env.openExternal`.
 */
export function isValidUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
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
  const safeFileName = fileName.normalize('NFC').replace(/[\\/:*?"<>|%#\u0000-\u001F]/g, '_')
  const dynamicTitle = `Transcript_${safeFileName}.txt`

  const uri = Uri.parse(`untitled:${dynamicTitle}`)
  const doc = await workspace.openTextDocument(uri)
  const editor = await window.showTextDocument(doc)

  await editor.edit(editBuilder => editBuilder.insert(new Position(0, 0), transcribedText))
}

export async function openServerUrl() {
  const serverUrl = getServerUrl()
  if (!isValidUrl(serverUrl)) {
    window.showWarningMessage('No valid http(s) Lemonade server URL configured.')
    return
  }
  await env.openExternal(Uri.parse(serverUrl))
}

export async function openSettings() {
  await commands.executeCommand('workbench.action.openSettings', '@ext:lanly-dev.audio-lab')
}

export async function revealInExplorer(item: AudioLabTreeItem) {
  if (!item?.fullPath) {
    console.error('AudioLab: tree item has no file path to reveal.')
    return
  }
  await commands.executeCommand('revealFileInOS', Uri.file(item.fullPath))
}
