const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  ModlensManager,
  summarizeStatus,
  validateEndpoint,
  validatePatch,
} = require('../electron/lib/modlens-manager.cjs')

test('visual API settings accept supported multimodal providers and reject unsafe shapes', () => {
  assert.deepEqual(validatePatch({
    provider: 'openai',
    engine: 'openai',
    apiKey: ' secret-key ',
    baseUrl: 'https://example.com/v1/',
    model: ' qwen3-vl-plus ',
  }), {
    provider: 'openai',
    engine: 'openai',
    apiKey: 'secret-key',
    baseUrl: 'https://example.com/v1',
    model: 'qwen3-vl-plus',
  })
  assert.equal(validateEndpoint('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1')
  assert.throws(() => validateEndpoint('file:///tmp/model'), /HTTP/)
  assert.throws(() => validateEndpoint('https://user:pass@example.com/v1'), /用户名或密码/)
  assert.throws(() => validatePatch({ provider: 'unknown' }), /不支持/)
  assert.throws(() => validatePatch({ provider: 'openai\nother' }), /格式无效/)
})

test('status does not claim an unverified CLI login is a working vision engine', () => {
  const result = summarizeStatus({
    installed: true,
    version: '3.22.0',
    config: { provider: '', engines: {} },
    doctor: {
      providers: [{ name: 'claude-cli', ready: true, authUnverified: true, status: 'installed', detail: 'found' }],
      selection: { canonical: 'antigravity-cli' },
    },
  })
  assert.equal(result.phase, 'degraded')
  assert.match(result.message, /登录状态未验证/)
})

test('manager reads plugin version, proxies config, and never adds a key to doctor arguments', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-modlens-test-'))
  const root = path.join(temporary, 'profiles', 'web', 'node_modules', '@liustack', 'modlens')
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.22.0' }))
  fs.writeFileSync(path.join(root, 'dist', 'main.js'), '')
  const requests = []
  const doctorCalls = []
  const config = {
    provider: 'openai',
    engines: { openai: { baseUrl: 'https://example.com/v1', model: 'vision-model', hasKey: true, source: 'file' } },
  }
  const manager = new ModlensManager({
    nodePath: 'node.exe',
    dshHome: temporary,
    getPort: () => 3080,
    request: async (request) => {
      requests.push(request)
      return config
    },
    runDoctor: async (_node, _cli, args) => {
      doctorCalls.push(args)
      return {
        providers: [{ name: 'openai', kind: 'api', ready: true, status: 'configured', settings: [] }],
        selection: { canonical: 'openai' },
        chains: { local: ['openai'], remote: ['openai'] },
      }
    },
  })
  const status = await manager.status()
  assert.equal(status.phase, 'ready')
  assert.equal(status.version, '3.22.0')
  assert.deepEqual(doctorCalls, [['doctor', '--json']])

  await manager.save({ provider: 'openai', engine: 'openai', apiKey: 'top-secret', baseUrl: 'https://example.com/v1', model: 'vision-model' })
  assert.deepEqual(requests.at(-1).body, {
    provider: 'openai',
    engine: 'openai',
    apiKey: 'top-secret',
    baseUrl: 'https://example.com/v1',
    model: 'vision-model',
  })
  assert.equal(doctorCalls.flat().includes('top-secret'), false)
  fs.rmSync(temporary, { recursive: true, force: true })
})
