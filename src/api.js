const mockInventory = {
  profileDir: '~/.dsh/profiles/web',
  core: [
    { name: '@deepseek-ai/dsh-base', source: '随 Harness 提供', enabled: true, builtIn: true, sourceKind: 'core' },
    { name: '@deepseek-ai/dsh-web-app', source: '随 Harness 提供', enabled: true, builtIn: true, sourceKind: 'core' },
  ],
  community: [],
  count: 0,
}

const mockSkills = {
  root: '~/.dsh/skills',
  skills: [
    { name: 'code-review', description: 'Review a code change and report actionable findings.', path: '~/.dsh/skills/code-review', kind: 'bundle' },
  ],
  count: 1,
}

function createBrowserMock() {
  const runtime = {
    phase: 'running',
    message: 'Harness 已就绪',
    url: 'http://127.0.0.1:3080',
    pid: 12480,
    version: '0.1.0-rc.7',
    logs: [],
  }
  let settings = {
    port: 3080,
    workspace: 'C:\\Users\\Demo\\Documents\\DeepSeek Harness\\Workspace',
    autoLaunch: false,
    closeToTray: false,
    autoCheckUpdates: true,
    updateRepository: 'deepseek-harness-studio/deepseek-harness-studio',
    updateDownloadMode: 'auto',
    updateMirrorUrl: '',
  }
  let updateStatus = {
    phase: 'available',
    message: '发现新版本 1.6.0',
    currentVersion: '1.6.0',
    latestVersion: '1.6.0',
    repository: settings.updateRepository,
    releaseUrl: 'https://github.com/',
    notes: '性能优化、插件体验改进与错误修复。',
    progress: 0,
    downloadedPath: '',
    downloadSource: '',
    downloadAttempts: [],
    checkedAt: new Date().toISOString(),
  }
  let modlensStatus = {
    installed: true,
    version: '3.22.0',
    phase: 'unconfigured',
    message: '尚未配置可用视觉引擎。建议接入阿里千问或 OpenAI 兼容视觉接口。',
    config: {
      provider: '',
      engines: {
        'antigravity-cli': { baseUrl: '', model: '', hasKey: false, source: '' },
        'gemini-api': { baseUrl: '', model: '', hasKey: false, source: '' },
        openai: { baseUrl: '', model: '', hasKey: false, source: '' },
        anthropic: { baseUrl: '', model: '', hasKey: false, source: '' },
        'claude-cli': { baseUrl: '', model: '', hasKey: false, source: '' },
        qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max', hasKey: false, source: '' },
      },
      keyless: ['antigravity-cli', 'claude-cli'],
      reuse: { claude: true, codex: false, opencode: false, pi: false, grok: false },
    },
    providers: [
      { name: 'antigravity-cli', kind: 'subprocess', ready: false, status: 'missing', detail: 'agy not on PATH', missing: [] },
      { name: 'gemini-api', kind: 'api', ready: false, status: 'missing', detail: 'missing: apiKey', missing: ['apiKey'] },
      { name: 'openai', kind: 'api', ready: false, status: 'missing', detail: 'missing: baseUrl, apiKey, model', missing: ['baseUrl', 'apiKey', 'model'] },
      { name: 'anthropic', kind: 'api', ready: false, status: 'missing', detail: 'missing: apiKey', missing: ['apiKey'] },
      { name: 'claude-cli', kind: 'subprocess', ready: true, status: 'installed', detail: 'Claude CLI 已安装（登录状态需实际调用确认）', missing: [] },
      { name: 'qwen', kind: 'api', ready: false, status: 'missing', detail: 'missing: apiKey（阿里云百炼 DashScope）', missing: ['apiKey'] },
    ],
    selection: { provider: 'antigravity-cli', canonical: 'antigravity-cli', source: 'default' },
    chains: { local: ['claude-cli'], remote: [] },
    error: '',
  }
  return {
    isMock: true,
    app: { info: async () => ({ version: '1.6.0', platform: 'win32', harnessVersion: '0.1.0-rc.7' }) },
    window: {
      minimize() {}, toggleMaximize() {}, close() {},
      isMaximized: async () => false,
      onMaximized: () => () => {},
    },
    runtime: {
      status: async () => runtime,
      start: async () => runtime,
      restart: async () => runtime,
      paths: async () => ({ node: 'node.exe', cli: '@deepseek-ai/dsh/lib/bin.js', dshHome: '~/.dsh' }),
      openUrl: async (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      openPath: async () => {},
      onStatus: () => () => {},
      onLog: () => () => {},
    },
    settings: {
      get: async () => settings,
      set: async (patch) => ({ settings: (settings = { ...settings, ...patch }), runtime }),
      chooseWorkspace: async () => settings.workspace,
    },
    updates: {
      status: async () => updateStatus,
      check: async () => updateStatus,
      download: async () => (updateStatus = { ...updateStatus, phase: 'downloaded', message: '版本 1.6.0 已通过国内社区镜像下载并通过 SHA-256 校验', progress: 100, downloadedPath: 'update.exe', downloadSource: '国内社区镜像' }),
      install: async () => ({ launched: true }),
      onStatus: () => () => {},
    },
    workspace: {
      onDetected: () => () => {},
    },
    plugins: {
      list: async () => mockInventory,
      chooseLocal: async () => 'E:\\DeepSeek\\plugins\\example-plugin',
      install: async () => ({ installed: ['example-plugin'], inventory: mockInventory }),
      remove: async () => ({ inventory: mockInventory }),
      toggle: async () => mockInventory,
      openProfile: async () => {},
      onBusy: () => () => {},
      onLog: () => () => {},
    },
    modlens: {
      status: async () => modlensStatus,
      save: async (patch) => {
        const provider = patch.provider || ''
        const engines = { ...modlensStatus.config.engines }
        if (patch.engine) engines[patch.engine] = {
          ...engines[patch.engine],
          baseUrl: patch.baseUrl || '',
          model: patch.model || '',
          hasKey: Boolean(patch.apiKey || engines[patch.engine]?.hasKey),
          source: 'file',
        }
        if (patch.engine === 'qwen' && patch.apiKey) {
          engines.openai = {
            ...engines.openai,
            baseUrl: patch.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: patch.model || 'qwen-vl-max',
            hasKey: true,
            source: 'file',
          }
        }
        modlensStatus = {
          ...modlensStatus,
          phase: provider ? 'ready' : 'degraded',
          message: provider ? `${provider} 已就绪，可以读取图片。` : '已启用自动故障转移。',
          config: { ...modlensStatus.config, provider, engines },
        }
        return modlensStatus
      },
    },
    balance: {
      get: async () => ({
        ok: true,
        configured: true,
        isAvailable: true,
        balanceInfos: [{ currency: 'CNY', total_balance: '88.88', granted_balance: '8.00', topped_up_balance: '80.88' }],
      }),
    },
    skills: {
      list: async () => mockSkills,
      chooseLocal: async () => 'E:\\DeepSeek\\skills\\example-skill',
      install: async () => ({ skill: mockSkills.skills[0], inventory: mockSkills }),
      remove: async () => mockSkills,
      openRoot: async () => {},
    },
  }
}

export const studio = window.harnessStudio || createBrowserMock()
export const isElectron = Boolean(window.harnessStudio)
