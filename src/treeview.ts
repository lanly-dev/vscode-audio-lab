import * as fs from 'fs'
import * as path from 'path'
import {
  ConfigurationTarget,
  Event,
  EventEmitter,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  Uri,
  window,
  workspace
} from 'vscode'

import { AUDIO_EXTENSIONS, getServerUrl, hasTransCapability, isAllowedTransModel, isValidUrl } from './utils'
import { getLemonadeStatus } from './server'
import { LemonadeModel, LemonadeStatus } from './types'
import AudioLabTreeItem from './treeItem'

export default class LemonadeTreeDataProvider implements TreeDataProvider<TreeItem> {
  private static instance: LemonadeTreeDataProvider | null = null

  private _onDidChangeTreeData: EventEmitter<void> = new EventEmitter<void>()
  readonly onDidChangeTreeData: Event<void> = this._onDidChangeTreeData.event

  private availableModels: LemonadeModel[] = []
  private currentServerUrl: string
  private hasError: Error | null
  private pickedModel: string | null
  private serverStatusData: LemonadeStatus | null
  private transcribingPaths: Set<string> = new Set()
  private treeView?: TreeView<TreeItem>

  // Singleton instance accessor and initializer
  static async createOrGet(): Promise<LemonadeTreeDataProvider> {
    if (LemonadeTreeDataProvider.instance) return LemonadeTreeDataProvider.instance
    const td = new LemonadeTreeDataProvider()
    td.treeView = window.createTreeView('lemonadeStatus', {
      treeDataProvider: td,
      showCollapseAll: true
    })
    await td.refreshStatus()
    LemonadeTreeDataProvider.instance = td
    return td
  }

  constructor() {
    const serverUrl = getServerUrl()
    if (!serverUrl) throw new Error('Lemonade server URL is not configured.')

    this.hasError = null
    this.availableModels = []
    this.serverStatusData = null
    this.currentServerUrl = serverUrl
    this.pickedModel = workspace.getConfiguration('audio-lab').get<string>('pickedModel') || null
  }

  async refreshStatus(): Promise<void> {
    this.hasError = null
    this.serverStatusData = null
    this.currentServerUrl = getServerUrl()
    this.pickedModel = workspace.getConfiguration('audio-lab').get<string>('pickedModel') || null
    this._onDidChangeTreeData.fire() // For the effect

    if (!isValidUrl(this.currentServerUrl)) {
      this.availableModels = []
      this._onDidChangeTreeData.fire()
      return
    }
    try {
      this.serverStatusData = await getLemonadeStatus()
    } catch (error) {
      this.hasError = error as Error
      this.availableModels = []
      this._onDidChangeTreeData.fire()
      return
    }
    this.availableModels = this.serverStatusData.models || []
    await this.clearUnavailablePickedModel()

    this._onDidChangeTreeData.fire()
  }

  /**
   * Reset `audio-lab.pickedModel` when the selected model is no longer offered
   * by the server (for example after it was removed in Lemonade), so that a
   * transcription cannot be started with a model that does not exist anymore.
   */
  private async clearUnavailablePickedModel(): Promise<void> {
    const picked = this.pickedModel
    if (!picked) return
    if (this.availableModels.some((model) => model.id === picked)) return

    this.pickedModel = null
    const config = workspace.getConfiguration('audio-lab')
    const inspected = config.inspect<string>('pickedModel')
    // Clear the scope that actually defines the value, otherwise a stale user
    // setting would keep overriding a cleared workspace setting.
    let target = ConfigurationTarget.Global
    if (inspected?.workspaceFolderValue !== undefined) target = ConfigurationTarget.WorkspaceFolder
    else if (inspected?.workspaceValue !== undefined) target = ConfigurationTarget.Workspace

    try {
      await config.update('pickedModel', undefined, target)
    } catch (error) {
      console.error('AudioLab: failed to clear the unavailable picked model:', error)
    }
    window.showWarningMessage(
      `Model "${picked}" is no longer available on the Lemonade server. Please pick another model for transcription.`
    )
  }

  /**
   * Start or stop showing the transcription spinner on an audio file tree item.
   * Each file path is tracked independently, so multiple concurrent transcriptions
   * each show their own spinner. The tree view badge also reflects the number of
   * in-flight transcriptions.
   */
  setTranscribing(filePath: string, transcribing: boolean): void {
    if (transcribing) this.transcribingPaths.add(filePath)
    else this.transcribingPaths.delete(filePath)
    this._onDidChangeTreeData.fire()
    this.updateBadge()
  }

  /**
   * Update the tree view badge to show how many transcriptions are currently
   * in progress. Cleared when none are running.
   */
  private updateBadge(): void {
    if (!this.treeView) return
    const count = this.transcribingPaths.size
    if (count === 0) this.treeView.badge = undefined
    else {
      this.treeView.badge = {
        value: count,
        tooltip: `${count} transcription${count === 1 ? '' : 's'} in progress`
      }
    }
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const items: TreeItem[] = []
    if (this.hasError) {
      const errorItem = new TreeItem(`${this.hasError.message}`, TreeItemCollapsibleState.None)
      errorItem.iconPath = new ThemeIcon('error', new ThemeColor('charts.red'))
      const currentUrl = this.currentServerUrl
      const pleaseCheckItem = new TreeItem(`Please check your server URL: ${currentUrl}`, TreeItemCollapsibleState.None)
      pleaseCheckItem.iconPath = new ThemeIcon('light-bulb', new ThemeColor('charts.yellow'))
      pleaseCheckItem.command = {
        title: 'Edit Server URL',
        command: 'audio-lab.changeServerUrl'
      }
      return [errorItem, pleaseCheckItem]
    }
    if (!element) {
      // Root level items

      if (this.serverStatusData) {
        // Server URL item
        const urlItem = new TreeItem(`${this.serverStatusData.url}`, TreeItemCollapsibleState.None)
        urlItem.iconPath = new ThemeIcon('server')
        urlItem.tooltip = `Server URL: ${this.currentServerUrl}`
        urlItem.contextValue = 'LEMONADE_SERVER_URL'
        items.push(urlItem)

        // Status indicator: a status only exists after a successful request, so
        // the server is running whenever this item is shown (connection failures
        // render the error item instead).
        const statusItem = new TreeItem('Status: Running', TreeItemCollapsibleState.None)
        statusItem.iconPath = new ThemeIcon('debug-start', new ThemeColor('charts.green'))
        statusItem.contextValue = 'LEMONADE_SERVER_STATUS'
        items.push(statusItem)

        // Models section header
        if (this.availableModels.length > 0) {
          const label = `Available Models (${this.availableModels.length})`
          const modelsHeader = new TreeItem(label, TreeItemCollapsibleState.Expanded)
          modelsHeader.iconPath = new ThemeIcon('list-tree')
          modelsHeader.contextValue = 'MODELS_HEADER'
          items.push(modelsHeader)
        } else {
          const noModels = new TreeItem('No models available', TreeItemCollapsibleState.None)
          noModels.iconPath = new ThemeIcon('circle-filled')
          items.push(noModels)
        }

        const audioHeader = new TreeItem('Audio Files', TreeItemCollapsibleState.Expanded)
        audioHeader.iconPath = new ThemeIcon('music')
        audioHeader.contextValue = 'AUDIO_HEADER'
        items.push(audioHeader)

      } else {
        const loadingItem = new TreeItem('Loading status...', TreeItemCollapsibleState.None)
        loadingItem.iconPath = new ThemeIcon('loading~spin')
        items.push(loadingItem)
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

    const allowedModels = workspace.getConfiguration('audio-lab').get<string[]>('transcriptionModels') || []

    for (const model of this.availableModels) {
      const modelId = model.id || 'Unknown'

      if (hasTransCapability(model) && isAllowedTransModel(model, allowedModels)) {
        let label = modelId

        if (this.pickedModel === modelId) {
          const pickedItem = new TreeItem(label, TreeItemCollapsibleState.None)
          pickedItem.iconPath = new ThemeIcon('circle-filled', new ThemeColor('charts.green'))
          pickedItem.tooltip = modelId
          aModels.push(pickedItem)
        } else {
          const availableItem = new TreeItem(label, TreeItemCollapsibleState.None)
          availableItem.iconPath = new ThemeIcon('circle-filled')
          availableItem.tooltip = modelId
          availableItem.contextValue = 'TRANSCRIBE_AVAILABLE'
          availableItem.command = {
            command: 'audio-lab.internal.pickModel',
            title: 'Select Model for Transcription',
            arguments: [modelId]
          }
          aModels.push(availableItem)
        }
      } else {
        // Model excluded from transcription selection (lacks transcription
        // capability or isn't in the transcriptionModels allow-list) - no inline
        // actions, just display
        const otherItem = new TreeItem(modelId, TreeItemCollapsibleState.None)
        otherItem.iconPath = new ThemeIcon('dash')
        bModels.push(otherItem)
      }
    }
    return [...aModels, ...bModels]
  }

  private getDirHasAudioChildren(): TreeItem[] {
    const items: TreeItem[] = []
    const workspaceFolders = workspace.workspaceFolders
    if (!workspaceFolders) return [new TreeItem('No workspace opened', TreeItemCollapsibleState.None)]

    // Collect all directories that contain audio files (including nested subdirectories)
    const dirsWithAudio: Set<string> = new Set()
    for (const folder of workspaceFolders) this.collectDirsWithAudio(folder.uri.fsPath, AUDIO_EXTENSIONS, dirsWithAudio)

    if (dirsWithAudio.size === 0) return [new TreeItem('No audio files found', TreeItemCollapsibleState.None)]

    let rootDir: TreeItem | null = null
    for (const dir of dirsWithAudio) {
      const label = dir === '.' ? '(workspace)' : dir
      const fullPath = path.join(workspaceFolders[0].uri.fsPath, dir === '.' ? '' : dir)
      const item = new AudioLabTreeItem(label, TreeItemCollapsibleState.Collapsed, fullPath)
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

  private getAudioFilesChildren(element: AudioLabTreeItem): TreeItem[] {
    const items: TreeItem[] = []

    // Directory path carried by the item created in getDirHasAudioChildren()
    const dirPath = element.fullPath || ''
    if (!dirPath || !fs.existsSync(dirPath)) {
      const noFilesItem = new TreeItem('No audio files', TreeItemCollapsibleState.None)
      noFilesItem.iconPath = new ThemeIcon('info')
      return [noFilesItem]
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = entry.name.split('.').pop()?.toLowerCase() || ''
          if (!AUDIO_EXTENSIONS.includes(ext)) continue

          const fullPath = path.join(dirPath, entry.name)
          const isTranscribing = this.transcribingPaths.has(fullPath)
          const fileItem = new AudioLabTreeItem(Uri.file(fullPath), TreeItemCollapsibleState.None, fullPath)
          if (isTranscribing) fileItem.iconPath = new ThemeIcon('loading~spin')
          // Hide the "transcribe" context menu option while this file is being transcribed
          fileItem.contextValue = isTranscribing ? 'AUDIO_ITEM_TRANSCRIBING' : 'AUDIO_ITEM'
          fileItem.tooltip = fullPath
          fileItem.command = {
            command: 'vscode.open',
            title: 'Open Audio File in Editor',
            arguments: [Uri.file(fullPath)]
          }
          items.push(fileItem)
        }
      }
    } catch {
      console.error(`AudioLab: Failed to read directory: ${dirPath}`)
    }

    if (items.length === 0) return [new TreeItem('No audio files', TreeItemCollapsibleState.None)]
    return items
  }
}
