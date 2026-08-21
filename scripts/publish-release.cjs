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
 * 版本规整: 源码版本号使用规整格式（如 1.06.0，小版本中位补零）。electron-builder
 *           会把产物文件名规范化（1.06.0 → 1.6.0），本脚本会把产物改名为规整格式
 *           （1.06.0）并重新生成 SHA256SUMS.txt，保证标签、下载链接与 App 内显示一致。
 *
 * 发布内容: release/ 下的 NSIS 安装包、便携版、.blockmap 增量更新、SHA256SUMS.txt。
 */
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const repo = 'Maskicruis/deepseek-harness-studio'
const API = 'https://api.github.com'
const UPLOADS_API = 'https://uploads.github.com'
const VERSION = process.argv[2] || require('../package.json').version
const METADATA_ONLY = process.argv.includes('--metadata-only')
const TAG = `v${VERSION}`
const DISPLAY_VERSION = String(VERSION).replace(/\.0$/, '') // 1.06.0 → 1.06
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

// electron-builder 规范化后的原始版本（1.06.0 → 1.6.0），用于定位构建产物
function rawVersion(padded) {
  const [major, minor, patch] = String(padded).split('.')
  return `${major}.${Number(minor)}.${patch}`
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

// 把 release/ 下 electron-builder 规范化命名的产物改名为规整版本名，并重新生成 SHA256SUMS.txt
function renameArtifacts() {
  const raw = rawVersion(VERSION)
  const moved = []
  if (raw !== VERSION) {
    for (const file of fs.readdirSync(RELEASE_DIR)) {
      const paddedName = file.split(raw).join(VERSION)
      if (paddedName !== file && !file.startsWith('win-unpacked')) {
        fs.renameSync(path.join(RELEASE_DIR, file), path.join(RELEASE_DIR, paddedName))
        moved.push(`${file} -> ${paddedName}`)
      }
    }
  }
  const lines = [
    `DeepSeek-Harness-Studio-Portable-${VERSION}-x64.exe`,
    `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe`,
  ].filter((name) => fs.existsSync(path.join(RELEASE_DIR, name)))
    .map((name) => `${sha256(path.join(RELEASE_DIR, name))} *${name}`)
  fs.writeFileSync(path.join(RELEASE_DIR, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'ascii')
  return moved
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

  const moved = renameArtifacts()
  for (const entry of moved) console.log(`已规整产物名: ${entry}`)

  const metadata = {
    name: `DeepSeek Harness Studio v${DISPLAY_VERSION}`,
    body: releaseNotes(),
    draft: false,
    prerelease: false,
  }

  // 1. 检查同名 release；重复执行时同步刷新标题和正文
  let release
  try {
    release = await api('GET', `${API}/repos/${repo}/releases/tags/${TAG}`, { token })
    release = await api('PATCH', `${API}/repos/${repo}/releases/${release.id}`, { token, body: metadata })
    console.log(`已更新 release ${TAG} 的标题和正文`)
  } catch {
    const body = {
      tag_name: TAG,
      ...metadata,
    }
    release = await api('POST', `${API}/repos/${repo}/releases`, { token, body })
    console.log(`已创建 release ${TAG}`)
  }

  if (METADATA_ONLY) {
    console.log(`✅ 发布页文案已更新: https://github.com/${repo}/releases/tag/${TAG}`)
    return
  }

  // 2. 上传资产
  const existing = new Map((release.assets || []).map((asset) => [asset.name, asset.id]))
  const candidates = [
    { name: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe`, file: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe` },
    { name: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe.blockmap`, file: `DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe.blockmap` },
    { name: `DeepSeek-Harness-Studio-Portable-${VERSION}-x64.exe`, file: `DeepSeek-Harness-Studio-Portable-${VERSION}-x64.exe` },
    { name: 'SHA256SUMS.txt', file: 'SHA256SUMS.txt' },
  ]
  for (const candidate of candidates) {
    const filePath = path.join(RELEASE_DIR, candidate.file)
    if (!fs.existsSync(filePath)) {
      console.warn(`跳过缺失资产: ${candidate.file}`)
      continue
    }
    if (existing.has(candidate.name)) {
      await api('DELETE', `${API}/repos/${repo}/releases/assets/${existing.get(candidate.name)}`, { token })
      console.log(`已移除旧资产: ${candidate.name}`)
    }
    const binary = fs.readFileSync(filePath)
    const uploaded = await api('POST', `${UPLOADS_API}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(candidate.name)}`, { token, binary })
    console.log(`已上传 ${candidate.name} (${(binary.length / 1048576).toFixed(1)} MB)`)
  }
  console.log(`✅ 发布完成: https://github.com/${repo}/releases/tag/${TAG}`)
}

function releaseNotes() {
  const asset = (name) => `https://github.com/${repo}/releases/download/${TAG}/${name}`
  return `## 🚀 安装使用

**Windows 10/11 用户直接下载安装版（推荐）：**

⬇️ [DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe](${asset(`DeepSeek-Harness-Studio-Setup-${VERSION}-x64.exe`)})（约 147 MB，安装向导，可选择安装目录）

不想安装？也可以直接用免安装便携版：

⬇️ [DeepSeek-Harness-Studio-Portable-${VERSION}-x64.exe](${asset(`DeepSeek-Harness-Studio-Portable-${VERSION}-x64.exe`)})（免安装，解压即用）

**安装后 3 步配置视觉识图：**

1. 打开 Studio「偏好设置 → 视觉能力」，视觉引擎默认就是「阿里千问 Qwen-VL」；
2. 粘贴阿里云百炼 DashScope API Key（\`sk-\` 开头）→ 点「保存并重启」；
3. 在 Harness 模型选择器选名称带 \`(modlens vision)\` 的模型，粘贴图片即可识图。

**读 PDF / Word / Excel：** 聊天框只收图片（PNG/JPG/WebP/GIF），读文档请用「文件路径 + \`read_document\` 工具」，例如直接发「读取 \`D:\\资料\\报告.docx\` 的内容」。

**以后怎么升级：** 在「偏好设置 → 软件更新」检查并下载更新，点「安装并重启」后按安装向导完成覆盖安装（可自定义安装目录）。

**完整性校验：** 下载后可用本 Release 附带的 \`SHA256SUMS.txt\` 校验文件（安装版与便携版均已收录）。

---

## 📋 v${DISPLAY_VERSION} 更新内容

### 🐛 修复 ModLens 后无法切回普通模型
- 使用 ModLens 识图后，现在可以在同一会话直接切回 \`DeepSeek-V4-Flash\` 或 \`DeepSeek-V4-Pro\`
- 原始提问文字和 ModLens 识别结论继续保留；纯文本 API 不会再收到它无法处理的历史图片数据
- 历史图片会转换为明确的文字占位，而输入框中尚未发送的新图片仍需使用带 \`(modlens vision)\` 的模型

### 🧰 构建可靠性
- 模型切换兼容补丁会在依赖安装和发布构建前自动检查并应用
- 新增回归测试，防止后续安装包再次出现图片会话锁死文本模型的问题

### 📄 延续功能
- 支持通过 \`read_document\` 按文件路径读取 PDF、Word（docx）、Excel（xlsx）与纯文本
- 软件更新继续采用「下载安装包 + 安装向导」覆盖安装，可自定义安装目录，无需先卸载

---

## 🛠️ 从源码构建

\`\`\`powershell
npm install
npm test
npm run dist
\`\`\`

输出位于 \`release/\`：安装版（NSIS）与便携版（portable）可执行文件。构建脚本会先运行 \`npm run runtime:prepare\` 复制当前 Node.js 24 运行时到打包资源，成品不依赖用户系统 PATH。

完整的构建、更新与发布说明见仓库 [README](https://github.com/${repo}#readme) 与 [docs/UPDATES_CN.md](https://github.com/${repo}/blob/main/docs/UPDATES_CN.md)。
`
}

main().catch((error) => {
  console.error('发布失败:', error.message)
  process.exit(1)
})
