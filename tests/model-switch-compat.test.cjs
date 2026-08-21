const test = require('node:test')
const assert = require('node:assert/strict')

const {
  IMAGE_PLACEHOLDER,
  patchApiProxy,
  patchDeepSeekAdapter,
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

  const patched = patchDeepSeekAdapter(source)

  assert.match(patched.source, /block\.type === "image"/)
  assert.match(patched.source, new RegExp(IMAGE_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(patched.source, /assertTextOnly\(message\.content\)/)
  assert.equal(patchDeepSeekAdapter(patched.source).changed, false)
})
