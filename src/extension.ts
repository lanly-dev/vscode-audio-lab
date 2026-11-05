import { commands, workspace } from 'vscode'
import { ExtensionContext } from 'vscode'

import { changeServerUrl, deleteMediaFiles, openServerUrl, openSettings, revealInExplorer } from './utils'
import { createSub, genSpeechFromEditor, genSpeechFromFile, pickModel, pickTtsModel, transcribeAudio } from './server'
import AudioLabTreeItem from './treeItem'
import LemonadeTreeDataProvider from './treeview'

export async function activate(context: ExtensionContext): Promise<void> {
  let tvProvider = await LemonadeTreeDataProvider.createOrGet()
  setupTreeview(tvProvider)
  const rc = commands.registerCommand

  context.subscriptions.push(
    // Internal model-picking commands (tree clicks, hidden from the palette)
    rc('audio-lab.internal.pickModel', (modelId: string) => pickModel(modelId, tvProvider)),
    rc('audio-lab.internal.pickTtsModel', (modelId: string) => pickTtsModel(modelId, tvProvider)),

    // No-palette context-menu commands
    rc('audio-lab.ncp.genSpeechFileItem', (item: AudioLabTreeItem) => genSpeechFromFile(tvProvider, item?.fullPath)),
    rc('audio-lab.ncp.genSpeechSelection', () => genSpeechFromEditor(tvProvider, true)),
    rc('audio-lab.ncp.genSpeechEditor', () => genSpeechFromEditor(tvProvider, false)),
    rc('audio-lab.ncp.revealInExplorer', revealInExplorer),
    rc('audio-lab.ncp.transcribeAudioItem', (item: AudioLabTreeItem) => transcribeAudio(tvProvider, item?.fullPath)),
    rc('audio-lab.ncp.createSubItem', (item: AudioLabTreeItem) => createSub(tvProvider, item?.fullPath)),
    rc('audio-lab.ncp.deleteMediaFileItems', (item: AudioLabTreeItem) => deleteMediaFiles(item, tvProvider)),
    rc('audio-lab.ncp.setVoiceRefItem', (item: AudioLabTreeItem) => tvProvider.setTtsRefVoice(item?.fullPath || null)),
    rc('audio-lab.ncp.clearVoiceRefItem', () => tvProvider.setTtsRefVoice(null)),
    rc('audio-lab.ncp.toggleShowOtherModels', () => tvProvider.setShowOtherModels(true)),
    rc('audio-lab.ncp.toggleHideOtherModels', () => tvProvider.setShowOtherModels(false)),

    // Palette-visible commands
    rc('audio-lab.transcribeAudioFile', () => transcribeAudio(tvProvider)),
    rc('audio-lab.createSub', () => createSub(tvProvider)),
    rc('audio-lab.changeServerUrl', () => changeServerUrl(tvProvider)),
    rc('audio-lab.openServerUrl', openServerUrl),
    rc('audio-lab.openSettings', openSettings),
    rc('audio-lab.refreshServerStatus', () => tvProvider.refreshStatus())
  )

  // Refresh the server status when the configuration changes
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('audio-lab')) return
      tvProvider.refreshStatus()
    })
  )
}

function setupTreeview(treeViewProvider: LemonadeTreeDataProvider): void {
  const treeview = treeViewProvider.theTreeview
  if (!treeview) return
  // Tree view is created inside LemonadeTreeDataProvider.createOrGet().
  // This hook is reserved for badge / title wiring if needed later.
}

export function deactivate(): void {
  console.debug('AudioLab extension deactivated')
}
