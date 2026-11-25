import * as fs from 'fs'
import * as os from 'os'
import { spawn } from 'child_process'
import * as path from 'path'
import {
  StatusBarAlignment,
  StatusBarItem,
  window,
  workspace
} from 'vscode'

const RECORD_SECONDS = 10

/** Records 10 seconds of audio from the default microphone and exposes a
 * status bar button to start recording. The recorded WAV is passed to an
 * optional callback so the caller can persist it (e.g. as a voice reference).
 *
 * Recording runs in a tiny bundled native helper (`audiolab-recorder`,
 * built from `native/recorder.c` on miniaudio) — one binary per platform
 * under `bin/<platform>-<arch>/`, WASAPI/CoreAudio/ALSA-Pulse under the
 * hood. No ffmpeg and no other extension is involved.
 */
export class VoiceRecorder {
  private statusBarItem?: StatusBarItem
  private isRecording = false

  constructor(
    private readonly extensionPath: string,
    private readonly onRecordingComplete?: (outputPath: string) => Promise<void>
  ) {}

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

  /** Absolute path of the recorder binary for the current platform/arch. */
  private recorderPath(): string {
    const name = process.platform === 'win32' ? 'audiolab-recorder.exe' : 'audiolab-recorder'
    return path.join(this.extensionPath, 'bin', `${process.platform}-${process.arch}`, name)
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
      const recorder = this.recorderPath()
      if (!fs.existsSync(recorder)) {
        throw new Error(
          `No voice recorder is bundled for ${process.platform}-${process.arch}. ` +
            'Build it with the scripts in the extension\'s native/ folder.'
        )
      }

      const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
      const outputPath = path.join(workspaceRoot, `voice-ref-${Date.now()}.wav`)

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(recorder, [outputPath, String(RECORD_SECONDS)])
        let stderr = ''
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        proc.on('close', (code: number | null) => {
          if (code === 0) resolve()
          else reject(new Error(stderr.trim() || `Recorder exited with code ${code}`))
        })
        proc.on('error', (err: Error) => reject(err))
      })

      // The helper exits 0 only after finalizing the WAV; still, trust the
      // artifact, not the exit code alone.
      if (!fs.existsSync(outputPath)) {
        throw new Error('Recorder finished but produced no file.')
      }

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
