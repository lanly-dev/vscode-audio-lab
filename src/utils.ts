import fs from 'fs'
import path from 'path'
import { commands, env, workspace, window } from 'vscode'
import { Position, Uri, TreeItem } from 'vscode'

import LemonadeTreeDataProvider from './treeview'
import { LemonadeModel } from './types'

/** SRT segment from Whisper-style verbose_json response. */
export interface SubtitleSegment {
  id?: number
  start: number
  end: number
  text: string
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
