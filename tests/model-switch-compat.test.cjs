const test = require('node:test')
const assert = require('node:assert/strict')

const {
  IMAGE_PLACEHOLDER,
  patchApiProxy,
  patchDshAgentCapabilities,
  patchDeepSeekImageProjection,
} = require('../scripts/patch-dsh-model-switch.cjs')

test('bundled API proxy allows a text model after historical image turns', () => {
  const source = [
    'if ([...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].some((message) => contentHasImage(message.content)) || messagesHaveImage(found.agent.session.deriveMessages())) {',
    'message: `Model "${resolved.model}" does not accept image input, but this session already contains images; select an image-capable model.`',
  ].join('\n')

  const patched = patchApiProxy(source, 'bundled')

  assert.equal(patched.changed, true)
  assert.match(patched.source, /nextStep\]\.some/)
  assert.doesNotMatch(patched.source, /messagesHaveImage\(found\.agent\.session\.deriveMessages\(\)\)/)
  assert.match(patched.source, /image currently queued for the next turn/)
  assert.equal(patchApiProxy(patched.source, 'bundled').changed, false)
})

test('typed API proxy keeps only the pending-image safety gate', () => {
  const source = [
    'if (pendingImage || messagesHaveImage(found.agent.session.deriveMessages())) {',
    'message: `Model "${resolved.model}" does not accept image input, but this session already contains images; select an image-capable model.`',
  ].join('\n')

  const patched = patchApiProxy(source, 'typed')

  assert.match(patched.source, /if \(pendingImage\) \{/)
  assert.doesNotMatch(patched.source, /pendingImage \|\|/)
  assert.equal(patchApiProxy(patched.source, 'typed').changed, false)
})

test('DeepSeek adapter projects historical images to a text placeholder', () => {
  const source = [
    'return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");',
    '\t\tassertTextOnly(message.content);',
  ].join('\n') + '\n'

  const patched = patchDeepSeekImageProjection(source)

  assert.match(patched.source, /block\.type === "image"/)
  assert.match(patched.source, new RegExp(IMAGE_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(patched.source, /assertTextOnly\(message\.content\)/)
  assert.equal(patchDeepSeekImageProjection(patched.source).changed, false)
})

test('DSH composition keeps official live search and approval-gated desktop tools', () => {
  const source = [
    '    - id: web',
    "      name: '@deepseek-ai/dsh-web'",
    '      config:',
    '        searchProvider: deepseek-official',
    '',
    '    - id: web-search-deepseek',
    "      name: '@deepseek-ai/dsh-web-search-deepseek'",
    '      config:',
    '        apiKeyEnv: DEEPSEEK_API_KEY',
    '',
    '    - id: tool-web',
    "      name: '@deepseek-ai/dsh-tool-web'",
    '      config:',
    '        fetch: false',
    '        searchTimeoutMs: 60000',
  ].join('\n')

  const patched = patchDshAgentCapabilities(source)

  assert.equal(patched.changed, true)
  assert.match(patched.source, /searchProvider: deepseek-official/)
  assert.match(patched.source, /name: '@deepseek-ai\/dsh-web-search-deepseek'/)
  assert.match(patched.source, /name: '@deepseek-harness-studio\/dsh-desktop-control'/)
  assert.match(patched.source, /DSH_STUDIO_DESKTOP_CONTROL !== '1'/)
  assert.match(patched.source, /fetch: false/)
  assert.doesNotMatch(patched.source, /web-fetch-http/)
  assert.equal(patchDshAgentCapabilities(patched.source).changed, false)
})
