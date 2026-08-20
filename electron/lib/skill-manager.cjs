const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_FILES = 500
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

function parseSkillDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter。')
  const metadata = YAML.parse(match[1]) || {}
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
  if (!SKILL_NAME.test(name)) throw new Error('Skill 名称必须使用小写 kebab-case。')
  if (!description) throw new Error('Skill 必须提供 description。')
  return { name, description }
}

function assertDirectChild(root, target) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (path.dirname(resolvedTarget) !== resolvedRoot) throw new Error('Skill 目标路径越界。')
  return resolvedTarget
}

function copyBundleSafe(source, destination) {
  let files = 0
  let bytes = 0
  const visit = (currentSource, currentDestination) => {
    const stat = fs.lstatSync(currentSource)
    if (stat.isSymbolicLink()) throw new Error('Skill 包不能包含符号链接。')
    if (stat.isDirectory()) {
      fs.mkdirSync(currentDestination, { recursive: true })
      for (const entry of fs.readdirSync(currentSource)) visit(path.join(currentSource, entry), path.join(currentDestination, entry))
      return
    }
    if (!stat.isFile()) throw new Error('Skill 包包含不支持的文件类型。')
    files += 1
    bytes += stat.size
    if (files > MAX_FILES || bytes > MAX_TOTAL_BYTES) throw new Error('Skill 包超过 500 个文件或 25 MB 限制。')
    fs.copyFileSync(currentSource, currentDestination, fs.constants.COPYFILE_EXCL)
  }
  visit(source, destination)
}

class SkillManager {
  constructor({ dshHome = path.join(os.homedir(), '.dsh') } = {}) {
    this.dshHome = dshHome
  }

  get skillRoot() {
    return path.join(this.dshHome, 'skills')
  }

  list() {
    fs.mkdirSync(this.skillRoot, { recursive: true })
    const skills = []
    for (const entry of fs.readdirSync(this.skillRoot, { withFileTypes: true })) {
      if (entry.name === '.system' || entry.name.startsWith('.studio-import-')) continue
      const bundlePath = path.join(this.skillRoot, entry.name)
      const documentPath = entry.isDirectory() ? path.join(bundlePath, 'SKILL.md') : entry.isFile() && entry.name.endsWith('.md') ? bundlePath : ''
      if (!documentPath || !fs.existsSync(documentPath)) continue
      try {
        const metadata = parseSkillDocument(documentPath)
        skills.push({ ...metadata, path: bundlePath, kind: entry.isDirectory() ? 'bundle' : 'markdown' })
      } catch {
        // Invalid entries remain on disk but are omitted, matching DSH discovery behavior.
      }
    }
    skills.sort((left, right) => left.name.localeCompare(right.name))
    return { root: this.skillRoot, skills, count: skills.length }
  }

  install(source) {
    const sourcePath = path.resolve(String(source || ''))
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) throw new Error('请选择包含 SKILL.md 的技能目录。')
    const documentPath = path.join(sourcePath, 'SKILL.md')
    if (!fs.existsSync(documentPath)) throw new Error('所选目录中没有 SKILL.md。')
    const metadata = parseSkillDocument(documentPath)
    fs.mkdirSync(this.skillRoot, { recursive: true })
    const destination = assertDirectChild(this.skillRoot, path.join(this.skillRoot, metadata.name))
    if (fs.existsSync(destination)) throw new Error(`Skill ${metadata.name} 已存在，请先移除后再导入。`)
    const staging = assertDirectChild(this.skillRoot, path.join(this.skillRoot, `.studio-import-${randomUUID()}`))
    try {
      copyBundleSafe(sourcePath, staging)
      fs.renameSync(staging, destination)
    } catch (error) {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true })
      throw error
    }
    return { skill: { ...metadata, path: destination, kind: 'bundle' }, inventory: this.list() }
  }

  remove(name) {
    const skillName = String(name || '').trim()
    if (!SKILL_NAME.test(skillName)) throw new Error('Skill 名称无效。')
    const inventory = this.list()
    const skill = inventory.skills.find((entry) => entry.name === skillName)
    if (!skill) throw new Error('未找到该 Skill。')
    const target = assertDirectChild(this.skillRoot, skill.path)
    fs.rmSync(target, { recursive: skill.kind === 'bundle', force: false })
    return this.list()
  }
}

module.exports = {
  MAX_FILES,
  MAX_TOTAL_BYTES,
  SKILL_NAME,
  SkillManager,
  assertDirectChild,
  copyBundleSafe,
  parseSkillDocument,
}
