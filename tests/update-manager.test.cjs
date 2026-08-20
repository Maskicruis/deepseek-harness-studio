const test = require('node:test')
const assert = require('node:assert/strict')
const {
  compareVersions,
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
