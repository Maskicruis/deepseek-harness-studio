const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, 'build')
const markSource = fs.readFileSync(path.join(buildDir, 'deepseek-mark.svg'), 'utf8')
const markPath = markSource.match(/<path[^>]+d="([^"]+)"/)?.[1]

if (!markPath) throw new Error('无法从 build/deepseek-mark.svg 读取 DeepSeek 标志。')

function frame({ compact = false } = {}) {
  const foreground = compact
    ? `
      <g transform="translate(56 57) scale(8.05)" fill="#ffffff">
        <path d="${markPath}"/>
      </g>
      <rect x="284" y="352" width="168" height="112" rx="36" fill="url(#badge)" stroke="#ffffff" stroke-opacity=".28" stroke-width="4"/>
      <text x="368" y="432" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="800" letter-spacing="-3">HS</text>`
    : `
      <g transform="translate(48 36) scale(8.35)" fill="#ffffff" opacity=".22">
        <path d="${markPath}"/>
      </g>
      <text x="256" y="82" text-anchor="middle" fill="#ffffff" fill-opacity=".86" font-family="Segoe UI, Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="6">DEEPSEEK</text>
      <rect x="48" y="286" width="416" height="174" rx="46" fill="url(#panel)" stroke="#ffffff" stroke-opacity=".22" stroke-width="3"/>
      <text x="256" y="371" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="53" font-weight="800" letter-spacing="1">HARNESS</text>
      <text x="256" y="420" text-anchor="middle" fill="#bfcaff" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="12">STUDIO</text>`

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="surface" x1="76" y1="38" x2="446" y2="490" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7288ff"/>
          <stop offset=".48" stop-color="#4263f4"/>
          <stop offset="1" stop-color="#1a329f"/>
        </linearGradient>
        <linearGradient id="panel" x1="64" y1="292" x2="446" y2="454" gradientUnits="userSpaceOnUse">
          <stop stop-color="#101b4b" stop-opacity=".9"/>
          <stop offset="1" stop-color="#07102f" stop-opacity=".96"/>
        </linearGradient>
        <linearGradient id="badge" x1="292" y1="356" x2="446" y2="460" gradientUnits="userSpaceOnUse">
          <stop stop-color="#14245d"/>
          <stop offset="1" stop-color="#07102e"/>
        </linearGradient>
        <radialGradient id="topGlow" cx="0" cy="0" r="1" gradientTransform="translate(402 90) rotate(135) scale(272)" gradientUnits="userSpaceOnUse">
          <stop stop-color="#b6c2ff" stop-opacity=".26"/>
          <stop offset="1" stop-color="#b6c2ff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="bottomGlow" cx="0" cy="0" r="1" gradientTransform="translate(54 476) rotate(-45) scale(300)" gradientUnits="userSpaceOnUse">
          <stop stop-color="#071f87" stop-opacity=".38"/>
          <stop offset="1" stop-color="#071f87" stop-opacity="0"/>
        </radialGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="16" stdDeviation="15" flood-color="#071441" flood-opacity=".55"/>
        </filter>
        <clipPath id="clip"><rect x="18" y="18" width="476" height="476" rx="112"/></clipPath>
      </defs>
      <g filter="url(#shadow)">
        <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#surface)"/>
        <g clip-path="url(#clip)">
          <rect x="18" y="18" width="476" height="476" fill="url(#topGlow)"/>
          <rect x="18" y="18" width="476" height="476" fill="url(#bottomGlow)"/>
          ${foreground}
        </g>
        <rect x="19.5" y="19.5" width="473" height="473" rx="110.5" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="3"/>
      </g>
    </svg>`)
}

function makeIco(images) {
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = headerSize
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(buffer.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += buffer.length
  })
  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)])
}

async function main() {
  fs.mkdirSync(buildDir, { recursive: true })
  const large = frame()
  const compact = frame({ compact: true })
  const appPng = await sharp(large).png().toBuffer()
  fs.writeFileSync(path.join(buildDir, 'app.png'), appPng)

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) {
    const source = size <= 64 ? compact : large
    const buffer = await sharp(source).resize(size, size, { fit: 'fill' }).png().toBuffer()
    images.push({ size, buffer })
  }
  fs.writeFileSync(path.join(buildDir, 'app.ico'), makeIco(images))
  console.log(`App icon generated: ${path.join(buildDir, 'app.png')} + ${sizes.length}-frame ICO`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
