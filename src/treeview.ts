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
  hasTtsCapability,
  isAllowedTransModel,
  isAllowedTtsModel,
  isValidUrl,
  MEDIA_EXTENSIONS,
  TEXT_EXTENSIONS,
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
  private pickedSttModel: string | null
  private pickedTtsModel: string | null
  private sessionPickedSttModel: string | null
  private sessionPickedTtsModel: string | null

  private showOtherModels: boolean = false
  private serverStatusData: LemonadeStatus | null
  private transcribingPaths: Set<string> = new Set()
  private treeView?: TreeView<TreeItem>

  // Singleton instance accessor and initializer
  static async createOrGet(): Promise<LemonadeTreeDataProvider> {
    if (LemonadeTreeDataProvider.instance) return LemonadeTreeDataProvider.instance
    const td = new LemonadeTreeDataProvider()
    td.treeView = window.createTreeView('lemonadeStatus', { treeDataProvider: td, showCollapseAll: true })
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
    this.pickedSttModel = workspace.getConfiguration('audio-lab').get<string>('pickedSttModel') || null
    this.pickedTtsModel = workspace.getConfiguration('audio-lab').get<string>('pickedTtsModel') || null
    this.sessionPickedSttModel = null
    this.sessionPickedTtsModel = null
  }

  refreshTree(): void {
    this._onDidChangeTreeData.fire()
  }

  async refreshStatus(): Promise<void> {
    this.hasError = null
    this.serverStatusData = null
    this.currentServerUrl = getServerUrl()
    this.pickedSttModel = workspace.getConfiguration('audio-lab').get<string>('pickedSttModel') || null
    this.pickedTtsModel = workspace.getConfiguration('audio-lab').get<string>('pickedTtsModel') || null
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
    await this.clearUnavailablePickedSttModel()
    await this.clearUnavailablePickedTtsModel()

    this._onDidChangeTreeData.fire()
  }

  /**
   * The model selected for transcription (STT), if any. A pick made in this
   * session while no folder was open (so it could not be saved to settings)
   * wins over the setting.
   */
  getPickedSttModel(): string | null {
    return this.sessionPickedSttModel ?? this.pickedSttModel
  }

  /** The model selected for TTS, if any (session pick wins over the setting). */
  getPickedTtsModel(): string | null {
    return this.sessionPickedTtsModel ?? this.pickedTtsModel
  }

  /**
   * Remember (or clear with `null`) a model picked while it could not be saved
   * to settings, so that the session still has a usable selection.
   */
  setSessionPickedSttModel(modelId: string | null): void {
    this.sessionPickedSttModel = modelId
    this._onDidChangeTreeData.fire()
  }

  /** Remember (or clear) a TTS model picked while it could not be saved. */
  setSessionPickedTtsModel(modelId: string | null): void {
    this.sessionPickedTtsModel = modelId
    this._onDidChangeTreeData.fire()
  }

  /**
   * Show or hide the models that are listed under "Installed Models > Other" but
   * cannot be picked for transcription (they lack the transcription capability,
   * or are not allowed by `audio-lab.transcriptionModels`) nor for TTS.
   */
  setShowOtherModels(show: boolean): void {
    this.showOtherModels = show
    this._onDidChangeTreeData.fire()
  }

  /** Number of models the server offers that are neither STT nor TTS selectable. */
  private get unrelatedModelCount(): number {
    return this.availableModels.filter((model) => !this.isSttSelectable(model) && !this.isTtsSelectable(model)).length
  }

  /**
   * Context value of the "Installed Models" header, which picks the inline eye
   * button: `MODELS_HEADER_WITH_UNRELATED` while the "Other" group is listed
   * (icon `$(eye)`), `MODELS_HEADER_TRANSCRIPTION_ONLY` while it is hidden
   * (icon `$(eye-closed)`), and plain `MODELS_HEADER` when the server offers no
   * unrelated models, so that no button is shown at all.
   */
  private getModelsHeaderContextValue(): string {
    if (this.unrelatedModelCount === 0) return 'MODELS_HEADER'
    return this.showOtherModels ? 'MODELS_HEADER_WITH_UNRELATED' : 'MODELS_HEADER_TRANSCRIPTION_ONLY'
  }

  /**
   * Reset the picked STT model when it is no longer offered by the server (for
   * example after it was removed in Lemonade), so that a transcription cannot be
   * started with a model that does not exist anymore.
   */
  private async clearUnavailablePickedSttModel(): Promise<void> {
    const picked = this.getPickedSttModel()
    if (!picked) return
    if (this.availableModels.some((model) => model.id === picked)) return

    const wasConfigured = this.pickedSttModel === picked
    this.pickedSttModel = null
    this.sessionPickedSttModel = null
    if (wasConfigured) await this.clearConfiguredPickedSttModel()
    window.showWarningMessage(`Model "${picked}" is not found. Please pick another model for transcription.`)
  }

  /** Remove `audio-lab.pickedSttModel` from the settings scope that defines it. */
  private async clearConfiguredPickedSttModel(): Promise<void> {
    const config = workspace.getConfiguration('audio-lab')
    const inspected = config.inspect<string>('pickedSttModel')
    // Clear the scope that actually defines the value, otherwise a stale user
    // setting would keep overriding a cleared workspace setting.
    let target = ConfigurationTarget.Global
    if (inspected?.workspaceFolderValue !== undefined) target = ConfigurationTarget.WorkspaceFolder
    else if (inspected?.workspaceValue !== undefined) target = ConfigurationTarget.Workspace

    try {
      await config.update('pickedSttModel', undefined, target)
    } catch (error) {
      console.error('AudioLab: failed to clear the unavailable picked model:', error)
    }
  }

  /** Reset the picked TTS model when it is no longer offered by the server. */
  private async clearUnavailablePickedTtsModel(): Promise<void> {
    const picked = this.getPickedTtsModel()
    if (!picked) return
    if (this.availableModels.some((model) => model.id === picked)) return

    const wasConfigured = this.pickedTtsModel === picked
    this.pickedTtsModel = null
    this.sessionPickedTtsModel = null
    if (wasConfigured) {
      try {
        const config = workspace.getConfiguration('audio-lab')
        const inspected = config.inspect<string>('pickedTtsModel')
        let target = ConfigurationTarget.Global
        if (inspected?.workspaceFolderValue !== undefined) target = ConfigurationTarget.WorkspaceFolder
        else if (inspected?.workspaceValue !== undefined) target = ConfigurationTarget.Workspace
        await config.update('pickedTtsModel', undefined, target)
      } catch (error) {
        console.error('AudioLab: failed to clear the unavailable picked TTS model:', error)
      }
    }
    window.showWarningMessage(`Model "${picked}" is not found. Please pick another TTS model.`)
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
      pleaseCheckItem.command = { title: 'Edit Server URL', command: 'audio-lab.changeServerUrl' }
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

        // Models section: one "Installed Models" header grouping STT (speech to
        // text / subgen), TTS (text to speech) and everything else.
        if (this.availableModels.length > 0) {
          const label = `Installed Models (${this.availableModels.length})`
          const modelsHeader = new TreeItem(label, TreeItemCollapsibleState.Expanded)
          modelsHeader.iconPath = new ThemeIcon('list-tree')
          modelsHeader.contextValue = this.getModelsHeaderContextValue()
          modelsHeader.tooltip = 'Models installed on the Lemonade server, grouped by capability.'
          items.push(modelsHeader)
        } else {
          const noModels = new TreeItem('No models available', TreeItemCollapsibleState.None)
          noModels.iconPath = new ThemeIcon('circle-filled')
          items.push(noModels)
        }

        const mediaHeader = new TreeItem('Media Files', TreeItemCollapsibleState.Expanded)
        mediaHeader.iconPath = new ThemeIcon('octoface')
        mediaHeader.contextValue = 'MEDIA_HEADER'
        mediaHeader.tooltip = 'Media files in the workspace.'
        items.push(mediaHeader)

      } else {
        const loadingItem = new TreeItem('Loading status...', TreeItemCollapsibleState.None)
        loadingItem.iconPath = new ThemeIcon('loading~spin')
        items.push(loadingItem)
      }
      return items
    } else if (element.contextValue?.startsWith('MODELS_HEADER')) return this.getInstalledModelsGroups()
    else if (element.contextValue === 'STT_HEADER') return this.getSttModelChildren()
    else if (element.contextValue === 'TTS_HEADER') return this.getTtsModelChildren()
    else if (element.contextValue === 'OTHER_HEADER') return this.getOtherModelChildren()
    else if (element.contextValue === 'MEDIA_HEADER') return this.getDirHasMediaChildren()
    else if (element.contextValue === 'MEDIA_DIRECTORY') return this.getMediaFilesChildren(element)
    return []
  }

  /** Whether a model is offered as a selectable STT / subtitle model. */
  private isSttSelectable(model: LemonadeModel): boolean {
    const allowed = workspace.getConfiguration('audio-lab').get<string[]>('transcriptionModels') || []
    return hasTransCapability(model) && isAllowedTransModel(model, allowed)
  }

  /** Whether a model is offered as a selectable TTS voice model. */
  private isTtsSelectable(model: LemonadeModel): boolean {
    const allowed = workspace.getConfiguration('audio-lab').get<string[]>('ttsModels') || []
    return hasTtsCapability(model) && isAllowedTtsModel(model, allowed)
  }

  /**
   * The three capability groups nested under "Installed Models": STT / Subgen
   * (speech-to-text + subtitle generation), TTS (text-to-speech) and Other
   * (everything else). The Other group only appears while `showOtherModels` is
   * on, toggled by the eye button on the parent header.
   */
  private getInstalledModelsGroups(): TreeItem[] {
    const sttModels = this.availableModels.filter((m) => this.isSttSelectable(m))
    const ttsModels = this.availableModels.filter((m) => this.isTtsSelectable(m))
    const otherCount = this.unrelatedModelCount

    const sttHeader = new TreeItem(`STT / Subgen (${sttModels.length})`, TreeItemCollapsibleState.Expanded)
    sttHeader.iconPath = new ThemeIcon('mic')
    sttHeader.contextValue = 'STT_HEADER'
    sttHeader.tooltip = 'Speech-to-text models for transcription and subtitles. Click a model to select it.'

    const ttsHeader = new TreeItem(`TTS (${ttsModels.length})`, TreeItemCollapsibleState.Expanded)
    ttsHeader.iconPath = new ThemeIcon('megaphone')
    ttsHeader.contextValue = 'TTS_HEADER'
    ttsHeader.tooltip = 'Text-to-speech models. Click a model to select it.'

    const groups: TreeItem[] = [sttHeader, ttsHeader]
    if (this.showOtherModels && otherCount > 0) {
      const otherHeader = new TreeItem(`Other (${otherCount})`, TreeItemCollapsibleState.Expanded)
      otherHeader.iconPath = new ThemeIcon('dash')
      otherHeader.contextValue = 'OTHER_HEADER'
      otherHeader.tooltip = 'Other installed models (not usable for STT or TTS).'
      groups.push(otherHeader)
    }
    return groups
  }

  private getTtsModelChildren(): TreeItem[] {
    const items: TreeItem[] = []
    for (const model of this.availableModels) {
      if (!this.isTtsSelectable(model)) continue
      const modelId = model.id || 'Unknown'
      const sizeLabel = model.size ? `${model.size} GB` : 'Size N/A'
      const label = `${modelId} ${sizeLabel}`
      if (this.getPickedTtsModel() === modelId) {
        const pickedItem = new TreeItem(label, TreeItemCollapsibleState.None)
        pickedItem.iconPath = new ThemeIcon('circle-filled', new ThemeColor('charts.green'))
        pickedItem.tooltip = modelId
        // Show description like the screenshot ("Size N/A", "8.50 GB", ...)
        pickedItem.description = sizeLabel
        items.push(pickedItem)
      } else {
        const item = new TreeItem(label, TreeItemCollapsibleState.None)
        item.iconPath = new ThemeIcon('circle-filled')
        item.tooltip = modelId
        item.description = sizeLabel
        item.contextValue = 'TTS_AVAILABLE'
        item.command = {
          command: 'audio-lab.internal.pickTtsModel',
          title: 'Select TTS Model',
          arguments: [modelId]
        }
        items.push(item)
      }
    }
    if (items.length === 0) {
      const hint = new TreeItem('No TTS models — adjust audio-lab.ttsModels', TreeItemCollapsibleState.None)
      hint.iconPath = new ThemeIcon('info')
      return [hint]
    }
    return items
  }

  private getSttModelChildren(): TreeItem[] {
    const items: TreeItem[] = []
    for (const model of this.availableModels) {
      if (!this.isSttSelectable(model)) continue
      const modelId = model.id || 'Unknown'
      if (this.getPickedSttModel() === modelId) {
        const pickedItem = new TreeItem(modelId, TreeItemCollapsibleState.None)
        pickedItem.iconPath = new ThemeIcon('circle-filled', new ThemeColor('charts.green'))
        pickedItem.tooltip = modelId
        items.push(pickedItem)
      } else {
        const availableItem = new TreeItem(modelId, TreeItemCollapsibleState.None)
        availableItem.iconPath = new ThemeIcon('circle-filled')
        availableItem.tooltip = modelId
        availableItem.contextValue = 'TRANSCRIBE_AVAILABLE'
        availableItem.command = {
          command: 'audio-lab.internal.pickModel',
          title: 'Select Model for Transcription',
          arguments: [modelId]
        }
        items.push(availableItem)
      }
    }
    if (items.length === 0) {
      const hint = new TreeItem('No STT models — adjust audio-lab.transcriptionModels', TreeItemCollapsibleState.None)
      hint.iconPath = new ThemeIcon('info')
      return [hint]
    }
    return items
  }

  /** Models that are installed but usable for neither STT nor TTS. Display only. */
  private getOtherModelChildren(): TreeItem[] {
    const items: TreeItem[] = []
    for (const model of this.availableModels) {
      if (this.isSttSelectable(model) || this.isTtsSelectable(model)) continue
      const otherItem = new TreeItem(model.id || 'Unknown', TreeItemCollapsibleState.None)
      otherItem.iconPath = new ThemeIcon('dash')
      items.push(otherItem)
    }
    if (items.length === 0) {
      const hint = new TreeItem('No other models', TreeItemCollapsibleState.None)
      hint.iconPath = new ThemeIcon('info')
      return [hint]
    }
    return items
  }

  private getDirHasMediaChildren(): TreeItem[] {
    const items: TreeItem[] = []
    const workspaceFolders = workspace.workspaceFolders
    if (!workspaceFolders) return [new TreeItem('No workspace opened', TreeItemCollapsibleState.None)]

    // Collect all directories that contain audio, subtitle or text files (including nested subdirectories)
    const dirsWithMedia: Set<string> = new Set()
    for (const folder of workspaceFolders) this.collectDirsWithMedia(folder.uri.fsPath, MEDIA_EXTENSIONS, dirsWithMedia)

    if (dirsWithMedia.size === 0) return [new TreeItem('No media files found', TreeItemCollapsibleState.None)]

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
      const relativeDir = path.relative(workspace.workspaceFolders?.[0]?.uri.fsPath || '', dirPath)
      result.add(relativeDir === '' ? '.' : relativeDir)
    }
  }

  private getMediaFilesChildren(element: AudioLabTreeItem): TreeItem[] {
    const audioItems: TreeItem[] = []
    const subtitleItems: TreeItem[] = []
    const textItems: TreeItem[] = []

    // Directory path carried by the item created in getDirHasMediaChildren()
    const dirPath = element.fullPath || ''
    if (!dirPath || !fs.existsSync(dirPath)) {
      const noFilesItem = new TreeItem('No audio, subtitle, or text files found', TreeItemCollapsibleState.None)
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
        const isText = TEXT_EXTENSIONS.includes(ext)
        if (!isAudio && !isSubtitle && !isText) continue

        const fullPath = path.join(dirPath, entry.name)
        const fileItem = new AudioLabTreeItem(Uri.file(fullPath), TreeItemCollapsibleState.None, fullPath)
        fileItem.tooltip = fullPath
        fileItem.command = {
          command: 'vscode.open',
          title: isAudio ? 'Open Audio File in Editor' : isSubtitle ? 'Open Subtitle File in Editor' : 'Open File in Editor',
          arguments: [Uri.file(fullPath)]
        }

        if (isAudio) {
          const isTranscribing = this.transcribingPaths.has(fullPath)
          fileItem.contextValue = isTranscribing ? 'AUDIO_ITEM_TRANSCRIBING' : 'AUDIO_ITEM'
          if (isTranscribing) fileItem.iconPath = new ThemeIcon('loading~spin')
        } else if (isSubtitle) fileItem.contextValue = 'SUBTITLE_ITEM'
        else fileItem.contextValue = 'TEXT_ITEM'

        if (isAudio) audioItems.push(fileItem)
        else if (isSubtitle) subtitleItems.push(fileItem)
        else textItems.push(fileItem)
      }
    } catch {
      console.error(`AudioLab: Failed to read directory: ${dirPath}`)
    }

    // Audio files first, then subtitle files, then plain-text files
    const items = [...audioItems, ...subtitleItems, ...textItems]
    if (items.length === 0) return [new TreeItem('No media files found', TreeItemCollapsibleState.None)]
    return items
  }
}
