const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { extractAbsolutePaths, promptTextFromUpload, resolveExistingWorkspace } = require('../electron/lib/path-detector.cjs')

test('absolute Windows paths are detected in natural-language prompts', () => {
  assert.deepEqual(extractAbsolutePaths('请把工程放在 "E:\\DeepSeek\\My Project"，然后开始。'), ['E:\\DeepSeek\\My Project'])
  assert.deepEqual(extractAbsolutePaths('分析 C:/work/demo/package.json 并修复问题'), ['C:/work/demo/package.json'])
  assert.deepEqual(extractAbsolutePaths('使用 \\\\server\\share\\project 作为目录'), ['\\\\server\\share\\project'])
})

test('a mentioned file resolves to its existing parent workspace', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-path-test-'))
  const file = path.join(temporary, 'app.js')
  fs.writeFileSync(file, '')
  assert.equal(resolveExistingWorkspace(file), temporary)
  assert.equal(resolveExistingWorkspace(path.join(temporary, 'future.ts')), temporary)
  assert.equal(resolveExistingWorkspace(path.join(temporary, 'missing-folder')), '')
  fs.rmSync(temporary, { recursive: true, force: true })
})

test('prompt upload decoding reads only session text content', () => {
  const body = Buffer.from(JSON.stringify({
    method: 'session.prompt',
    payload: { content: [{ type: 'text', text: '处理 E:\\Demo' }, { type: 'image', data: 'ignored' }] },
  }))
  assert.equal(promptTextFromUpload([{ bytes: body }]), '处理 E:\\Demo')
})
