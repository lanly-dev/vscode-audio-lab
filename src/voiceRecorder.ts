import * as fs from 'fs'
import * as os from 'os'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
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
 * Recording runs in the Voica all-in-one binary (`bin/voica-all.com`, an
 * Actually Portable Executable built by the separate `voica` project): the
 * same file runs on Windows, macOS and Linux, extracts the Voica host for
 * the current OS plus its `recorder.wasm` app, and records through the
 * host's miniaudio bridge (WASAPI/CoreAudio/ALSA-Pulse — no ffmpeg, no
 * other extension). On first use the extension copies it into global
 * storage under a hash-named file so it can be made executable (and carry
 * an `.exe` name on Windows).
 */
export class VoiceRecorder {
  private statusBarItem?: StatusBarItem
  private isRecording = false

  constructor(
    private readonly extensionPath: string,
    private readonly storagePath: string,
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

  /** Copy the Voica binary (`bin/voica-all.com`) into global storage and
   * return its path. The copy is named by a hash of its bytes, so a
   * refreshed binary never leaves a stale one behind; off Windows it is
   * chmodded executable, on Windows it gets an `.exe` name (the APE runs
   * under either name). */
  private async ensureVoica(): Promise<string> {
    const sourcePath = path.join(this.extensionPath, 'bin', 'voica-all.com')
    if (!fs.existsSync(sourcePath)) {
      throw new Error('The Voica recorder binary is missing from the extension (bin/voica-all.com).')
    }
    const bytes = await fs.promises.readFile(sourcePath)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    const name = `voica-${hash}${process.platform === 'win32' ? '.exe' : '.com'}`
    const target = path.join(this.storagePath, name)
    if (!fs.existsSync(target)) {
      await fs.promises.mkdir(this.storagePath, { recursive: true })
      await fs.promises.writeFile(target, bytes)
      if (process.platform !== 'win32') await fs.promises.chmod(target, 0o755)
    }
    return target
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
      const recorder = await this.ensureVoica()

      const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
      const outputPath = path.join(workspaceRoot, `voice-ref-${Date.now()}.wav`)

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(recorder, ['--seconds', String(RECORD_SECONDS), '--out', outputPath])
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        proc.on('close', (code: number | null) => {
          // Trust the artifact over the exit code: the Voica launcher can
          // surface a mangled status (e.g. a raw system() wait status, 256
          // for a host exit of 1) even when the host wrote a complete WAV.
          // The output name is unique to this run, so a file here is this
          // run's work; the completion callback validates the WAV itself.
          if (code === 0 || fs.existsSync(outputPath)) resolve()
          else {
            const detail = stderr.trim() || stdout.trim().slice(-500)
            reject(new Error(detail || `Recorder exited with code ${code}`))
          }
        })
        proc.on('error', (err: Error) => reject(err))
      })

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
