const { EventEmitter } = require('node:events')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { assertDshRuntimeIntegrity, readBundledDshVersion } = require('./dsh-runtime-integrity.cjs')

const READY_MARKERS = ['DeepSeek Harness', '<div id="root"></div>']

function executableFromWhere(name) {
  if (process.platform !== 'win32') return name
  const result = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return ''
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || ''
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '..', '..')
}

function resolveDshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
}

function resolveDesktopControlSource() {
  const root = resolveProjectRoot()
  return firstExisting([
    path.join(root, 'packages', 'dsh-desktop-control'),
    path.join(root, 'node_modules', '@deepseek-harness-studio', 'dsh-desktop-control'),
  ])
}

function ensureDesktopControlPackage({ dshHome = resolveDshHome(), source = resolveDesktopControlSource() } = {}) {
  if (!source || !fs.existsSync(path.join(source, 'package.json'))) {
    throw new Error('安装包中缺少桌面控制组件，请重新安装或更新 Studio。')
  }
  const target = path.join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-harness-studio', 'dsh-desktop-control')
  fs.mkdirSync(target, { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true, dereference: true })
  return target
}

function resolveNodeExecutable() {
  const root = resolveProjectRoot()
  const candidates = [
    process.env.DSH_STUDIO_NODE,
    process.resourcesPath && path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    path.join(root, 'assets', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    process.platform === 'win32' && process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe') : '',
    executableFromWhere('node'),
  ]
  return firstExisting(candidates)
}

function resolveDshCli() {
  const root = resolveProjectRoot()
  const home = os.homedir()
  const candidates = [
    process.env.DSH_CLI,
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(home, '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  return firstExisting(candidates)
}

function probeHarness(port, timeout = 1200) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        if (body.length < 8192) body += chunk
      })
      response.on('end', () => resolve({
        ready: response.statusCode === 200 && READY_MARKERS.some((marker) => body.includes(marker)),
        occupied: true,
        statusCode: response.statusCode,
      }))
    })
    request.on('timeout', () => {
      request.destroy()
      resolve({ ready: false, occupied: false })
    })
    request.on('error', (error) => resolve({
      ready: false,
      occupied: error.code !== 'ECONNREFUSED',
      error: error.message,
    }))
  })
}

function callHarness(port, method, payload, timeout = 5000) {
  if (!/^[A-Za-z0-9._-]+$/.test(method)) return Promise.reject(new Error(`无效的 Harness 方法：${method}`))
  const rpcId = randomUUID()
  const body = JSON.stringify({ type: 'client-request', rpcId, method, payload })
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/${method}`,
      method: 'POST',
      timeout,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { responseBody += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Harness API ${method} 返回 HTTP ${response.statusCode}`))
          return
        }
        try {
          const envelope = JSON.parse(responseBody)
          if (envelope.rpcId !== rpcId) throw new Error('Harness API 响应标识不匹配')
          resolve(envelope.result)
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error(`Harness API ${method} 请求超时`)))
    request.on('error', reject)
    request.end(body)
  })
}

function fetchHarnessText(port, resourcePath, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: resourcePath,
      timeout,
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Harness 资源 ${resourcePath} 返回 HTTP ${response.statusCode}`))
          return
        }
        resolve(body)
      })
    })
    request.on('timeout', () => request.destroy(new Error(`Harness 资源 ${resourcePath} 请求超时`)))
    request.on('error', reject)
  })
}

async function inspectHarnessBootstrap(port) {
  const html = await fetchHarnessText(port, '/')
  const bootMatch = html.match(/window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)
  if (!bootMatch) throw new Error('Harness 首页缺少 __DSH_BOOT__ 清单')
  let boot
  try {
    boot = JSON.parse(bootMatch[1])
  } catch (error) {
    throw new Error(`Harness boot 清单无法解析：${error.message || String(error)}`)
  }
  const clientEntry = boot.entries?.find((entry) => entry?.id === '@deepseek-ai/dsh-client-modules')
  if (!clientEntry?.url) throw new Error('Harness boot 清单缺少 dsh-client-modules')
  const clientUrl = new URL(clientEntry.url, `http://127.0.0.1:${port}`)
  if (clientUrl.hostname !== '127.0.0.1' || Number(clientUrl.port || 80) !== Number(port)) {
    throw new Error('Harness client module 指向了非本地地址')
  }
  const clientSource = await fetchHarnessText(port, `${clientUrl.pathname}${clientUrl.search}`)
  const moduleScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1])
  const shellPath = moduleScripts.find((source) => /\/assets\/.*\.js(?:\?|$)/.test(source))
  const shellSource = shellPath ? await fetchHarnessText(port, shellPath) : ''
  const hostSource = `${html}\n${shellSource}`
  const expectsFactory = /createClientModuleSystem|did not export the bootstrap module face/.test(hostSource)
  const providesFactory = /(?:exports\.|["'])createClientModuleSystem(?:["']|\s*=)/.test(clientSource)
  const expectsLegacy = /ClientModuleSystem/.test(hostSource)
  const providesLegacy = /(?:exports\.|["'])ClientModuleSystem(?:["']|\s*=)/.test(clientSource)

  if (expectsFactory && !providesFactory) {
    throw new Error('Harness 宿主需要 createClientModuleSystem，但实际 client.js 未导出该 bootstrap 接口')
  }
  if (!expectsFactory && expectsLegacy && !providesLegacy) {
    throw new Error('Harness Web 需要 ClientModuleSystem，但实际 client.js 未导出该接口')
  }
  if (!expectsFactory && !expectsLegacy) throw new Error('无法识别 Harness Web 的 bootstrap 接口')
  return { revision: String(boot.rev || ''), clientRevision: String(clientEntry.rev || ''), contract: expectsFactory ? 'factory' : 'legacy' }
}

async function ensureWorkspaceRegistered(port, workspace) {
  const resolved = path.resolve(workspace)
  fs.mkdirSync(resolved, { recursive: true })
  const result = await callHarness(port, 'workspace.create', { path: resolved })
  if (!result?.ok) {
    const detail = result?.error ? `${result.error.code}: ${result.error.message}` : '未知错误'
    throw new Error(`默认工作区注册失败：${detail}`)
  }
  return result.value.workspace
}

function unwrapHarnessResult(result, method) {
  if (result?.ok === false) {
    const detail = result.error?.message || result.error?.code || '未知错误'
    throw new Error(`Harness API ${method} 调用失败：${detail}`)
  }
  return result?.ok === true && Object.hasOwn(result, 'value') ? result.value : result
}

async function describeHarness(port) {
  const description = unwrapHarnessResult(await callHarness(port, 'host.describe', {}), 'host.describe')
  if (!description || typeof description.version !== 'string' || !description.version.trim()) {
    throw new Error('Harness 未返回有效的版本信息')
  }
  return description
}

function assertHarnessCompatibility(description, expectedVersion, port) {
  const actualVersion = String(description?.version || '').trim()
  if (!actualVersion) throw new Error(`端口 ${port} 上的 Harness 无法确认版本。`)
  if (actualVersion !== expectedVersion) {
    throw new Error(`端口 ${port} 正在运行 Harness ${actualVersion}，Studio 内置版本为 ${expectedVersion}。为防止客户端模块混用，请关闭外部 Harness 或更换端口。`)
  }
  return actualVersion
}

class RuntimeManager extends EventEmitter {
  constructor(settingsStore, options = {}) {
    super()
    this.settingsStore = settingsStore
    this.beforeStart = typeof options.beforeStart === 'function' ? options.beforeStart : null
    this.child = null
    this.external = false
    this.stopping = false
    this.appRoot = resolveProjectRoot()
    this.expectedVersion = readBundledDshVersion(this.appRoot) || 'unknown'
    this.status = {
      phase: 'idle',
      message: '等待启动',
      url: '',
      pid: null,
      version: this.expectedVersion,
      uiRevision: '',
    }
    this.logs = []
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.getStatus())
  }

  #log(message, level = 'info') {
    const clean = String(message).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
    if (!clean) return
    const entry = { time: new Date().toISOString(), level, message: clean }
    this.logs.push(entry)
    if (this.logs.length > 300) this.logs.shift()
    this.emit('log', entry)
  }

  getStatus() {
    return { ...this.status, logs: this.logs.slice(-80) }
  }

  getPaths() {
    return { node: resolveNodeExecutable(), cli: resolveDshCli() }
  }

  getHarnessVersion() {
    return this.expectedVersion
  }

  #failStart(message, url = '') {
    this.#log(message, 'error')
    this.#setStatus({ phase: 'error', message, url, pid: null })
    return this.getStatus()
  }

  async #verifyRunningHarness(port) {
    let description
    try {
      description = await describeHarness(port)
    } catch (describeError) {
      try {
        const bootstrap = await inspectHarnessBootstrap(port)
        this.#log(`Harness ${this.expectedVersion} bootstrap 已验证（${bootstrap.contract} · ${bootstrap.clientRevision || bootstrap.revision}）`)
        return { version: this.expectedVersion, bootstrap, verification: 'bootstrap' }
      } catch (bootstrapError) {
        throw new Error(`Harness 客户端模块兼容性验证失败：${bootstrapError.message || String(bootstrapError)}。请关闭其他 Harness 进程后重试；host.describe：${describeError.message || String(describeError)}`)
      }
    }
    const version = assertHarnessCompatibility(description, this.expectedVersion, port)
    return { ...description, version, verification: 'host.describe' }
  }

  async registerWorkspace(workspace) {
    const registered = await ensureWorkspaceRegistered(this.settingsStore.get().port, workspace)
    this.#log(`已识别并注册任务路径：${registered.path}`)
    return registered
  }

  async #prepareWorkspace(port, workspace) {
    try {
      const registered = await ensureWorkspaceRegistered(port, workspace)
      this.#log(`默认工作区：${registered.path}`)
      return registered
    } catch (error) {
      this.#log(error instanceof Error ? error.message : String(error), 'warn')
      return null
    }
  }

  async start(options = {}) {
    if (this.child || this.status.phase === 'starting' || this.status.phase === 'running') return this.getStatus()

    const requestedTimeout = Number(options?.timeoutMs)
    const startupTimeoutMs = Number.isFinite(requestedTimeout) ? Math.max(5_000, Math.min(requestedTimeout, 120_000)) : 120_000

    const settings = this.settingsStore.get()
    const workspace = path.resolve(settings.workspace || path.join(os.homedir(), 'DeepSeek Harness', 'Workspace'))
    fs.mkdirSync(workspace, { recursive: true })
    const url = `http://127.0.0.1:${settings.port}`
    const uiRevision = randomUUID()
    this.#setStatus({ phase: 'starting', message: '正在启动 Harness…', url, pid: null, uiRevision })

    try {
      await this.beforeStart?.()
      const integrity = assertDshRuntimeIntegrity(this.appRoot)
      this.expectedVersion = integrity.expectedVersion
      this.#setStatus({ version: this.expectedVersion })
    } catch (error) {
      return this.#failStart(error.message || String(error))
    }

    const existing = await probeHarness(settings.port)
    if (existing.ready) {
      let description
      try {
        description = await this.#verifyRunningHarness(settings.port)
      } catch (error) {
        return this.#failStart(error.message || String(error))
      }
      this.external = true
      await this.#prepareWorkspace(settings.port, workspace)
      this.#log(`已连接兼容的 Harness ${description.version}：${url}`)
      this.#setStatus({ phase: 'running', message: 'Harness 已连接', url, pid: null, version: description.version })
      return this.getStatus()
    }
    if (existing.occupied) {
      const message = `端口 ${settings.port} 已被其他程序占用，请在偏好设置中更换端口。`
      this.#log(message, 'error')
      this.#setStatus({ phase: 'error', message, url: '', pid: null })
      return this.getStatus()
    }

    const node = resolveNodeExecutable()
    const cli = resolveDshCli()
    if (!node || !cli) {
      const missing = [!node && 'Node.js 运行时', !cli && 'DeepSeek Harness'].filter(Boolean).join('、')
      const message = `未找到${missing}。请运行 npm install，或在环境变量中指定 DSH_STUDIO_NODE / DSH_CLI。`
      this.#log(message, 'error')
      this.#setStatus({ phase: 'error', message, url: '', pid: null })
      return this.getStatus()
    }

    this.external = false
    this.stopping = false
    this.#log(`工作区：${workspace}`)
    this.#log(`启动：dsh web --port ${settings.port}`)

    if (settings.desktopControl) {
      try {
        ensureDesktopControlPackage()
        this.#log('真实桌面控制组件已部署（每次操作仍需单独批准）')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.#log(message, 'error')
        this.#setStatus({ phase: 'error', message, url: '', pid: null })
        return this.getStatus()
      }
    }

    const child = spawn(node, [cli, 'web', '--port', String(settings.port)], {
      cwd: workspace,
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        DSH_STUDIO_DESKTOP_CONTROL: settings.desktopControl ? '1' : '0',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    this.#setStatus({ pid: child.pid || null })

    child.stdout.on('data', (data) => this.#log(data))
    child.stderr.on('data', (data) => this.#log(data, 'warn'))
    child.on('error', (error) => {
      this.#log(error.message, 'error')
      this.child = null
      this.#setStatus({ phase: 'error', message: `Harness 启动失败：${error.message}`, pid: null })
    })
    child.on('exit', (code, signal) => {
      const expected = this.stopping
      this.child = null
      this.stopping = false
      this.#log(`Harness 进程已退出（code=${code ?? '-'}, signal=${signal ?? '-'}）`, expected ? 'info' : 'warn')
      if (!expected) this.#setStatus({
        phase: code === 0 ? 'idle' : 'error',
        message: code === 0 ? 'Harness 已停止' : `Harness 异常退出（${code ?? signal ?? 'unknown'}）`,
        pid: null,
      })
    })

    const deadline = Date.now() + startupTimeoutMs
    while (Date.now() < deadline && this.child === child) {
      const probe = await probeHarness(settings.port, 1500)
      if (probe.ready) {
        try {
          const description = await this.#verifyRunningHarness(settings.port)
          this.#setStatus({ version: description.version })
        } catch (error) {
          const message = error.message || String(error)
          await this.stop()
          return this.#failStart(message)
        }
        await this.#prepareWorkspace(settings.port, workspace)
        this.#log(`Harness 已就绪：${url}`)
        this.#setStatus({ phase: 'running', message: 'Harness 已就绪', url, pid: child.pid || null })
        return this.getStatus()
      }
      await new Promise((resolve) => setTimeout(resolve, 550))
    }

    if (this.child === child) {
      this.#setStatus({ phase: 'error', message: 'Harness 启动超时，请查看运行日志。', pid: child.pid || null })
    }
    return this.getStatus()
  }

  async stop() {
    if (this.external) {
      this.external = false
      this.#setStatus({ phase: 'idle', message: '已断开外部 Harness', pid: null })
      return
    }
    const child = this.child
    if (!child) {
      this.#setStatus({ phase: 'idle', message: 'Harness 已停止', pid: null })
      return
    }
    this.stopping = true
    this.#setStatus({ phase: 'stopping', message: '正在停止 Harness…' })
    child.kill()
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 4000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    if (this.child === child && process.platform === 'win32' && child.pid) {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      this.child = null
    }
    this.#setStatus({ phase: 'idle', message: 'Harness 已停止', pid: null })
  }

  async restart() {
    await this.stop()
    return this.start()
  }
}

module.exports = {
  RuntimeManager,
  assertHarnessCompatibility,
  callHarness,
  describeHarness,
  ensureDesktopControlPackage,
  ensureWorkspaceRegistered,
  firstExisting,
  inspectHarnessBootstrap,
  probeHarness,
  resolveDshHome,
  resolveDshCli,
  resolveNodeExecutable,
}
