import { commands, ExtensionContext, workspace } from 'vscode'

import { changeServerUrl, deleteMediaFile, openServerUrl, openSettings, revealInExplorer } from './utils'
import { pickModel, pickTtsModel, generateSpeechFromTextFile, generateSpeechFromEditor, transcribeAudio, createSubtitles } from './server'
import AudioLabTreeItem from './treeItem'
import LemonadeTreeDataProvider from './treeview'

export async function activate(context: ExtensionContext) {
  const rc = commands.registerCommand

  const p = await LemonadeTreeDataProvider.createOrGet()
  const d1a = rc('audio-lab.internal.pickModel', async (modelId: string) => pickModel(modelId, p))
  const d1b = rc('audio-lab.internal.pickTtsModel', async (modelId: string) => pickTtsModel(modelId, p))

  // TTS entry points (context menus only - hidden from the command palette)
  const d2a = rc('audio-lab.ncp.speakTextFileItem', (item: AudioLabTreeItem) => generateSpeechFromTextFile(p, item?.fullPath))
  const d2b = rc('audio-lab.ncp.speakSelection', () => generateSpeechFromEditor(p, true))
  const d2c = rc('audio-lab.ncp.speakEditorContent', () => generateSpeechFromEditor(p, false))

  // No command palette
  const d3 = rc('audio-lab.ncp.revealInExplorer', revealInExplorer)
  const d4 = rc('audio-lab.ncp.transcribeAudioItem', (item: AudioLabTreeItem) => transcribeAudio(p, item?.fullPath))
  const d5 = rc('audio-lab.ncp.createSubtitlesItem', (item: AudioLabTreeItem) => createSubtitles(p, item?.fullPath))
  const d6 = rc('audio-lab.ncp.deleteMediaFileItem', (item: AudioLabTreeItem) => deleteMediaFile(item, p))
  const d7 = rc('audio-lab.ncp.toggleShowOtherModels', () => p.setShowOtherModels(true))
  const d8 = rc('audio-lab.ncp.toggleHideOtherModels', () => p.setShowOtherModels(false))

  const d9 = rc('audio-lab.transcribeAudioFile', () => transcribeAudio(p))
  const d10 = rc('audio-lab.createSubtitles', () => createSubtitles(p))
  const d11 = rc('audio-lab.changeServerUrl', () => changeServerUrl(p))
  const d12 = rc('audio-lab.openServerUrl', openServerUrl)
  const d13 = rc('audio-lab.openSettings', openSettings)
  const d14 = rc('audio-lab.refreshServerStatus', () => p.refreshStatus()) 

  // Refresh the server status when the configuration changes
  const d15 = workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('audio-lab')) return
    p.refreshStatus()
  })
  context.subscriptions.push(d1a, d1b, d2a, d2b, d2c, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15)
}

export function deactivate() {
  console.info('AudioLab extension deactivated')
}
