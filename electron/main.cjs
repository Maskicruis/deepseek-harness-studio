const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')
const { RuntimeManager } = require('./lib/runtime-manager.cjs')
const { PluginManager } = require('./lib/plugin-manager.cjs')
const { ModlensManager } = require('./lib/modlens-manager.cjs')
const { SkillManager } = require('./lib/skill-manager.cjs')
const { UpdateManager } = require('./lib/update-manager.cjs')
const { extractAbsolutePaths, promptTextFromUpload, resolveExistingWorkspace } = require('./lib/path-detector.cjs')
const { SettingsStore } = require('./lib/settings-store.cjs')

let mainWindow = null
let runtime = null
let plugins = null
let modlens = null
let skills = null
let updates = null
let settings = null
let pluginBusy = false
let defaultWorkspace = ''
let defaultUpdateRepository = ''

function readDefaultUpdateRepository() {
  try {
    const configPath = path.join(__dirname, '..', 'build', 'update-config.json')
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return typeof parsed.repository === 'string' ? parsed.repository.trim() : ''
  } catch {
    return ''
  }
}

function getUpdateRepository() {
  return settings?.get().updateRepository?.trim() || defaultUpdateRepository
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, '..', 'build', 'app.ico'),
    title: 'DeepSeek Harness Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: true,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => emit('window:maximized', true))
  mainWindow.on('unmaximize', () => emit('window:maximized', false))
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

function registerWindowIpc() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()))
}

function registerPromptPathDetection() {
  const harnessSession = session.fromPartition('persist:deepseek-harness')
  harnessSession.webRequest.onBeforeRequest({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    callback({})
    if (details.method !== 'POST' || !details.url.includes('/api/session.prompt')) return
    const mentions = extractAbsolutePaths(promptTextFromUpload(details.uploadData))
    for (const mention of mentions) {
      const workspace = resolveExistingWorkspace(mention)
      if (!workspace) {
        emit('workspace:path-detected', { path: mention, registered: false, reason: '目录尚不存在，将由智能体按消息要求处理' })
        continue
      }
      runtime.registerWorkspace(workspace).then((registered) => {
        emit('workspace:path-detected', { path: registered.path, registered: true })
      }).catch((error) => {
        emit('workspace:path-detected', { path: workspace, registered: false, reason: error.message || String(error) })
      })
    }
  })
}

function registerRuntimeIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    harnessVersion: '0.1.0-rc.7',
  }))
  ipcMain.handle('runtime:status', () => runtime.getStatus())
  ipcMain.handle('runtime:start', () => runtime.start())
  ipcMain.handle('runtime:restart', () => runtime.restart())
  ipcMain.handle('runtime:paths', () => ({
    ...runtime.getPaths(),
    dshHome: path.join(os.homedir(), '.dsh'),
  }))
  ipcMain.handle('runtime:open-url', (_event, url) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('只允许打开 HTTP(S) 链接。')
    return shell.openExternal(url)
  })
  ipcMain.handle('runtime:open-path', (_event, targetPath) => {
    const resolved = path.resolve(String(targetPath || ''))
    if (!fs.existsSync(resolved)) throw new Error('路径不存在。')
    return shell.openPath(resolved)
  })
}

function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Harness 工作区',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? '' : result.filePaths[0]
  })
  ipcMain.handle('settings:set', async (_event, patch) => {
    const previous = settings.get()
    const requested = typeof patch?.workspace === 'string' ? patch.workspace.trim() : previous.workspace
    const normalizedPatch = { ...(patch || {}), workspace: requested || defaultWorkspace }
    const next = settings.set(normalizedPatch)
    fs.mkdirSync(next.workspace, { recursive: true })
    app.setLoginItemSettings({
      openAtLogin: next.autoLaunch,
      openAsHidden: false,
    })
    const runtimeChanged = previous.port !== next.port || previous.workspace !== next.workspace
    if (runtimeChanged) await runtime.restart()
    const updateSettingsChanged = previous.autoCheckUpdates !== next.autoCheckUpdates
      || previous.updateRepository !== next.updateRepository
      || previous.updateDownloadMode !== next.updateDownloadMode
      || previous.updateMirrorUrl !== next.updateMirrorUrl
    if (updateSettingsChanged && next.autoCheckUpdates && getUpdateRepository()) {
      setTimeout(() => updates?.check(), 250)
    }
    return { settings: next, runtime: runtime.getStatus() }
  })
}

function registerUpdateIpc() {
  ipcMain.handle('updates:status', () => updates.getStatus())
  ipcMain.handle('updates:check', () => updates.check())
  ipcMain.handle('updates:download', () => updates.download())
  ipcMain.handle('updates:install', () => {
    const result = updates.install()
    // 安装程序（向导）由用户手动完成；稍后退出以释放文件锁
    setTimeout(() => app.quit(), 500)
    return result
  })
}

async function withRuntimeRestart(operation) {
  if (pluginBusy) throw new Error('已有插件操作正在进行，请稍候。')
  pluginBusy = true
  emit('plugins:busy', true)
  await runtime.stop()
  try {
    return await operation()
  } finally {
    try {
      await runtime.start()
    } finally {
      pluginBusy = false
      emit('plugins:busy', false)
    }
  }
}

function registerPluginIpc() {
  ipcMain.handle('plugins:list', () => plugins.list())
  ipcMain.handle('plugins:choose-local', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地 Harness 插件目录',
      properties: ['openDirectory'],
    })
    return result.canceled ? '' : result.filePaths[0]
  })
  ipcMain.handle('plugins:install', (_event, source) => withRuntimeRestart(() => plugins.install(source)))
  ipcMain.handle('plugins:remove', (_event, name) => withRuntimeRestart(() => plugins.remove(name)))
  ipcMain.handle('plugins:toggle', (_event, { name, enabled }) => withRuntimeRestart(async () => plugins.toggle(name, enabled)))
  ipcMain.handle('plugins:open-profile', () => {
    fs.mkdirSync(plugins.profileDir, { recursive: true })
    return shell.openPath(plugins.profileDir)
  })
}

function registerModlensIpc() {
  ipcMain.handle('modlens:status', () => modlens.status())
  ipcMain.handle('modlens:save', async (_event, patch) => {
    await modlens.save(patch)
    await runtime.restart()
    return modlens.status()
  })
}

// 查询 DeepSeek 账户余额（读 ~/.dsh/.credentials.yaml 中的 DEEPSEEK_API_KEY）
async function fetchBalance() {
  const credentialsPath = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  let apiKey = ''
  try {
    if (fs.existsSync(credentialsPath)) {
      const parsed = YAML.parse(fs.readFileSync(credentialsPath, 'utf8'))
      apiKey = String(parsed?.DEEPSEEK_API_KEY || parsed?.deepseek_api_key || '').trim()
    }
  } catch {
    apiKey = ''
  }
  if (!apiKey) {
    return { ok: false, configured: false, message: '未配置 DeepSeek API Key（~/.dsh/.credentials.yaml）' }
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const response = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    const data = await response.json()
    if (!response.ok) {
      return { ok: false, configured: true, message: data?.error?.message || `HTTP ${response.status}` }
    }
    return {
      ok: true,
      configured: true,
      isAvailable: data.is_available === true,
      balanceInfos: Array.isArray(data.balance_infos) ? data.balance_infos : [],
    }
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error?.name === 'AbortError' ? '查询超时' : error?.message || String(error),
    }
  }
}

function registerBalanceIpc() {
  ipcMain.handle('balance:get', fetchBalance)
}

function registerSkillIpc() {
  ipcMain.handle('skills:list', () => skills.list())
  ipcMain.handle('skills:choose-local', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择包含 SKILL.md 的 DSH Skill 目录',
      properties: ['openDirectory'],
    })
    return result.canceled ? '' : result.filePaths[0]
  })
  ipcMain.handle('skills:install', (_event, source) => skills.install(source))
  ipcMain.handle('skills:remove', (_event, name) => skills.remove(name))
  ipcMain.handle('skills:open-root', () => {
    fs.mkdirSync(skills.skillRoot, { recursive: true })
    return shell.openPath(skills.skillRoot)
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('ai.deepseek.harness.studio')
  nativeTheme.themeSource = 'dark'
  Menu.setApplicationMenu(null)

  settings = new SettingsStore(path.join(app.getPath('userData'), 'studio-settings.json'))
  defaultUpdateRepository = readDefaultUpdateRepository()
  defaultWorkspace = path.join(app.getPath('documents'), 'DeepSeek Harness', 'Workspace')
  if (!settings.get().workspace.trim()) settings.set({ workspace: defaultWorkspace })
  fs.mkdirSync(settings.get().workspace, { recursive: true })
  runtime = new RuntimeManager(settings)
  const runtimePaths = runtime.getPaths()
  plugins = new PluginManager({
    cliPath: runtimePaths.cli,
    nodePath: runtimePaths.node,
    onLog: (entry) => emit('plugins:log', { ...entry, time: new Date().toISOString() }),
  })
  modlens = new ModlensManager({
    nodePath: runtimePaths.node,
    dshHome: path.join(os.homedir(), '.dsh'),
    getPort: () => settings.get().port,
  })
  skills = new SkillManager({ dshHome: path.join(os.homedir(), '.dsh') })
  updates = new UpdateManager({
    currentVersion: app.getVersion(),
    getRepository: getUpdateRepository,
    getDownloadOptions: () => ({
      mode: settings.get().updateDownloadMode,
      customMirror: settings.get().updateMirrorUrl,
    }),
    updateDir: path.join(app.getPath('userData'), 'updates'),
  })
  runtime.on('status', (status) => emit('runtime:status-changed', status))
  runtime.on('log', (entry) => emit('runtime:log', entry))
  updates.on('status', (status) => emit('updates:status-changed', status))

  registerWindowIpc()
  registerPromptPathDetection()
  registerRuntimeIpc()
  registerSettingsIpc()
  registerUpdateIpc()
  registerPluginIpc()
  registerModlensIpc()
  registerBalanceIpc()
  registerSkillIpc()
  createMainWindow()

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  await runtime.start()
  if (settings.get().autoCheckUpdates && getUpdateRepository()) {
    setTimeout(() => updates.check(), 8000)
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

app.on('window-all-closed', () => {
  runtime?.stop().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})

app.on('before-quit', () => {
  if (runtime?.child) runtime.child.kill()
})
