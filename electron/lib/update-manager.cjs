const { EventEmitter } = require('node:events')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const API_VERSION = '2022-11-28'
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 6
const BUILT_IN_UPDATE_MIRRORS = Object.freeze([
  Object.freeze({ id: 'gh-proxy', label: '国内社区镜像', baseUrl: 'https://gh-proxy.com' }),
])

function parseGitHubRepository(value) {
  const source = String(value || '').trim().replace(/\.git$/i, '').replace(/\/$/, '')
  const match = source.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i)
  if (!match) return null
  return { owner: match[1], repo: match[2], slug: `${match[1]}/${match[2]}` }
}

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' }
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) throw new Error('版本号必须采用 SemVer 格式。')
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true })
}

function selectReleaseAsset(assets, version) {
  const list = Array.isArray(assets) ? assets : []
  const expected = `DeepSeek-Harness-Studio-Setup-${String(version).replace(/^v/i, '')}-x64.exe`.toLowerCase()
  return list.find((asset) => String(asset?.name || '').toLowerCase() === expected) || null
}

function parseChecksums(content) {
  const checksums = new Map()
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (match) checksums.set(match[2].trim(), match[1].toUpperCase())
  }
  return checksums
}

function assertHttps(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('更新服务只允许 HTTPS。')
  return parsed
}

function normalizeMirrorBase(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  try {
    const parsed = assertHttps(source)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function buildDownloadCandidates(assetUrl, { mode = 'auto', customMirror = '' } = {}) {
  const officialUrl = assertHttps(assetUrl).toString()
  const candidates = []
  const seen = new Set()
  const add = (label, url, kind) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    candidates.push({ label, url, kind })
  }
  const addMirror = (label, baseUrl, kind) => {
    const base = normalizeMirrorBase(baseUrl)
    if (base) add(label, `${base}/${officialUrl}`, kind)
  }

  if (mode === 'custom') addMirror('自定义镜像', customMirror, 'custom')
  else if (mode !== 'github') {
    for (const mirror of BUILT_IN_UPDATE_MIRRORS) addMirror(mirror.label, mirror.baseUrl, 'mirror')
  }
  add('GitHub 官方线路', officialUrl, 'github')
  return candidates
}

function requestBuffer(url, { headers = {}, maxBytes = MAX_METADATA_BYTES, redirects = MAX_REDIRECTS } = {}) {
  const parsed = assertHttps(url)
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (redirects <= 0) return reject(new Error('更新服务重定向次数过多。'))
        return requestBuffer(new URL(response.headers.location, parsed).toString(), { headers, maxBytes, redirects: redirects - 1 }).then(resolve, reject)
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`更新服务返回 HTTP ${response.statusCode}`))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          request.destroy(new Error('更新元数据超过大小限制。'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    request.setTimeout(15000, () => request.destroy(new Error('更新服务请求超时。')))
    request.on('error', reject)
  })
}

async function requestJson(url) {
  const buffer = await requestBuffer(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'DeepSeek-Harness-Studio-Updater',
      'x-github-api-version': API_VERSION,
    },
  })
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error('更新服务返回了无效 JSON。')
  }
}

function downloadFile(url, filePath, onProgress, redirects = MAX_REDIRECTS) {
  const parsed = assertHttps(url)
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'user-agent': 'DeepSeek-Harness-Studio-Updater' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (redirects <= 0) return reject(new Error('安装包重定向次数过多。'))
        return downloadFile(new URL(response.headers.location, parsed).toString(), filePath, onProgress, redirects - 1).then(resolve, reject)
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`安装包下载返回 HTTP ${response.statusCode}`))
        return
      }
      const total = Number(response.headers['content-length']) || 0
      let received = 0
      const hash = createHash('sha256')
      const output = fs.createWriteStream(filePath, { flags: 'wx' })
      response.on('data', (chunk) => {
        received += chunk.length
        hash.update(chunk)
        onProgress?.({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 1000) / 10) : 0 })
      })
      response.on('error', reject)
      output.on('error', reject)
      output.on('finish', () => resolve({ received, sha256: hash.digest('hex').toUpperCase() }))
      response.pipe(output)
    })
    request.setTimeout(30000, () => request.destroy(new Error('安装包下载超时。')))
    request.on('error', reject)
  })
}

class UpdateManager extends EventEmitter {
  constructor({ currentVersion, getRepository, getDownloadOptions = () => ({}), updateDir, download = downloadFile }) {
    super()
    this.currentVersion = currentVersion
    this.getRepository = getRepository
    this.getDownloadOptions = getDownloadOptions
    this.updateDir = updateDir
    this.downloadFile = download
    this.release = null
    this.status = {
      phase: 'idle',
      message: '尚未检查更新',
      currentVersion,
      latestVersion: '',
      repository: '',
      releaseUrl: '',
      notes: '',
      progress: 0,
      downloadedPath: '',
      checkedAt: '',
      downloadSource: '',
      downloadAttempts: [],
    }
  }

  #set(patch) {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.getStatus())
    return this.getStatus()
  }

  getStatus() {
    return { ...this.status }
  }

  async check() {
    const parsed = parseGitHubRepository(this.getRepository())
    if (!parsed) return this.#set({ phase: 'unconfigured', message: '请先设置 GitHub 更新仓库（owner/repo）。', repository: '' })
    this.#set({ phase: 'checking', message: '正在检查 GitHub Releases…', repository: parsed.slug, progress: 0, downloadedPath: '', downloadSource: '', downloadAttempts: [] })
    try {
      const release = await requestJson(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/releases/latest`)
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '')
      if (!parseVersion(latestVersion)) throw new Error('最新 Release 的标签不是有效版本号。')
      const checkedAt = new Date().toISOString()
      if (compareVersions(latestVersion, this.currentVersion) <= 0) {
        this.release = null
        return this.#set({ phase: 'latest', message: '当前已是最新版本', latestVersion, releaseUrl: release.html_url || '', notes: '', checkedAt })
      }
      const asset = selectReleaseAsset(release.assets, latestVersion)
      if (!asset?.browser_download_url) throw new Error('最新 Release 中没有 Windows x64 安装包。')
      let expectedHash = String(asset.digest || '').match(/^sha256:([0-9a-f]{64})$/i)?.[1]?.toUpperCase() || ''
      if (!expectedHash) {
        const checksumAsset = (release.assets || []).find((item) => /^SHA256SUMS\.txt$/i.test(String(item?.name || '')))
        if (checksumAsset?.browser_download_url) {
          const checksumText = (await requestBuffer(checksumAsset.browser_download_url, { maxBytes: 1024 * 1024 })).toString('utf8')
          expectedHash = parseChecksums(checksumText).get(asset.name) || ''
        }
      }
      this.release = { asset, expectedHash, latestVersion }
      return this.#set({
        phase: 'available',
        message: expectedHash ? `发现新版本 ${latestVersion}` : `发现新版本 ${latestVersion}，但发布页缺少 SHA-256 校验值`,
        latestVersion,
        releaseUrl: release.html_url || '',
        notes: String(release.body || '').slice(0, 6000),
        checkedAt,
      })
    } catch (error) {
      this.release = null
      return this.#set({ phase: 'error', message: error.message || String(error), checkedAt: new Date().toISOString() })
    }
  }

  async download() {
    if (!this.release) await this.check()
    if (!this.release || this.status.phase !== 'available') return this.getStatus()
    if (!this.release.expectedHash) return this.#set({ phase: 'error', message: '为安全起见，缺少 SHA-256 校验值时不会下载安装包。' })
    fs.mkdirSync(this.updateDir, { recursive: true })
    const fileName = path.basename(this.release.asset.name)
    const finalPath = path.join(this.updateDir, fileName)
    const partialPath = `${finalPath}.part`
    for (const candidate of [partialPath, finalPath]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
    }
    const options = this.getDownloadOptions?.() || {}
    const candidates = buildDownloadCandidates(this.release.asset.browser_download_url, options)
    const attempts = []
    for (const candidate of candidates) {
      if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath)
      this.#set({
        phase: 'downloading',
        message: `正在通过${candidate.label}下载 ${this.release.latestVersion}…`,
        progress: 0,
        downloadedPath: '',
        downloadSource: candidate.label,
        downloadAttempts: [...attempts],
      })
      try {
        const result = await this.downloadFile(candidate.url, partialPath, ({ percent }) => {
          this.#set({
            phase: 'downloading',
            progress: percent,
            message: `正在通过${candidate.label}下载 ${this.release.latestVersion}… ${percent.toFixed(1)}%`,
          })
        })
        if (result.sha256 !== this.release.expectedHash) throw new Error('SHA-256 校验失败')
        fs.renameSync(partialPath, finalPath)
        return this.#set({
          phase: 'downloaded',
          message: `版本 ${this.release.latestVersion} 已通过${candidate.label}下载并通过 SHA-256 校验`,
          progress: 100,
          downloadedPath: finalPath,
          downloadSource: candidate.label,
          downloadAttempts: [...attempts, { label: candidate.label, ok: true }],
        })
      } catch (error) {
        if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath)
        attempts.push({ label: candidate.label, ok: false, error: error.message || String(error) })
      }
    }
    const detail = attempts.map((attempt) => `${attempt.label}：${attempt.error}`).join('；')
    return this.#set({
      phase: 'error',
      message: `所有下载线路均失败。${detail}`.slice(0, 1200),
      progress: 0,
      downloadedPath: '',
      downloadSource: '',
      downloadAttempts: attempts,
    })
  }

  install() {
    const installer = this.status.downloadedPath
    if (!installer || !fs.existsSync(installer)) throw new Error('尚未下载可安装的更新。')
    const child = spawn(installer, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return { launched: true, path: installer }
  }
}

module.exports = {
  BUILT_IN_UPDATE_MIRRORS,
  UpdateManager,
  buildDownloadCandidates,
  compareVersions,
  downloadFile,
  parseChecksums,
  parseGitHubRepository,
  parseVersion,
  normalizeMirrorBase,
  requestBuffer,
  requestJson,
  selectReleaseAsset,
}
