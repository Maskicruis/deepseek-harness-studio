const fs = require('node:fs')
const path = require('node:path')
const { parseGitHubRepository } = require('../electron/lib/update-manager.cjs')

const requested = process.argv[2] || process.env.GITHUB_REPOSITORY || ''
const repository = parseGitHubRepository(requested)
if (!repository) {
  console.error('用法: npm run update:configure -- owner/repository')
  process.exitCode = 1
} else {
  const output = path.join(__dirname, '..', 'build', 'update-config.json')
  fs.writeFileSync(output, `${JSON.stringify({ repository: repository.slug }, null, 2)}\n`, 'utf8')
  console.log(`更新仓库已设置为 ${repository.slug}`)
}
