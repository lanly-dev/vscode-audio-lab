import { commands, ExtensionContext, TreeItem } from 'vscode'

import { changeServerUrl, openServerUrl, openSettings, revealInExplorer } from './utils'
import { pickModel, transcribeAudio } from './server'
import LemonadeTreeDataProvider from './treeview'

export async function activate(context: ExtensionContext) {
  const rc = commands.registerCommand

  const p = await LemonadeTreeDataProvider.createOrGet()
  const d1a = rc('audio-lab.transcribeAudioFile', () => transcribeAudio(p))
  const d1b = rc('audio-lab.transcribeAudioItem', (item: TreeItem) => transcribeAudio(p, item.tooltip?.toString()))

  const d2 = rc('audio-lab.internal.pickModel', async (modelId: string) => pickModel(modelId, p))

  const d3 = rc('audio-lab.changeServerUrl', () => changeServerUrl(p))
  const d4 = rc('audio-lab.openServerUrl', openServerUrl)
  const d5 = rc('audio-lab.openSettings', openSettings)
  const d6 = rc('audio-lab.refreshServerStatus', () => p.refreshStatus())
  const d7 = rc('audio-lab.revealInExplorer', revealInExplorer)

  context.subscriptions.push(d1a, d1b, d2, d3, d4, d5, d6, d7)
}

export function deactivate() {
  console.info('AudioLab extension deactivated')
}
