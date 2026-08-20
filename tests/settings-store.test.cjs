const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SettingsStore } = require('../electron/lib/settings-store.cjs')

test('settings store persists sanitized values', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-settings-test-'))
  const filePath = path.join(temporary, 'settings.json')
  const store = new SettingsStore(filePath)
  store.set({ port: 4090, workspace: 'E:\\Workspace', autoLaunch: true })
  assert.deepEqual(new SettingsStore(filePath).get(), {
    port: 4090,
    workspace: 'E:\\Workspace',
    autoLaunch: true,
    closeToTray: false,
    autoCheckUpdates: true,
    updateRepository: '',
  })
  store.set({ port: 80 })
  assert.equal(store.get().port, 3080)
  store.set({ autoCheckUpdates: false, updateRepository: '  owner/repository\r\n' })
  assert.equal(store.get().autoCheckUpdates, false)
  assert.equal(store.get().updateRepository, 'owner/repository')
  fs.rmSync(temporary, { recursive: true, force: true })
})
