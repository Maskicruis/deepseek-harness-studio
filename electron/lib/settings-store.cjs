const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_SETTINGS = Object.freeze({
  port: 3080,
  workspace: '',
  autoLaunch: false,
  closeToTray: false,
  autoCheckUpdates: true,
  updateRepository: '',
  updateDownloadMode: 'auto',
  updateMirrorUrl: '',
})

const UPDATE_DOWNLOAD_MODES = new Set(['auto', 'github', 'custom'])

function sanitizeMirrorUrl(value) {
  const source = typeof value === 'string' ? value.replace(/[\r\n\0]/g, '').trim().slice(0, 2048) : ''
  if (!source) return ''
  try {
    const parsed = new URL(source)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath
    this.value = this.#read()
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return this.#sanitize({ ...DEFAULT_SETTINGS, ...parsed })
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  #sanitize(candidate) {
    const port = Number(candidate.port)
    return {
      port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_SETTINGS.port,
      workspace: typeof candidate.workspace === 'string' ? candidate.workspace : '',
      autoLaunch: Boolean(candidate.autoLaunch),
      closeToTray: Boolean(candidate.closeToTray),
      autoCheckUpdates: candidate.autoCheckUpdates !== false,
      updateRepository: typeof candidate.updateRepository === 'string'
        ? candidate.updateRepository.replace(/[\r\n]/g, '').trim().slice(0, 200)
        : '',
      updateDownloadMode: UPDATE_DOWNLOAD_MODES.has(candidate.updateDownloadMode)
        ? candidate.updateDownloadMode
        : DEFAULT_SETTINGS.updateDownloadMode,
      updateMirrorUrl: sanitizeMirrorUrl(candidate.updateMirrorUrl),
    }
  }

  get() {
    return { ...this.value }
  }

  set(patch) {
    this.value = this.#sanitize({ ...this.value, ...patch })
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, this.filePath)
    return this.get()
  }
}

module.exports = { DEFAULT_SETTINGS, SettingsStore, sanitizeMirrorUrl }
