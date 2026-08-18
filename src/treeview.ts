import * as fs from 'fs'
import * as path from 'path'
import {
  Event,
  EventEmitter,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace
} from 'vscode'

import { getLemonadeStatus } from './server'
import { isValidUrl, isWhisperModel } from './utils'
import { LemonadeModel, LemonadeStatus } from './types'

export default class LemonadeTreeDataProvider implements TreeDataProvider<TreeItem> {
  private static instance: LemonadeTreeDataProvider | null = null

  private _onDidChangeTreeData: EventEmitter<void> = new EventEmitter<void>()
  readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event

  private availableModels: LemonadeModel[] = []
  private currentServerUrl: string
  private getError: Error | null
  private isServerRunning: boolean | null
  private pickedModel: string | null
  private serverStatusData: LemonadeStatus | null
  private transcribingPaths: Set<string> = new Set()

  // Singleton instance accessor and initializer
  static async createOrGet(): Promise<LemonadeTreeDataProvider> {
    if (LemonadeTreeDataProvider.instance) return LemonadeTreeDataProvider.instance
    const td = new LemonadeTreeDataProvider()
    window.createTreeView('lemonadeStatus', {
      treeDataProvider: td,
      showCollapseAll: true
    })
    await td.refreshStatus()
    LemonadeTreeDataProvider.instance = td
    return td
  }

  constructor() {
    const config = workspace.getConfiguration('audio-lab')
    if (!config.get<string>('lemonadeServerUrl')) throw new Error('Lemonade server URL is not configured.')

    this.getError = null
    this.availableModels = []
    this.isServerRunning = null
    this.serverStatusData = null
    this.currentServerUrl = config.get<string>('lemonadeServerUrl')!
    this.pickedModel = config.get<string>('pickedModel') ? config.get<string>('pickedModel')! : null
  }

  async refreshStatus(): Promise<void> {
    this.getError = null
    this.isServerRunning = null
    this.serverStatusData = null
    this.currentServerUrl = workspace.getConfiguration('audio-lab').get<string>('lemonadeServerUrl')!
    // Double check logic if the model got removed
    this.pickedModel = workspace.getConfiguration('audio-lab').get<string>('pickedModel')!
    this._onDidChangeTreeData.fire() // For the effect

    if (!isValidUrl(this.currentServerUrl)) {
      this.isServerRunning = null
      this.availableModels = []
      this._onDidChangeTreeData.fire()
      return
    }
    try {
      this.serverStatusData = await getLemonadeStatus()
    } catch (error) {
      this.getError = error as Error
      this._onDidChangeTreeData.fire()
      return
    }
    this.availableModels = this.serverStatusData.models || []
    this.isServerRunning = this.serverStatusData.isRunning !== false  // Use the isRunning flag we added

    this._onDidChangeTreeData.fire()
  }

  /**
   * Start or stop showing the transcription spinner on an audio file tree item.
   * Each file path is tracked independently, so multiple concurrent transcriptions
   * each show their own spinner.
   */
  setTranscribing(filePath: string, transcribing: boolean): void {
    if (transcribing) this.transcribingPaths.add(filePath)
    else this.transcribingPaths.delete(filePath)
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (this.getError) {
      const errorItem = new TreeItem(`Error: ${this.getError.message}`, TreeItemCollapsibleState.None)
      errorItem.iconPath = new ThemeIcon('error', new ThemeColor('charts.red'))
      return [errorItem as TreeItem]
    }
    if (!element) {
      // Root level items
      const items: TreeItem[] = []

      if (this.serverStatusData) {
        // Server URL item
        const urlItem = new TreeItem(
          `${this.serverStatusData.url}`,
          TreeItemCollapsibleState.None
        )
        urlItem.iconPath = new ThemeIcon('server')
        urlItem.tooltip = `Server URL: ${this.currentServerUrl}`
        urlItem.contextValue = 'LEMONADE_SERVER_URL'
        items.push(urlItem as TreeItem)

        // Status indicator
        const statusText = this.isServerRunning ? 'Running' : this.isServerRunning === false ? 'Stopped' : 'Unknown'
        const statusItem = new TreeItem(`Status: ${statusText}`, TreeItemCollapsibleState.None)
        const statusColor = this.isServerRunning
          ? 'charts.green'
          // Red if stopped, gray if unknown, but error case is handled above, so this won't be shown
          : this.isServerRunning === false ? 'charts.red' : 'charts.gray'
        statusItem.iconPath = new ThemeIcon('debug-start', new ThemeColor(statusColor))
        statusItem.contextValue = 'LEMONADE_SERVER_STATUS'
        items.push(statusItem as TreeItem)

        // Models section header
        if (this.availableModels.length > 0) {
          const label = `Available Models (${this.availableModels.length})`
          const modelsHeader = new TreeItem(label, TreeItemCollapsibleState.Expanded)
          modelsHeader.iconPath = new ThemeIcon('list-tree')
          modelsHeader.contextValue = 'MODELS_HEADER'
          items.push(modelsHeader as TreeItem)
        } else {
          const noModels = new TreeItem('No models available', TreeItemCollapsibleState.None)
          noModels.iconPath = new ThemeIcon('circle-filled')
          items.push(noModels as TreeItem)
        }

        const audioHeader = new TreeItem('Audio Files', TreeItemCollapsibleState.Expanded)
        audioHeader.iconPath = new ThemeIcon('music')
        audioHeader.contextValue = 'AUDIO_HEADER'
        items.push(audioHeader as TreeItem)

      } else {
        const loadingItem = new TreeItem('Loading status...', TreeItemCollapsibleState.None)
        loadingItem.iconPath = new ThemeIcon('loading~spin')
        items.push(loadingItem as TreeItem)
      }
      return items
    }
    else if (element.contextValue === 'MODELS_HEADER') return this.getModelChildren()
    else if (element.contextValue === 'AUDIO_HEADER') return this.getDirHasAudioChildren()
    else if (element.contextValue === 'AUDIO_DIRECTORY') return this.getAudioFilesChildren(element)
    return []
  }

  private getModelChildren(): TreeItem[] {
    const aModels: TreeItem[] = []
    const bModels: TreeItem[] = []

    for (const model of this.availableModels) {
      const modelId = model.id || 'Unknown'

      if (isWhisperModel(model)) {
        let label = modelId

        if (this.pickedModel === modelId) {
          const pickedItem = new TreeItem(label, TreeItemCollapsibleState.None)
          pickedItem.iconPath = new ThemeIcon('circle-filled', new ThemeColor('charts.green'))
          pickedItem.tooltip = modelId
          aModels.push(pickedItem as TreeItem)
        } else {
          const availableItem = new TreeItem(label, TreeItemCollapsibleState.None)
          availableItem.iconPath = new ThemeIcon('circle-filled')
          availableItem.tooltip = modelId
          availableItem.contextValue = 'WHISPER_AVAILABLE'
          availableItem.command = {
            command: 'audio-lab.pickModel',
            title: 'Select Model for Transcription',
            arguments: [modelId]
          }
          aModels.push(availableItem as TreeItem)
        }
      } else {
        // Non-whisper model - no inline actions, just display
        const otherItem = new TreeItem(modelId, TreeItemCollapsibleState.None)
        otherItem.iconPath = new ThemeIcon('dash')
        bModels.push(otherItem as TreeItem)
      }
    }
    return [...aModels, ...bModels]
  }

  private getDirHasAudioChildren(): TreeItem[] {
    const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm', 'opus', 'amr', 'au', 'aiff']
    const items: TreeItem[] = []
    const workspaceFolders = workspace.workspaceFolders
    if (!workspaceFolders) return [new TreeItem('No workspace opened', TreeItemCollapsibleState.None) as TreeItem]

    // Collect all directories that contain audio files (including nested subdirectories)
    const dirsWithAudio: Set<string> = new Set()
    for (const folder of workspaceFolders) this.collectDirsWithAudio(folder.uri.fsPath, audioExtensions, dirsWithAudio)

    if (dirsWithAudio.size === 0) return [new TreeItem('No audio files found', TreeItemCollapsibleState.None) as TreeItem]

    let rootDir: TreeItem | null = null
    for (const dir of dirsWithAudio) {
      let item: TreeItem
      const label = dir === '.' ? '(workspace)' : dir
      item = new TreeItem(label, TreeItemCollapsibleState.Collapsed)
      const fullPath = path.join(workspaceFolders[0].uri.fsPath, dir === '.' ? '' : dir)
      item.iconPath = new ThemeIcon('folder')
      item.contextValue = 'AUDIO_DIRECTORY'
      item.tooltip = fullPath
      if (dir === '.') rootDir = item
      else items.push(item)
    }
    return rootDir ? [rootDir, ...items] : items
  }

  private collectDirsWithAudio(dirPath: string, audioExtensions: string[], result: Set<string>) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    let hasAudioInDir = false

    for (const entry of entries) {
      if (['node_modules', '.git', '.vscode', 'dist', 'build'].includes(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)
      const ext = entry.name.split('.').pop()?.toLowerCase() || ''

      if (entry.isFile() && audioExtensions.includes(ext)) hasAudioInDir = true
      else if (entry.isDirectory()) this.collectDirsWithAudio(fullPath, audioExtensions, result)
    }

    // Add directory to result if it has audio files directly or in subdirs
    if (hasAudioInDir) {
      const relativeDir = path.relative(
        workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        dirPath
      )
      result.add(relativeDir === '' ? '.' : relativeDir)
    }
  }

  private getAudioFilesChildren(element: TreeItem): TreeItem[] {
    const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'webm', 'opus', 'amr', 'au', 'aiff']
    const items: TreeItem[] = []

    // Get the directory path from the element's tooltip (stored by getDirHasAudioChildren)
    const dirPath = typeof element.tooltip === 'string' ? element.tooltip : ''
    if (!dirPath || !fs.existsSync(dirPath)) {
      const noFilesItem = new TreeItem('No audio files', TreeItemCollapsibleState.None)
      noFilesItem.iconPath = new ThemeIcon('info')
      return [noFilesItem as TreeItem]
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = entry.name.split('.').pop()?.toLowerCase() || ''
          if (!audioExtensions.includes(ext)) continue

          const fullPath = path.join(dirPath, entry.name)
          const isTranscribing = this.transcribingPaths.has(fullPath)
          const fileItem = new TreeItem(Uri.file(fullPath), TreeItemCollapsibleState.None)
          if (isTranscribing) fileItem.iconPath = new ThemeIcon('loading~spin')
          // Hide the "transcribe" context menu option while this file is being transcribed
          fileItem.contextValue = isTranscribing ? 'AUDIO_ITEM_TRANSCRIBING' : 'AUDIO_ITEM'
          fileItem.tooltip = fullPath
          fileItem.command = {
            command: 'vscode.open',
            title: 'Open Audio File in Editor',
            arguments: [Uri.file(fullPath)]
          }
          items.push(fileItem as TreeItem)
        }
      }
    } catch {
      console.error(`AudioLab: Failed to read directory: ${dirPath}`)
    }

    if (items.length === 0) return [new TreeItem('No audio files', TreeItemCollapsibleState.None) as TreeItem]
    return items
  }
}
