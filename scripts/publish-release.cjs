#!/usr/bin/env node
/*
 * publish-release.cjs — 把 release/ 目录下的构建产物发布到 GitHub Releases。
 *
 * 用法:
 *   node scripts/publish-release.cjs [version]
 *
 * 认证: 通过 Git Credential Manager 读取 github.com 的 token（git credential fill），
 *       或环境变量 GH_TOKEN / GITHUB_TOKEN。不会把密钥写入任何文件。
 *
 * 发布内容: release/ 下的 NSIS 安装包、.blockmap 增量更新、SHA256SUMS.txt。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const repo = 'Maskicruis/deepseek-harness-studio'
const API = 'https://api.github.com'
const VERSION = process.argv[2] || require('../package.json').version
const TAG = `v${VERSION}`
const RELEASE_DIR = path.resolve(__dirname, '..', 'release')

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true })
    const line = out.split(/\r?\n/).find((entry) => entry.startsWith('password='))
    if (line) return line.slice('password='.length)
  } catch {
    // 忽略
  }
  throw new Error('未找到 GitHub 凭据。请先登录 git credential manager，或设置 GH_TOKEN 环境变量。')
}

async function api(method, url, { token, body, binary } = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'deepseek-harness-studio-release', Accept: 'application/vnd.github+json' }
  const options = { method, headers }
  if (body !== undefined && binary === undefined) { options.body = JSON.stringify(body); headers['Content-Type'] = 'application/json' }
  if (binary !== undefined) { options.body = binary; headers['Content-Type'] = 'application/octet-stream' }
  const response = await fetch(url, options)
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${method} ${url} -> HTTP ${response.status}: ${data?.message || text.slice(0, 300)}`)
  return data
}

async function main() {
  const token = getToken()
  const user = await api('GET', `${API}/user`, { token })
  console.log(`以 @${user.login} 发布 ${repo} ${TAG}`)

  // 1. 检查同名 release，存在则复用
  let release
  try {
    release = await api('GET', `${API}/repos/${repo}/releases/tags/${TAG}`, { token })
    console.log(`已存在 release ${TAG}，将补传缺失资产`)
  } catch {
    const body = {
      tag_name: TAG,
      name: `DeepSeek Harness Studio v${VERSION}`,
      body: releaseNotes(),
      draft: false,
      prerelease: false,
    }
    release = await api('POST', `${API}/repos/${repo}/releases`, { token, body })
    console.log(`已创建 release ${TAG}`)
  }

  // 2. 上传资产
  const existing = new Map((release.assets || []).map((asset) => [asset.name, asset.id]))
  const candidates = [
    { name: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe`, file: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe` },
    { name: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe.blockmap`, file: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe.blockmap` },
    { name: 'SHA256SUMS.txt', file: 'SHA256SUMS.txt' },
  ]
  for (const candidate of candidates) {
    const filePath = path.join(RELEASE_DIR, candidate.file)
    if (!fs.existsSync(filePath)) {
      console.warn(`跳过缺失资产: ${candidate.file}`)
      continue
    }
    if (existing.has(candidate.name)) {
      console.log(`资产已存在，跳过: ${candidate.name}`)
      continue
    }
    const binary = fs.readFileSync(filePath)
    const uploaded = await api('POST', `${API}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(candidate.name)}`, { token, binary })
    console.log(`已上传 ${candidate.name} (${(binary.length / 1048576).toFixed(1)} MB)`)
  }
  console.log(`✅ 发布完成: https://github.com/${repo}/releases/tag/${TAG}`)
}

function releaseNotes() {
  return `## v${VERSION} 更新内容

### 🖼️ 视觉模块重做（接入阿里千问）
- 新增「阿里千问 Qwen-VL」视觉引擎快捷配置：接入阿里云百炼 DashScope（OpenAI 兼容端点），国内直连、无需代理
- 自动填充 \`https://dashscope.aliyuncs.com/compatible-mode/v1\` 与 \`qwen-vl-max\`，只需粘贴 API Key 即可用
- 保留 OpenAI 兼容、Gemini、Anthropic、Claude CLI 等引擎与自动故障转移

### 💰 新增 Token 余额显示
- 顶栏实时显示 DeepSeek 账户余额（读取 \`~/.dsh/.credentials.yaml\` 中的 DEEPSEEK_API_KEY）
- 点击余额可手动刷新；未配置 API Key 时明确提示

### ⚡ 更新器优化
- 更新下载自动走系统代理（优先环境变量 HTTPS_PROXY，其次 Windows 系统代理），国内更新速度提升 100 倍以上
- 元数据请求超时 15s→30s、安装包下载超时 30s→180s，减少大文件断流
- 保留国内社区镜像回退与 SHA-256 校验

### 其他
- 版本升级至 \`1.5.0\`
`
}

main().catch((error) => {
  console.error('发布失败:', error.message)
  process.exit(1)
})
