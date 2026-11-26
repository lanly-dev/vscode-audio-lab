// Diagnostic for the "Recorder exited with code 256" failure.
// Spawns the Voica recorder copy from global storage exactly as
// VoiceRecorder does (piped stdio, bare --out name, cwd = this repo),
// then again with inherited stdio, and reports everything either way.
// Run from the repo root:  node scripts/diag-recorder.mjs
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
const storage = path.join(roaming, 'Code', 'User', 'globalStorage', 'lanly-dev.audio-lab')
const exeName = fs.readdirSync(storage).find((f) => f.startsWith('voica-'))
if (!exeName) {
  console.error('no voica-* binary found in', storage)
  process.exit(1)
}
const exePath = path.join(storage, exeName)
const cwd = process.cwd()
console.log('exe:', exePath)
console.log('cwd:', cwd)
console.log('env: ComSpec=%s | HOME=%s | USERPROFILE=%s',
  process.env.ComSpec, process.env.HOME, process.env.USERPROFILE)

function run(label, stdio, outName) {
  return new Promise((resolve) => {
    const proc = spawn(exePath, ['--seconds', '3', '--out', outName], { cwd, stdio })
    let out = ''
    let err = ''
    if (proc.stdout) proc.stdout.on('data', (d) => { out += d })
    if (proc.stderr) proc.stderr.on('data', (d) => { err += d })
    proc.on('error', (e) => {
      console.log(label, 'SPAWN ERROR:', e.message)
      resolve()
    })
    proc.on('close', (code) => {
      console.log(label, 'close code:', code,
        '| wav exists:', fs.existsSync(path.join(cwd, outName)))
      if (stdio !== 'inherit') {
        console.log(label, 'stdout:', JSON.stringify(out))
        console.log(label, 'stderr:', JSON.stringify(err.slice(0, 300)))
      }
      resolve()
    })
  })
}

await run('[piped]  ', 'pipe', 'diag-piped.wav')
await run('[inherit]', 'inherit', 'diag-inherit.wav')
