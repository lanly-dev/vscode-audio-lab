#!/usr/bin/env node
/*
 * Pack the per-platform recorder binaries from ../bin/<platform>-<arch>/
 * into ONE combined file: ../bin/audiolab-recorder-all.
 *
 * Bundle layout (all integers little-endian):
 *   char[6]  magic "ALREC1"
 *   u32      format version (1)
 *   u32      entry count
 *   per entry: u16 key length, key bytes ("win32-x64", ...),
 *              u32 payload offset (absolute), u32 payload length
 *   payloads concatenated in entry order
 *
 * The extension reads the index, extracts its own platform's payload to
 * global storage, marks it executable, and runs it. Platforms whose binary
 * has not been built yet are skipped with a warning — the bundle states
 * exactly what it contains, never more.
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const nativeDir = path.dirname(fileURLToPath(import.meta.url))
const binDir = path.join(nativeDir, '..', 'bin')
const KEYS = ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64']
const exeName = (key) => (key.startsWith('win32') ? 'audiolab-recorder.exe' : 'audiolab-recorder')

const entries = []
for (const key of KEYS) {
  const p = path.join(binDir, key, exeName(key))
  if (fs.existsSync(p)) entries.push({ key, data: fs.readFileSync(p) })
  else console.log(`skip ${key} (not built yet)`)
}
if (entries.length === 0) {
  console.error('no platform binaries found under bin/ — build at least one first')
  process.exit(1)
}

let headerSize = 6 + 4 + 4
for (const e of entries) headerSize += 2 + Buffer.byteLength(e.key) + 4 + 4

const header = Buffer.alloc(headerSize)
let o = 0
header.write('ALREC1', o, 'ascii'); o += 6
header.writeUInt32LE(1, o); o += 4
header.writeUInt32LE(entries.length, o); o += 4
let offset = headerSize
for (const e of entries) {
  const kb = Buffer.from(e.key, 'utf8')
  header.writeUInt16LE(kb.length, o); o += 2
  kb.copy(header, o); o += kb.length
  header.writeUInt32LE(offset, o); o += 4
  header.writeUInt32LE(e.data.length, o); o += 4
  offset += e.data.length
}

const out = path.join(binDir, 'audiolab-recorder-all')
fs.writeFileSync(out, Buffer.concat([header, ...entries.map((e) => e.data)]))
for (const e of entries) console.log(`packed ${e.key} (${e.data.length} bytes)`)
console.log(`wrote ${out} (${offset} bytes, ${entries.length} of ${KEYS.length} platforms)`)
