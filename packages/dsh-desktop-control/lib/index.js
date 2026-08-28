import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'studio-desktop-control'
export const inject = ['tools', 'systemPrompt']

export const DESKTOP_TOOL_NAMES = Object.freeze([
  'computer_screenshot',
  'computer_list_windows',
  'computer_focus_window',
  'computer_move_mouse',
  'computer_click',
  'computer_scroll',
  'computer_type',
  'computer_hotkey',
])

const DESKTOP_TOOL_SET = new Set(DESKTOP_TOOL_NAMES)
const SCRIPT_PATH = fileURLToPath(new URL('../scripts/desktop-control.ps1', import.meta.url))
const MAX_STDOUT_BYTES = 2 * 1024 * 1024
const MAX_TEXT_LENGTH = 2000
const HOTKEY_PATTERN = /^(?:(?:CTRL|ALT|SHIFT|WIN)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|ENTER|TAB|ESC|SPACE|BACKSPACE|DELETE|HOME|END|PAGEUP|PAGEDOWN|LEFT|RIGHT|UP|DOWN)$/

function jsonSchema(spec) {
  const schema = {}
  for (const key of ['type', 'description', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength']) {
    if (spec[key] !== undefined) schema[key] = spec[key]
  }
  if (spec.type === 'array') schema.items = jsonSchema(spec.items)
  if (spec.type === 'object') {
    schema.additionalProperties = spec.additionalProperties === true
    schema.properties = Object.fromEntries(Object.entries(spec.properties || {}).map(([key, value]) => [key, jsonSchema(value)]))
    const required = Object.entries(spec.properties || {}).filter(([, value]) => value.required).map(([key]) => key)
    if (required.length) schema.required = required
  }
  return schema
}

function parameterSchema(spec) {
  const required = Object.entries(spec).filter(([, value]) => value.required).map(([key]) => key)
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, jsonSchema(value)])),
    ...(required.length ? { required } : {}),
  }
}

function validateParameters(spec, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object')
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(spec, key)) throw new Error(`unsupported tool argument: ${key}`)
  }
  for (const [key, rule] of Object.entries(spec)) {
    const value = args[key]
    if (value === undefined) {
      if (rule.required) throw new Error(`missing required tool argument: ${key}`)
      continue
    }
    if (rule.type === 'integer' && !Number.isInteger(value)) throw new Error(`${key} must be an integer`)
    if (rule.type === 'string' && typeof value !== 'string') throw new Error(`${key} must be a string`)
    if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) throw new Error(`${key} has an unsupported value`)
  }
}

// Kept self-contained so Studio can deploy this package into any user's DSH
// profile without copying or hard-coding dependencies from the app directory.
function defineTool(options) {
  const parameters = parameterSchema(options.parameters)
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: { schema: jsonSchema(options.output.schema), render: options.output.render },
    ...(options.presentCall ? { presentCall: options.presentCall } : {}),
    ...(options.isConcurrencySafe ? { isConcurrencySafe: options.isConcurrencySafe } : {}),
    async execute(args, exec) {
      validateParameters(options.parameters, args)
      return options.execute(args, exec)
    },
  }
}

function powershellPath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR
  return systemRoot
    ? path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
}

function abortError() {
  const error = new Error('desktop operation cancelled')
  error.name = 'AbortError'
  return error
}

function appendArgument(argv, name, value) {
  if (value === undefined || value === null || value === '') return
  argv.push(`-${name}`, String(value))
}

export function runDesktopCommand(action, input = {}, signal) {
  if (process.platform !== 'win32') return Promise.reject(new Error('desktop control is available only on Windows'))
  if (signal?.aborted) return Promise.reject(abortError())
  const argv = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, '-Action', action]
  appendArgument(argv, 'OutputPath', input.outputPath)
  appendArgument(argv, 'X', input.x)
  appendArgument(argv, 'Y', input.y)
  appendArgument(argv, 'Button', input.button)
  appendArgument(argv, 'Clicks', input.clicks)
  appendArgument(argv, 'Delta', input.delta)
  appendArgument(argv, 'WindowHandle', input.windowHandle)
  appendArgument(argv, 'Keys', input.keys)
  if (input.text !== undefined) appendArgument(argv, 'TextBase64', Buffer.from(input.text, 'utf8').toString('base64'))

  return new Promise((resolve, reject) => {
    const child = spawn(powershellPath(), argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handler(value)
    }
    const onAbort = () => {
      child.kill()
      finish(reject, abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) child.kill()
    })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-65536) })
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        finish(reject, new Error((stderr || stdout || `desktop helper exited with code ${code}`).trim()))
        return
      }
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
        finish(resolve, JSON.parse(line || '{}'))
      } catch (error) {
        finish(reject, new Error(`desktop helper returned invalid JSON: ${error.message}`))
      }
    })
  })
}

function approvalReason(exec) {
  const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
  switch (exec.name) {
    case 'computer_screenshot': return '允许智能体读取当前桌面截图并发送给所选模型？'
    case 'computer_list_windows': return '允许智能体读取当前可见窗口的标题与位置？'
    case 'computer_focus_window': return `允许智能体切换到窗口 ${String(args.window_handle || '')}？`
    case 'computer_move_mouse': return `允许智能体把鼠标移动到 (${args.x}, ${args.y})？`
    case 'computer_click': return `允许智能体在 (${args.x}, ${args.y}) 执行${args.button || 'left'}点击？`
    case 'computer_scroll': return `允许智能体在 (${args.x}, ${args.y}) 滚动桌面？`
    case 'computer_type': return `允许智能体向当前窗口输入 ${String(args.text || '').length} 个字符？`
    case 'computer_hotkey': return `允许智能体向当前窗口发送快捷键 ${String(args.keys || '')}？`
    default: return '允许智能体执行这次桌面操作？'
  }
}

export function desktopApprovalDecision(exec, nextDecision = { kind: 'allow' }) {
  if (!DESKTOP_TOOL_SET.has(exec.name) || nextDecision.kind !== 'allow') return nextDecision
  return { kind: 'ask', reason: approvalReason(exec) }
}

function textBlock(text) {
  return [{ type: 'text', text }]
}

function actionOutput(action, message) {
  return { ok: true, action, message }
}

const ACTION_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      action: { type: 'string', required: true },
      message: { type: 'string', required: true },
    },
  },
  render: (_args, value) => textBlock(value.message),
}

function actionPresenter(title) {
  return (args) => ({ card: 'generic', title: typeof title === 'function' ? title(args) : title, kind: 'execute', rawInput: JSON.stringify(args) })
}

async function assertImageCapableRoute(ctx, exec) {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (!provider || !model || !llm) throw new Error('desktop screenshot requires a resolvable image-capable model')
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (!active.inputModalities?.includes('image')) {
    throw new Error(`model "${model}" does not accept images; switch to an image-capable model before using computer_screenshot`)
  }
}

function screenshotContent(value) {
  return [
    {
      type: 'text',
      text: `Captured the Windows virtual desktop. Screenshot pixel (0,0) maps to desktop coordinate (${value.originX},${value.originY}); size ${value.width}x${value.height}. Cursor: (${value.cursorX},${value.cursorY}).`,
    },
    { type: 'image', attachment: value.image },
  ]
}

function registerScreenshot(ctx) {
  ctx.tools.register(defineTool({
    name: 'computer_screenshot',
    description: 'Capture the real Windows virtual desktop and return the screenshot. Requires one-time user approval and an image-capable model.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          originX: { type: 'integer', required: true },
          originY: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          cursorX: { type: 'integer', required: true },
          cursorY: { type: 'integer', required: true },
          image: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true, enum: ['image/png'] },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => screenshotContent(value),
    },
    async execute(_args, exec) {
      await assertImageCapableRoute(ctx, exec)
      const attachments = ctx.get('attachments')
      if (!attachments) throw new Error('desktop screenshot requires the Harness attachment service')
      const directory = path.join(os.tmpdir(), 'deepseek-harness-studio-desktop')
      fs.mkdirSync(directory, { recursive: true })
      const outputPath = path.join(directory, `${randomUUID()}.png`)
      try {
        const result = await runDesktopCommand('screenshot', { outputPath }, exec.signal)
        const data = fs.readFileSync(outputPath)
        const ref = await attachments.saveImage({ data, mediaType: 'image/png', name: 'windows-desktop.png' })
        return {
          originX: result.originX,
          originY: result.originY,
          width: result.width,
          height: result.height,
          cursorX: result.cursorX,
          cursorY: result.cursorY,
          image: {
            attachmentId: ref.attachmentId,
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            name: ref.name || 'windows-desktop.png',
          },
        }
      } finally {
        try { fs.unlinkSync(outputPath) } catch {}
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Capture Windows desktop', kind: 'read' }),
  }))
}

function registerWindowTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'computer_list_windows',
    description: 'List visible top-level Windows desktop windows with handles, titles, processes, and screen bounds. Requires one-time user approval.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          windows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                handle: { type: 'string', required: true },
                title: { type: 'string', required: true },
                process: { type: 'string', required: true },
                x: { type: 'integer', required: true },
                y: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => textBlock(value.windows.length
        ? value.windows.map((window) => `${window.handle} | ${window.process} | ${window.title} | (${window.x},${window.y}) ${window.width}x${window.height}`).join('\n')
        : 'No visible desktop windows found.'),
    },
    execute: (_args, exec) => runDesktopCommand('list-windows', {}, exec.signal),
    presentCall: () => ({ card: 'generic', title: 'List Windows desktop windows', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_focus_window',
    description: 'Bring a visible Windows window to the foreground by the handle returned from computer_list_windows. Requires one-time user approval.',
    parameters: { window_handle: { type: 'string', required: true, description: 'Decimal window handle from computer_list_windows.' } },
    output: ACTION_OUTPUT,
    async execute(args, exec) {
      if (!/^\d{1,20}$/.test(args.window_handle)) throw new Error('window_handle must be a decimal handle returned by computer_list_windows')
      await runDesktopCommand('focus-window', { windowHandle: args.window_handle }, exec.signal)
      return actionOutput('focus-window', `Focused window ${args.window_handle}.`)
    },
    presentCall: actionPresenter((args) => `Focus window ${args.window_handle}`),
  }))
}

function registerPointerTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'computer_move_mouse',
    description: 'Move the real Windows mouse pointer to absolute virtual-desktop coordinates. Requires one-time user approval.',
    parameters: {
      x: { type: 'integer', required: true, description: 'Absolute desktop x coordinate.' },
      y: { type: 'integer', required: true, description: 'Absolute desktop y coordinate.' },
    },
    output: ACTION_OUTPUT,
    async execute(args, exec) {
      await runDesktopCommand('move', args, exec.signal)
      return actionOutput('move', `Moved mouse to (${args.x}, ${args.y}).`)
    },
    presentCall: actionPresenter((args) => `Move mouse to (${args.x}, ${args.y})`),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_click',
    description: 'Click the real Windows desktop at absolute virtual-desktop coordinates. Requires one-time user approval.',
    parameters: {
      x: { type: 'integer', required: true, description: 'Absolute desktop x coordinate.' },
      y: { type: 'integer', required: true, description: 'Absolute desktop y coordinate.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Defaults to left.' },
      clicks: { type: 'integer', description: '1 for single click or 2 for double click. Defaults to 1.' },
    },
    output: ACTION_OUTPUT,
    async execute(args, exec) {
      const button = args.button || 'left'
      const clicks = args.clicks ?? 1
      if (![1, 2].includes(clicks)) throw new Error('clicks must be 1 or 2')
      await runDesktopCommand('click', { ...args, button, clicks }, exec.signal)
      return actionOutput('click', `${clicks === 2 ? 'Double-clicked' : 'Clicked'} ${button} at (${args.x}, ${args.y}).`)
    },
    presentCall: actionPresenter((args) => `${args.clicks === 2 ? 'Double click' : 'Click'} at (${args.x}, ${args.y})`),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_scroll',
    description: 'Scroll the real Windows desktop at absolute virtual-desktop coordinates. Positive delta scrolls up and negative scrolls down. Requires one-time user approval.',
    parameters: {
      x: { type: 'integer', required: true, description: 'Absolute desktop x coordinate.' },
      y: { type: 'integer', required: true, description: 'Absolute desktop y coordinate.' },
      delta: { type: 'integer', required: true, description: 'Wheel delta, typically multiples of 120; positive is up, negative is down.' },
    },
    output: ACTION_OUTPUT,
    async execute(args, exec) {
      if (args.delta === 0 || Math.abs(args.delta) > 2400) throw new Error('delta must be between -2400 and 2400 and cannot be zero')
      await runDesktopCommand('scroll', args, exec.signal)
      return actionOutput('scroll', `Scrolled ${args.delta} at (${args.x}, ${args.y}).`)
    },
    presentCall: actionPresenter((args) => `Scroll at (${args.x}, ${args.y})`),
  }))
}

function registerKeyboardTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'computer_type',
    description: 'Type Unicode text into the currently focused real Windows control without using the clipboard. Requires one-time user approval.',
    parameters: { text: { type: 'string', required: true, description: 'Text to type, up to 2000 UTF-16 characters.' } },
    output: ACTION_OUTPUT,
    async execute(args, exec) {
      if (!args.text.length || args.text.length > MAX_TEXT_LENGTH) throw new Error(`text must contain 1-${MAX_TEXT_LENGTH} characters`)
      await runDesktopCommand('type', { text: args.text }, exec.signal)
      return actionOutput('type', `Typed ${args.text.length} characters into the focused window.`)
    },
    presentCall: actionPresenter((args) => `Type ${String(args.text || '').length} characters`),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_hotkey',
    description: 'Send a restricted keyboard shortcut to the currently focused real Windows control, for example CTRL+L, CTRL+S, ALT+F4, or ENTER. Requires one-time user approval.',
    parameters: { keys: { type: 'string', required: true, description: 'Uppercase key combination joined by +.' } },
    output: ACTION_OUTPUT,
    async execute(args, exec) {
      const keys = args.keys.trim().toUpperCase()
      if (!HOTKEY_PATTERN.test(keys)) throw new Error('unsupported hotkey; use modifiers CTRL/ALT/SHIFT/WIN plus one supported key')
      await runDesktopCommand('hotkey', { keys }, exec.signal)
      return actionOutput('hotkey', `Sent ${keys} to the focused window.`)
    },
    presentCall: actionPresenter((args) => `Send hotkey ${args.keys}`),
  }))
}

export function apply(ctx) {
  if (process.platform !== 'win32') return
  ctx.systemPrompt.section({
    name: 'tool:studio-desktop-control',
    order: 112,
    text: [
      'Windows desktop control tools operate the user\'s real interactive session and every call requires one-time user approval.',
      'Observe with computer_screenshot before choosing coordinates, make the smallest necessary action, and capture another screenshot to verify the result.',
      'Never infer that a click or keystroke succeeded without observing the resulting screen.',
      'Do not interact with password fields, authentication secrets, UAC secure desktop, or destructive confirmation dialogs; ask the user to handle those directly.',
      'Use web_search for current information and cite the real sources returned by the search provider.',
    ].join(' '),
  })
  ctx.on('tools/pre-execute', async (exec, next) => desktopApprovalDecision(exec, await next()))
  registerScreenshot(ctx)
  registerWindowTools(ctx)
  registerPointerTools(ctx)
  registerKeyboardTools(ctx)
}
