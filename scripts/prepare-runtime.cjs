const fs = require('node:fs')
const path = require('node:path')

const destination = path.resolve(__dirname, '..', 'assets', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
fs.mkdirSync(path.dirname(destination), { recursive: true })
if (path.resolve(process.execPath) !== destination) fs.copyFileSync(process.execPath, destination)
console.log(`Bundled Node runtime prepared: ${destination}`)
