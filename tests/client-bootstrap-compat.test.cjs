const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  CRITICAL_DSH_PACKAGES,
  assertDshRuntimeIntegrity,
  inspectDshRuntime,
} = require('../electron/lib/dsh-runtime-integrity.cjs')
const { assertHarnessCompatibility } = require('../electron/lib/runtime-manager.cjs')

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents, 'utf8')
}

function createRuntimeFixture({ version = '0.1.0-rc.7', clientVersion = version, factoryHost = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-integrity-'))
  for (const packageName of CRITICAL_DSH_PACKAGES) {
    const packageVersion = packageName === '@deepseek-ai/dsh-client-modules' ? clientVersion : version
    writeFile(path.join(root, 'node_modules', ...packageName.split('/'), 'package.json'), JSON.stringify({ name: packageName, version: packageVersion }))
  }
  const modulesDir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib')
  const webDir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-web', 'lib')
  writeFile(path.join(modulesDir, 'index.js'), factoryHost ? 'const face = module.createClientModuleSystem\n' : 'const host = true\n')
  writeFile(path.join(modulesDir, 'client.js'), 'exports.ClientModuleSystem = class ClientModuleSystem {}\nexports.parseBootManifest = () => ({})\n')
  writeFile(path.join(webDir, 'index.js'), 'const system = new ClientModuleSystem()\n')
  return root
}

test('matching legacy DSH browser bootstrap contract passes integrity validation', () => {
  const root = createRuntimeFixture()
  try {
    const report = assertDshRuntimeIntegrity(root)
    assert.equal(report.ok, true)
    assert.equal(report.expectedVersion, '0.1.0-rc.7')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('mixed DSH package versions are rejected before Harness starts', () => {
  const root = createRuntimeFixture({ clientVersion: '0.1.5-rc.2' })
  try {
    const report = inspectDshRuntime(root)
    assert.equal(report.ok, false)
    assert.match(report.issues.join('\n'), /dsh-client-modules=0\.1\.5-rc\.2/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('new bootstrap host with an old client module face is rejected', () => {
  const root = createRuntimeFixture({ factoryHost: true })
  try {
    assert.throws(() => assertDshRuntimeIntegrity(root), /createClientModuleSystem/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Studio refuses an external Harness running a different version', () => {
  assert.equal(assertHarnessCompatibility({ version: '0.1.0-rc.7' }, '0.1.0-rc.7', 17890), '0.1.0-rc.7')
  assert.throws(
    () => assertHarnessCompatibility({ version: '0.1.5-rc.2' }, '0.1.0-rc.7', 17890),
    /关闭外部 Harness 或更换端口/,
  )
})

test('Harness webview uses a non-persistent partition and cache-busted URL', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(appSource, /partition="deepseek-harness"/)
  assert.doesNotMatch(appSource, /partition="persist:deepseek-harness"/)
  assert.match(appSource, /searchParams\.set\('studioBoot'/)
  assert.match(mainSource, /clearHarnessClientCache/)
  assert.match(mainSource, /clearLegacyHarnessClientCache/)
})
