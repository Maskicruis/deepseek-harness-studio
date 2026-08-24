const { spawn } = require('node:child_process')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')
const YAML = require('yaml')

const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const QUARANTINE_FILENAME = '.studio-quarantine.json'
const DOMESTIC_NPM_REGISTRY = 'https://registry.npmmirror.com'

function normalizePluginSource(source) {
  const value = String(source || '').trim()
  if (!value) throw new Error('请输入 npm 包名、GitHub 地址或本地插件目录。')
  if (value.length > 2048 || /[\0\r\n]/.test(value) || value.startsWith('-')) throw new Error('插件来源格式无效。')
  return value
}

function normalizePackageName(name) {
  const value = String(name || '').trim()
  if (!value || value.length > 214 || !PACKAGE_NAME_PATTERN.test(value)) throw new Error('插件包名格式无效。')
  return value
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function readJsonResult(filePath) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: '' }
  } catch (error) {
    return {
      value: {},
      error: fs.existsSync(filePath) ? `配置文件无法解析：${error.message || String(error)}` : 'web profile 尚未创建。',
    }
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.studio.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
}

function inferSourceKind(source) {
  const value = String(source || '').trim()
  if (path.isAbsolute(value) || /^(?:file|link):/i.test(value)) return 'local'
  if (/^(?:github:|git\+|git:\/\/|https?:\/\/github\.com\/|git@github\.com:)/i.test(value)) return 'github'
  if (!value) return 'unknown'
  return 'npm'
}

function packageDirectory(profileDir, name) {
  const packageName = normalizePackageName(name)
  return path.join(profileDir, 'node_modules', ...packageName.split('/'))
}

function repositoryUrl(repository) {
  let value = typeof repository === 'string' ? repository : repository?.url
  value = String(value || '').trim()
  if (!value) return ''
  value = value.replace(/^git\+/, '').replace(/^git@github\.com:/, 'https://github.com/')
  value = value.replace(/\.git$/i, '')
  return /^https?:\/\//i.test(value) ? value : ''
}

function hasDshBundle(manifest) {
  return typeof manifest?.dsh?.bundle?.patch === 'string' && Boolean(manifest.dsh.bundle.patch.trim())
}

function resolveLocalSource(source, baseDir = process.cwd()) {
  const value = String(source || '').trim()
  if (path.isAbsolute(value)) return path.resolve(value)
  const match = value.match(/^(?:file|link):(.*)$/i)
  if (!match) return ''
  return path.resolve(baseDir, match[1])
}

function requestedPackageName(source) {
  const value = String(source || '').trim()
  if (!value || inferSourceKind(value) !== 'npm') return ''
  const match = value.startsWith('@')
    ? value.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/)
    : value.match(/^([^@]+)(?:@.+)?$/)
  if (!match) return ''
  try { return normalizePackageName(match[1]) } catch { return '' }
}

function isPluginNetworkFailure(error) {
  const message = String(error?.message || error || '')
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ERR_SOCKET_TIMEOUT|ERR_PNPM_(?:META_)?FETCH_FAIL|network socket disconnected|fetch failed|request timed out|pnpm failed in profile directory/i.test(message)
}

function normalizePluginError(error, { mirrorRetried = false, directRetried = false } = {}) {
  const detail = String(error?.message || error || '')
    .replace(/\uFFFD+/g, '')
    .replace(/[ \t]+\r?\n/g, '\n')
    .trim()
  const prefix = directRetried
    ? '插件操作失败：DSH 官方源、DSH 国内镜像和内置 pnpm 直连均未成功。'
    : mirrorRetried
      ? '插件操作失败：npm 官方源和国内镜像均未成功。'
      : '插件操作失败。'
  const normalized = new Error(detail ? `${prefix}\n${detail}` : prefix)
  if (error?.code) normalized.code = error.code
  return normalized
}

function buildPluginEnvironment({ baseEnv = process.env, nodePath, shimDir, bundledBin, dshHome, platform = process.platform }) {
  const environment = { ...baseEnv }
  const pathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path')
  const inheritedPath = pathKeys.map((key) => environment[key]).find(Boolean) || ''
  for (const key of pathKeys) delete environment[key]
  const pathKey = platform === 'win32' ? 'Path' : 'PATH'
  environment[pathKey] = [path.dirname(nodePath), shimDir, bundledBin, inheritedPath].filter(Boolean).join(path.delimiter)
  environment.DSH_HOME = dshHome
  environment.NO_COLOR = '1'
  environment.FORCE_COLOR = '0'
  return environment
}

function analyzeBundlePatch({ profileDir, directory, manifest }) {
  const declared = manifest?.dsh?.bundle?.patch
  if (typeof declared !== 'string' || !declared.trim()) {
    return { valid: false, loaderNames: [], unresolvedLoaders: [], error: '未声明 dsh.bundle.patch。' }
  }
  const bundlePath = path.resolve(directory, declared)
  if (!fs.existsSync(bundlePath)) {
    return { valid: false, loaderNames: [], unresolvedLoaders: [], error: `插件声明的 bundle patch 不存在：${declared}` }
  }
  let patches
  try {
    const document = YAML.parseDocument(fs.readFileSync(bundlePath, 'utf8'))
    if (document.errors.length) throw document.errors[0]
    patches = document.toJS()
  } catch (error) {
    return { valid: false, loaderNames: [], unresolvedLoaders: [], error: `bundle patch 无法解析：${error.message || String(error)}` }
  }
  if (!Array.isArray(patches)) {
    return { valid: false, loaderNames: [], unresolvedLoaders: [], error: 'bundle patch 顶层必须是数组。' }
  }
  const loaderNames = []
  for (const patch of patches) {
    if (!Array.isArray(patch?.insert)) continue
    for (const entry of patch.insert) {
      if (typeof entry?.name === 'string' && entry.name.trim() && !entry.group) loaderNames.push(entry.name.trim())
    }
  }
  const profileRequire = createRequire(path.join(profileDir, 'package.json'))
  const packageRequire = createRequire(path.join(directory, 'package.json'))
  const unresolvedLoaders = [...new Set(loaderNames.filter((name) => {
    if (/^(?:cordis:|node:)/.test(name)) return false
    try {
      profileRequire.resolve(name)
      return false
    } catch {
      try {
        packageRequire.resolve(name)
        return false
      } catch {
        return true
      }
    }
  }))]
  return {
    valid: unresolvedLoaders.length === 0,
    loaderNames: [...new Set(loaderNames)],
    unresolvedLoaders,
    error: unresolvedLoaders.length ? `bundle 引用了无法加载的模块：${unresolvedLoaders.join('、')}` : '',
  }
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

function communityRecord({ profileDir, name, source, enabled, orphan = false, quarantine = null }) {
  const directory = packageDirectory(profileDir, name)
  const packagePath = path.join(directory, 'package.json')
  const installed = fs.existsSync(packagePath)
  const packageResult = installed ? readJsonResult(packagePath) : { value: {}, error: '' }
  const manifest = packageResult.value || {}
  const bundleDeclared = hasDshBundle(manifest)
  const bundlePath = bundleDeclared ? path.resolve(directory, manifest.dsh.bundle.patch) : ''
  const bundle = bundleDeclared && fs.existsSync(bundlePath)
  const bundleAnalysis = installed && !packageResult.error && bundle
    ? analyzeBundlePatch({ profileDir, directory, manifest })
    : { valid: false, loaderNames: [], unresolvedLoaders: [], error: '' }
  let health = 'ready'
  let message = '已安装、已启用，DSH bundle 可用。'

  if (orphan) {
    health = 'orphan'
    message = '该 bundle 已启用，但未在 dependencies 中声明。建议修复 profile。'
  } else if (!installed) {
    health = 'missing'
    message = '依赖已声明，但 node_modules 中缺少插件文件。请修复插件。'
  } else if (packageResult.error) {
    health = 'invalid'
    message = packageResult.error
  } else if (bundleDeclared && !bundle) {
    health = 'invalid'
    message = `插件声明的 bundle patch 不存在：${manifest.dsh.bundle.patch}`
  } else if (!bundleDeclared) {
    health = 'incompatible'
    message = '该依赖未声明 dsh.bundle.patch，不能作为 DSH 插件启用。'
  } else if (!bundleAnalysis.valid) {
    health = enabled ? 'load-failed' : 'quarantined'
    message = bundleAnalysis.error || '插件 bundle 无法通过启动前检查。'
  } else if (quarantine) {
    health = enabled ? 'load-failed' : 'quarantined'
    message = String(quarantine.reason || '插件未通过 Harness 实际启动验证，已被安全隔离。')
  } else if (!enabled) {
    health = 'disabled'
    message = '插件已安装，但当前未加入 web profile 的 bundle 列表。'
  }

  return {
    name,
    source: source || '未在 dependencies 中声明',
    sourceKind: inferSourceKind(source),
    enabled: Boolean(enabled),
    builtIn: false,
    installed,
    version: String(manifest.version || ''),
    description: String(manifest.description || ''),
    homepage: String(manifest.homepage || repositoryUrl(manifest.repository) || ''),
    repository: repositoryUrl(manifest.repository),
    packagePath: installed ? directory : '',
    manifestPath: installed ? packagePath : '',
    isBundle: bundle,
    loaderNames: bundleAnalysis.loaderNames,
    unresolvedLoaders: bundleAnalysis.unresolvedLoaders,
    health,
    healthMessage: message,
    hasIssue: !['ready', 'disabled'].includes(health),
    blocksStartup: Boolean(enabled) && !['ready'].includes(health),
    canEnable: installed && bundle && bundleAnalysis.valid && !orphan && !quarantine,
    canToggle: !orphan && (Boolean(enabled) || (installed && bundle && bundleAnalysis.valid && !quarantine)),
    canUpdate: installed && !orphan,
    quarantine,
    orphan,
  }
}

class PluginManager {
  constructor({ cliPath, nodePath, dshHome = path.join(os.homedir(), '.dsh'), onLog = () => {}, commandRunner = null, pnpmRunner = null, baseEnv = process.env }) {
    this.cliPath = cliPath
    this.nodePath = nodePath
    this.dshHome = dshHome
    this.onLog = onLog
    this.commandRunner = commandRunner
    this.pnpmRunner = pnpmRunner
    this.baseEnv = baseEnv
    this.operation = null
  }

  get profileDir() {
    return path.join(this.dshHome, 'profiles', 'web')
  }

  get manifestPath() {
    return path.join(this.profileDir, 'package.json')
  }

  get quarantinePath() {
    return path.join(this.profileDir, QUARANTINE_FILENAME)
  }

  #quarantineRecords() {
    const value = readJson(this.quarantinePath, {})
    return value?.plugins && typeof value.plugins === 'object' && !Array.isArray(value.plugins) ? value.plugins : {}
  }

  #writeQuarantineRecords(plugins) {
    writeJsonAtomic(this.quarantinePath, { version: 1, plugins })
  }

  #markQuarantined(entries) {
    if (!entries.length) return
    const records = this.#quarantineRecords()
    const detectedAt = new Date().toISOString()
    for (const entry of entries) {
      records[entry.name] = {
        reason: String(entry.reason || '插件未通过 Harness 实际启动验证。'),
        source: String(entry.source || 'startup-probe'),
        detectedAt,
      }
    }
    this.#writeQuarantineRecords(records)
  }

  #clearQuarantine(names) {
    const targets = new Set(Array.isArray(names) ? names : [names])
    const records = this.#quarantineRecords()
    let changed = false
    for (const name of targets) {
      if (!Object.prototype.hasOwnProperty.call(records, name)) continue
      delete records[name]
      changed = true
    }
    if (changed) this.#writeQuarantineRecords(records)
  }

  list() {
    const manifestResult = readJsonResult(this.manifestPath)
    const manifest = manifestResult.value || {}
    const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.filter((name) => typeof name === 'string') : []
    const bundleSet = new Set(bundles)
    const quarantineRecords = this.#quarantineRecords()
    const community = Object.entries(dependencies).map(([name, source]) => {
      try {
        return communityRecord({ profileDir: this.profileDir, name, source: String(source || ''), enabled: bundleSet.has(name), quarantine: quarantineRecords[name] || null })
      } catch (error) {
        return {
          name: String(name), source: String(source || ''), sourceKind: inferSourceKind(source), enabled: bundleSet.has(name), builtIn: false,
          installed: false, version: '', description: '', homepage: '', repository: '', packagePath: '', manifestPath: '',
          isBundle: false, health: 'invalid', healthMessage: error.message || String(error), hasIssue: true,
          blocksStartup: bundleSet.has(name), canEnable: false, canToggle: bundleSet.has(name), canUpdate: false, orphan: false,
        }
      }
    })

    for (const name of bundles) {
      if (CORE_BUNDLES.has(name) || Object.prototype.hasOwnProperty.call(dependencies, name)) continue
      try {
        community.push(communityRecord({ profileDir: this.profileDir, name, source: '', enabled: true, orphan: true, quarantine: quarantineRecords[name] || null }))
      } catch {
        community.push({
          name: String(name), source: '无效 bundle 条目', sourceKind: 'unknown', enabled: true, builtIn: false,
          installed: false, version: '', description: '', homepage: '', repository: '', packagePath: '', manifestPath: '',
          isBundle: false, health: 'invalid', healthMessage: 'bundle 列表中包含无效包名。', hasIssue: true,
          blocksStartup: true, canEnable: false, canToggle: false, canUpdate: false, orphan: true,
        })
      }
    }

    community.sort((left, right) => left.name.localeCompare(right.name))
    const core = [...CORE_BUNDLES].map((name) => {
      const enabled = bundleSet.has(name)
      return {
        name,
        source: '随 Harness 提供',
        sourceKind: 'core',
        enabled,
        builtIn: true,
        installed: true,
        version: '',
        description: name.endsWith('dsh-base') ? 'DeepSeek Harness 核心运行时能力。' : 'DeepSeek Harness Web 应用界面。',
        homepage: '', repository: '', packagePath: '', manifestPath: '', isBundle: true,
        health: enabled ? 'core' : 'core-missing',
        healthMessage: enabled ? '随 Harness 提供并始终启用。' : '核心 bundle 未写入 profile，需要修复。',
        hasIssue: !enabled,
        blocksStartup: false,
        canEnable: false,
        canToggle: false,
        canUpdate: false,
        orphan: false,
      }
    })
    const summary = {
      total: community.length,
      ready: community.filter((plugin) => plugin.health === 'ready').length,
      disabled: community.filter((plugin) => plugin.health === 'disabled').length,
      issues: community.filter((plugin) => plugin.hasIssue).length + core.filter((plugin) => plugin.hasIssue).length,
      blocking: community.filter((plugin) => plugin.blocksStartup).length,
    }
    return {
      profileDir: this.profileDir,
      manifestPath: this.manifestPath,
      manifestError: manifestResult.error,
      core,
      community,
      count: community.length,
      summary,
      operation: this.operation,
      scannedAt: new Date().toISOString(),
    }
  }

  inspectSource(source) {
    const normalized = normalizePluginSource(source)
    const sourceKind = inferSourceKind(normalized)
    if (sourceKind !== 'local') {
      return {
        source: normalized,
        sourceKind,
        inspected: false,
        compatible: null,
        message: '远程来源将在下载后验证 DSH bundle 清单。',
      }
    }

    const directory = resolveLocalSource(normalized, this.profileDir)
    if (!directory || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('选择的本地插件目录不存在。')
    const manifestPath = path.join(directory, 'package.json')
    if (!fs.existsSync(manifestPath)) throw new Error('所选目录缺少 package.json，不是可安装插件。')
    const result = readJsonResult(manifestPath)
    if (result.error) throw new Error(result.error)
    const manifest = result.value
    const name = normalizePackageName(manifest.name)
    if (!hasDshBundle(manifest)) throw new Error('该包未声明 dsh.bundle.patch，不是可用的 DSH 插件。')
    const bundlePath = path.resolve(directory, manifest.dsh.bundle.patch)
    if (!fs.existsSync(bundlePath)) throw new Error(`插件声明的 bundle patch 不存在：${manifest.dsh.bundle.patch}`)
    const analysis = analyzeBundlePatch({ profileDir: this.profileDir, directory, manifest })
    if (!analysis.valid) throw new Error(analysis.error)
    return {
      source: normalized,
      sourceKind,
      inspected: true,
      compatible: true,
      name,
      version: String(manifest.version || ''),
      description: String(manifest.description || ''),
      directory,
      manifestPath,
      loaderNames: analysis.loaderNames,
      message: '本地插件结构验证通过。',
    }
  }

  #spawnNodeScript(entry, args, environment) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.nodePath, [entry, ...args], {
        cwd: this.profileDir,
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      const record = (text, level) => {
        const clean = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        if (!clean) return
        output += clean
        const message = clean.trim()
        if (message) this.onLog({ level, message, timestamp: new Date().toISOString() })
      }
      child.stdout.on('data', (chunk) => record(stdoutDecoder.write(chunk), 'info'))
      child.stderr.on('data', (chunk) => record(stderrDecoder.write(chunk), 'warn'))
      child.on('error', reject)
      child.on('close', (code) => {
        record(stdoutDecoder.end(), 'info')
        record(stderrDecoder.end(), 'warn')
        const detail = output.trim()
        if (code === 0) resolve(detail)
        else reject(new Error(detail || `插件命令退出，代码 ${code}`))
      })
    })
  }

  #reconcileBundles(before) {
    const after = readJson(this.manifestPath, {})
    const beforeDependencies = new Set(Object.keys(before?.dependencies || {}))
    const dependencies = Object.keys(after?.dependencies || {})
    const dependencySet = new Set(dependencies)
    const bundles = Array.isArray(after?.dsh?.profile?.bundles) ? [...after.dsh.profile.bundles] : []
    let changed = false
    const exportsBundle = (name) => {
      const manifest = readJson(path.join(packageDirectory(this.profileDir, name), 'package.json'), {})
      return hasDshBundle(manifest)
    }
    for (const name of dependencies) {
      if (exportsBundle(name) && !bundles.includes(name)) {
        bundles.push(name)
        changed = true
      }
    }
    for (const name of [...bundles]) {
      const wasDependency = beforeDependencies.has(name) || dependencySet.has(name)
      const stillBundle = dependencySet.has(name) && exportsBundle(name)
      if (wasDependency && !stillBundle) {
        bundles.splice(bundles.indexOf(name), 1)
        changed = true
      }
    }
    if (!changed) return
    after.dsh ||= {}
    after.dsh.profile ||= {}
    after.dsh.profile.bundles = bundles
    writeJsonAtomic(this.manifestPath, after)
  }

  async #runBundledPnpm(args) {
    if (!this.nodePath || !fs.existsSync(this.nodePath)) throw new Error('找不到 Node.js 运行时。')
    if (!this.cliPath || !fs.existsSync(this.cliPath)) throw new Error('找不到 DeepSeek Harness CLI。')
    const before = readJson(this.manifestPath, {})
    const bundledBin = path.resolve(path.dirname(this.cliPath), '..', '..', '..', '.bin')
    const { shimDir, pnpmEntry } = createPnpmShim({ cliPath: this.cliPath, nodePath: this.nodePath, dshHome: this.dshHome })
    const environment = buildPluginEnvironment({ baseEnv: this.baseEnv, nodePath: this.nodePath, shimDir, bundledBin, dshHome: this.dshHome })
    this.onLog({ level: 'warn', message: `正在绕过 DSH 转发层，直接调用内置 pnpm：${pnpmEntry}`, timestamp: new Date().toISOString() })
    const output = this.pnpmRunner
      ? await this.pnpmRunner(args)
      : await this.#spawnNodeScript(pnpmEntry, args, environment)
    this.#reconcileBundles(before)
    return output
  }

  async #run(args) {
    if (this.operation) throw new Error('已有插件操作正在进行，请稍候。')
    this.operation = args.join(' ')
    const execute = async (commandArgs) => {
      this.onLog({ level: 'info', message: `dsh plugin ${commandArgs.join(' ')}`, timestamp: new Date().toISOString() })
      this.onLog({ level: 'info', message: `插件运行环境：Node=${this.nodePath} · Profile=${this.profileDir}`, timestamp: new Date().toISOString() })
      if (this.commandRunner) return this.commandRunner(commandArgs)
      if (!this.nodePath || !fs.existsSync(this.nodePath)) throw new Error('找不到 Node.js 运行时。')
      if (!this.cliPath || !fs.existsSync(this.cliPath)) throw new Error('找不到 DeepSeek Harness CLI。')

      fs.mkdirSync(this.profileDir, { recursive: true })
      const bundledBin = path.resolve(path.dirname(this.cliPath), '..', '..', '..', '.bin')
      const { shimDir } = createPnpmShim({ cliPath: this.cliPath, nodePath: this.nodePath, dshHome: this.dshHome })
      const environment = buildPluginEnvironment({ baseEnv: this.baseEnv, nodePath: this.nodePath, shimDir, bundledBin, dshHome: this.dshHome })
      return this.#spawnNodeScript(this.cliPath, ['plugin', '--profile', 'web', ...commandArgs], environment)
    }
    try {
      try {
        return await execute(args)
      } catch (error) {
        if (!isPluginNetworkFailure(error) || args.some((argument) => /^--registry(?:=|$)/.test(argument))) throw normalizePluginError(error)
        const fallbackArgs = [...args, `--registry=${DOMESTIC_NPM_REGISTRY}`]
        this.onLog({ level: 'warn', message: `npm 官方源连接失败，正在切换国内镜像重试：${DOMESTIC_NPM_REGISTRY}`, timestamp: new Date().toISOString() })
        try {
          return await execute(fallbackArgs)
        } catch (fallbackError) {
          try {
            return await this.#runBundledPnpm(fallbackArgs)
          } catch (directError) {
            throw normalizePluginError(directError, { mirrorRetried: true, directRetried: true })
          }
        }
      }
    } finally {
      this.operation = null
    }
  }

  #quarantineBlocking(inventory = this.list()) {
    const blockedPlugins = inventory.community.filter((plugin) => plugin.blocksStartup)
    const blocked = blockedPlugins.map((plugin) => plugin.name)
    if (!blocked.length) return []
    this.#markQuarantined(blockedPlugins.map((plugin) => ({ name: plugin.name, reason: plugin.healthMessage, source: 'static-check' })))
    const manifest = readJson(this.manifestPath, {})
    manifest.dsh ||= {}
    manifest.dsh.profile ||= {}
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    manifest.dsh.profile.bundles = bundles.filter((bundle) => !blocked.includes(bundle))
    writeJsonAtomic(this.manifestPath, manifest)
    for (const name of blocked) {
      this.onLog({ level: 'warn', message: `已隔离启动失败插件：${name}`, timestamp: new Date().toISOString() })
    }
    return blocked
  }

  async isolateStartupFailures(probe) {
    if (typeof probe !== 'function') throw new Error('缺少 Harness 启动探测器。')
    const initial = this.list()
    const enabled = initial.community.filter((plugin) => plugin.enabled).map((plugin) => plugin.name)
    const manifestResult = readJsonResult(this.manifestPath)
    if (manifestResult.error) throw new Error(manifestResult.error)
    const originalManifest = manifestResult.value
    const originalBundles = Array.isArray(originalManifest.dsh?.profile?.bundles) ? [...originalManifest.dsh.profile.bundles] : []
    const coreBundles = [...new Set([...originalBundles.filter((name) => CORE_BUNDLES.has(name)), ...CORE_BUNDLES])]
    let attempts = 0

    const applyCommunity = (names) => {
      const current = readJson(this.manifestPath, originalManifest)
      current.dsh ||= {}
      current.dsh.profile ||= {}
      current.dsh.profile.bundles = [...new Set([...coreBundles, ...names])]
      writeJsonAtomic(this.manifestPath, current)
    }
    const verify = async (names) => {
      applyCommunity(names)
      attempts += 1
      this.onLog({ level: 'info', message: `实际启动探测 ${attempts}：${names.length ? names.join('、') : '仅核心组件'}`, timestamp: new Date().toISOString() })
      try {
        const result = await probe(names)
        return { ok: Boolean(result?.ok), message: String(result?.message || (result?.ok ? '启动通过' : '启动失败')) }
      } catch (error) {
        return { ok: false, message: error.message || String(error) }
      }
    }

    try {
      const baseline = await verify([])
      if (!baseline.ok) {
        writeJsonAtomic(this.manifestPath, originalManifest)
        return { ok: false, coreFailure: true, isolated: [], quarantined: [], attempts, message: `仅核心组件也无法启动：${baseline.message}`, inventory: this.list() }
      }

      const accepted = []
      let remaining = [...enabled]
      const isolated = []

      const locateFailure = async (candidates, knownFailure) => {
        if (candidates.length === 1) return { name: candidates[0], reason: knownFailure.message }
        const middle = Math.ceil(candidates.length / 2)
        const left = candidates.slice(0, middle)
        const right = candidates.slice(middle)
        const leftResult = await verify([...accepted, ...left])
        if (!leftResult.ok) return locateFailure(left, leftResult)
        const rightResult = await verify([...accepted, ...right])
        if (!rightResult.ok) return locateFailure(right, rightResult)
        return { name: candidates[candidates.length - 1], reason: `与其他插件组合时启动失败：${knownFailure.message}` }
      }

      while (remaining.length) {
        const allResult = await verify([...accepted, ...remaining])
        if (allResult.ok) {
          accepted.push(...remaining)
          remaining = []
          break
        }
        const failure = await locateFailure(remaining, allResult)
        isolated.push(failure)
        remaining = remaining.filter((name) => name !== failure.name)
      }

      applyCommunity(accepted)
      this.#clearQuarantine(accepted)
      this.#markQuarantined(isolated.map((entry) => ({ ...entry, source: 'startup-probe' })))
      for (const entry of isolated) {
        this.onLog({ level: 'warn', message: `实际启动验证失败，已隔离：${entry.name}（${entry.reason}）`, timestamp: new Date().toISOString() })
      }
      return {
        ok: true,
        coreFailure: false,
        isolated,
        quarantined: isolated.map((entry) => entry.name),
        attempts,
        message: isolated.length ? `已隔离 ${isolated.length} 个启动故障插件。` : '全部社区插件均通过实际启动验证。',
        inventory: this.list(),
      }
    } catch (error) {
      writeJsonAtomic(this.manifestPath, originalManifest)
      throw error
    }
  }

  diagnose({ quarantine = false } = {}) {
    const before = this.list()
    const blocking = before.community.filter((plugin) => plugin.blocksStartup)
    const alreadyIsolated = before.community.filter((plugin) => plugin.health === 'quarantined')
    this.#markQuarantined(alreadyIsolated.map((plugin) => ({ name: plugin.name, reason: plugin.healthMessage, source: plugin.quarantine?.source || 'static-check' })))
    const quarantined = quarantine ? this.#quarantineBlocking(before) : []
    const inventory = quarantined.length || alreadyIsolated.length ? this.list() : before
    return {
      ok: blocking.length === 0,
      blocking: blocking.map((plugin) => ({ name: plugin.name, health: plugin.health, message: plugin.healthMessage })),
      quarantined,
      inventory,
    }
  }

  async install(source) {
    const inspected = this.inspectSource(source)
    const requestedName = requestedPackageName(inspected.source)
    const before = new Set(this.list().community.map((plugin) => plugin.name))
    const output = await this.#run(['add', inspected.source, '--reporter=append-only'])
    let detected = this.list()
    const installed = detected.community.filter((plugin) => !before.has(plugin.name)).map((plugin) => plugin.name)
    let affected = installed.length
      ? detected.community.filter((plugin) => installed.includes(plugin.name))
      : detected.community.filter((plugin) => plugin.name === inspected.name || plugin.name === requestedName || plugin.source === inspected.source)
    const retryNames = affected.filter((plugin) => plugin.quarantine).map((plugin) => plugin.name)
    if (retryNames.length) {
      this.#clearQuarantine(retryNames)
      detected = this.list()
      for (const name of retryNames) {
        const recovered = detected.community.find((plugin) => plugin.name === name)
        if (!recovered?.enabled && recovered?.canEnable) detected = this.toggle(name, true)
      }
      affected = detected.community.filter((plugin) => retryNames.includes(plugin.name) || installed.includes(plugin.name))
    }
    const invalid = affected.find((plugin) => plugin.hasIssue)
    if (invalid) this.onLog({ level: 'warn', message: `${invalid.name}：${invalid.healthMessage}`, timestamp: new Date().toISOString() })
    const quarantined = this.#quarantineBlocking(detected)
    return { output, installed, inspected, quarantined, inventory: quarantined.length ? this.list() : detected, warning: invalid?.healthMessage || '' }
  }

  async update(name) {
    const packageName = normalizePackageName(name)
    const plugin = this.list().community.find((item) => item.name === packageName && !item.orphan)
    if (!plugin) throw new Error('未找到可更新的社区插件。')
    const args = plugin.sourceKind === 'npm'
      ? ['update', packageName, '--latest', '--reporter=append-only']
      : ['add', `${packageName}@${plugin.source}`, '--reporter=append-only']
    const output = await this.#run(args)
    if (plugin.health === 'quarantined') this.#clearQuarantine(packageName)
    let detected = this.list()
    const recovered = detected.community.find((item) => item.name === packageName)
    const restored = plugin.health === 'quarantined' && recovered?.canEnable ? [packageName] : []
    if (restored.length) detected = this.toggle(packageName, true)
    const quarantined = this.#quarantineBlocking(detected)
    return { output, quarantined, restored, inventory: quarantined.length ? this.list() : detected }
  }

  async repair(name = '') {
    const packageName = String(name || '').trim()
    if (!packageName) {
      const result = readJsonResult(this.manifestPath)
      if (result.error && fs.existsSync(this.manifestPath)) throw new Error(`${result.error} 请先备份并修正 package.json，Studio 不会覆盖损坏的配置。`)
      const manifest = result.value || {}
      manifest.name ||= 'dsh-profile-web'
      manifest.private = true
      manifest.dependencies ||= {}
      manifest.dsh ||= {}
      manifest.dsh.profile ||= {}
      const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
      manifest.dsh.profile.bundles = [...new Set([...CORE_BUNDLES, ...bundles])]
      writeJsonAtomic(this.manifestPath, manifest)
      const output = await this.#run(['install', '--reporter=append-only'])
      const detected = this.list()
      const quarantined = this.#quarantineBlocking(detected)
      return { output, quarantined, inventory: quarantined.length ? this.list() : detected }
    }

    const normalized = normalizePackageName(packageName)
    const plugin = this.list().community.find((item) => item.name === normalized && !item.orphan)
    if (!plugin) throw new Error('未找到可修复的社区插件。')
    const output = await this.#run(['add', `${normalized}@${plugin.source}`, '--reporter=append-only'])
    if (plugin.health === 'quarantined') this.#clearQuarantine(normalized)
    let detected = this.list()
    const recovered = detected.community.find((item) => item.name === normalized)
    const restored = plugin.health === 'quarantined' && recovered?.canEnable ? [normalized] : []
    if (restored.length) detected = this.toggle(normalized, true)
    const quarantined = this.#quarantineBlocking(detected)
    return { output, quarantined, restored, inventory: quarantined.length ? this.list() : detected }
  }

  async remove(name) {
    const packageName = normalizePackageName(name)
    if (CORE_BUNDLES.has(packageName)) throw new Error('内置核心插件不能移除。')
    const inventory = this.list()
    const plugin = inventory.community.find((item) => item.name === packageName)
    if (!plugin) throw new Error('未找到该社区插件。')
    if (plugin.orphan) {
      const manifest = readJson(this.manifestPath, {})
      const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
      manifest.dsh.profile.bundles = bundles.filter((bundle) => bundle !== packageName)
      writeJsonAtomic(this.manifestPath, manifest)
      this.#clearQuarantine(packageName)
      this.onLog({ level: 'info', message: `已清理孤立 bundle：${packageName}`, timestamp: new Date().toISOString() })
      return { output: '', inventory: this.list() }
    }
    const output = await this.#run(['remove', packageName, '--reporter=append-only'])
    this.#clearQuarantine(packageName)
    return { output, inventory: this.list() }
  }

  toggle(name, enabled) {
    const packageName = normalizePackageName(name)
    if (CORE_BUNDLES.has(packageName)) throw new Error('内置核心插件始终启用。')
    const inventory = this.list()
    const plugin = inventory.community.find((item) => item.name === packageName)
    if (!plugin) throw new Error('未找到该社区插件。')
    if (enabled && !plugin.canEnable) throw new Error(plugin.healthMessage || '该插件未通过启动检查，不能启用。')
    if (!enabled && !plugin.enabled) return inventory
    const manifest = readJson(this.manifestPath, {})
    manifest.dsh ||= {}
    manifest.dsh.profile ||= {}
    const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : []
    const index = bundles.indexOf(packageName)
    if (enabled && index < 0) bundles.push(packageName)
    if (!enabled && index >= 0) bundles.splice(index, 1)
    manifest.dsh.profile.bundles = bundles
    writeJsonAtomic(this.manifestPath, manifest)
    this.onLog({ level: 'info', message: `${enabled ? '启用' : '停用'}插件：${packageName}`, timestamp: new Date().toISOString() })
    return this.list()
  }

  location(name) {
    const packageName = normalizePackageName(name)
    const plugin = this.list().community.find((item) => item.name === packageName)
    if (!plugin?.packagePath || !fs.existsSync(plugin.packagePath)) throw new Error('插件安装目录不存在。')
    return plugin.packagePath
  }
}

module.exports = {
  CORE_BUNDLES,
  DOMESTIC_NPM_REGISTRY,
  PluginManager,
  analyzeBundlePatch,
  buildPluginEnvironment,
  communityRecord,
  createPnpmShim,
  hasDshBundle,
  inferSourceKind,
  isPluginNetworkFailure,
  normalizePluginError,
  normalizePackageName,
  normalizePluginSource,
  packageDirectory,
  readJson,
  readJsonResult,
  repositoryUrl,
  requestedPackageName,
  resolveLocalSource,
  writeJsonAtomic,
}
