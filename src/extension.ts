import { commands, ExtensionContext, TreeItem } from 'vscode'

import { changeServerUrl, openServerUrl, openSettings, revealInExplorer } from './utils'
import { pickModel, transcribeAudio } from './server'
import LemonadeTreeDataProvider from './treeview'

export async function activate(context: ExtensionContext) {
  const rc = commands.registerCommand

  const p = await LemonadeTreeDataProvider.createOrGet()
  const d1 = rc('audio-lab.internal.pickModel', async (modelId: string) => pickModel(modelId, p))

  // No command palette
  const d2 = rc('audio-lab.ncp.transcribeAudioItem', (item: TreeItem) => transcribeAudio(p, item.tooltip?.toString()))
  const d3 = rc('audio-lab.ncp.revealInExplorer', revealInExplorer)

  const d4 = rc('audio-lab.transcribeAudioFile', () => transcribeAudio(p))
  const d5 = rc('audio-lab.changeServerUrl', () => changeServerUrl(p))
  const d6 = rc('audio-lab.openServerUrl', openServerUrl)
  const d7 = rc('audio-lab.openSettings', openSettings)
  const d8 = rc('audio-lab.refreshServerStatus', () => p.refreshStatus())

  context.subscriptions.push(d1, d2, d3, d4, d5, d6, d7, d8)
}

export function deactivate() {
  console.info('AudioLab extension deactivated')
}
