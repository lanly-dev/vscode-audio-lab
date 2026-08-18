import * as vscode from 'vscode'
import LemonadeTreeDataProvider from './Treeview'
import { changeServerUrl, openServerUrl, openSettings, revealInExplorer } from './Config'
import { pickModel, transcribeAudio } from './Server'

export async function activate(context: vscode.ExtensionContext) {
  const rc = vscode.commands.registerCommand

  const lemonadeProvider = await createTreeViews()
  const d1a = rc('audio-lab.transcribeAudioFile', () => transcribeAudio(lemonadeProvider))
  const d1b = rc('audio-lab.transcribeAudioItem', (item: vscode.TreeItem) => transcribeAudio(lemonadeProvider, item.tooltip?.toString()))

  const d2 = rc('audio-lab.changeServerUrl', () => changeServerUrl(lemonadeProvider))
  const d3 = rc('audio-lab.openServerUrl', () => openServerUrl())
  const d4 = rc('audio-lab.openSettings', openSettings)
  const d5 = rc('audio-lab.pickModel', async (modelId: string) => pickModel(modelId, lemonadeProvider))
  const d6 = rc('audio-lab.refreshServerStatus', () => lemonadeProvider.refreshStatus())
  const d7 = rc('audio-lab.revealInExplorer', revealInExplorer)

  context.subscriptions.push(d1a, d1b, d2, d3, d4, d5, d6, d7)
}

// Register tree view for Lemonade status
async function createTreeViews() {
  const lemonadeProvider = new LemonadeTreeDataProvider()
  vscode.window.createTreeView('lemonadeStatus', {
    treeDataProvider: lemonadeProvider,
    showCollapseAll: true
  })
  await lemonadeProvider.refreshStatus()
  return lemonadeProvider
}

export function deactivate() {
  console.info('AudioLab extension deactivated')
}
