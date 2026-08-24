const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  CORE_BUNDLES,
  DOMESTIC_NPM_REGISTRY,
  PluginManager,
  createPnpmShim,
  inferSourceKind,
  isPluginNetworkFailure,
  normalizePackageName,
  normalizePluginError,
  normalizePluginSource,
  requestedPackageName,
} = require('../electron/lib/plugin-manager.cjs')

function writePackage(profile, name, manifest = {}) {
  const directory = path.join(profile, 'node_modules', ...name.split('/'))
  fs.mkdirSync(directory, { recursive: true })
  const value = { name, version: '1.0.0', ...manifest }
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(value))
  if (value.dsh?.bundle?.patch) fs.writeFileSync(path.resolve(directory, value.dsh.bundle.patch), '[]\n')
  return directory
}

test('normalizePluginSource accepts supported source strings', () => {
  assert.equal(normalizePluginSource('  @scope/plugin  '), '@scope/plugin')
  assert.equal(normalizePluginSource('github:owner/repo'), 'github:owner/repo')
  assert.throws(() => normalizePluginSource(''), /请输入/)
  assert.throws(() => normalizePluginSource('bad\nvalue'), /格式无效/)
  assert.throws(() => normalizePluginSource('--config.ignore-scripts=false'), /格式无效/)
})

test('normalizePackageName rejects paths and command-like values', () => {
  assert.equal(normalizePackageName('@scope/plugin-name'), '@scope/plugin-name')
  assert.throws(() => normalizePackageName('../plugin'), /格式无效/)
  assert.throws(() => normalizePackageName('plugin --force'), /格式无效/)
})

test('requestedPackageName extracts npm names without mistaking URLs for packages', () => {
  assert.equal(requestedPackageName('@scope/plugin@1.2.3'), '@scope/plugin')
  assert.equal(requestedPackageName('dsh-plugin@latest'), 'dsh-plugin')
  assert.equal(requestedPackageName('github:owner/repository'), '')
  assert.equal(requestedPackageName('https://github.com/owner/repository'), '')
})

test('createPnpmShim creates a launcher beside the DSH home', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-shim-test-'))
  const nodeModules = path.join(temporary, 'app', 'node_modules')
  const cliPath = path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const pnpmEntry = path.join(nodeModules, 'pnpm', 'bin', 'pnpm.cjs')
  fs.mkdirSync(path.dirname(cliPath), { recursive: true })
  fs.mkdirSync(path.dirname(pnpmEntry), { recursive: true })
  fs.writeFileSync(cliPath, '')
  fs.writeFileSync(pnpmEntry, '')
  const result = createPnpmShim({ cliPath, nodePath: 'C:\\runtime\\node.exe', dshHome: path.join(temporary, '.dsh') })
  assert.equal(fs.existsSync(result.shimPath), true)
  assert.match(fs.readFileSync(result.shimPath, 'utf8'), /pnpm\.cjs/)
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('createPnpmShim rewrites an absolute launcher after the app installation moves', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-shim-move-test-'))
  const nodeModules = path.join(temporary, 'moved app', 'resources', 'app', 'node_modules')
  const cliPath = path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const pnpmEntry = path.join(nodeModules, 'pnpm', 'bin', 'pnpm.cjs')
  const dshHome = path.join(temporary, 'another user', '.dsh')
  fs.mkdirSync(path.dirname(cliPath), { recursive: true })
  fs.mkdirSync(path.dirname(pnpmEntry), { recursive: true })
  fs.writeFileSync(cliPath, '')
  fs.writeFileSync(pnpmEntry, '')
  const staleNode = 'D:\\Old Fixed Install\\node.exe'
  const movedNode = path.join(temporary, 'moved app', 'resources', 'runtime', 'node.exe')
  const first = createPnpmShim({ cliPath, nodePath: staleNode, dshHome })
  assert.match(fs.readFileSync(first.shimPath, 'utf8'), /Old Fixed Install/)
  createPnpmShim({ cliPath, nodePath: movedNode, dshHome })
  const rewritten = fs.readFileSync(first.shimPath, 'utf8')
  assert.equal(rewritten.includes(staleNode), false)
  assert.equal(rewritten.includes(movedNode), true)
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('inferSourceKind identifies npm, GitHub, and local sources', () => {
  assert.equal(inferSourceKind('@scope/plugin'), 'npm')
  assert.equal(inferSourceKind('github:owner/repo'), 'github')
  assert.equal(inferSourceKind('https://github.com/owner/repo'), 'github')
  assert.equal(inferSourceKind(path.resolve('local-plugin')), 'local')
  assert.equal(inferSourceKind('file:E:/plugins/local-plugin'), 'local')
})

test('network failures retry plugin commands through the domestic npm mirror', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-registry-fallback-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const commands = []
  const manager = new PluginManager({
    cliPath: 'unused', nodePath: 'unused', dshHome: temporary,
    commandRunner: async (args) => {
      commands.push(args)
      if (commands.length === 1) throw new Error('ERR_PNPM_META_FETCH_FAIL ECONNRESET registry.npmjs.org')
      return 'ok'
    },
  })
  await manager.repair()
  assert.equal(isPluginNetworkFailure(new Error('request failed: ETIMEDOUT')), true)
  assert.equal(isPluginNetworkFailure(new Error('ERR_PNPM_FETCH_404')), false)
  assert.deepEqual(commands[0], ['install', '--reporter=append-only'])
  assert.deepEqual(commands[1], ['install', '--reporter=append-only', `--registry=${DOMESTIC_NPM_REGISTRY}`])
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('generic DSH pnpm failures also retry through the domestic npm mirror', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-generic-pnpm-fallback-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const commands = []
  const manager = new PluginManager({
    cliPath: 'unused', nodePath: 'unused', dshHome: temporary,
    commandRunner: async (args) => {
      commands.push(args)
      if (commands.length === 1) throw new Error(`dsh: pnpm failed in profile directory ${profile}`)
      return 'recovered through mirror'
    },
  })
  const result = await manager.repair()
  assert.equal(result.output, 'recovered through mirror')
  assert.equal(isPluginNetworkFailure(new Error('dsh: pnpm failed in profile directory C:\\Users\\demo\\.dsh\\profiles\\web')), true)
  assert.deepEqual(commands[1], ['install', '--reporter=append-only', `--registry=${DOMESTIC_NPM_REGISTRY}`])
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('plugin errors remove replacement characters and explain a failed mirror retry', () => {
  const error = normalizePluginError(new Error('et\uFFFD\uFFFD\uFFFD dsh: pnpm failed'), { mirrorRetried: true })
  assert.doesNotMatch(error.message, /\uFFFD/)
  assert.match(error.message, /npm 官方源和国内镜像均未成功/)
  assert.match(error.message, /dsh: pnpm failed/)
})

test('plugin inventory separates core and community bundles', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/weather': '^1.2.3', '@demo/disabled': 'github:demo/disabled' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@demo/weather'] } },
  }))
  writePackage(profile, '@demo/weather', { version: '1.2.4', description: 'Weather tools', dsh: { bundle: { patch: './cordis.patch.yml' } } })
  writePackage(profile, '@demo/disabled', { version: '2.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary })
  const inventory = manager.list()
  assert.equal(inventory.core.length, 2)
  assert.equal(inventory.community.length, 2)
  assert.equal(inventory.community.find((item) => item.name === '@demo/weather').enabled, true)
  assert.equal(inventory.community.find((item) => item.name === '@demo/weather').version, '1.2.4')
  assert.equal(inventory.community.find((item) => item.name === '@demo/weather').health, 'ready')
  assert.equal(inventory.community.find((item) => item.name === '@demo/disabled').enabled, false)
  assert.equal(inventory.community.find((item) => item.name === '@demo/disabled').health, 'disabled')
  assert.deepEqual(inventory.summary, { total: 2, ready: 1, disabled: 1, issues: 0, blocking: 0 })
  assert.equal(CORE_BUNDLES.has(inventory.core[0].name), true)

  manager.toggle('@demo/disabled', true)
  assert.equal(manager.list().community.find((item) => item.name === '@demo/disabled').enabled, true)
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('plugin inventory reports missing, incompatible, and orphaned entries', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-health-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/broken': '1.0.0', '@demo/missing': '1.0.0', '@demo/plain': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@demo/broken', '@demo/plain', '@demo/orphan'] } },
  }))
  const brokenDirectory = writePackage(profile, '@demo/broken', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  fs.unlinkSync(path.join(brokenDirectory, 'cordis.patch.yml'))
  writePackage(profile, '@demo/plain', { description: 'A normal dependency without a DSH bundle' })
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary })
  const inventory = manager.list()
  assert.equal(inventory.community.find((item) => item.name === '@demo/broken').health, 'invalid')
  assert.equal(inventory.community.find((item) => item.name === '@demo/missing').health, 'missing')
  assert.equal(inventory.community.find((item) => item.name === '@demo/plain').health, 'incompatible')
  assert.equal(inventory.community.find((item) => item.name === '@demo/orphan').health, 'orphan')
  assert.equal(inventory.summary.issues, 4)
  assert.throws(() => manager.toggle('@demo/plain', true), /dsh\.bundle\.patch/)
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('inspectSource validates local DSH plugin manifests before installation', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-inspect-test-'))
  const good = path.join(temporary, 'good')
  const plain = path.join(temporary, 'plain')
  fs.mkdirSync(good, { recursive: true })
  fs.mkdirSync(plain, { recursive: true })
  fs.writeFileSync(path.join(good, 'package.json'), JSON.stringify({ name: '@demo/good', version: '2.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  fs.writeFileSync(path.join(good, 'cordis.patch.yml'), '[]\n')
  fs.writeFileSync(path.join(plain, 'package.json'), JSON.stringify({ name: '@demo/plain', version: '1.0.0' }))
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary })
  assert.deepEqual(manager.inspectSource(good), {
    source: good,
    sourceKind: 'local',
    inspected: true,
    compatible: true,
    name: '@demo/good',
    version: '2.1.0',
    description: '',
    directory: good,
    manifestPath: path.join(good, 'package.json'),
    loaderNames: [],
    message: '本地插件结构验证通过。',
  })
  assert.throws(() => manager.inspectSource(plain), /不是可用的 DSH 插件/)
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('startup diagnosis quarantines a bundle whose loader module cannot resolve', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-loader-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/bad-loader': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@demo/bad-loader'] } },
  }))
  const directory = writePackage(profile, '@demo/bad-loader', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '- insert:\n    - id: bad-loader\n      name: loader-package-that-does-not-exist\n')
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary })

  const before = manager.list()
  const failed = before.community.find((item) => item.name === '@demo/bad-loader')
  assert.equal(failed.health, 'load-failed')
  assert.equal(failed.blocksStartup, true)
  assert.deepEqual(failed.unresolvedLoaders, ['loader-package-that-does-not-exist'])
  assert.equal(before.summary.blocking, 1)

  const diagnosis = manager.diagnose({ quarantine: true })
  assert.equal(diagnosis.ok, false)
  assert.deepEqual(diagnosis.quarantined, ['@demo/bad-loader'])
  const isolated = diagnosis.inventory.community.find((item) => item.name === '@demo/bad-loader')
  assert.equal(isolated.enabled, false)
  assert.equal(isolated.health, 'quarantined')
  assert.equal(diagnosis.inventory.summary.blocking, 0)
  assert.throws(() => manager.toggle('@demo/bad-loader', true), /无法加载的模块/)
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('real startup isolation persists across later package-manager bundle rewrites', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-startup-probe-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  const manifestPath = path.join(profile, 'package.json')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify({
    dependencies: { '@demo/good': '1.0.0', '@demo/runtime-crash': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@demo/good', '@demo/runtime-crash'] } },
  }))
  writePackage(profile, '@demo/good', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  writePackage(profile, '@demo/runtime-crash', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary })
  const probe = async () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const enabled = manifest.dsh.profile.bundles
    return enabled.includes('@demo/runtime-crash')
      ? { ok: false, message: 'plugin apply() threw during boot' }
      : { ok: true, message: 'ready' }
  }

  const isolated = await manager.isolateStartupFailures(probe)
  assert.equal(isolated.ok, true)
  assert.deepEqual(isolated.quarantined, ['@demo/runtime-crash'])
  assert.equal(isolated.inventory.community.find((item) => item.name === '@demo/good').health, 'ready')
  assert.equal(isolated.inventory.community.find((item) => item.name === '@demo/runtime-crash').health, 'quarantined')

  const rewritten = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  rewritten.dsh.profile.bundles.push('@demo/runtime-crash')
  fs.writeFileSync(manifestPath, JSON.stringify(rewritten))
  const reintroduced = manager.list().community.find((item) => item.name === '@demo/runtime-crash')
  assert.equal(reintroduced.health, 'load-failed')
  assert.equal(reintroduced.blocksStartup, true)
  const diagnosis = manager.diagnose({ quarantine: true })
  assert.deepEqual(diagnosis.quarantined, ['@demo/runtime-crash'])
  assert.equal(diagnosis.inventory.community.find((item) => item.name === '@demo/runtime-crash').health, 'quarantined')
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('update and repair use pnpm-compatible DSH plugin commands', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-command-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/weather': '^1.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@demo/weather'] } },
  }))
  writePackage(profile, '@demo/weather', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  const commands = []
  const manager = new PluginManager({
    cliPath: 'unused', nodePath: 'unused', dshHome: temporary,
    commandRunner: async (args) => { commands.push(args); return 'ok' },
  })
  await manager.update('@demo/weather')
  await manager.repair('@demo/weather')
  await manager.repair()
  assert.deepEqual(commands[0], ['update', '@demo/weather', '--latest', '--reporter=append-only'])
  assert.deepEqual(commands[1], ['add', '@demo/weather@^1.2.3', '--reporter=append-only'])
  assert.deepEqual(commands[2], ['install', '--reporter=append-only'])
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('updating a quarantined plugin restores it only after its loader becomes valid', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-recover-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/recovered': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const directory = writePackage(profile, '@demo/recovered', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
  fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '- insert:\n    - id: broken\n      name: missing-before-update\n')
  const manager = new PluginManager({
    cliPath: 'unused', nodePath: 'unused', dshHome: temporary,
    commandRunner: async () => { fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '[]\n'); return 'updated' },
  })
  assert.equal(manager.list().community[0].health, 'quarantined')
  const result = await manager.update('@demo/recovered')
  assert.deepEqual(result.restored, ['@demo/recovered'])
  assert.equal(result.inventory.community[0].enabled, true)
  assert.equal(result.inventory.community[0].health, 'ready')
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('profile repair never overwrites a malformed manifest', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-corrupt-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  const manifestPath = path.join(profile, 'package.json')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(manifestPath, '{ this is not json')
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary, commandRunner: async () => 'ok' })
  await assert.rejects(() => manager.repair(), /不会覆盖损坏的配置/)
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), '{ this is not json')
  fs.rmSync(temporary, { recursive: true, force: true })
})
