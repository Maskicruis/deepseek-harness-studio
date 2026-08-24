const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('app PNG is a 512px DeepSeek Harness Studio source icon', () => {
  const buffer = fs.readFileSync(path.join(root, 'build', 'app.png'))
  assert.deepEqual(buffer.subarray(0, 8), pngSignature)
  assert.equal(buffer.readUInt32BE(16), 512)
  assert.equal(buffer.readUInt32BE(20), 512)
})

test('Windows ICO contains dedicated frames from 16px through 256px', () => {
  const buffer = fs.readFileSync(path.join(root, 'build', 'app.ico'))
  assert.equal(buffer.readUInt16LE(0), 0)
  assert.equal(buffer.readUInt16LE(2), 1)
  const count = buffer.readUInt16LE(4)
  assert.equal(count, 7)
  const sizes = []
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16
    const rawSize = buffer.readUInt8(entry)
    const size = rawSize || 256
    const length = buffer.readUInt32LE(entry + 8)
    const offset = buffer.readUInt32LE(entry + 12)
    sizes.push(size)
    assert.equal(buffer.readUInt8(entry + 1) || 256, size)
    assert.equal(buffer.readUInt16LE(entry + 4), 1)
    assert.equal(buffer.readUInt16LE(entry + 6), 32)
    assert.ok(offset + length <= buffer.length)
    assert.deepEqual(buffer.subarray(offset, offset + 8), pngSignature)
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])
})
