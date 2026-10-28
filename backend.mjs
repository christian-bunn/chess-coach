#!/usr/bin/env node
// Start the backend on http://127.0.0.1:8000 with the venv's uvicorn.
//
// This is the one place that knows where a virtualenv keeps its programs: Scripts/ on Windows,
// bin/ everywhere else. dev.sh, share.sh and .claude/launch.json all come through here, so the
// same command works on Linux, macOS and Windows. Extra arguments are passed on to uvicorn
// (`node backend.mjs --reload`, say).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const venv = join(root, 'backend', '.venv')
const uvicorn = [join(venv, 'bin', 'uvicorn'), join(venv, 'Scripts', 'uvicorn.exe')].find(existsSync)

if (!uvicorn) {
  console.error(`No backend virtualenv in ${venv}. Create one: see Setup in README.md.`)
  process.exit(1)
}

const server = spawn(
  uvicorn,
  ['app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
)

// Ctrl+C and `kill` should stop uvicorn too, not just this wrapper.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => server.kill(signal))
}
server.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
