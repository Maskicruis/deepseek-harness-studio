const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const ENGINES = Object.freeze(['antigravity-cli', 'gemini-api', 'openai', 'anthropic', 'claude-cli'])
const API_ENGINES = new Set(['gemini-api', 'openai', 'anthropic'])
const REUSE_HARNESSES = Object.freeze(['claude', 'codex', 'opencode', 'pi', 'grok'])

function cleanText(value, field, maximum) {
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本。`)
  if (value.length > maximum || /[\0\r\n]/.test(value)) throw new Error(`${field} 格式无效。`)
  return value.trim()
}

function validateEndpoint(value) {
  const endpoint = cleanText(value, '接口地址', 2048)
  if (!endpoint) return ''
  let parsed
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error('接口地址不是有效 URL。')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('接口地址仅支持 HTTP(S)。')
  if (parsed.username || parsed.password) throw new Error('请勿在接口地址中包含用户名或密码。')
  return endpoint.replace(/\/$/, '')
}

function validatePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('视觉配置格式无效。')
  const patch = {}
  if (input.provider !== undefined) {
    const provider = cleanText(input.provider, '视觉引擎', 64).toLowerCase()
    if (provider !== '' && !ENGINES.includes(provider)) throw new Error('不支持该视觉引擎。')
    patch.provider = provider
  }
  if (input.engine !== undefined) {
    const engine = cleanText(input.engine, '视觉引擎', 64).toLowerCase()
    if (!ENGINES.includes(engine)) throw new Error('不支持该视觉引擎。')
    patch.engine = engine
  }
  if (input.apiKey !== undefined) patch.apiKey = cleanText(input.apiKey, 'API Key', 8192)
  if (input.baseUrl !== undefined) patch.baseUrl = validateEndpoint(input.baseUrl)
  if (input.model !== undefined) patch.model = cleanText(input.model, '模型名称', 512)
  if (input.reuse !== undefined) {
    if (!input.reuse || typeof input.reuse !== 'object' || Array.isArray(input.reuse)) throw new Error('复用授权格式无效。')
    patch.reuse = {}
    for (const name of REUSE_HARNESSES) {
      if (typeof input.reuse[name] === 'boolean') patch.reuse[name] = input.reuse[name]
    }
  }
  return patch
}

function requestJson({ port, method = 'GET', requestPath, body, timeout = 35_000 }) {
  const parsedPort = Number(port)
  if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
    return Promise.reject(new Error('Harness 端口无效。'))
  }
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: parsedPort,
      path: requestPath,
      method,
      timeout,
      headers: payload ? {
        'content-type': 'application/json',
        'content-length': payload.length,
      } : undefined,
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        if (responseBody.length < 1024 * 1024) responseBody += chunk
      })
      response.on('end', () => {
        let parsed = {}
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {}
        } catch {
          reject(new Error('ModLens 返回了无效响应。'))
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(parsed.error || `ModLens 返回 HTTP ${response.statusCode}`))
          return
        }
        resolve(parsed)
      })
    })
    request.on('timeout', () => request.destroy(new Error('ModLens 响应超时。')))
    request.on('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

function runJson(nodePath, cliPath, args, timeout = 35_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [cliPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `ModLens 诊断退出，代码 ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('ModLens 诊断结果无法解析。'))
      }
    })
  })
}

function summarizeStatus({ installed, version, config, doctor, configError = '', doctorError = '' }) {
  if (!installed) {
    return {
      installed: false,
      version: '',
      phase: 'missing',
      message: '尚未安装 ModLens，请先在插件中心接入。',
      config: null,
      providers: [],
      selection: null,
      chains: { local: [], remote: [] },
      error: '',
    }
  }
  const providers = Array.isArray(doctor?.providers)
    ? doctor.providers.map((provider) => ({
      name: provider.name,
      kind: provider.kind,
      ready: provider.ready === true,
      status: provider.status || '',
      detail: provider.detail || '',
      authUnverified: provider.authUnverified === true,
      missing: Array.isArray(provider.settings)
        ? provider.settings.filter((field) => !field.present).map((field) => field.field)
        : [],
    }))
    : []
  const readyProviders = providers.filter((provider) => provider.ready && !provider.authUnverified)
  const unverifiedProviders = providers.filter((provider) => provider.ready && provider.authUnverified)
  const selectedName = doctor?.selection?.canonical || config?.provider || ''
  const selected = providers.find((provider) => provider.name === selectedName)
  let phase = 'unconfigured'
  let message = '尚未配置可用视觉引擎。建议接入 Gemini API 或 OpenAI 兼容视觉接口。'
  if (readyProviders.length) {
    phase = selected?.ready ? 'ready' : 'degraded'
    message = selected?.ready
      ? `${selected.name} 已就绪，可以读取图片。`
      : `可用备用引擎：${readyProviders.map((provider) => provider.name).join('、')}；当前首选引擎尚未就绪。`
  } else if (unverifiedProviders.length) {
    phase = 'degraded'
    message = `已发现 ${unverifiedProviders.map((provider) => provider.name).join('、')}，但登录状态未验证；建议配置直连视觉 API。`
  }
  if (configError) {
    phase = phase === 'ready' ? 'degraded' : phase
    message = `ModLens 已安装，但设置接口不可用：${configError}`
  } else if (doctorError && !providers.length) {
    phase = 'error'
    message = `ModLens 诊断失败：${doctorError}`
  }
  return {
    installed: true,
    version,
    phase,
    message,
    config: config || null,
    providers,
    selection: doctor?.selection || null,
    chains: doctor?.chains || { local: [], remote: [] },
    error: configError || doctorError || '',
  }
}

class ModlensManager {
  constructor({ nodePath, dshHome, getPort, request = requestJson, runDoctor = runJson }) {
    this.nodePath = nodePath
    this.dshHome = dshHome
    this.getPort = getPort
    this.request = request
    this.runDoctor = runDoctor
  }

  get packageRoot() {
    return path.join(this.dshHome, 'profiles', 'web', 'node_modules', '@liustack', 'modlens')
  }

  get cliPath() {
    return path.join(this.packageRoot, 'dist', 'main.js')
  }

  get version() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.packageRoot, 'package.json'), 'utf8')).version || ''
    } catch {
      return ''
    }
  }

  async getConfig(discover = true) {
    return this.request({
      port: this.getPort(),
      requestPath: discover ? '/modlens/config?discover=1' : '/modlens/config',
    })
  }

  async save(input) {
    const patch = validatePatch(input)
    return this.request({
      port: this.getPort(),
      method: 'POST',
      requestPath: '/modlens/config',
      body: patch,
    })
  }

  async status() {
    const installed = Boolean(this.version && fs.existsSync(this.cliPath))
    if (!installed) return summarizeStatus({ installed: false })
    const [configResult, doctorResult] = await Promise.allSettled([
      this.getConfig(true),
      this.runDoctor(this.nodePath, this.cliPath, ['doctor', '--json']),
    ])
    return summarizeStatus({
      installed: true,
      version: this.version,
      config: configResult.status === 'fulfilled' ? configResult.value : null,
      doctor: doctorResult.status === 'fulfilled' ? doctorResult.value : null,
      configError: configResult.status === 'rejected' ? configResult.reason.message || String(configResult.reason) : '',
      doctorError: doctorResult.status === 'rejected' ? doctorResult.reason.message || String(doctorResult.reason) : '',
    })
  }
}

module.exports = {
  API_ENGINES,
  ENGINES,
  ModlensManager,
  REUSE_HARNESSES,
  requestJson,
  runJson,
  summarizeStatus,
  validateEndpoint,
  validatePatch,
}
