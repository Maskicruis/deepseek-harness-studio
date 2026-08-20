const { EventEmitter } = require('node:events')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

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

class RuntimeManager extends EventEmitter {
  constructor(settingsStore) {
    super()
    this.settingsStore = settingsStore
    this.child = null
    this.external = false
    this.stopping = false
    this.status = {
      phase: 'idle',
      message: '等待启动',
      url: '',
      pid: null,
      version: '0.1.0-rc.7',
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

  async start() {
    if (this.child || this.status.phase === 'starting' || this.status.phase === 'running') return this.getStatus()

    const settings = this.settingsStore.get()
    const workspace = path.resolve(settings.workspace || path.join(os.homedir(), 'DeepSeek Harness', 'Workspace'))
    fs.mkdirSync(workspace, { recursive: true })
    const url = `http://127.0.0.1:${settings.port}`
    this.#setStatus({ phase: 'starting', message: '正在启动 Harness…', url, pid: null })

    const existing = await probeHarness(settings.port)
    if (existing.ready) {
      this.external = true
      await this.#prepareWorkspace(settings.port, workspace)
      this.#log(`已连接现有 Harness 服务：${url}`)
      this.#setStatus({ phase: 'running', message: 'Harness 已连接', url, pid: null })
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

    const child = spawn(node, [cli, 'web', '--port', String(settings.port)], {
      cwd: workspace,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
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

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && this.child === child) {
      const probe = await probeHarness(settings.port, 1500)
      if (probe.ready) {
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
  callHarness,
  ensureWorkspaceRegistered,
  firstExisting,
  probeHarness,
  resolveDshCli,
  resolveNodeExecutable,
}
