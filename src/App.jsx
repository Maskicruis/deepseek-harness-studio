import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore,
  Blocks,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Github,
  Globe2,
  HardDrive,
  Info,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Package,
  PanelRightClose,
  Presentation,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { isElectron, studio } from './api.js'

const EMPTY_RUNTIME = {
  phase: 'starting',
  message: '正在启动 DeepSeek Harness…',
  url: '',
  pid: null,
  version: '0.1.0-rc.7',
  logs: [],
}

const EMPTY_MODLENS_STATUS = {
  installed: false,
  version: '',
  phase: 'idle',
  message: '正在检查 ModLens…',
  config: null,
  providers: [],
  selection: null,
  chains: { local: [], remote: [] },
  error: '',
}

// 视觉引擎：默认只展示阿里千问（国内直连）；其余引擎收进「高级选项」，避免 Claude/codex 等选项造成困惑。
const VISION_PRIMARY_PROVIDERS = [
  { value: 'qwen', label: '阿里千问 Qwen-VL', hint: '阿里云百炼 DashScope，国内直连' },
]
const VISION_ADVANCED_PROVIDERS = [
  { value: '', label: '自动故障转移', hint: '使用所有已就绪引擎' },
  { value: 'openai', label: 'OpenAI 兼容 API', hint: 'Qwen-VL、GLM-V、vLLM、Ollama 等' },
  { value: 'gemini-api', label: 'Gemini API', hint: 'Google AI Studio，多模态直连' },
  { value: 'anthropic', label: 'Anthropic API', hint: 'Claude 多模态接口' },
  { value: 'antigravity-cli', label: 'Antigravity CLI', hint: '本机登录，无需 API Key' },
  { value: 'claude-cli', label: 'Claude CLI', hint: '复用本机 Claude Code 登录' },
]

const ECOSYSTEM_COMPONENTS = [
  {
    name: '@liustack/modlens',
    source: '@liustack/modlens@3.22.0',
    version: '3.22.0',
    title: 'ModLens 视觉引擎',
    category: '视觉',
    icon: Eye,
    description: '让纯文本 DeepSeek / GLM 模型读取粘贴图片、截图和本地图片路径，并返回结构化视觉证据。',
    hint: '安装后在模型选择器中使用 “modlens vision”，首次使用需配置可用视觉引擎。',
    url: 'https://github.com/liustack/modlens',
  },
  {
    name: 'dsh-plugin-doc-reader',
    source: 'dsh-plugin-doc-reader@0.1.2',
    version: '0.1.2',
    title: '文档读取',
    category: '文档',
    icon: FileText,
    description: '让模型读取 PDF、Word（docx）、Excel（xlsx）及纯文本文件（通过文件路径）。',
    hint: '安装后模型可用 read_document 工具，按文件路径读取文档内容（聊天框只收图片，文档请用路径）。',
    url: 'https://www.npmjs.com/package/dsh-plugin-doc-reader',
  },
  {
    name: '@liustack/modsearch',
    source: '@liustack/modsearch@5.6.0',
    version: '5.6.0',
    title: 'ModSearch 联网搜索',
    category: '搜索',
    icon: Globe2,
    description: '为模型增加网页搜索、页面抓取和 X 搜索能力，适合资料研究与实时信息任务。',
    hint: '安装并启用后，智能体可按任务需要调用搜索工具。',
    url: 'https://github.com/liustack/modsearch',
  },
  {
    name: '@liustack/pptfast',
    source: '@liustack/pptfast@0.20.0',
    version: '0.20.0',
    title: 'PPTFast 演示文稿',
    category: '创作',
    icon: Presentation,
    description: '为智能体提供可编辑 PPTX 生成能力，以结构化语义内容生成原生 PowerPoint 页面。',
    hint: '适用于汇报、方案和教学演示文稿生成。',
    url: 'https://github.com/liustack/pptfast',
  },
  {
    name: '@wntediluvian/dsh-backup',
    source: '@wntediluvian/dsh-backup@0.2.3',
    version: '0.2.3',
    title: 'DSH Backup 备份恢复',
    category: '数据',
    icon: ArchiveRestore,
    description: '管理会话、记忆、插件、Skill 和配置的完整及增量备份，并提供恢复入口。',
    hint: '安装后请在 Harness 设置页检查备份位置和保留策略。',
    url: 'https://www.npmjs.com/package/@wntediluvian/dsh-backup',
  },
  {
    name: '@paicat1/dsh-screenshot',
    source: '@paicat1/dsh-screenshot@1.0.0',
    version: '1.0.0',
    title: 'DSH Screenshot 屏幕捕获',
    category: '视觉',
    icon: Camera,
    description: '增加浏览器快捷截图与面向智能体的捕获工具，可配合 ModLens 完成截图读取。',
    hint: '屏幕捕获属于高敏感能力，仅在需要时启用。',
    url: 'https://www.npmjs.com/package/@paicat1/dsh-screenshot',
  },
]

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

function shortName(packageName) {
  return packageName.replace(/^@[^/]+\//, '').replace(/^dsh-/, '')
}

function sourceLabel(kind) {
  if (kind === 'github') return 'GitHub'
  if (kind === 'local') return '本地'
  if (kind === 'core') return '核心'
  return 'npm'
}

function IconButton({ title, children, onClick, danger = false, active = false, disabled = false }) {
  return (
    <button
      type="button"
      className={cx('icon-button', danger && 'danger', active && 'active')}
      aria-label={title}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function StatusPill({ runtime }) {
  const running = runtime.phase === 'running'
  const working = ['starting', 'stopping'].includes(runtime.phase)
  return (
    <div className={cx('status-pill', runtime.phase)} title={runtime.message}>
      <span className="status-dot" />
      <span>{running ? 'Harness 在线' : working ? '正在连接' : runtime.phase === 'error' ? '需要处理' : 'Harness 离线'}</span>
      {runtime.pid ? <span className="pid">PID {runtime.pid}</span> : null}
    </div>
  )
}

function TitleBar({ runtime, updateStatus, panel, setPanel, onReload, isMaximized, balance, onRefreshBalance }) {
  const updateActive = ['available', 'downloading', 'downloaded'].includes(updateStatus.phase)
  const updateLabel = updateStatus.phase === 'downloading'
    ? `更新 ${Math.round(updateStatus.progress || 0)}%`
    : updateActive && updateStatus.latestVersion
      ? `更新 ${updateStatus.latestVersion}`
      : '更新'
  let balanceLabel = balance ? (balance.ok ? balance.balanceInfos?.[0]?.total_balance || '0.00' : balance.configured ? '查询失败' : '未配置 Key') : '…'
  if (balance?.ok && balance.balanceInfos?.[0]?.currency && balanceLabel && balanceLabel !== '查询失败' && balanceLabel !== '未配置 Key' && balanceLabel !== '…') {
    balanceLabel = `¥ ${balanceLabel}`
  }
  return (
    <header className="titlebar">
      <div className="brand drag-region">
        <div className="brand-mark"><img src="./deepseek-mark.svg" alt="" /></div>
        <div className="brand-copy">
          <span>DeepSeek</span>
          <small>HARNESS STUDIO</small>
        </div>
      </div>
      <div className="titlebar-center drag-region"><StatusPill runtime={runtime} /></div>
      <div className="titlebar-actions no-drag">
        <button
          type="button"
          className={cx('toolbar-button', 'balance-button', balance?.ok && 'ok', balance?.configured === false && 'warn')}
          title={balance?.message || (balance?.ok ? `余额 ${balanceLabel}（点击刷新）` : '点击刷新余额')}
          onClick={onRefreshBalance}
        >
          <Wallet size={15} />
          <span>{balanceLabel}</span>
        </button>
        <IconButton title="重新载入界面" onClick={onReload}><RefreshCw size={16} /></IconButton>
        <button
          type="button"
          className={cx('toolbar-button', panel === 'plugins' && 'active')}
          onClick={() => setPanel(panel === 'plugins' ? null : 'plugins')}
        >
          <Blocks size={16} />
          <span>插件</span>
        </button>
        <button
          type="button"
          className={cx('toolbar-button', 'update-toolbar', updateActive && 'update-ready', panel === 'settings' && 'active')}
          title={updateStatus.message}
          onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
        >
          <Download size={16} className={updateStatus.phase === 'checking' ? 'spin' : ''} />
          <span>{updateLabel}</span>
        </button>
        <IconButton title="偏好设置" active={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>
          <Settings size={16} />
        </IconButton>
        <span className="window-divider" />
        <IconButton title="最小化" onClick={() => studio.window.minimize()}><Minimize2 size={16} /></IconButton>
        <IconButton title={isMaximized ? '还原' : '最大化'} onClick={() => studio.window.toggleMaximize()}>
          {isMaximized ? <Square size={13} /> : <Maximize2 size={14} />}
        </IconButton>
        <IconButton title="关闭" danger onClick={() => studio.window.close()}><X size={17} /></IconButton>
      </div>
    </header>
  )
}

function RuntimeSplash({ runtime, onRestart, openSettings }) {
  const error = runtime.phase === 'error'
  return (
    <div className="runtime-splash">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <div className="splash-card">
        <div className={cx('splash-logo', error && 'error')}>
          <img src="./deepseek-mark.svg" alt="DeepSeek" />
          {!error ? <span className="orbit" /> : null}
        </div>
        <div>
          <span className="eyebrow">DEEPSEEK HARNESS</span>
          <h1>{error ? 'Harness 未能启动' : '正在唤醒你的智能体'}</h1>
          <p>{runtime.message}</p>
        </div>
        {error ? (
          <div className="splash-actions">
            <button className="primary-button" type="button" onClick={onRestart}><RotateCcw size={16} />重试</button>
            <button className="secondary-button" type="button" onClick={openSettings}><Settings size={16} />检查设置</button>
          </div>
        ) : (
          <div className="loading-line"><span /></div>
        )}
        <div className="splash-meta">
          <span><ShieldCheck size={14} /> 本地运行</span>
          <span><Blocks size={14} /> 插件化架构</span>
          <span><Code2 size={14} /> 工作区智能体</span>
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      className={cx('toggle', checked && 'checked')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function PluginCard({ plugin, busy, onToggle, onRemove }) {
  return (
    <article className={cx('plugin-card', !plugin.enabled && 'disabled')}>
      <div className={cx('plugin-icon', plugin.builtIn && 'core')}>
        {plugin.builtIn ? <Zap size={18} /> : <Package size={18} />}
      </div>
      <div className="plugin-info">
        <div className="plugin-name-row">
          <strong>{shortName(plugin.name)}</strong>
          <span className={cx('source-chip', plugin.sourceKind)}>{sourceLabel(plugin.sourceKind)}</span>
        </div>
        <code title={plugin.name}>{plugin.name}</code>
        <p title={plugin.source}>{plugin.source}</p>
      </div>
      <div className="plugin-actions">
        <Toggle
          checked={plugin.enabled}
          disabled={busy || plugin.builtIn}
          label={`${plugin.enabled ? '停用' : '启用'} ${plugin.name}`}
          onChange={(enabled) => onToggle(plugin.name, enabled)}
        />
        {!plugin.builtIn ? (
          <IconButton danger title="卸载插件" onClick={() => onRemove(plugin.name)}><Trash2 size={15} /></IconButton>
        ) : null}
      </div>
    </article>
  )
}

function EcosystemCard({ component, installedPlugin, busy, onInstall, onConfigure }) {
  const Icon = component.icon
  const installed = Boolean(installedPlugin)
  return (
    <article className={cx('ecosystem-card', installed && 'installed')}>
      <div className="ecosystem-card-head">
        <div className="ecosystem-icon"><Icon size={19} /></div>
        <div>
          <div className="ecosystem-title"><strong>{component.title}</strong><span>{component.category}</span></div>
          <code>{component.name}@{component.version}</code>
        </div>
        {installed ? <span className="installed-badge"><CircleCheck size={12} />已接入</span> : null}
      </div>
      <p>{component.description}</p>
      <small>{component.hint}</small>
      <div className="ecosystem-actions">
        <button type="button" className="component-docs" onClick={() => studio.runtime.openUrl(component.url)}>
          <ExternalLink size={13} />说明
        </button>
        {installed && component.name === '@liustack/modlens' ? (
          <button type="button" className="component-configure" onClick={onConfigure}>
            <Settings size={14} />配置视觉 API
          </button>
        ) : null}
        <button type="button" className="component-install" disabled={busy} onClick={() => onInstall(component.source)}>
          {busy ? <LoaderCircle className="spin" size={14} /> : installed ? <RefreshCw size={14} /> : <Package size={14} />}
          {installed ? '更新 / 修复' : '一键接入'}
        </button>
      </div>
    </article>
  )
}

function SkillCard({ skill, busy, onRemove }) {
  return (
    <article className="skill-card">
      <div className="skill-icon"><FileText size={18} /></div>
      <div className="skill-info">
        <div><strong>/{skill.name}</strong><span>{skill.kind === 'bundle' ? 'BUNDLE' : 'MARKDOWN'}</span></div>
        <p>{skill.description}</p>
        <code title={skill.path}>{skill.path}</code>
      </div>
      <IconButton danger title="移除 Skill" onClick={() => onRemove(skill.name)} disabled={busy}><Trash2 size={15} /></IconButton>
    </article>
  )
}

function PluginDrawer({ busy, inventory, skillInventory, logs, onClose, onConfigureModlens, onImportSkill, onInstall, onRefresh, onRefreshSkills, onRemove, onRemoveSkill, onToggle, toast }) {
  const [tab, setTab] = useState('installed')
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('npm')

  const plugins = useMemo(() => [...(inventory.core || []), ...(inventory.community || [])], [inventory])
  const filtered = plugins.filter((plugin) => `${plugin.name} ${plugin.source}`.toLowerCase().includes(query.toLowerCase()))
  const installedByName = useMemo(() => new Map((inventory.community || []).map((plugin) => [plugin.name, plugin])), [inventory])

  const chooseLocal = async () => {
    const chosen = await studio.plugins.chooseLocal()
    if (chosen) {
      setKind('local')
      setSource(chosen)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!source.trim()) return
    const ok = await onInstall(source.trim())
    if (ok) {
      setSource('')
      setTab('installed')
    }
  }

  return (
    <aside className="side-panel plugin-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">COMMUNITY EXTENSIONS</span>
          <h2>插件中心</h2>
        </div>
        <IconButton title="关闭插件中心" onClick={onClose}><PanelRightClose size={18} /></IconButton>
      </div>

      <div className="segmented-control multi">
        <button type="button" className={tab === 'installed' ? 'active' : ''} onClick={() => setTab('installed')}>
          已安装 <span>{inventory.count || 0}</span>
        </button>
        <button type="button" className={tab === 'ecosystem' ? 'active' : ''} onClick={() => setTab('ecosystem')}>生态组件</button>
        <button type="button" className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>Skills <span>{skillInventory.count || 0}</span></button>
        <button type="button" className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>自定义</button>
      </div>

      {tab === 'installed' ? (
        <div className="panel-body">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已安装插件" />
            <IconButton title="刷新列表" onClick={onRefresh}><RefreshCw size={14} /></IconButton>
          </div>
          <div className="section-label"><span>运行时组件</span><small>{filtered.length}</small></div>
          <div className="plugin-list">
            {filtered.map((plugin) => (
              <PluginCard key={plugin.name} plugin={plugin} busy={busy} onToggle={onToggle} onRemove={onRemove} />
            ))}
            {!filtered.length ? (
              <div className="empty-state"><Blocks size={26} /><strong>没有匹配的插件</strong><p>换一个关键词，或从社区导入新插件。</p></div>
            ) : null}
          </div>
        </div>
      ) : tab === 'ecosystem' ? (
        <div className="panel-body ecosystem-body">
          <div className="catalog-hero">
            <div><Sparkles size={18} /><span className="eyebrow">CURATED FOR DSH</span></div>
            <h3>为智能体接入更多感官与工具</h3>
            <p>精选组件均通过 DSH web profile 安装。版本固定便于复现，安装后会自动重启 Harness。</p>
          </div>
          <div className="ecosystem-list">
            {ECOSYSTEM_COMPONENTS.map((component) => (
              <EcosystemCard
                key={component.name}
                component={component}
                installedPlugin={installedByName.get(component.name)}
                busy={busy}
                onInstall={onInstall}
                onConfigure={onConfigureModlens}
              />
            ))}
          </div>
          <div className="security-note">
            <ShieldCheck size={18} />
            <div><strong>精选不等于官方背书</strong><p>以上均为第三方社区组件，不会静默预装。接入前请查看说明、权限和服务条款。</p></div>
          </div>
        </div>
      ) : tab === 'skills' ? (
        <div className="panel-body skill-body">
          <div className="skill-hero">
            <div className="skill-hero-icon"><FolderPlus size={20} /></div>
            <div><h3>DSH 本地 Skills</h3><p>导入包含 `SKILL.md` 的技能目录。Harness 会自动发现，并可通过 `/skill-name` 或模型匹配调用。</p></div>
          </div>
          <div className="skill-toolbar">
            <button className="primary-button" type="button" disabled={busy} onClick={onImportSkill}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <FolderPlus size={15} />}导入 Skill
            </button>
            <button className="secondary-button" type="button" onClick={() => studio.skills.openRoot()}><FolderOpen size={15} />打开目录</button>
            <IconButton title="刷新 Skills" onClick={onRefreshSkills}><RefreshCw size={14} /></IconButton>
          </div>
          <div className="section-label"><span>用户技能</span><small>{skillInventory.count || 0}</small></div>
          <div className="skill-list">
            {(skillInventory.skills || []).map((skill) => <SkillCard key={`${skill.name}-${skill.path}`} skill={skill} busy={busy} onRemove={onRemoveSkill} />)}
            {!skillInventory.count ? <div className="empty-state"><FileText size={26} /><strong>还没有本地 Skill</strong><p>选择一个带有 SKILL.md 的目录开始导入。</p></div> : null}
          </div>
          <div className="skill-note"><Zap size={15} /><span>DSH 会热刷新 Skill 目录，通常无需重启运行时。</span></div>
        </div>
      ) : (
        <div className="panel-body import-body">
          <div className="import-hero">
            <div className="stacked-icons"><Package /><Github /><HardDrive /></div>
            <h3>把社区能力接入 Harness</h3>
            <p>支持 npm 包、GitHub 仓库和本地开发目录。安装后会写入 web profile，并自动重启运行时。</p>
          </div>

          <div className="source-types">
            {[
              ['npm', Package, 'npm 包'],
              ['github', Github, 'GitHub'],
              ['local', FolderOpen, '本地目录'],
            ].map(([value, Icon, label]) => (
              <button type="button" key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>
                <Icon size={17} /><span>{label}</span>{kind === value ? <Check size={14} /> : null}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="install-form">
            <label htmlFor="plugin-source">插件来源</label>
            <div className="source-input">
              <input
                id="plugin-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={kind === 'npm' ? '@scope/dsh-plugin' : kind === 'github' ? 'github:owner/repository' : '选择插件文件夹'}
                readOnly={kind === 'local'}
              />
              {kind === 'local' ? <button type="button" onClick={chooseLocal}><Folder size={16} />选择</button> : null}
            </div>
            <button className="primary-button install-button" disabled={busy || !source.trim()} type="submit">
              {busy ? <LoaderCircle className="spin" size={17} /> : <Package size={17} />}
              {busy ? '正在安装并重启…' : '导入并启用插件'}
            </button>
          </form>

          <div className="security-note">
            <ShieldCheck size={18} />
            <div><strong>安装前请确认来源可信</strong><p>社区插件可获得 Harness 提供的工具与工作区权限。GitHub 插件的构建脚本可能需要额外批准。</p></div>
          </div>

          <button className="market-link" type="button" onClick={() => studio.runtime.openUrl('https://github.com/topics/dsh-plugin')}>
            <Globe2 size={17} />浏览 GitHub 社区插件<ExternalLink size={14} />
          </button>

          {logs.length ? (
            <div className="install-log">
              <div><TerminalSquare size={15} /><span>安装日志</span></div>
              <pre>{logs.slice(-12).map((entry) => `[${entry.level}] ${entry.message}`).join('\n')}</pre>
            </div>
          ) : null}
        </div>
      )}
      {toast ? <div className={cx('inline-toast', toast.type)}>{toast.type === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}{toast.message}</div> : null}
    </aside>
  )
}

function SettingRow({ icon: Icon, title, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-icon"><Icon size={17} /></div>
      <div className="setting-copy"><strong>{title}</strong><p>{description}</p></div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function UpdateCard({ status, onCheck, onDownload, onInstall }) {
  const busy = ['checking', 'downloading'].includes(status.phase)
  const available = status.phase === 'available'
  const secureDownload = available && !status.message.includes('缺少 SHA-256')
  const checkedAt = status.checkedAt ? new Date(status.checkedAt).toLocaleString('zh-CN', { hour12: false }) : ''
  return (
    <div className={cx('update-card', status.phase)}>
      <div className="update-card-head">
        <span className="update-card-icon"><Download size={18} /></span>
        <div>
          <strong>{status.phase === 'downloaded' ? '更新已准备好' : available ? '发现可用更新' : '软件更新'}</strong>
          <p>{status.message || '尚未检查更新'}</p>
        </div>
        <span className="version-chip">v{status.currentVersion || '1.07.3'}{status.latestVersion && status.latestVersion !== status.currentVersion ? ` → v${status.latestVersion}` : ''}</span>
      </div>
      {status.phase === 'downloading' ? <div className="update-progress"><span style={{ width: `${status.progress || 0}%` }} /></div> : null}
      {status.notes && available ? <p className="update-notes">{status.notes}</p> : null}
      <div className="update-card-footer">
        <span>{status.repository || '等待配置 GitHub 仓库'}{status.downloadSource ? ` · ${status.downloadSource}` : ''}{checkedAt ? ` · ${checkedAt}` : ''}</span>
        <div>
          {status.releaseUrl ? <button className="text-button" type="button" onClick={() => studio.runtime.openUrl(status.releaseUrl)}><Github size={14} />发布页</button> : null}
          {status.phase === 'downloaded'
            ? <button className="primary-button compact-button" type="button" onClick={onInstall}><Download size={14} />安装并重启</button>
            : secureDownload
              ? <button className="primary-button compact-button" type="button" onClick={onDownload}><Download size={14} />下载更新</button>
              : <button className="secondary-button compact-button" disabled={busy || status.phase === 'unconfigured'} type="button" onClick={onCheck}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{status.phase === 'checking' ? '检查中…' : '检查更新'}</button>}
        </div>
      </div>
    </div>
  )
}

function VisionSettingsCard({ status, busy, onRefresh, onSave }) {
  const summary = status.config
  const [draft, setDraft] = useState({ provider: 'qwen', apiKey: '', baseUrl: '', model: '' })
  const [showAdvanced, setShowAdvanced] = useState(false)

  const isAdvancedProvider = (value) => !VISION_PRIMARY_PROVIDERS.some((provider) => provider.value === value)

  useEffect(() => {
    const configured = summary?.provider || ''
    // 未配置时默认引导到阿里千问；已配置高级引擎时自动展开高级区
    const provider = configured || 'qwen'
    const engine = summary?.engines?.[provider] || {}
    setDraft({ provider, apiKey: '', baseUrl: engine.baseUrl || '', model: engine.model || '' })
    if (configured && isAdvancedProvider(configured)) setShowAdvanced(true)
  }, [summary])

  const chooseProvider = (provider) => {
    const engine = summary?.engines?.[provider] || {}
    const openaiEngine = summary?.engines?.openai || {}
    if (provider === 'qwen') {
      setDraft({ provider, apiKey: '', baseUrl: engine.baseUrl || openaiEngine.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: engine.model || openaiEngine.model || 'qwen-vl-max' })
    } else {
      setDraft({ provider, apiKey: '', baseUrl: engine.baseUrl || '', model: engine.model || '' })
    }
  }
  const engineSummary = summary?.engines?.[draft.provider] || {}
  // 阿里千问底层复用 openai 引擎（DashScope 兼容端点），配置状态从 openai 派生
  const qwenUnderlying = draft.provider === 'qwen' ? summary?.engines?.openai || {} : {}
  const effectiveEngineSummary = draft.provider === 'qwen' ? { ...engineSummary, hasKey: Boolean(engineSummary.hasKey || qwenUnderlying.hasKey), baseUrl: engineSummary.baseUrl || qwenUnderlying.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: engineSummary.model || qwenUnderlying.model || 'qwen-vl-max' } : engineSummary
  const providerHealth = status.providers.find((provider) => provider.name === draft.provider)
  const apiProvider = ['openai', 'gemini-api', 'anthropic', 'qwen'].includes(draft.provider)
  const keyReady = Boolean(draft.apiKey.trim() || effectiveEngineSummary.hasKey)
  const missing = []
  if (draft.provider === 'openai') {
    if (!draft.baseUrl.trim()) missing.push('接口地址')
    if (!keyReady) missing.push('API Key')
    if (!draft.model.trim()) missing.push('模型名称')
  } else if (draft.provider === 'qwen') {
    if (!keyReady) missing.push('API Key')
  } else if (['gemini-api', 'anthropic'].includes(draft.provider) && !keyReady) {
    missing.push('API Key')
  }
  const pristine = summary?.engines?.[draft.provider] || {}
  const dirty = Boolean(
    summary
    && (draft.provider !== (summary.provider || '')
      || draft.apiKey.trim()
      || (apiProvider && draft.baseUrl.trim() !== (pristine.baseUrl || effectiveEngineSummary.baseUrl || ''))
      || (apiProvider && draft.model.trim() !== (pristine.model || effectiveEngineSummary.model || ''))),
  )
  let insecureEndpoint = false
  try {
    const endpoint = new URL(draft.baseUrl)
    insecureEndpoint = endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  } catch {
    insecureEndpoint = false
  }

  const submit = () => {
    const patch = { provider: draft.provider }
    if (apiProvider) {
      Object.assign(patch, {
        engine: draft.provider,
        apiKey: draft.apiKey,
        baseUrl: draft.provider === 'qwen' && !draft.baseUrl.trim() ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : draft.baseUrl,
        model: draft.provider === 'qwen' && !draft.model.trim() ? 'qwen-vl-max' : draft.model,
      })
    }
    onSave(patch)
  }

  return (
    <div className={cx('vision-card', status.phase)}>
      <div className="vision-card-head">
        <span className="vision-card-icon"><Eye size={19} /></span>
        <div>
          <div className="vision-card-title">
            <strong>ModLens 视觉 API</strong>
            {status.version ? <span>v{status.version}</span> : null}
          </div>
          <p>{status.message}</p>
        </div>
        <span className={cx('vision-state', status.phase)}>
          {busy ? '检测中' : status.phase === 'ready' ? '已就绪' : status.phase === 'degraded' ? '有备用引擎' : status.phase === 'missing' ? '未安装' : status.phase === 'error' ? '异常' : '待配置'}
        </span>
      </div>

      {status.installed && summary ? (
        <>
          <label className="vision-field">
            <span>视觉引擎</span>
            <select value={draft.provider} onChange={(event) => chooseProvider(event.target.value)}>
              {VISION_PRIMARY_PROVIDERS.map((provider) => <option key={provider.value} value={provider.value}>{provider.label} · {provider.hint}</option>)}
              {showAdvanced || isAdvancedProvider(draft.provider)
                ? VISION_ADVANCED_PROVIDERS.map((provider) => <option key={provider.value || 'auto'} value={provider.value}>{provider.label} · {provider.hint}</option>)
                : null}
            </select>
          </label>
          <button className="text-button vision-advanced-toggle" type="button" onClick={() => setShowAdvanced((value) => !value)}>
            <ChevronRight size={14} className={showAdvanced ? 'rotate-90' : ''} />{showAdvanced ? '收起高级引擎' : '高级引擎（Gemini / Claude 等）'}
          </button>

          {draft.provider === '' ? (
            <div className="vision-auto-note">
              <Sparkles size={16} />
              <div><strong>自动模式不会自动提供模型</strong><p>它只会在已经配置或登录的引擎之间故障转移。请选择一个 API 引擎填写配置，或先登录受支持的本地 CLI。</p></div>
            </div>
          ) : apiProvider ? (
            <div className="vision-fields">
              <label className="vision-field">
                <span>API Key <small>{engineSummary.hasKey ? '已安全保存，留空不修改' : '尚未设置'}</small></span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder={engineSummary.hasKey ? '••••••••••••••••' : '粘贴服务商提供的密钥'}
                />
              </label>
              <label className="vision-field">
                <span>接口地址 <small>{draft.provider === 'openai' ? '必填，不会替你猜测端点' : draft.provider === 'qwen' ? '已默认阿里云百炼兼容端点' : '可选，留空使用官方默认'}</small></span>
                <input
                  type="url"
                  spellCheck="false"
                  value={draft.baseUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                  placeholder={draft.provider === 'openai' ? 'https://example.com/v1' : draft.provider === 'qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : '留空使用 Provider 默认地址'}
                />
              </label>
              <label className="vision-field">
                <span>视觉模型 <small>{draft.provider === 'openai' ? '必须支持图片输入' : draft.provider === 'qwen' ? '默认 qwen-vl-max' : '可选，留空使用推荐模型'}</small></span>
                <input
                  type="text"
                  spellCheck="false"
                  value={draft.model}
                  onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                  placeholder={draft.provider === 'openai' ? '例如 qwen3-vl-plus' : draft.provider === 'qwen' ? 'qwen-vl-max' : '使用 Provider 默认模型'}
                />
              </label>
              {insecureEndpoint ? <p className="vision-warning"><CircleAlert size={14} />非本机 HTTP 地址会明文传输密钥和图片，建议改用 HTTPS。</p> : null}
            </div>
          ) : (
            <div className={cx('vision-cli-note', providerHealth?.ready && 'ready')}>
              <TerminalSquare size={17} />
              <div>
                <strong>{providerHealth?.ready ? '本机 CLI 已发现' : '本机 CLI 尚未就绪'}</strong>
                <p>{providerHealth?.detail || '该引擎通过本机登录工作，不需要 API Key。'}</p>
              </div>
            </div>
          )}

          <div className="vision-actions">
            <button className="secondary-button compact-button" type="button" disabled={busy} onClick={onRefresh}>
              {busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}检测引擎
            </button>
            <button className="primary-button compact-button" type="button" disabled={busy || !dirty || missing.length > 0} onClick={submit}>
              <ShieldCheck size={14} />保存并重启
            </button>
          </div>
          {missing.length ? <p className="vision-missing">还需填写：{missing.join('、')}</p> : null}
          <div className="vision-usage">
            <strong><Check size={14} />配置完成后怎么用</strong>
            <p>在 Harness 模型选择器中选名称带 <code>(modlens vision)</code> 的文本模型，然后直接粘贴图片并提问；也支持在消息中提供图片绝对路径。</p>
          </div>
          <p className="vision-security"><ShieldCheck size={13} />密钥只写入本机 <code>~/.modlens/config.json</code>，不会进入工作区、Git 仓库或界面回显。</p>
          <p className="vision-hint"><Info size={13} />如果在 Harness 里看到 ModLens 自带的「插件配置」页（auto 模式、勾选 claude/codex 那页），那是插件原生界面，无需在那里操作——API Key 就在本页填写并保存。</p>
        </>
      ) : (
        <div className="vision-empty">
          <Eye size={22} />
          <div><strong>{status.installed ? '设置接口暂不可用' : '先接入 ModLens 插件'}</strong><p>{status.error || '打开“插件 → 生态组件”，安装后再回到这里配置视觉 API。'}</p></div>
          <button className="secondary-button compact-button" type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} />重新检测</button>
        </div>
      )}
    </div>
  )
}

function SettingsDrawer({ appInfo, paths, runtime, settings, setSettings, updateStatus, modlensStatus, modlensBusy, onCheckModlens, onSaveModlens, onCheckUpdate, onDownloadUpdate, onInstallUpdate, onClose, onRestart, onSave, toast }) {
  const chooseWorkspace = async () => {
    const selected = await studio.settings.chooseWorkspace()
    if (selected) setSettings((current) => ({ ...current, workspace: selected }))
  }
  return (
    <aside className="side-panel settings-panel">
      <div className="panel-header">
        <div><span className="eyebrow">PREFERENCES</span><h2>偏好设置</h2></div>
        <IconButton title="关闭设置" onClick={onClose}><PanelRightClose size={18} /></IconButton>
      </div>
      <div className="panel-body settings-body">
        <section>
          <div className="section-label"><span>视觉能力</span></div>
          <VisionSettingsCard status={modlensStatus} busy={modlensBusy} onRefresh={onCheckModlens} onSave={onSaveModlens} />
        </section>

        <section>
          <div className="section-label"><span>运行环境</span></div>
          <SettingRow icon={FolderOpen} title="默认工作区" description="首次启动会自动创建；无需选择目录即可直接开始对话">
            <button className="path-button" type="button" onClick={chooseWorkspace}><span>{settings.workspace || '正在准备默认目录…'}</span><Folder size={15} /></button>
          </SettingRow>
          <SettingRow icon={Globe2} title="本地服务端口" description="仅监听 127.0.0.1，不对局域网开放">
            <input
              className="port-input"
              type="number"
              min="1024"
              max="65535"
              value={settings.port || 3080}
              onChange={(event) => setSettings((current) => ({ ...current, port: Number(event.target.value) }))}
            />
          </SettingRow>
          <SettingRow icon={Zap} title="开机启动" description="登录 Windows 后自动打开 Studio">
            <Toggle checked={Boolean(settings.autoLaunch)} label="开机启动" onChange={(autoLaunch) => setSettings((current) => ({ ...current, autoLaunch }))} />
          </SettingRow>
        </section>

        <section>
          <div className="section-label"><span>软件更新</span></div>
          <SettingRow icon={RefreshCw} title="自动检查更新" description="启动后静默检查；更新会静默覆盖安装并自动重启，无需重新走安装向导">
            <Toggle checked={settings.autoCheckUpdates !== false} label="自动检查更新" onChange={(autoCheckUpdates) => setSettings((current) => ({ ...current, autoCheckUpdates }))} />
          </SettingRow>
          <SettingRow icon={Github} title="GitHub 更新仓库" description="支持 owner/repo 或仓库网址；留空使用内置仓库">
            <input
              className="repo-input"
              type="text"
              spellCheck="false"
              placeholder="owner/repository"
              value={settings.updateRepository || ''}
              onChange={(event) => setSettings((current) => ({ ...current, updateRepository: event.target.value }))}
            />
          </SettingRow>
          <SettingRow icon={Download} title="更新下载线路" description="自动模式优先国内社区镜像，失败后回退 GitHub；安装前始终校验 SHA-256">
            <select
              className="route-select"
              value={settings.updateDownloadMode || 'auto'}
              onChange={(event) => setSettings((current) => ({ ...current, updateDownloadMode: event.target.value }))}
            >
              <option value="auto">自动（国内优先）</option>
              <option value="github">仅 GitHub</option>
              <option value="custom">自定义镜像</option>
            </select>
          </SettingRow>
          {settings.updateDownloadMode === 'custom' ? (
            <SettingRow icon={Globe2} title="自定义镜像前缀" description="兼容 gh-proxy 的完整 URL 转发格式；失败时仍会回退 GitHub">
              <input
                className="repo-input"
                type="url"
                spellCheck="false"
                placeholder="https://mirror.example.com"
                value={settings.updateMirrorUrl || ''}
                onChange={(event) => setSettings((current) => ({ ...current, updateMirrorUrl: event.target.value }))}
              />
            </SettingRow>
          ) : null}
          <UpdateCard status={updateStatus} onCheck={onCheckUpdate} onDownload={onDownloadUpdate} onInstall={onInstallUpdate} />
        </section>

        <section>
          <div className="section-label"><span>Harness</span></div>
          <button className="wide-action" type="button" onClick={onRestart}><RotateCcw size={17} /><span><strong>重启 Harness</strong><small>{runtime.message}</small></span><ChevronRight size={16} /></button>
          <button className="wide-action" type="button" onClick={() => studio.runtime.openPath(paths.dshHome)}><HardDrive size={17} /><span><strong>打开数据目录</strong><small>{paths.dshHome || '~/.dsh'}</small></span><ExternalLink size={14} /></button>
          <button className="wide-action" type="button" onClick={() => studio.plugins.openProfile()}><Blocks size={17} /><span><strong>打开 web profile</strong><small>查看插件清单与 patch 配置</small></span><ExternalLink size={14} /></button>
        </section>

        <section className="about-card">
          <img src="./deepseek-mark.svg" alt="" />
          <div><strong>DeepSeek Harness Studio</strong><p>桌面端 {appInfo.version || '1.0.0'} · Harness {appInfo.harnessVersion || runtime.version}</p></div>
          <span>Developer Preview</span>
        </section>
        <p className="brand-disclaimer">DeepSeek 名称与图标归其权利人所有。本客户端基于开源 Harness 构建。</p>
      </div>
      <div className="settings-footer">
        {toast ? <span className={toast.type}>{toast.message}</span> : <span>更改工作区或端口会重启 Harness</span>}
        <button className="primary-button" type="button" onClick={onSave}>保存设置</button>
      </div>
    </aside>
  )
}

export default function App() {
  const [runtime, setRuntime] = useState(EMPTY_RUNTIME)
  const [panel, setPanel] = useState(null)
  const [inventory, setInventory] = useState({ core: [], community: [], count: 0, profileDir: '' })
  const [skillInventory, setSkillInventory] = useState({ root: '', skills: [], count: 0 })
  const [settings, setSettings] = useState({ port: 3080, workspace: '', autoLaunch: false, autoCheckUpdates: true, updateRepository: '', updateDownloadMode: 'auto', updateMirrorUrl: '' })
  const [paths, setPaths] = useState({ node: '', cli: '', dshHome: '' })
  const [appInfo, setAppInfo] = useState({ version: '1.07.3', harnessVersion: '0.1.0-rc.7' })
  const [updateStatus, setUpdateStatus] = useState({ phase: 'idle', message: '尚未检查更新', currentVersion: '1.07.3', latestVersion: '', repository: '', releaseUrl: '', notes: '', progress: 0, checkedAt: '', downloadSource: '', downloadAttempts: [] })
  const [modlensStatus, setModlensStatus] = useState(EMPTY_MODLENS_STATUS)
  const [modlensBusy, setModlensBusy] = useState(false)
  const [balance, setBalance] = useState(null)
  const [balanceBusy, setBalanceBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [skillBusy, setSkillBusy] = useState(false)
  const [pluginLogs, setPluginLogs] = useState([])
  const [toast, setToast] = useState(null)
  const [webReady, setWebReady] = useState(false)
  const [webKey, setWebKey] = useState(0)
  const [isMaximized, setIsMaximized] = useState(false)
  const webviewRef = useRef(null)
  const toastTimer = useRef(null)

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const refreshPlugins = useCallback(async () => {
    try { setInventory(await studio.plugins.list()) }
    catch (error) { notify(error.message || String(error), 'error') }
  }, [notify])

  const refreshSkills = useCallback(async () => {
    try { setSkillInventory(await studio.skills.list()) }
    catch (error) { notify(error.message || String(error), 'error') }
  }, [notify])

  const refreshModlens = useCallback(async () => {
    setModlensBusy(true)
    try { setModlensStatus(await studio.modlens.status()) }
    catch (error) { notify(error.message || String(error), 'error') }
    finally { setModlensBusy(false) }
  }, [notify])

  const refreshBalance = useCallback(async () => {
    if (!isElectron) return
    setBalanceBusy(true)
    try { setBalance(await studio.balance.get()) }
    catch (error) { setBalance({ ok: false, configured: true, message: error.message || String(error) }) }
    finally { setBalanceBusy(false) }
  }, [])

  useEffect(() => {
    if (isElectron) refreshBalance()
  }, [refreshBalance])

  useEffect(() => {
    Promise.all([studio.runtime.status(), studio.settings.get(), studio.runtime.paths(), studio.app.info(), studio.window.isMaximized(), studio.updates.status()])
      .then(([status, savedSettings, runtimePaths, info, maximized, savedUpdateStatus]) => {
        setRuntime(status)
        setSettings(savedSettings)
        setPaths(runtimePaths)
        setAppInfo(info)
        setIsMaximized(maximized)
        setUpdateStatus(savedUpdateStatus)
      })
      .catch((error) => notify(error.message || String(error), 'error'))
    refreshPlugins()
    refreshSkills()
    const disposeStatus = studio.runtime.onStatus((status) => {
      setRuntime(status)
      if (status.phase !== 'running') setWebReady(false)
    })
    const disposeRuntimeLog = studio.runtime.onLog((entry) => {
      setRuntime((current) => ({ ...current, logs: [...(current.logs || []), entry].slice(-100) }))
    })
    const disposePluginLog = studio.plugins.onLog((entry) => setPluginLogs((current) => [...current, entry].slice(-80)))
    const disposeBusy = studio.plugins.onBusy(setBusy)
    const disposeMaximized = studio.window.onMaximized(setIsMaximized)
    const disposePathDetected = studio.workspace.onDetected((result) => {
      notify(result.registered ? `已识别任务路径：${result.path}` : `已识别路径：${result.path}（${result.reason}）`, result.registered ? 'success' : 'info')
    })
    const disposeUpdate = studio.updates.onStatus(setUpdateStatus)
    return () => {
      clearTimeout(toastTimer.current)
      disposeStatus?.(); disposeRuntimeLog?.(); disposePluginLog?.(); disposeBusy?.(); disposeMaximized?.(); disposePathDetected?.(); disposeUpdate?.()
    }
  }, [notify, refreshPlugins, refreshSkills])

  useEffect(() => {
    if (panel === 'settings') refreshModlens()
  }, [panel, refreshModlens])

  useEffect(() => {
    if (!isElectron || !webviewRef.current || runtime.phase !== 'running') return undefined
    const view = webviewRef.current
    const handleReady = () => setWebReady(true)
    const handleFailure = () => setWebReady(false)
    view.addEventListener('did-stop-loading', handleReady)
    view.addEventListener('did-fail-load', handleFailure)
    return () => {
      view.removeEventListener('did-stop-loading', handleReady)
      view.removeEventListener('did-fail-load', handleFailure)
    }
  }, [runtime.phase, runtime.url, webKey])

  const restart = async () => {
    try {
      setWebReady(false)
      await studio.runtime.restart()
      setWebKey((value) => value + 1)
    } catch (error) { notify(error.message || String(error), 'error') }
  }

  const installPlugin = async (source) => {
    setPluginLogs([])
    try {
      const result = await studio.plugins.install(source)
      setInventory(result.inventory)
      const names = result.installed?.length ? result.installed.join('、') : source
      notify(`插件已导入：${names}`)
      return true
    } catch (error) {
      notify(error.message || String(error), 'error')
      return false
    }
  }

  const removePlugin = async (name) => {
    if (!window.confirm(`确定卸载插件 ${name}？\n插件的独立配置文件不会被主动删除。`)) return
    try {
      const result = await studio.plugins.remove(name)
      setInventory(result.inventory)
      notify(`已卸载 ${shortName(name)}`)
    } catch (error) { notify(error.message || String(error), 'error') }
  }

  const togglePlugin = async (name, enabled) => {
    try {
      setInventory(await studio.plugins.toggle(name, enabled))
      notify(`${enabled ? '已启用' : '已停用'} ${shortName(name)}`)
    } catch (error) { notify(error.message || String(error), 'error') }
  }

  const importSkill = async () => {
    try {
      const source = await studio.skills.chooseLocal()
      if (!source) return
      setSkillBusy(true)
      const result = await studio.skills.install(source)
      setSkillInventory(result.inventory)
      notify(`Skill 已导入：/${result.skill.name}`)
    } catch (error) {
      notify(error.message || String(error), 'error')
    } finally {
      setSkillBusy(false)
    }
  }

  const removeSkill = async (name) => {
    if (!window.confirm(`确定移除 Skill /${name}？\n其目录和目录内资源会被删除。`)) return
    setSkillBusy(true)
    try {
      setSkillInventory(await studio.skills.remove(name))
      notify(`已移除 Skill /${name}`)
    } catch (error) {
      notify(error.message || String(error), 'error')
    } finally {
      setSkillBusy(false)
    }
  }

  const saveSettings = async () => {
    if (settings.updateDownloadMode === 'custom') {
      try {
        const mirror = new URL(settings.updateMirrorUrl)
        if (mirror.protocol !== 'https:' || mirror.username || mirror.password || mirror.search || mirror.hash) throw new Error('invalid')
      } catch {
        notify('自定义更新镜像必须是无账号、无查询参数的 HTTPS 地址', 'error')
        return
      }
    }
    try {
      const result = await studio.settings.set(settings)
      setSettings(result.settings)
      setRuntime(result.runtime)
      setWebKey((value) => value + 1)
      notify('设置已保存')
    } catch (error) { notify(error.message || String(error), 'error') }
  }

  const saveModlens = async (patch) => {
    setModlensBusy(true)
    try {
      setWebReady(false)
      const next = await studio.modlens.save(patch)
      setModlensStatus(next)
      setRuntime(await studio.runtime.status())
      setWebKey((value) => value + 1)
      notify('视觉 API 已保存，Harness 已重启')
    } catch (error) {
      notify(error.message || String(error), 'error')
    } finally {
      setModlensBusy(false)
    }
  }

  const checkUpdate = async () => {
    try { setUpdateStatus(await studio.updates.check()) }
    catch (error) { notify(error.message || String(error), 'error') }
  }

  const downloadUpdate = async () => {
    try { setUpdateStatus(await studio.updates.download()) }
    catch (error) { notify(error.message || String(error), 'error') }
  }

  const installUpdate = async () => {
    if (!window.confirm('将关闭 DeepSeek Harness Studio 并打开新版安装程序。\n请在安装向导中点击「下一步」完成覆盖安装（可自定义安装目录）。\n你的工作区、会话、插件和设置都会保留。是否继续？')) return
    try { await studio.updates.install() }
    catch (error) { notify(error.message || String(error), 'error') }
  }

  const reloadWeb = () => {
    setWebReady(false)
    if (isElectron && webviewRef.current?.reload) webviewRef.current.reload()
    else setWebKey((value) => value + 1)
  }

  const showRuntime = runtime.phase === 'running' && runtime.url

  return (
    <div className="app-shell">
      <TitleBar runtime={runtime} updateStatus={updateStatus} panel={panel} setPanel={setPanel} onReload={reloadWeb} isMaximized={isMaximized} balance={balance} onRefreshBalance={refreshBalance} />
      <main className="workspace-surface">
        {showRuntime ? (
          <div className={cx('harness-frame', webReady && 'ready')}>
            {isElectron ? (
              <webview
                key={`${runtime.url}-${webKey}`}
                ref={webviewRef}
                src={runtime.url}
                partition="persist:deepseek-harness"
                webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
              />
            ) : (
              <iframe key={`${runtime.url}-${webKey}`} src={runtime.url} title="DeepSeek Harness" onLoad={() => setWebReady(true)} />
            )}
            {!webReady ? <RuntimeSplash runtime={{ ...runtime, phase: 'starting', message: '正在载入 Harness 界面…' }} /> : null}
          </div>
        ) : <RuntimeSplash runtime={runtime} onRestart={restart} openSettings={() => setPanel('settings')} />}

        {panel ? <button className="panel-backdrop" type="button" aria-label="关闭侧边栏" onClick={() => setPanel(null)} /> : null}
        {panel === 'plugins' ? (
          <PluginDrawer
            busy={busy || skillBusy}
            inventory={inventory}
            skillInventory={skillInventory}
            logs={pluginLogs}
            onClose={() => setPanel(null)}
            onConfigureModlens={() => setPanel('settings')}
            onImportSkill={importSkill}
            onInstall={installPlugin}
            onRefresh={refreshPlugins}
            onRefreshSkills={refreshSkills}
            onRemove={removePlugin}
            onRemoveSkill={removeSkill}
            onToggle={togglePlugin}
            toast={toast}
          />
        ) : null}
        {panel === 'settings' ? (
          <SettingsDrawer
            appInfo={appInfo}
            paths={paths}
            runtime={runtime}
            settings={settings}
            setSettings={setSettings}
            updateStatus={updateStatus}
            modlensStatus={modlensStatus}
            modlensBusy={modlensBusy}
            onCheckModlens={refreshModlens}
            onSaveModlens={saveModlens}
            onCheckUpdate={checkUpdate}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
            onClose={() => setPanel(null)}
            onRestart={restart}
            onSave={saveSettings}
            toast={toast}
          />
        ) : null}
      </main>
      {!panel && toast ? <div className={cx('global-toast', toast.type)}>{toast.type === 'error' ? <CircleAlert size={17} /> : <CircleCheck size={17} />}{toast.message}</div> : null}
    </div>
  )
}
