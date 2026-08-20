const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  CORE_BUNDLES,
  PluginManager,
  createPnpmShim,
  inferSourceKind,
  normalizePluginSource,
} = require('../electron/lib/plugin-manager.cjs')

test('normalizePluginSource accepts supported source strings', () => {
  assert.equal(normalizePluginSource('  @scope/plugin  '), '@scope/plugin')
  assert.equal(normalizePluginSource('github:owner/repo'), 'github:owner/repo')
  assert.throws(() => normalizePluginSource(''), /请输入/)
  assert.throws(() => normalizePluginSource('bad\nvalue'), /格式无效/)
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

test('inferSourceKind identifies npm, GitHub, and local sources', () => {
  assert.equal(inferSourceKind('@scope/plugin'), 'npm')
  assert.equal(inferSourceKind('github:owner/repo'), 'github')
  assert.equal(inferSourceKind('https://github.com/owner/repo'), 'github')
  assert.equal(inferSourceKind(path.resolve('local-plugin')), 'local')
})

test('plugin inventory separates core and community bundles', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-test-'))
  const profile = path.join(temporary, 'profiles', 'web')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/weather': '^1.2.3', '@demo/disabled': 'github:demo/disabled' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@demo/weather'] } },
  }))
  const manager = new PluginManager({ cliPath: 'unused', nodePath: 'unused', dshHome: temporary })
  const inventory = manager.list()
  assert.equal(inventory.core.length, 2)
  assert.equal(inventory.community.length, 2)
  assert.equal(inventory.community.find((item) => item.name === '@demo/weather').enabled, true)
  assert.equal(inventory.community.find((item) => item.name === '@demo/disabled').enabled, false)
  assert.equal(CORE_BUNDLES.has(inventory.core[0].name), true)

  manager.toggle('@demo/disabled', true)
  assert.equal(manager.list().community.find((item) => item.name === '@demo/disabled').enabled, true)
  fs.rmSync(temporary, { recursive: true, force: true })
})
