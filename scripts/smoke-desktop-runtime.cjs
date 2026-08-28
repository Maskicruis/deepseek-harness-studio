const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const requestedAppRoot = process.argv[2] ? path.resolve(process.argv[2]) : ''
const appRoot = requestedAppRoot || path.resolve(__dirname, '..')
if (requestedAppRoot) {
  process.env.DSH_STUDIO_NODE = path.join(appRoot, '..', 'runtime', 'node.exe')
  process.env.DSH_CLI = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}
const { RuntimeManager } = require(path.join(appRoot, 'electron', 'lib', 'runtime-manager.cjs'))
const { SettingsStore } = require(path.join(appRoot, 'electron', 'lib', 'settings-store.cjs'))

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-desktop-smoke-'))
  const priorDshHome = process.env.DSH_HOME
  const runtime = new RuntimeManager(new SettingsStore(path.join(temporary, 'settings.json')))
  try {
    process.env.DSH_HOME = path.join(temporary, 'home')
    const port = await reservePort()
    runtime.settingsStore.set({
      port,
      workspace: path.join(temporary, 'workspace'),
      desktopControl: true,
    })
    const status = await runtime.start({ timeoutMs: 60_000 })
    if (status.phase !== 'running') {
      throw new Error(`desktop-control runtime smoke test failed: ${status.message}\n${status.logs.map((entry) => entry.message).join('\n')}`)
    }
    process.stdout.write(`${JSON.stringify({ phase: status.phase, desktopControl: true, harnessVersion: status.version, appRoot })}\n`)
  } finally {
    await runtime.stop()
    if (priorDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorDshHome
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`)
  process.exitCode = 1
})
