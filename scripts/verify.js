// Compound-engineering gate: tsc + eslint + package.json must all pass.
// Run: npm run verify
const { execSync } = require('child_process')

let failed = false
const step = (name, cmd) => {
  try {
    execSync(cmd, { stdio: 'inherit', shell: true })
    console.log(`ok: ${name}`)
  } catch {
    console.error(`FAIL: ${name}`)
    failed = true
  }
}

step('tsc --noEmit', 'npx tsc --noEmit')
step('eslint', 'npx eslint .')
try {
  JSON.parse(require('fs').readFileSync('package.json', 'utf8'))
  console.log('ok: package.json parses')
} catch {
  console.error('FAIL: package.json parses')
  failed = true
}

process.exit(failed ? 1 : 0)
