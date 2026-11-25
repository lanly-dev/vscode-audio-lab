import * as os from 'os'
import { spawn } from 'child_process'
import * as path from 'path'
import {
  commands,
  extensions,
  StatusBarAlignment,
  StatusBarItem,
  window,
  workspace
} from 'vscode'

const EMC_EXTENSION_ID = 'lanly-dev.easymediaconverter'
const EMC_MIN_VERSION = '3.1.0'

function isVersionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return true
}

/** Records 10 seconds of audio from the default microphone and exposes a
 * status bar button to start recording. The recorded WAV is passed to an
 * optional callback so the caller can persist it (e.g. as a voice reference).
 *
 * Depends on the Easy Media Converter extension (`lanly-dev.easymediaconverter`)
 * which bundles ffmpeg — voice recording requires ffmpeg under the hood, and
 * EMC is the declared dependency instead of requiring system ffmpeg directly.
 */
export class VoiceRecorder {
  private statusBarItem?: StatusBarItem
  private isRecording = false

  constructor(private readonly onRecordingComplete?: (outputPath: string) => Promise<void>) {}

  /** Create or update the status bar item based on the showVoiceRecorder setting. */
  setupVoiceRecorder(): void {
    const show = workspace.getConfiguration('audio-lab').get<boolean>('showVoiceRecorder', true)
    if (show) {
      if (!this.statusBarItem) {
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100)
        this.statusBarItem.command = 'audio-lab.ncp.recordVoiceItem'
        this.statusBarItem.text = '$(record) Record Voice'
        this.statusBarItem.tooltip = 'Record 10-second voice reference'
      }
      this.statusBarItem.show()
    } else if (this.statusBarItem) {
      this.statusBarItem.hide()
    }
  }

  /** Check if the Easy Media Converter extension is installed and meets the
   * minimum version. Shows an install/update prompt if not. */
  private async checkEmcAvailable(): Promise<boolean> {
    const emc = extensions.getExtension(EMC_EXTENSION_ID)
    if (!emc) {
      const action = await window.showErrorMessage(
        'Voice recording needs the Easy Media Converter extension, which is not installed.',
        'Install Easy Media Converter'
      )
      if (action) await commands.executeCommand('workbench.extensions.installExtension', EMC_EXTENSION_ID)
      return false
    }
    const emcVersion = String(emc.packageJSON.version ?? '')
    if (!isVersionAtLeast(emcVersion, EMC_MIN_VERSION)) {
      const action = await window.showErrorMessage(
        `Voice recording needs Easy Media Converter ${EMC_MIN_VERSION} or newer ` +
          `(you have ${emcVersion || 'an unknown version'}).`,
        'Update Easy Media Converter'
      )
      if (action) await commands.executeCommand('workbench.extensions.installExtension', EMC_EXTENSION_ID)
      return false
    }
    return true
  }

  /** Record 10 seconds of audio from the default microphone and save as WAV,
   * then invoke the completion callback if provided. */
  async recordVoice(): Promise<void> {
    if (this.isRecording) return
    this.isRecording = true

    if (this.statusBarItem) {
      this.statusBarItem.text = '$(sync~spin) Recording voice (10s)...'
      this.statusBarItem.tooltip = 'Recording voice (10s)...'
    }

    try {
      const emcOk = await this.checkEmcAvailable()
      if (!emcOk) return

      const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
      const outputPath = path.join(workspaceRoot, `voice-ref-${Date.now()}.wav`)

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-f', 'dshow',
          '-i', 'audio=Microphone',
          '-t', '10',
          '-ac', '1',
          '-ar', '16000',
          '-y',
          outputPath
        ])

        ffmpeg.on('close', (code: number) => {
          if (code === 0) resolve()
          else reject(new Error(`ffmpeg exited with code ${code}`))
        })
        ffmpeg.on('error', (err: Error) => reject(err))
      })

      if (this.onRecordingComplete) await this.onRecordingComplete(outputPath)
      else window.showInformationMessage(`Voice recorded: ${path.basename(outputPath)}`)
    } catch (error) {
      window.showErrorMessage(
        `Voice recording failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      this.isRecording = false
      if (this.statusBarItem) {
        this.statusBarItem.text = '$(record) Record Voice'
        this.statusBarItem.tooltip = 'Record 10-second voice reference'
      }
    }
  }

  /** Dispose of the status bar item when the extension deactivates. */
  dispose(): void {
    this.statusBarItem?.dispose()
    this.statusBarItem = undefined
  }
}
