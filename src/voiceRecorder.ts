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
 * Recording runs in a tiny native helper (`audiolab-recorder`, built from
 * `native/recorder.c` on miniaudio; WASAPI/CoreAudio/ALSA-Pulse under the
 * hood — no ffmpeg, no other extension). All platforms' binaries ship
 * combined in ONE file, `bin/audiolab-recorder-all`; on first use the
 * current platform's binary is extracted from it into global storage.
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

  /** Extract the current platform's recorder from the combined bundle
   * (`bin/audiolab-recorder-all`, packed by `native/pack.mjs`) into global
   * storage and return its path. The extracted file is named by a hash of
   * its bytes, so a refreshed bundle never leaves a stale binary behind. */
  private async ensureRecorder(): Promise<string> {
    const bundlePath = path.join(this.extensionPath, 'bin', 'audiolab-recorder-all')
    if (!fs.existsSync(bundlePath)) {
      throw new Error('The voice recorder bundle is missing from the extension (bin/audiolab-recorder-all).')
    }
    const key = `${process.platform}-${process.arch}`
    const handle = await fs.promises.open(bundlePath, 'r')
    try {
      const head = Buffer.alloc(14)
      await handle.read(head, 0, 14, 0)
      if (head.toString('ascii', 0, 6) !== 'ALREC1') {
        throw new Error('The voice recorder bundle is corrupt (bad header).')
      }
      const count = head.readUInt32LE(10)
      let pos = 14
      let found: { offset: number, length: number } | undefined
      const available: string[] = []
      for (let i = 0; i < count; i++) {
        const meta = Buffer.alloc(2)
        await handle.read(meta, 0, 2, pos)
        pos += 2
        const keyLen = meta.readUInt16LE(0)
        const rest = Buffer.alloc(keyLen + 8)
        await handle.read(rest, 0, keyLen + 8, pos)
        pos += keyLen + 8
        const entryKey = rest.toString('utf8', 0, keyLen)
        available.push(entryKey)
        if (entryKey === key) {
          found = { offset: rest.readUInt32LE(keyLen), length: rest.readUInt32LE(keyLen + 4) }
        }
      }
      if (!found) {
        throw new Error(
          `No voice recorder for ${key} in the bundle (it contains: ${available.join(', ') || 'nothing'}).`
        )
      }
      const payload = Buffer.alloc(found.length)
      await handle.read(payload, 0, found.length, found.offset)
      const hash = createHash('sha256').update(payload).digest('hex').slice(0, 8)
      const name = `audiolab-recorder-${hash}${process.platform === 'win32' ? '.exe' : ''}`
      const target = path.join(this.storagePath, name)
      if (!fs.existsSync(target)) {
        await fs.promises.mkdir(this.storagePath, { recursive: true })
        await fs.promises.writeFile(target, payload)
        if (process.platform !== 'win32') await fs.promises.chmod(target, 0o755)
      }
      return target
    } finally {
      await handle.close()
    }
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
      const recorder = await this.ensureRecorder()

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
