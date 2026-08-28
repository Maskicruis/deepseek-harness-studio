const test = require('node:test')
const assert = require('node:assert/strict')

test('desktop tools register on Windows and force one-time approval', async () => {
  const {
    DESKTOP_TOOL_NAMES,
    apply,
    desktopApprovalDecision,
  } = await import('../packages/dsh-desktop-control/lib/index.js')

  const registered = []
  const promptSections = []
  let approvalGate
  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    systemPrompt: { section: (section) => promptSections.push(section) },
    on(name, handler) {
      if (name === 'tools/pre-execute') approvalGate = handler
    },
    get: () => undefined,
  }

  apply(ctx)

  assert.deepEqual(registered.map((tool) => tool.name), [...DESKTOP_TOOL_NAMES])
  assert.equal(typeof approvalGate, 'function')
  assert.match(promptSections[0].text, /every call requires one-time user approval/)

  const allowed = desktopApprovalDecision({
    name: 'computer_click',
    arguments: { x: 120, y: 240, button: 'left' },
  })
  assert.deepEqual(allowed, {
    kind: 'ask',
    reason: '允许智能体在 (120, 240) 执行left点击？',
  })

  const denied = { kind: 'deny', reason: 'policy blocked this action' }
  assert.equal(desktopApprovalDecision({ name: 'computer_type', arguments: { text: 'secret' } }, denied), denied)
  const unrelated = { name: 'web_search', arguments: { query: 'news' } }
  assert.deepEqual(desktopApprovalDecision(unrelated), { kind: 'allow' })

  const waterfallDecision = await approvalGate(
    { name: 'computer_hotkey', arguments: { keys: 'CTRL+L' } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(waterfallDecision, {
    kind: 'ask',
    reason: '允许智能体向当前窗口发送快捷键 CTRL+L？',
  })
})
