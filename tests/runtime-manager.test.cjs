const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { ensureWorkspaceRegistered } = require('../electron/lib/runtime-manager.cjs')

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
