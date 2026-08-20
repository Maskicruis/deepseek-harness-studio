const path = require('node:path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const assets = path.join(root, 'docs', 'assets')
const source = (name) => path.join(assets, name)
const output = (name) => path.join(assets, name)

function svg(width, height, body) {
  return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)
}

async function roundedImage(input, width, height, radius, options = {}) {
  let pipeline = sharp(input)
  if (options.extract) pipeline = pipeline.extract(options.extract)
  const image = await pipeline.resize(width, height, {
    fit: options.fit || 'cover',
    position: options.position || 'center',
    background: '#0d111c',
  }).ensureAlpha().png().toBuffer()
  const mask = svg(width, height, `<rect width="${width}" height="${height}" rx="${radius}" fill="white"/>`)
  return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

function frame(width, height, radius = 28) {
  return svg(width, height, `
    <defs><filter id="s" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="20"/></filter></defs>
    <rect x="18" y="24" width="${width - 36}" height="${height - 36}" rx="${radius}" fill="#000" opacity=".58" filter="url(#s)"/>
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius}" fill="#0b0f19" stroke="#7186ff" stroke-opacity=".34" stroke-width="2"/>
  `)
}

function typography(width, height, body) {
  return svg(width, height, `<style>
    .sans{font-family:'Microsoft YaHei','Segoe UI',sans-serif}
    .white{fill:#f7f9ff}.muted{fill:#aab4ca}.blue{fill:#91a8ff}.fine{fill:#7986a3}
  </style>${body}`)
}

async function makeHero() {
  const width = 1920
  const height = 1080
  const screenshot = await roundedImage(source('product-ui-v1.1.png'), 1160, 653, 24)
  const icon = await sharp(path.join(root, 'build', 'app.png')).resize(76, 76).png().toBuffer()
  const copy = typography(width, height, `
    <text x="105" y="165" class="sans blue" font-size="19" font-weight="700" letter-spacing="4">UNOFFICIAL · OPEN SOURCE</text>
    <text x="105" y="282" class="sans white" font-size="74" font-weight="750">DeepSeek</text>
    <text x="105" y="365" class="sans white" font-size="74" font-weight="750">Harness Studio</text>
    <text x="105" y="435" class="sans muted" font-size="29">打开即聊的 Windows 智能体桌面端</text>
    <rect x="105" y="489" width="173" height="44" rx="22" fill="#526dff" fill-opacity=".18" stroke="#7186ff" stroke-opacity=".5"/>
    <text x="132" y="519" class="sans blue" font-size="18" font-weight="650">默认工作区</text>
    <rect x="293" y="489" width="173" height="44" rx="22" fill="#526dff" fill-opacity=".18" stroke="#7186ff" stroke-opacity=".5"/>
    <text x="320" y="519" class="sans blue" font-size="18" font-weight="650">路径智能识别</text>
    <rect x="105" y="548" width="173" height="44" rx="22" fill="#526dff" fill-opacity=".18" stroke="#7186ff" stroke-opacity=".5"/>
    <text x="132" y="578" class="sans blue" font-size="18" font-weight="650">社区插件中心</text>
    <text x="105" y="935" class="sans fine" font-size="18">Windows 10/11 · 本地运行 · Electron + React · MIT License</text>
    <text x="105" y="974" class="sans fine" font-size="15">非官方社区项目，与 DeepSeek 官方不存在隶属、赞助或背书关系</text>
  `)
  await sharp(source('background-hero-generated.png')).resize(width, height, { fit: 'cover' }).composite([
    { input: svg(width, height, `<rect width="${width}" height="${height}" fill="#02050d" opacity=".24"/><rect width="650" height="${height}" fill="url(#g)"/><defs><linearGradient id="g"><stop stop-color="#050916"/><stop offset="1" stop-color="#050916" stop-opacity="0"/></linearGradient></defs>`) },
    { input: frame(1204, 697), left: 684, top: 192 },
    { input: screenshot, left: 706, top: 214 },
    { input: icon, left: 105, top: 64 },
    { input: copy },
  ]).png().toFile(output('hero-wide-v1.1.png'))
}

async function makePathFeature() {
  const width = 1600
  const height = 900
  const panel = await roundedImage(source('settings-default-workspace-v1.1.png'), 430, 620, 26, {
    extract: { left: 820, top: 34, width: 455, height: 681 },
    fit: 'fill',
  })
  const copy = typography(width, height, `
    <text x="720" y="105" class="sans blue" font-size="18" font-weight="700" letter-spacing="3">ZERO-CONFIG WORKSPACE</text>
    <text x="720" y="170" class="sans white" font-size="48" font-weight="750">无需先选工作区</text>
    <text x="720" y="218" class="sans muted" font-size="22">首次启动自动准备目录，打开就能开始对话。</text>
    <rect x="720" y="255" width="360" height="1" fill="#7186ff" opacity=".3"/>
    <circle cx="742" cy="307" r="6" fill="#6680ff"/><text x="766" y="315" class="sans muted" font-size="20">消息内绝对路径自动识别</text>
    <circle cx="742" cy="352" r="6" fill="#6680ff"/><text x="766" y="360" class="sans muted" font-size="20">文件路径自动归入父目录</text>
    <circle cx="742" cy="397" r="6" fill="#6680ff"/><text x="766" y="405" class="sans muted" font-size="20">自定义目录仍可随时切换</text>
    <text x="70" y="842" class="sans fine" font-size="16">DeepSeek Harness Studio v1.1 · 非官方社区开源项目</text>
  `)
  await sharp(source('background-paths-generated.png')).resize(width, height, { fit: 'cover' }).composite([
    { input: svg(width, height, `<rect width="${width}" height="${height}" fill="#02050d" opacity=".2"/><rect x="680" width="920" height="900" fill="#050916" opacity=".62"/>`) },
    { input: copy },
    { input: frame(472, 662), left: 1100, top: 220 },
    { input: panel, left: 1121, top: 241 },
  ]).png().toFile(output('feature-paths-v1.1.png'))
}

async function makePluginFeature() {
  const width = 1600
  const height = 900
  const panel = await roundedImage(source('plugin-center-v1.1.png'), 505, 690, 26, {
    extract: { left: 820, top: 34, width: 455, height: 681 },
    fit: 'fill',
  })
  const copy = typography(width, height, `
    <text x="88" y="100" class="sans blue" font-size="18" font-weight="700" letter-spacing="3">COMMUNITY EXTENSIONS</text>
    <text x="88" y="170" class="sans white" font-size="52" font-weight="750">把社区能力接入 Harness</text>
    <text x="88" y="222" class="sans muted" font-size="23">npm、GitHub、本地目录，一处导入与管理。</text>
    <rect x="88" y="266" width="530" height="1" fill="#7186ff" opacity=".3"/>
    <text x="88" y="314" class="sans white" font-size="20" font-weight="650">可见的安装日志</text>
    <text x="88" y="347" class="sans muted" font-size="18">启用、停用、卸载与 Harness 自动重启</text>
    <text x="88" y="394" class="sans white" font-size="20" font-weight="650">明确的安全提示</text>
    <text x="88" y="427" class="sans muted" font-size="18">在安装前确认来源与权限边界</text>
    <text x="88" y="842" class="sans fine" font-size="16">DeepSeek Harness Studio v1.1 · Extend locally, build together</text>
  `)
  await sharp(source('background-plugins-generated.png')).resize(width, height, { fit: 'cover' }).composite([
    { input: svg(width, height, `<rect width="${width}" height="${height}" fill="#02050d" opacity=".24"/><rect width="720" height="900" fill="#040814" opacity=".7"/>`) },
    { input: copy },
    { input: frame(547, 732), left: 878, top: 88 },
    { input: panel, left: 899, top: 109 },
  ]).png().toFile(output('feature-plugins-v1.1.png'))
}

Promise.all([makeHero(), makePathFeature(), makePluginFeature()]).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
