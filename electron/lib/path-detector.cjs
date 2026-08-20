const fs = require('node:fs')
const path = require('node:path')

const TRAILING_PUNCTUATION = /[，。；、：!?！？)）\]}】>]+$/u

function cleanCandidate(candidate) {
  return String(candidate || '').trim().replace(TRAILING_PUNCTUATION, '')
}

function extractAbsolutePaths(text) {
  const value = String(text || '')
  const candidates = []
  const quoted = /["'“”‘’`]([A-Za-z]:[\\/][^"'“”‘’`\r\n]+|\\\\[^\\/\s]+[\\/][^"'“”‘’`\r\n]+)["'“”‘’`]/gu
  const plain = /(?:^|[\s（(])([A-Za-z]:[\\/][^\s"'“”‘’`<>|?*\r\n]+|\\\\[^\\/\s]+[\\/][^\s"'“”‘’`<>|?*\r\n]+)/gu
  for (const match of value.matchAll(quoted)) candidates.push(cleanCandidate(match[1]))
  for (const match of value.matchAll(plain)) candidates.push(cleanCandidate(match[1]))
  return [...new Set(candidates.filter(Boolean))].slice(0, 4)
}

function resolveExistingWorkspace(candidate) {
  const resolved = path.resolve(cleanCandidate(candidate))
  if (fs.existsSync(resolved)) {
    return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved)
  }
  const parent = path.dirname(resolved)
  const looksLikeFile = /\.[A-Za-z0-9_-]{1,12}$/u.test(path.basename(resolved))
  return looksLikeFile && fs.existsSync(parent) && fs.statSync(parent).isDirectory() ? parent : ''
}

function promptTextFromUpload(uploadData) {
  try {
    const bytes = (uploadData || []).flatMap((item) => item.bytes ? [Buffer.from(item.bytes)] : [])
    if (!bytes.length) return ''
    const envelope = JSON.parse(Buffer.concat(bytes).toString('utf8'))
    if (envelope?.method !== 'session.prompt' || !Array.isArray(envelope?.payload?.content)) return ''
    return envelope.payload.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
  } catch {
    return ''
  }
}

module.exports = { extractAbsolutePaths, promptTextFromUpload, resolveExistingWorkspace }
