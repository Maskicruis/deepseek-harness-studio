const test = require('node:test')
const assert = require('node:assert/strict')

test('DeepSeek adapter discovers future models and sends native vision input', async () => {
  const { DeepSeekAdapter, resolveAdapterOptions } = await import('@deepseek-ai/dsh-llm-deepseek')
  const connection = resolveAdapterOptions({})
  const originalFetch = global.fetch
  const requests = []
  let modelRequests = 0
  let attachmentReads = 0
  const imageRef = {
    attachmentId: 'sha256:test-image',
    mediaType: 'image/png',
    bytes: 4,
    width: 1,
    height: 1,
    name: 'test.png',
  }
  const adapter = new DeepSeekAdapter({
    options: () => connection,
    resolveApiKey: async () => 'sk-test',
    resolveUserId: () => 'test-user',
    resolveAttachments: () => ({
      readImage: async (ref) => {
        attachmentReads += 1
        assert.deepEqual(ref, imageRef)
        return { ref, data: Uint8Array.from([137, 80, 78, 71]) }
      },
    }),
  })

  global.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/models')) {
      modelRequests += 1
      return new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
          { id: 'deepseek-v4-flash-vision-exp', object: 'model', owned_by: 'deepseek' },
          { id: 'deepseek-v5-future', object: 'model', owned_by: 'deepseek' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    requests.push({ url: String(url), body: JSON.parse(init.body) })
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n')
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }

  try {
    const first = await adapter.listModels('deepseek-official')
    const second = await adapter.listModels('deepseek-official')
    assert.equal(modelRequests, 1)
    assert.deepEqual(first.map((model) => model.id), [
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v5-future',
    ])
    assert.deepEqual(second, first)
    assert.deepEqual(first[1].inputModalities, ['text', 'image'])
    assert.deepEqual(first[2].inputModalities, ['text'])

    adapter.discoveryCache.expiresAt = 0
    global.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/models')) {
        modelRequests += 1
        throw new Error('temporary discovery failure')
      }
      requests.push({ url: String(url), body: JSON.parse(init.body) })
      const sse = [
        'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
        '',
      ].join('\n')
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const retained = await adapter.listModels('deepseek-official')
    assert.equal(modelRequests, 2)
    assert.deepEqual(retained, first)

    const resolvedVision = await adapter.resolveModel('deepseek-official', 'deepseek-v4-flash-vision-exp')
    const resolvedFuture = await adapter.resolveModel('deepseek-official', 'deepseek-v5-future')
    assert.deepEqual(resolvedVision.inputModalities, ['text', 'image'])
    assert.equal(resolvedFuture.id, 'deepseek-v5-future')

    const message = {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image.' },
        { type: 'image', attachment: imageRef },
      ],
    }
    for await (const _chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      messages: [message],
    })) {}
    assert.equal(attachmentReads, 1)
    assert.equal(requests[0].body.model, 'deepseek-v4-flash-vision-exp')
    assert.deepEqual(requests[0].body.messages[0].content, [
      { type: 'text', text: 'Describe this image.' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw==', detail: 'auto' },
      },
    ])

    for await (const _chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      messages: [message],
    })) {}
    assert.equal(attachmentReads, 1)
    assert.match(requests[1].body.messages[0].content, /Image omitted/)
  } finally {
    global.fetch = originalFetch
  }
})
