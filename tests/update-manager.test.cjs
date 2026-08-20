const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  UpdateManager,
  buildDownloadCandidates,
  compareVersions,
  normalizeMirrorBase,
  parseChecksums,
  parseGitHubRepository,
  parseVersion,
  selectReleaseAsset,
} = require('../electron/lib/update-manager.cjs')

test('GitHub repository parser accepts slugs and repository URLs', () => {
  assert.deepEqual(parseGitHubRepository('example/studio'), { owner: 'example', repo: 'studio', slug: 'example/studio' })
  assert.deepEqual(parseGitHubRepository('https://github.com/example/studio.git'), { owner: 'example', repo: 'studio', slug: 'example/studio' })
  assert.equal(parseGitHubRepository('https://example.com/example/studio'), null)
})

test('semantic versions are compared without string ordering mistakes', () => {
  assert.deepEqual(parseVersion('v1.3.0'), { major: 1, minor: 3, patch: 0, prerelease: '' })
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.3.0-beta.2', '1.3.0'), -1)
  assert.equal(compareVersions('1.3.0', '1.3.0'), 0)
})

test('release asset selection and checksum parsing use the published installer name', () => {
  const expected = { name: 'DeepSeek-Harness-Studio-Setup-1.3.0-x64.exe', browser_download_url: 'https://example.test/setup.exe' }
  assert.equal(selectReleaseAsset([{ name: 'portable.exe' }, expected], '1.3.0'), expected)
  const checksums = parseChecksums(`ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD *${expected.name}\n`)
  assert.equal(checksums.get(expected.name), 'ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD')
})

test('download candidates prefer a mirror and always retain GitHub fallback', () => {
  const asset = 'https://github.com/example/studio/releases/download/v1.4.1/setup.exe'
  const automatic = buildDownloadCandidates(asset, { mode: 'auto' })
  assert.equal(automatic[0].kind, 'mirror')
  assert.equal(automatic.at(-1).url, asset)
  assert.equal(automatic.at(-1).kind, 'github')

  const official = buildDownloadCandidates(asset, { mode: 'github' })
  assert.deepEqual(official, [{ label: 'GitHub 官方线路', url: asset, kind: 'github' }])

  const custom = buildDownloadCandidates(asset, { mode: 'custom', customMirror: 'https://mirror.example.com/gh/' })
  assert.equal(custom[0].url, `https://mirror.example.com/gh/${asset}`)
  assert.equal(custom[1].kind, 'github')
  assert.equal(normalizeMirrorBase('http://unsafe.example.com'), '')
})

test('update download falls back to GitHub after a mirror failure and verifies SHA-256', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-test-'))
  const payload = Buffer.from('verified installer payload')
  const digest = createHash('sha256').update(payload).digest('hex').toUpperCase()
  const calls = []
  const manager = new UpdateManager({
    currentVersion: '1.4.0',
    getRepository: () => 'example/studio',
    getDownloadOptions: () => ({ mode: 'auto' }),
    updateDir: temporary,
    download: async (url, filePath, onProgress) => {
      calls.push(url)
      if (calls.length === 1) throw new Error('mirror unavailable')
      fs.writeFileSync(filePath, payload)
      onProgress?.({ percent: 100, received: payload.length, total: payload.length })
      return { received: payload.length, sha256: digest }
    },
  })
  manager.release = {
    asset: {
      name: 'DeepSeek-Harness-Studio-Setup-1.4.1-x64.exe',
      browser_download_url: 'https://github.com/example/studio/releases/download/v1.4.1/DeepSeek-Harness-Studio-Setup-1.4.1-x64.exe',
    },
    expectedHash: digest,
    latestVersion: '1.4.1',
  }
  manager.status.phase = 'available'
  const status = await manager.download()
  assert.equal(calls.length, 2)
  assert.match(calls[0], /^https:\/\/gh-proxy\.com\//)
  assert.match(calls[1], /^https:\/\/github\.com\//)
  assert.equal(status.phase, 'downloaded')
  assert.equal(status.downloadSource, 'GitHub 官方线路')
  assert.equal(fs.readFileSync(status.downloadedPath, 'utf8'), payload.toString())
  fs.rmSync(temporary, { recursive: true, force: true })
})
