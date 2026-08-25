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

function patchDeepSeekImageProjection(source) {
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

function patchDeepSeekDynamicModels(source) {
  let changed = false
  const apply = (before, after, label) => {
    const result = replaceOnce(source, before, after, label)
    source = result.source
    changed = changed || result.changed
  }

  apply(
    [
      'function modelInfo(provider, model) {',
      '\treturn {',
      '\t\tprovider,',
      '\t\tid: model.id,',
      '\t\tname: model.name ?? model.id,',
      '\t\t...model.description === void 0 ? {} : { description: model.description },',
      '\t\tinputModalities: ["text"]',
      '\t};',
      '}',
    ].join('\n'),
    [
      'const MODEL_DISCOVERY_TTL_MS = 3e5;',
      'const VISION_MODEL_ID_PATTERN = /(?:^|[-_.])(?:vision|vl|multimodal)(?:$|[-_.])/i;',
      'function modelInputModalities(model) {',
      '\tif (Array.isArray(model.inputModalities) && model.inputModalities.includes("image")) return ["text", "image"];',
      '\treturn VISION_MODEL_ID_PATTERN.test(model.id) ? ["text", "image"] : ["text"];',
      '}',
      'function modelInfo(provider, model) {',
      '\treturn {',
      '\t\tprovider,',
      '\t\tid: model.id,',
      '\t\tname: model.name ?? model.id,',
      '\t\t...model.description === void 0 ? {} : { description: model.description },',
      '\t\tinputModalities: modelInputModalities(model)',
      '\t};',
      '}',
    ].join('\n'),
    'DeepSeek model modality metadata',
  )

  const parseMarker = [
    '/**',
    '* Parse an SSE byte stream into data payloads. Yields \u0060[DONE]\u0060 as the final',
  ].join('\n')
  apply(
    parseMarker,
    [
      'async function serializeVisionUserContent(blocks, attachments) {',
      '\tconst content = [];',
      '\tfor (const block of blocks) {',
      '\t\tif (block.type === "text" && block.text.length > 0) content.push({ type: "text", text: block.text });',
      '\t\telse if (block.type === "image") {',
      '\t\t\tconst stored = await attachments.readImage(block.attachment);',
      '\t\t\tcontent.push({',
      '\t\t\t\ttype: "image_url",',
      '\t\t\t\timage_url: {',
      '\t\t\t\t\turl: "data:" + stored.ref.mediaType + ";base64," + Buffer.from(stored.data).toString("base64"),',
      '\t\t\t\t\tdetail: "auto"',
      '\t\t\t\t}',
      '\t\t\t});',
      '\t\t}',
      '\t}',
      '\tif (content.every((block) => block.type === "text")) return content.map((block) => block.text).join("");',
      '\treturn content;',
      '}',
      'async function serializeMessagesWithImages(messages, attachments) {',
      '\tconst wire = [];',
      '\tfor (const message of messages) {',
      '\t\tif (message.role === "system") {',
      '\t\t\twire.push({ role: "system", content: flattenText(message.content) });',
      '\t\t\tcontinue;',
      '\t\t}',
      '\t\tif (message.role === "assistant") {',
      '\t\t\twire.push(serializeAssistant(message));',
      '\t\t\tcontinue;',
      '\t\t}',
      '\t\tconst toolResults = message.content.filter((block) => block.type === "tool-result");',
      '\t\tconst content = await serializeVisionUserContent(message.content.filter((block) => block.type !== "tool-result"), attachments);',
      '\t\tif ((typeof content === "string" ? content.length > 0 : content.length > 0) || toolResults.length === 0) wire.push({ role: "user", content });',
      '\t\tfor (const result of toolResults) wire.push({',
      '\t\t\trole: "tool",',
      '\t\t\ttool_call_id: result.toolCallId,',
      '\t\t\tcontent: flattenText(result.content) || "(no output)"',
      '\t\t});',
      '\t}',
      '\treturn wire;',
      '}',
      'async function serializeRequestWithImages(options, defaults, attachments) {',
      '\tconst body = serializeRequest(options, defaults);',
      '\tconst messages = [];',
      '\tif (options.system !== void 0) messages.push({ role: "system", content: options.system });',
      '\tmessages.push(...await serializeMessagesWithImages(options.messages, attachments));',
      '\treturn { ...body, messages };',
      '}',
      parseMarker,
    ].join('\n'),
    'DeepSeek vision request serialization',
  )

  apply(
    [
      'var DeepSeekAdapter = class extends LlmAdapter {',
      '\tconfig;',
      '\tconstructor(config) {',
    ].join('\n'),
    [
      'var DeepSeekAdapter = class extends LlmAdapter {',
      '\tconfig;',
      '\tdiscoveryCache;',
      '\tdiscoveryPromise;',
      '\tconstructor(config) {',
    ].join('\n'),
    'DeepSeek model discovery state',
  )

  const staleCatalogFallback = [
    '\t\t\t} catch {',
    '\t\t\t\treturn connection.models;',
    '\t\t\t}',
    '\t\t})();',
  ].join('\n')
  if (source.includes(staleCatalogFallback)) {
    apply(
      staleCatalogFallback,
      [
        '\t\t\t} catch {',
        '\t\t\t\treturn this.discoveryCache?.baseURL === connection.baseURL ? this.discoveryCache.models : connection.models;',
        '\t\t\t}',
        '\t\t})();',
      ].join('\n'),
      'DeepSeek last-known model catalog fallback',
    )
  }

  apply(
    [
      '\tlistModels(provider) {',
      '\t\treturn Promise.resolve(this.config.options().models.map((model) => modelInfo(provider, model)));',
      '\t}',
      '\tresolveModel(provider, model, _signal) {',
      '\t\tconst connection = this.config.options();',
      '\t\tconst configured = connection.models.find((entry) => entry.id === model);',
    ].join('\n'),
    [
      '\tasync listModels(provider) {',
      '\t\tconst connection = this.config.options();',
      '\t\tconst now = Date.now();',
      '\t\tif (this.discoveryCache?.baseURL === connection.baseURL && this.discoveryCache.expiresAt > now) return this.discoveryCache.models.map((model) => modelInfo(provider, model));',
      '\t\tif (this.discoveryPromise?.baseURL === connection.baseURL) return (await this.discoveryPromise.promise).map((model) => modelInfo(provider, model));',
      '\t\tconst promise = (async () => {',
      '\t\t\ttry {',
      '\t\t\t\tconst apiKey = await this.config.resolveApiKey(connection);',
      '\t\t\t\tconst response = await fetch(connection.baseURL.replace(/\\\/+$/, "") + "/models", {',
      '\t\t\t\t\theaders: { authorization: "Bearer " + apiKey, accept: "application/json", ...attributionHeaders() },',
      '\t\t\t\t\tsignal: AbortSignal.timeout(15e3)',
      '\t\t\t\t});',
      '\t\t\t\tif (!response.ok) throw new Error("DeepSeek model discovery returned HTTP " + response.status);',
      '\t\t\t\tconst payload = await response.json();',
      '\t\t\t\tif (!Array.isArray(payload?.data)) throw new Error("DeepSeek model discovery returned no data array");',
      '\t\t\t\tconst configured = new Map(connection.models.map((model) => [model.id, model]));',
      '\t\t\t\tconst seen = new Set();',
      '\t\t\t\tconst models = [];',
      '\t\t\t\tfor (const entry of payload.data) {',
      '\t\t\t\t\tconst id = typeof entry?.id === "string" ? entry.id.trim() : "";',
      '\t\t\t\t\tif (!id || id.length > 200 || seen.has(id)) continue;',
      '\t\t\t\t\tseen.add(id);',
      '\t\t\t\t\tmodels.push(configured.get(id) ?? { id, name: id });',
      '\t\t\t\t}',
      '\t\t\t\tif (models.length === 0) throw new Error("DeepSeek model discovery returned an empty catalog");',
      '\t\t\t\tthis.discoveryCache = { baseURL: connection.baseURL, expiresAt: Date.now() + MODEL_DISCOVERY_TTL_MS, models };',
      '\t\t\t\treturn models;',
      '\t\t\t} catch {',
      '\t\t\t\treturn this.discoveryCache?.baseURL === connection.baseURL ? this.discoveryCache.models : connection.models;',
      '\t\t\t}',
      '\t\t})();',
      '\t\tthis.discoveryPromise = { baseURL: connection.baseURL, promise };',
      '\t\ttry {',
      '\t\t\treturn (await promise).map((model) => modelInfo(provider, model));',
      '\t\t} finally {',
      '\t\t\tif (this.discoveryPromise?.promise === promise) this.discoveryPromise = void 0;',
      '\t\t}',
      '\t}',
      '\tresolveModel(provider, model, _signal) {',
      '\t\tconst connection = this.config.options();',
      '\t\tconst discovered = this.discoveryCache?.baseURL === connection.baseURL ? this.discoveryCache.models.find((entry) => entry.id === model) : void 0;',
      '\t\tconst configured = connection.models.find((entry) => entry.id === model) ?? discovered;',
    ].join('\n'),
    'DeepSeek live model discovery',
  )

  apply(
    [
      '\t\t\tconst watchdog = __addDisposableResource(env_1, idleWatchdog(options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]), connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE), false);',
      '\t\t\tconst iterator = this.request(options, watchdog.signal, connection, apiKey, userId, () => {',
      '\t\t\t\twatchdog.pulse();',
      '\t\t\t})[Symbol.asyncIterator]();',
    ].join('\n'),
    [
      '\t\t\tconst watchdog = __addDisposableResource(env_1, idleWatchdog(options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]), connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE), false);',
      '\t\t\tconst containsImage = options.messages.some((message) => contentHasImage(message.content));',
      '\t\t\tconst acceptsImages = VISION_MODEL_ID_PATTERN.test(options.model);',
      '\t\t\tconst attachments = containsImage && acceptsImages ? this.config.resolveAttachments?.() : void 0;',
      '\t\t\tif (containsImage && acceptsImages && attachments === void 0) throw new LlmError("DeepSeek vision input requires the durable attachment service", "UNSUPPORTED_CONTENT");',
      '\t\t\tconst iterator = this.request(options, watchdog.signal, connection, apiKey, userId, () => {',
      '\t\t\t\twatchdog.pulse();',
      '\t\t\t}, attachments)[Symbol.asyncIterator]();',
    ].join('\n'),
    'DeepSeek vision attachment resolution',
  )

  apply(
    [
      '\tasync *request(options, signal, connection, apiKey, userId, onComment) {',
      '\t\tconst body = serializeRequest(options, connection.defaults);',
    ].join('\n'),
    [
      '\tasync *request(options, signal, connection, apiKey, userId, onComment, attachments) {',
      '\t\tconst body = attachments === void 0 ? serializeRequest(options, connection.defaults) : await serializeRequestWithImages(options, connection.defaults, attachments);',
    ].join('\n'),
    'DeepSeek vision request selection',
  )

  apply(
    [
      '}, {',
      '\tid: "deepseek-v4-pro",',
      '\tname: "DeepSeek-V4-Pro",',
      '\tcontextWindow: DEFAULT_CONTEXT_WINDOW',
      '}];',
    ].join('\n'),
    [
      '}, {',
      '\tid: "deepseek-v4-pro",',
      '\tname: "DeepSeek-V4-Pro",',
      '\tcontextWindow: DEFAULT_CONTEXT_WINDOW',
      '}, {',
      '\tid: "deepseek-v4-flash-vision-exp",',
      '\tname: "DeepSeek-V4-Flash-Vision-Exp",',
      '\tdescription: "Experimental native multimodal vision model",',
      '\tcontextWindow: DEFAULT_CONTEXT_WINDOW',
      '}];',
    ].join('\n'),
    'DeepSeek vision fallback model',
  )

  apply(
    [
      '\tconst adapter = new DeepSeekAdapter({',
      '\t\toptions,',
      '\t\tresolveApiKey,',
      '\t\tresolveUserId',
      '\t});',
    ].join('\n'),
    [
      '\tconst adapter = new DeepSeekAdapter({',
      '\t\toptions,',
      '\t\tresolveApiKey,',
      '\t\tresolveUserId,',
      '\t\tresolveAttachments: () => ctx.get("attachments")',
      '\t});',
    ].join('\n'),
    'DeepSeek attachment service injection',
  )

  return { source, changed }
}

function patchDeepSeekAdapter(source) {
  const projection = patchDeepSeekImageProjection(source)
  const models = patchDeepSeekDynamicModels(projection.source)
  return { source: models.source, changed: projection.changed || models.changed }
}

function patchDeepSeekAdapterTypes(source) {
  let changed = false
  const apply = (before, after, label) => {
    const result = replaceOnce(source, before, after, label)
    source = result.source
    changed = changed || result.changed
  }
  apply(
    "import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';",
    [
      "import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';",
      "import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';",
    ].join('\n'),
    'DeepSeek attachment type import',
  )
  apply(
    [
      '    /** Resolve the harness-home anonymous id shared with telemetry and feedback. */',
      '    resolveUserId: () => AnonymousUserId;',
    ].join('\n'),
    [
      '    /** Resolve the harness-home anonymous id shared with telemetry and feedback. */',
      '    resolveUserId: () => AnonymousUserId;',
      '    /** Resolve durable image bytes when the selected model accepts vision input. */',
      '    resolveAttachments?: () => AttachmentStore | undefined;',
    ].join('\n'),
    'DeepSeek attachment resolver type',
  )
  return { source, changed }
}

function patchDeepSeekIndexTypes(source) {
  return replaceOnce(
    source,
    '    /** Advisory models shown by discovery consumers; defaults to V4 Flash and V4 Pro. */',
    '    /** Fallback models shown when live GET /models discovery is unavailable. */',
    'DeepSeek dynamic model config documentation',
  )
}

function patchDeepSeekSerializeTypes(source) {
  return replaceOnce(
    source,
    [
      ' * thinking-mode passback. Core image blocks are rejected explicitly because this wire route is text-only;',
      " * unknown declaration-merged block types retain the adapter's documented extension fallback.",
    ].join('\n'),
    [
      ' * thinking-mode passback. Native vision models receive user image blocks through OpenAI-compatible',
      " * image_url parts; text-only models project historical images to a placeholder.",
    ].join('\n'),
    'DeepSeek vision serializer documentation',
  )
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
    patchFile(path.join(nodeModules, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'types', 'adapter.d.ts'), patchDeepSeekAdapterTypes),
    patchFile(path.join(nodeModules, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'types', 'index.d.ts'), patchDeepSeekIndexTypes),
    patchFile(path.join(nodeModules, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'types', 'serialize.d.ts'), patchDeepSeekSerializeTypes),
  ]
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'))
  for (const result of patchDshModelSwitch(root)) {
    process.stdout.write(`${result.changed ? 'patched' : 'already patched'} ${result.filePath}\n`)
  }
}

module.exports = {
  IMAGE_PLACEHOLDER,
  patchApiProxy,
  patchDeepSeekAdapter,
  patchDeepSeekAdapterTypes,
  patchDeepSeekDynamicModels,
  patchDeepSeekImageProjection,
  patchDeepSeekIndexTypes,
  patchDeepSeekSerializeTypes,
  patchDshModelSwitch,
}
