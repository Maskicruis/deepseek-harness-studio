const fs = require('node:fs')
const path = require('node:path')

const IMAGE_PLACEHOLDER = '[Image omitted: this text-only model cannot access the original image.]'

function replaceOnce(source, before, after, label) {
  if (after.length > 0 && source.includes(after)) return { source, changed: false }
  if (after.length === 0 && !source.includes(before)) return { source, changed: false }
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label}: expected exactly one unpatched match`)
  }
  return { source: source.replace(before, after), changed: true }
}

function patchApiProxy(source, style) {
  if (style === 'bundled') {
    const before = 'if ([...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].some((message) => contentHasImage(message.content)) || messagesHaveImage(found.agent.session.deriveMessages())) {'
    const after = 'if ([...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].some((message) => contentHasImage(message.content))) {'
    let result = replaceOnce(source, before, after, 'api-proxy bundled image gate')
    const message = replaceOnce(
      result.source,
      'does not accept image input, but this session already contains images; select an image-capable model.',
      'does not accept the image currently queued for the next turn; send it with an image-capable model first.',
      'api-proxy bundled error message',
    )
    return { source: message.source, changed: result.changed || message.changed }
  }

  const before = 'if (pendingImage || messagesHaveImage(found.agent.session.deriveMessages())) {'
  const after = 'if (pendingImage) {'
  let result = replaceOnce(source, before, after, 'api-proxy typed image gate')
  const message = replaceOnce(
    result.source,
    'does not accept image input, but this session already contains images; select an image-capable model.',
    'does not accept the image currently queued for the next turn; send it with an image-capable model first.',
    'api-proxy typed error message',
  )
  return { source: message.source, changed: result.changed || message.changed }
}

function patchDeepSeekAdapter(source) {
  const beforeFlatten = 'return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");'
  const afterFlatten = `return blocks.map((block) => block.type === "text" ? block.text : block.type === "image" ? "\\n${IMAGE_PLACEHOLDER}\\n" : "").join("");`
  let result = replaceOnce(source, beforeFlatten, afterFlatten, 'DeepSeek image-to-text projection')
  const assertion = replaceOnce(
    result.source,
    '\t\tassertTextOnly(message.content);\n',
    '',
    'DeepSeek text-only assertion',
  )
  return { source: assertion.source, changed: result.changed || assertion.changed }
}

function patchFile(filePath, transform) {
  if (!fs.existsSync(filePath)) throw new Error(`required DSH file not found: ${filePath}`)
  const source = fs.readFileSync(filePath, 'utf8')
  const result = transform(source)
  if (result.changed) fs.writeFileSync(filePath, result.source, 'utf8')
  return { filePath, changed: result.changed }
}

function patchDshModelSwitch(appRoot) {
  const nodeModules = path.join(appRoot, 'node_modules')
  return [
    patchFile(path.join(nodeModules, '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js'), (source) => patchApiProxy(source, 'bundled')),
    patchFile(path.join(nodeModules, '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'types', 'api-proxy.js'), (source) => patchApiProxy(source, 'typed')),
    patchFile(path.join(nodeModules, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js'), patchDeepSeekAdapter),
  ]
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'))
  for (const result of patchDshModelSwitch(root)) {
    process.stdout.write(`${result.changed ? 'patched' : 'already patched'} ${result.filePath}\n`)
  }
}

module.exports = { IMAGE_PLACEHOLDER, patchApiProxy, patchDeepSeekAdapter, patchDshModelSwitch }
