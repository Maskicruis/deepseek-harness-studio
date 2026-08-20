const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

function normalizePluginSource(source) {
  const value = String(source || '').trim()
  if (!value) throw new Error('请输入 npm 包名、GitHub 地址或本地插件目录。')
  if (value.length > 2048 || /[\0\r\n]/.test(value)) throw new Error('插件来源格式无效。')
  return value
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.studio.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
}

function inferSourceKind(source) {
  if (path.isAbsolute(source)) return 'local'
  if (/^(github:|git\+|https?:\/\/github\.com\/)/i.test(source)) return 'github'
  return 'npm'
}

function createPnpmShim({ cliPath, nodePath, dshHome }) {
  const nodeModulesRoot = path.resolve(path.dirname(cliPath), '..', '..', '..')
  const pnpmEntry = path.join(nodeModulesRoot, 'pnpm', 'bin', 'pnpm.cjs')
  if (!fs.existsSync(pnpmEntry)) throw new Error('应用内未找到 pnpm，无法管理插件。')
  const shimDir = path.join(dshHome, '.studio-bin')
  fs.mkdirSync(shimDir, { recursive: true })
  if (process.platform === 'win32') {
    const shimPath = path.join(shimDir, 'pnpm.cmd')
    const content = `@echo off\r\n"${nodePath}" "${pnpmEntry}" %*\r\n`
    if (!fs.existsSync(shimPath) || fs.readFileSync(shimPath, 'utf8') !== content) fs.writeFileSync(shimPath, content, 'utf8')
    return { shimDir, shimPath, pnpmEntry }
  }
  const shimPath = path.join(shimDir, 'pnpm')
  const content = `#!/bin/sh\nexec "${nodePath}" "${pnpmEntry}" "$@"\n`
  if (!fs.existsSync(shimPath) || fs.readFileSync(shimPath, 'utf8') !== content) {
    fs.writeFileSync(shimPath, content, { encoding: 'utf8', mode: 0o755 })
  }
  return { shimDir, shimPath, pnpmEntry }
}

class PluginManager {
  constructor({ cliPath, nodePath, dshHome = path.join(os.homedir(), '.dsh'), onLog = () => {} }) {
    this.cliPath = cliPath
    this.nodePath = nodePath
    this.dshHome = dshHome
    this.onLog = onLog
    this.operation = null
  }

  get profileDir() {
    return path.join(this.dshHome, 'profiles', 'web')
  }

  get manifestPath() {
    return path.join(this.profileDir, 'package.json')
  }

  list() {
    const manifest = readJson(this.manifestPath, {})
    const dependencies = manifest.dependencies || {}
    const bundles = manifest.dsh?.profile?.bundles || []
    const community = Object.entries(dependencies).map(([name, source]) => ({
      name,
      source,
      sourceKind: inferSourceKind(source),
      enabled: bundles.includes(name),
      builtIn: false,
    }))
    const core = bundles.filter((name) => CORE_BUNDLES.has(name)).map((name) => ({
      name,
      source: '随 Harness 提供',
      sourceKind: 'core',
      enabled: true,
      builtIn: true,
    }))
    return { profileDir: this.profileDir, core, community, count: community.length }
  }

  async #run(args) {
    if (this.operation) throw new Error('已有插件操作正在进行，请稍候。')
    if (!this.nodePath || !fs.existsSync(this.nodePath)) throw new Error('找不到 Node.js 运行时。')
    if (!this.cliPath || !fs.existsSync(this.cliPath)) throw new Error('找不到 DeepSeek Harness CLI。')

    fs.mkdirSync(this.profileDir, { recursive: true })
    this.operation = args.join(' ')
    this.onLog({ level: 'info', message: `dsh ${args.join(' ')}` })
    try {
      return await new Promise((resolve, reject) => {
        const bundledBin = path.resolve(path.dirname(this.cliPath), '..', '..', '..', '.bin')
        const { shimDir } = createPnpmShim({ cliPath: this.cliPath, nodePath: this.nodePath, dshHome: this.dshHome })
        const child = spawn(this.nodePath, [this.cliPath, 'plugin', '--profile', 'web', ...args], {
          cwd: this.profileDir,
          env: {
            ...process.env,
            DSH_HOME: this.dshHome,
            PATH: `${path.dirname(this.nodePath)}${path.delimiter}${shimDir}${path.delimiter}${bundledBin}${path.delimiter}${process.env.PATH || ''}`,
            NO_COLOR: '1',
            FORCE_COLOR: '0',
          },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let output = ''
        const record = (chunk, level) => {
          const text = chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
          if (!text) return
          output += `${text}\n`
          this.onLog({ level, message: text })
        }
        child.stdout.on('data', (chunk) => record(chunk, 'info'))
        child.stderr.on('data', (chunk) => record(chunk, 'warn'))
        child.on('error', reject)
        child.on('exit', (code) => {
          if (code === 0) resolve(output.trim())
          else reject(new Error(output.trim() || `插件命令退出，代码 ${code}`))
        })
      })
    } finally {
      this.operation = null
    }
  }

  async install(source) {
    const normalized = normalizePluginSource(source)
    if (path.isAbsolute(normalized) && !fs.existsSync(normalized)) throw new Error('选择的本地插件目录不存在。')
    const before = new Set(Object.keys(readJson(this.manifestPath, {}).dependencies || {}))
    const output = await this.#run(['add', normalized])
    const inventory = this.list()
    const installed = inventory.community.filter((plugin) => !before.has(plugin.name)).map((plugin) => plugin.name)
    return { output, installed, inventory }
  }

  async remove(name) {
    const packageName = String(name || '').trim()
    if (!packageName || CORE_BUNDLES.has(packageName)) throw new Error('内置核心插件不能移除。')
    const inventory = this.list()
    if (!inventory.community.some((plugin) => plugin.name === packageName)) throw new Error('未找到该社区插件。')
    const output = await this.#run(['remove', packageName])
    return { output, inventory: this.list() }
  }

  toggle(name, enabled) {
    const packageName = String(name || '').trim()
    if (!packageName || CORE_BUNDLES.has(packageName)) throw new Error('内置核心插件始终启用。')
    const manifest = readJson(this.manifestPath, {})
    const dependencies = manifest.dependencies || {}
    if (!(packageName in dependencies)) throw new Error('未找到该社区插件。')
    manifest.dsh ||= {}
    manifest.dsh.profile ||= {}
    const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : []
    const index = bundles.indexOf(packageName)
    if (enabled && index < 0) bundles.push(packageName)
    if (!enabled && index >= 0) bundles.splice(index, 1)
    manifest.dsh.profile.bundles = bundles
    writeJsonAtomic(this.manifestPath, manifest)
    this.onLog({ level: 'info', message: `${enabled ? '启用' : '停用'}插件：${packageName}` })
    return this.list()
  }
}

module.exports = {
  CORE_BUNDLES,
  PluginManager,
  createPnpmShim,
  inferSourceKind,
  normalizePluginSource,
  readJson,
  writeJsonAtomic,
}
