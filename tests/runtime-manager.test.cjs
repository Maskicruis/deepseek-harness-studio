const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { describeHarness, ensureDesktopControlPackage, ensureWorkspaceRegistered, inspectHarnessBootstrap } = require('../electron/lib/runtime-manager.cjs')

test('desktop control package is deployed relative to the active DSH home', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-package-test-'))
  const source = path.join(temporary, 'source')
  const dshHome = path.join(temporary, 'another-user', '.dsh')
  fs.mkdirSync(path.join(source, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"studio-desktop-control"}\n', 'utf8')
  fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export const ready = true\n', 'utf8')

  try {
    const target = ensureDesktopControlPackage({ dshHome, source })
    assert.equal(target, path.join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-harness-studio', 'dsh-desktop-control'))
    assert.equal(fs.readFileSync(path.join(target, 'lib', 'index.js'), 'utf8'), 'export const ready = true\n')
    assert.equal(target.includes('E:\\DeepSeek'), false)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('default workspace is created and registered through the Harness API', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-test-'))
  const workspace = path.join(temporary, 'DeepSeek Harness', 'Workspace')
  let received
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      received = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: received.rpcId,
        result: {
          ok: true,
          value: {
            created: true,
            workspace: {
              workspaceId: 'default-workspace',
              path: received.payload.path,
              title: 'Workspace',
              sessionIds: [],
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            },
          },
        },
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await ensureWorkspaceRegistered(server.address().port, workspace)
    assert.equal(fs.existsSync(workspace), true)
    assert.equal(received.method, 'workspace.create')
    assert.equal(received.payload.path, path.resolve(workspace))
    assert.equal(result.workspaceId, 'default-workspace')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('running Harness version is read through host.describe', async () => {
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const envelope = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: envelope.rpcId,
        result: {
          ok: true,
          value: { version: '0.1.0-rc.7', cwd: 'C:\\workspace', attachedSessions: 0, canOpenPath: false },
        },
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await describeHarness(server.address().port)
    assert.equal(result.version, '0.1.0-rc.7')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('legacy Harness compatibility is verified from its served bootstrap assets', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': request.url === '/' ? 'text/html' : 'text/javascript' })
    if (request.url === '/') {
      response.end('<script>window.__DSH_BOOT__ = {"rev":"root-rev","entries":[{"id":"@deepseek-ai/dsh-client-modules","url":"/plugins/client.js?rev=client-rev","rev":"client-rev"}]}</script><script type="module" src="/assets/index.js"></script><div id="root"></div>')
    } else if (request.url === '/assets/index.js') {
      response.end('const system = new ClientModuleSystem()')
    } else {
      response.end('exports.ClientModuleSystem = class ClientModuleSystem {}')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await inspectHarnessBootstrap(server.address().port)
    assert.deepEqual(result, { revision: 'root-rev', clientRevision: 'client-rev', contract: 'legacy' })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
