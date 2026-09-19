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

import {
  AUDIO_EXTENSIONS,
  getServerUrl,
  hasTransCapability,
  isAllowedTransModel,
  isValidUrl,
  MEDIA_EXTENSIONS,
  SUBTITLE_EXTENSIONS
} from './utils'
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
  private sessionPickedModel: string | null

  private showOtherModels: boolean = false
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
    this.sessionPickedModel = null
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
   * The model selected for transcription, if any. A pick made in this session
   * while no folder was open (so it could not be saved to settings) wins over
   * the setting.
   */
  getPickedModel(): string | null {
    return this.sessionPickedModel ?? this.pickedModel
  }

  /**
   * Remember (or clear with `null`) a model picked while it could not be saved
   * to settings, so that the session still has a usable selection.
   */
  setSessionPickedModel(modelId: string | null): void {
    this.sessionPickedModel = modelId
    this._onDidChangeTreeData.fire()
  }

  /**
   * Show or hide the models that are listed under "Available Models" but cannot
   * be picked for transcription (they lack the transcription capability, or are
   * not allowed by `audio-lab.transcriptionModels`).
   */
  setShowOtherModels(show: boolean): void {
    this.showOtherModels = show
    this._onDidChangeTreeData.fire()
  }

  /** Number of models the server offers that cannot be transcribed. */
  private get unrelatedModelCount(): number {
    const allowedModels = workspace.getConfiguration('audio-lab').get<string[]>('transcriptionModels') || []
    const isSelectable = (model: LemonadeModel) => hasTransCapability(model) && isAllowedTransModel(model, allowedModels)
    return this.availableModels.filter((model) => !isSelectable(model)).length
  }

  /**
   * Context value of the "Available Models" header, which picks the inline eye
   * button: `MODELS_HEADER_WITH_UNRELATED` while those models are listed (icon
   * `$(eye)`), `MODELS_HEADER_TRANSCRIPTION_ONLY` while they are hidden (icon
   * `$(eye-closed)`), and plain `MODELS_HEADER` when the server offers none, so
   * that no button is shown at all.
   */
  private getModelsHeaderContextValue(): string {
    if (this.unrelatedModelCount === 0) return 'MODELS_HEADER'
    return this.showOtherModels ? 'MODELS_HEADER_WITH_UNRELATED' : 'MODELS_HEADER_TRANSCRIPTION_ONLY'
  }

  /**
   * Reset the picked model when it is no longer offered by the server (for
   * example after it was removed in Lemonade), so that a transcription cannot be
   * started with a model that does not exist anymore.
   */
  private async clearUnavailablePickedModel(): Promise<void> {
    const picked = this.getPickedModel()
    if (!picked) return
    if (this.availableModels.some((model) => model.id === picked)) return

    const wasConfigured = this.pickedModel === picked
    this.pickedModel = null
    this.sessionPickedModel = null
    if (wasConfigured) await this.clearConfiguredPickedModel()
    window.showWarningMessage(
      `Model "${picked}" is no longer available on the Lemonade server. Please pick another model for transcription.`
    )
  }

  /** Remove `audio-lab.pickedModel` from the settings scope that defines it. */
  private async clearConfiguredPickedModel(): Promise<void> {
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
          modelsHeader.contextValue = this.getModelsHeaderContextValue()
          items.push(modelsHeader)
        } else {
          const noModels = new TreeItem('No models available', TreeItemCollapsibleState.None)
          noModels.iconPath = new ThemeIcon('circle-filled')
          items.push(noModels)
        }

        const mediaHeader = new TreeItem('Audio & Subtitles', TreeItemCollapsibleState.Expanded)
        mediaHeader.iconPath = new ThemeIcon('music')
        mediaHeader.contextValue = 'MEDIA_HEADER'
        items.push(mediaHeader)

      } else {
        const loadingItem = new TreeItem('Loading status...', TreeItemCollapsibleState.None)
        loadingItem.iconPath = new ThemeIcon('loading~spin')
        items.push(loadingItem)
      }
      return items
    }
    else if (element.contextValue?.startsWith('MODELS_HEADER')) return this.getModelChildren()
    else if (element.contextValue === 'MEDIA_HEADER') return this.getDirHasMediaChildren()
    else if (element.contextValue === 'MEDIA_DIRECTORY') return this.getMediaFilesChildren(element)
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

        if (this.getPickedModel() === modelId) {
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
      } else if (this.showOtherModels) {
        // Model excluded from transcription selection (lacks transcription
        // capability or isn't in the transcriptionModels allow-list) - no inline
        // actions, just display. The header's eye button hides these entirely.
        const otherItem = new TreeItem(modelId, TreeItemCollapsibleState.None)
        otherItem.iconPath = new ThemeIcon('dash')
        bModels.push(otherItem)
      }
    }
    return [...aModels, ...bModels]
  }

  private getDirHasMediaChildren(): TreeItem[] {
    const items: TreeItem[] = []
    const workspaceFolders = workspace.workspaceFolders
    if (!workspaceFolders) return [new TreeItem('No workspace opened', TreeItemCollapsibleState.None)]

    // Collect all directories that contain audio or subtitle files (including nested subdirectories)
    const dirsWithMedia: Set<string> = new Set()
    for (const folder of workspaceFolders) this.collectDirsWithMedia(folder.uri.fsPath, MEDIA_EXTENSIONS, dirsWithMedia)

    if (dirsWithMedia.size === 0) return [new TreeItem('No audio or subtitle files found', TreeItemCollapsibleState.None)]

    let rootDir: TreeItem | null = null
    for (const dir of dirsWithMedia) {
      const label = dir === '.' ? '(workspace)' : dir
      const fullPath = path.join(workspaceFolders[0].uri.fsPath, dir === '.' ? '' : dir)
      const item = new AudioLabTreeItem(label, TreeItemCollapsibleState.Collapsed, fullPath)
      item.iconPath = new ThemeIcon('folder')
      item.contextValue = 'MEDIA_DIRECTORY'
      item.tooltip = fullPath
      if (dir === '.') rootDir = item
      else items.push(item)
    }
    return rootDir ? [rootDir, ...items] : items
  }

  private collectDirsWithMedia(dirPath: string, mediaExtensions: string[], result: Set<string>) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    let hasMediaInDir = false

    for (const entry of entries) {
      if (['node_modules', '.git', '.vscode', 'dist', 'build'].includes(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)
      const ext = entry.name.split('.').pop()?.toLowerCase() || ''

      if (entry.isFile() && mediaExtensions.includes(ext)) hasMediaInDir = true
      else if (entry.isDirectory()) this.collectDirsWithMedia(fullPath, mediaExtensions, result)
    }

    // Add directory to result if it has audio or subtitle files directly or in subdirs
    if (hasMediaInDir) {
      const relativeDir = path.relative(
        workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        dirPath
      )
      result.add(relativeDir === '' ? '.' : relativeDir)
    }
  }

  private getMediaFilesChildren(element: AudioLabTreeItem): TreeItem[] {
    const audioItems: TreeItem[] = []
    const subtitleItems: TreeItem[] = []

    // Directory path carried by the item created in getDirHasMediaChildren()
    const dirPath = element.fullPath || ''
    if (!dirPath || !fs.existsSync(dirPath)) {
      const noFilesItem = new TreeItem('No audio or subtitle files', TreeItemCollapsibleState.None)
      noFilesItem.iconPath = new ThemeIcon('info')
      return [noFilesItem]
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue

        const ext = entry.name.split('.').pop()?.toLowerCase() || ''
        const isAudio = AUDIO_EXTENSIONS.includes(ext)
        const isSubtitle = SUBTITLE_EXTENSIONS.includes(ext)
        if (!isAudio && !isSubtitle) continue

        const fullPath = path.join(dirPath, entry.name)
        const fileItem = new AudioLabTreeItem(Uri.file(fullPath), TreeItemCollapsibleState.None, fullPath)
        fileItem.tooltip = fullPath
        fileItem.command = {
          command: 'vscode.open',
          title: isAudio ? 'Open Audio File in Editor' : 'Open Subtitle File in Editor',
          arguments: [Uri.file(fullPath)]
        }

        if (isAudio) {
          const isTranscribing = this.transcribingPaths.has(fullPath)
          if (isTranscribing) fileItem.iconPath = new ThemeIcon('loading~spin')
          // Hide the "transcribe" context menu option while this file is being transcribed
          fileItem.contextValue = isTranscribing ? 'AUDIO_ITEM_TRANSCRIBING' : 'AUDIO_ITEM'
          audioItems.push(fileItem)
        } else {
          // Subtitle files are listed for reference next to their audio file; the
          // audio-only actions are not offered for them.
          fileItem.contextValue = 'SUBTITLE_ITEM'
          subtitleItems.push(fileItem)
        }
      }
    } catch {
      console.error(`AudioLab: Failed to read directory: ${dirPath}`)
    }

    // Audio files first, then the subtitle files of the same directory
    const items = [...audioItems, ...subtitleItems]
    if (items.length === 0) return [new TreeItem('No audio or subtitle files', TreeItemCollapsibleState.None)]
    return items
  }
}
